import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ✨ ENHANCED WITH: Extended Thinking + Intelligent Analysis + Auto-Structure
// The AI now:
// 1. Analyzes content structure BEFORE generating
// 2. Uses extended thinking to reason through optimal slide flow
// 3. Auto-detects topics, learning outcomes, prerequisites
// 4. Intelligently orders slides by cognitive progression
// 5. Automatically fills missing course details

const MAX_PASTE_CHARS = 12000;

// 🚀 FIX 1: Prioritize v1beta for all models. 
// v1beta is required for stable "responseSchema" (Structured Outputs) support.
const GEMINI_MODELS = [
  { name: "gemini-1.5-flash", apiVersion: "v1beta" },
  { name: "gemini-1.5-flash-8b", apiVersion: "v1beta" }, // Added 8b as it's highly available
  { name: "gemini-1.5-pro", apiVersion: "v1beta" },
];

// Fallback: Try "-latest" variants if standard aliases fail
const GEMINI_MODELS_BETA = [
  { name: "gemini-1.5-flash-latest", apiVersion: "v1beta" },
  { name: "gemini-1.5-pro-latest", apiVersion: "v1beta" },
];

// ========== Input validation ==========
const GenerateInput = z.object({
  mode: z.enum(["brief", "paste"]).default("brief"),
  apiKey: z.string().optional().default(""),
  topic: z.string().optional().default(""),
  pastedContent: z
    .string()
    .optional()
    .default("")
    .refine((v) => v.length <= MAX_PASTE_CHARS, {
      message: `Pasted content is too long (max ${MAX_PASTE_CHARS} characters).`,
    }),
  courseName: z.string().optional().default(""),
  courseCode: z.string().optional().default(""),
  courseLevel: z.string().optional().default(""),
  creditUnits: z.string().optional().default(""),
  contactTime: z.string().optional().default(""),
  slideCount: z.number().int().min(4).max(24).default(10),
  extraNotes: z.string().optional().default(""),
  enableExtendedThinking: z.boolean().optional().default(true),
});

type GenerateInputT = z.infer<typeof GenerateInput>;

export type SlideSpec = {
  type: "title" | "identification" | "content" | "list" | "takeaway";
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  sections?: { heading: string; description: string }[];
};

export type SlideDeck = {
  courseName: string;
  courseCode: string;
  courseLevel: string;
  creditUnits: string;
  contactTime: string;
  topic: string;
  slides: SlideSpec[];
};

// ========== Content Analysis Schema ==========
export type ContentAnalysis = {
  detectedTopic: string;
  keyTopics: string[];
  learningOutcomes: string[];
  estimatedLevel: string;
  suggestedStructure: string[];
  detectedCourseInfo: {
    courseName?: string;
    courseCode?: string;
    courseLevel?: string;
    creditUnits?: string;
    contactTime?: string;
  };
  contentComplexity: "basic" | "intermediate" | "advanced";
  recommendedSlideCount: number;
};

// ========== Content Clamping (Layout Safety) ==========
const MAX_BULLETS = 4;
const MAX_BULLET_CHARS = 75;
const MAX_BODY_CHARS = 180;
const MAX_TITLE_CHARS = 55;

function clamp(text: string, max: number): string {
  const t = (text ?? "").toString().trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

const SLIDE_TYPES = new Set([
  "title",
  "identification",
  "content",
  "list",
  "takeaway",
]);

function clampSlide(spec: Record<string, unknown>): SlideSpec {
  const type = SLIDE_TYPES.has(spec.type as string)
    ? (spec.type as SlideSpec["type"])
    : "content";

  const bulletsIn = Array.isArray(spec.bullets) ? spec.bullets : [];
  const sectionsIn = Array.isArray(spec.sections) ? spec.sections : [];

  const bullets = bulletsIn
    .filter((b: unknown): b is string => typeof b === "string" && b.trim().length > 0)
    .slice(0, MAX_BULLETS)
    .map((b) => clamp(b, MAX_BULLET_CHARS));

  const sections = sectionsIn
    .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === "object")
    .filter(
      (s) => typeof s.heading === "string" || typeof s.description === "string",
    )
    .slice(0, 3)
    .map((s) => ({
      heading: clamp(typeof s.heading === "string" ? s.heading : "", 35),
      description: clamp(
        typeof s.description === "string" ? s.description : "",
        100,
      ),
    }));

  return {
    type,
    title: clamp(typeof spec.title === "string" ? spec.title : "", MAX_TITLE_CHARS),
    subtitle:
      typeof spec.subtitle === "string" && spec.subtitle.trim()
        ? clamp(spec.subtitle, 80)
        : undefined,
    body:
      typeof spec.body === "string" && spec.body.trim()
        ? clamp(spec.body, MAX_BODY_CHARS)
        : undefined,
    bullets: bullets.length ? bullets : undefined,
    sections: sections.length ? sections : undefined,
  };
}

// ========== Gemini Structured Output Schemas ==========
const analysisSchema = {
  type: "OBJECT",
  properties: {
    detectedTopic: { type: "STRING" },
    keyTopics: { type: "ARRAY", items: { type: "STRING" } },
    learningOutcomes: { type: "ARRAY", items: { type: "STRING" } },
    estimatedLevel: { type: "STRING" },
    suggestedStructure: { type: "ARRAY", items: { type: "STRING" } },
    detectedCourseInfo: {
      type: "OBJECT",
      properties: {
        courseName: { type: "STRING" },
        courseCode: { type: "STRING" },
        courseLevel: { type: "STRING" },
        creditUnits: { type: "STRING" },
        contactTime: { type: "STRING" },
      },
    },
    contentComplexity: { type: "STRING", enum: ["basic", "intermediate", "advanced"] },
    recommendedSlideCount: { type: "INTEGER" },
  },
  required: ["detectedTopic", "keyTopics", "suggestedStructure"],
};

const deckSchema = {
  type: "OBJECT",
  properties: {
    courseName: { type: "STRING" },
    courseCode: { type: "STRING" },
    courseLevel: { type: "STRING" },
    creditUnits: { type: "STRING" },
    contactTime: { type: "STRING" },
    topic: { type: "STRING" },
    slides: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: {
            type: "STRING",
            enum: ["title", "identification", "content", "list", "takeaway"],
          },
          title: { type: "STRING" },
          subtitle: { type: "STRING" },
          body: { type: "STRING" },
          bullets: { type: "ARRAY", items: { type: "STRING" } },
          sections: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                heading: { type: "STRING" },
                description: { type: "STRING" },
              },
              required: ["heading", "description"],
            },
          },
        },
        required: ["type", "title"],
      },
    },
  },
  required: ["topic", "slides"],
};

// ========== PHASE 1: Intelligent Content Analysis ==========

function buildAnalysisPrompt(data: GenerateInputT): string {
  const content = data.mode === "paste" ? data.pastedContent : `Topic: ${data.topic}`;

  return `You are an expert curriculum designer and educational strategist. Your task is to DEEPLY ANALYZE educational content and structure it optimally for learning.

ANALYZE this material and provide intelligent insights about its structure, prerequisites, and learning progression:

${content}

Return ONLY valid JSON matching the exact schema requirements.

REASONING TO APPLY:
1. Identify natural cognitive progression (simple → complex)
2. Detect prerequisite knowledge
3. Find concept connections
4. Suggest optimal learning sequence
5. Identify practical applications`;
}

async function analyzeContent(
  apiKey: string,
  data: GenerateInputT,
): Promise<ContentAnalysis> {
  const prompt = buildAnalysisPrompt(data);

  try {
    const response = await callGeminiWithSmartFallback(
      apiKey,
      prompt,
      analysisSchema,
      data.enableExtendedThinking,
    );

    return {
      detectedTopic: response.detectedTopic as string || data.topic || "Lecture",
      keyTopics: Array.isArray(response.keyTopics) ? response.keyTopics : [],
      learningOutcomes: Array.isArray(response.learningOutcomes)
        ? response.learningOutcomes
        : [],
      estimatedLevel: response.estimatedLevel as string || "Intermediate",
      suggestedStructure: Array.isArray(response.suggestedStructure)
        ? response.suggestedStructure
        : [],
      detectedCourseInfo: (response.detectedCourseInfo as any) || {},
      contentComplexity: (response.contentComplexity as any) || "intermediate",
      recommendedSlideCount: Math.min(
        Math.max((response.recommendedSlideCount as number) || 10, 4),
        24,
      ),
    };
  } catch (err) {
    console.error("Analysis phase failed, using defaults", err);
    return {
      detectedTopic: data.topic || "Lecture",
      keyTopics: [],
      learningOutcomes: [],
      estimatedLevel: "Intermediate",
      suggestedStructure: [],
      detectedCourseInfo: {},
      contentComplexity: "intermediate",
      recommendedSlideCount: data.slideCount,
    };
  }
}

// ========== PHASE 2: AI-Powered Slide Generation ==========

function buildGenerationPrompt(
  data: GenerateInputT,
  analysis: ContentAnalysis,
): string {
  const courseInfo = [
    data.courseName || analysis.detectedCourseInfo.courseName,
    data.courseCode || analysis.detectedCourseInfo.courseCode,
    data.courseLevel || analysis.detectedCourseInfo.courseLevel,
    data.creditUnits || analysis.detectedCourseInfo.creditUnits,
    data.contactTime || analysis.detectedCourseInfo.contactTime,
  ]
    .filter(Boolean)
    .join(" | ");

  const structureGuidance =
    analysis.suggestedStructure.length > 0
      ? `COGNITIVE PROGRESSION TO FOLLOW:\n${analysis.suggestedStructure
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n")}\n\n`
      : "";

  return `You are building a world-class university lecture deck for Metropolitan International University (MIU).

STRATEGIC CONTENT ANALYSIS:
- Primary Topic: ${analysis.detectedTopic}
- Key Concepts: ${analysis.keyTopics.slice(0, 4).join(", ")}
- Learning Outcomes: ${analysis.learningOutcomes.slice(0, 3).join("; ")}
- Level: ${analysis.estimatedLevel} | Complexity: ${analysis.contentComplexity}

${structureGuidance}

GENERATION REQUIREMENTS:
- Create EXACTLY ${data.slideCount} slides in OPTIMAL COGNITIVE ORDER
- Slide 1: type "title" — Topic: "${analysis.detectedTopic}"
- Slide 2: type "identification" — Course details (${courseInfo || "Course Information"})
- Slides 3-${data.slideCount - 1}: type "content" or "list" — Follow the suggested structure, building from foundations to applications
- Last Slide: type "takeaway" — 4 essential learner takeaways
- ORDERING: Arrange by learning progression (basics → advanced → practical application)

CONTENT RULES (CRITICAL FOR LAYOUT):
- Titles: Maximum ${MAX_TITLE_CHARS} characters (no wrapping)
- Body text: Maximum ${MAX_BODY_CHARS} characters (punchy, focused)
- Bullets: Maximum ${MAX_BULLETS} bullets per slide, each ≤${MAX_BULLET_CHARS} characters
- White space: Prioritize clarity, never overflow
- Each slide = ONE clear concept or theme
- Avoid paragraphs; use structure and bullet points

${data.mode === "paste" ? `Source Material:\n"""\n${data.pastedContent}\n"""` : ""}

${data.extraNotes ? `Instructor Guidance: ${data.extraNotes}` : ""}

RETURN ONLY: Valid JSON matching the slide schema. No markdown. No explanation.`;
}

// ========== Gemini API Integration ==========

class GeminiError extends Error {}

const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithThinking(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  useThinking: boolean,
  modelConfig: { name: string; apiVersion: string } = { name: "gemini-1.5-flash", apiVersion: "v1beta" },
): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/${modelConfig.apiVersion}/models/${modelConfig.name}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Extended thinking only works on specific experimental models
  const supportsThinking = modelConfig.name.includes("thinking");
  const shouldUseThinking = useThinking && supportsThinking;

  const body = shouldUseThinking
    ? {
        systemInstruction: {
          parts: [
            {
              text: "You are an expert curriculum designer. Think deeply and reason through optimal educational structure. Ensure slides follow cognitive learning progression.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          thinking: { budgetTokens: 8000 },
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }
    : {
        systemInstruction: {
          parts: [
            {
              text: "You are an expert curriculum designer. Ensure slides follow cognitive learning progression and learning science principles.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errorDetail = "";
      try {
        const errorJson = await res.json();
        errorDetail = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch {
        errorDetail = await res.text().catch(() => "");
      }

      if (res.status === 404) {
        throw new GeminiError(
          `MODEL_NOT_FOUND: "${modelConfig.name}" not available via ${modelConfig.apiVersion}. Trying alternate model...`,
        );
      }
      if (res.status === 400 && errorDetail.includes("thinking")) {
        throw new GeminiError(
          `Thinking feature not supported. Using standard mode...`,
        );
      }
      if (res.status === 429) {
        const err = new GeminiError("Rate limited. Applying backoff...");
        (err as any).status = 429;
        throw err;
      }
      if (res.status === 400 || res.status === 403) {
        throw new GeminiError(
          `API Error (${res.status}): ${errorDetail || "Verify API key is valid and has access."}`,
        );
      }

      const err = new GeminiError(
        `Gemini request failed (${res.status}): ${errorDetail.slice(0, 200)}`,
      );
      (err as any).status = res.status;
      throw err;
    }

    const json = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: { text?: string }) => p?.text ?? "").join("")
      : "";

    if (!text.trim()) {
      throw new GeminiError("Gemini returned empty response. Retrying...");
    }

    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GeminiError) {
      // Ensure the status code persists through the custom error wrapping
      if ((err.message.includes("API Error (400)"))) (err as any).status = 400;
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeminiError("Request timeout. Please try again.");
    }
    throw new GeminiError(
      err instanceof Error ? err.message : "Unknown error calling Gemini",
    );
  }
}

async function generateSlidesWithFullAnalysis(
  apiKey: string,
  data: GenerateInputT,
): Promise<SlideDeck> {
  // ========== PHASE 1: Content Analysis ==========
  console.log("📊 Phase 1: Analyzing content intelligence...");
  const analysis = await analyzeContent(apiKey, data);
  console.log(`  ✓ Topic: ${analysis.detectedTopic}`);
  console.log(`  ✓ Concepts: ${analysis.keyTopics.slice(0, 3).join(", ")}`);
  console.log(`  ✓ Level: ${analysis.estimatedLevel}`);

  // ========== PHASE 2: Intelligent Slide Generation ==========
  console.log("🧠 Phase 2: Generating slides with extended reasoning...");
  const prompt = buildGenerationPrompt(data, analysis);
  
  let parsed: Record<string, unknown>;
  
  // Use smart fallback to find working model
  parsed = await callGeminiWithSmartFallback(
    apiKey,
    prompt,
    deckSchema,
    data.enableExtendedThinking,
  );

  console.log("✓ Slides generated and validated");
  return toSlideDeck(data, analysis, parsed);
}

// ========== Smart Model Selection with Fallback ==========

async function callGeminiWithSmartFallback(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  useThinking: boolean,
): Promise<Record<string, unknown>> {
  // Try models in order with fallback
  const modelsToTry = [...GEMINI_MODELS, ...GEMINI_MODELS_BETA];
  let lastError: Error | null = null;

  for (const modelConfig of modelsToTry) {
    try {
      console.log(`🔄 Trying model: ${modelConfig.name} (${modelConfig.apiVersion})...`);
      return await callGeminiWithThinking(
        apiKey,
        prompt,
        schema,
        useThinking,
        modelConfig,
      );
    } catch (err) {
      lastError = err;
      const status = (err as any)?.status;
      const message = err instanceof Error ? err.message : String(err);

      // 🚀 FIX 2: Do NOT silently swallow 400 (Bad Request) errors! 
      // If the schema or prompt is strictly invalid, we want to know immediately.
      if (status === 400 && !message.includes("Thinking feature not supported")) {
        console.error(`🚨 Schema/Payload Error on ${modelConfig.name}:`, message);
        throw err; 
      }

      // If 404, this model isn't available - try next
      if (status === 404 || message.includes("MODEL_NOT_FOUND")) {
        console.log(`⚠️  ${modelConfig.name} not available, trying next...`);
        continue;
      }

      // If thinking not supported but useThinking was true, try without thinking on same model
      if (useThinking && message.includes("Thinking feature not supported")) {
        try {
          console.log(`⚠️  Thinking not supported, retrying without thinking...`);
          return await callGeminiWithThinking(
            apiKey,
            prompt,
            schema,
            false,
            modelConfig,
          );
        } catch (retryErr) {
          lastError = retryErr;
          continue;
        }
      }

      // Rate limit - wait and retry
      if (status === 429) {
        console.log(`⏳ Rate limited, waiting before retry...`);
        await sleep(5000);
        continue;
      }

      // Other errors might be retryable (500s)
      if (status && [500, 502, 503, 504].includes(status)) {
        console.log(`⚠️  Server error, retrying...`);
        await sleep(2000);
        continue;
      }

      // If it's a permission error, no point retrying
      if (message.includes("API key") || message.includes("permission")) {
        throw err;
      }
    }
  }

  // All models failed
  throw new GeminiError(
    lastError instanceof Error
      ? `All Gemini models exhausted. Last error: ${lastError.message}\n\nTroubleshooting:\n1. Verify your API key is correct (from https://aistudio.google.com/apikey)\n2. Ensure the Generative Language API is enabled in Google Cloud\n3. Check if your region/IP is restricted by Google`
      : "All models failed. Please check your API key and network.",
  );
}

// ========== Response Processing ==========

const MAX_SLIDES_SAFETY_CAP = 40;

function toSlideDeck(
  data: GenerateInputT,
  analysis: ContentAnalysis,
  parsed: Record<string, unknown>,
): SlideDeck {
  try {
    const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
    const slides = rawSlides
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .slice(0, MAX_SLIDES_SAFETY_CAP)
      .map(clampSlide)
      .filter((s) => s.title || s.body || s.bullets?.length || s.sections?.length);

    if (!slides.length) {
      throw new GeminiError("No usable slides generated. Try again.");
    }

    // Enforce proper slide structure
    if (slides[0]?.type !== "title") {
      slides[0] = { ...slides[0], type: "title" };
    }
    if (slides.length > 1 && slides[1]?.type !== "identification") {
      slides[1] = { ...slides[1], type: "identification" };
    }
    if (slides[slides.length - 1]?.type !== "takeaway") {
      slides[slides.length - 1] = {
        ...slides[slides.length - 1],
        type: "takeaway",
      };
    }

    const topic = analysis.detectedTopic || data.topic || "Untitled Lecture";

    return {
      courseName:
        data.courseName ||
        analysis.detectedCourseInfo.courseName ||
        (typeof parsed.courseName === "string" ? parsed.courseName : "") ||
        "",
      courseCode:
        data.courseCode ||
        analysis.detectedCourseInfo.courseCode ||
        (typeof parsed.courseCode === "string" ? parsed.courseCode : "") ||
        "",
      courseLevel:
        data.courseLevel ||
        analysis.detectedCourseInfo.courseLevel ||
        (typeof parsed.courseLevel === "string" ? parsed.courseLevel : "") ||
        "",
      creditUnits:
        data.creditUnits ||
        analysis.detectedCourseInfo.creditUnits ||
        (typeof parsed.creditUnits === "string" ? parsed.creditUnits : "") ||
        "",
      contactTime:
        data.contactTime ||
        analysis.detectedCourseInfo.contactTime ||
        (typeof parsed.contactTime === "string" ? parsed.contactTime : "") ||
        "",
      topic: clamp(topic, MAX_TITLE_CHARS),
      slides,
    };
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    throw new GeminiError(
      "Failed to process Gemini response. Please try again.",
    );
  }
}

// ========== Public Server Function ==========

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    if (!data.apiKey.trim()) {
      throw new Error(
        "Add your Gemini API key from https://aistudio.google.com/apikey",
      );
    }
    if (data.mode === "paste" && data.pastedContent.trim().length < 20) {
      throw new Error("Please paste substantial course material (20+ characters).");
    }
    if (data.mode === "brief" && !data.topic.trim()) {
      throw new Error("Please enter a lecture topic.");
    }

    try {
      return await generateSlidesWithFullAnalysis(data.apiKey.trim(), data);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Slide generation failed. Please try again.",
      );
    }
  });
