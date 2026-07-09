import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_PASTE_CHARS = 12000;

// Updated to match 2026 stable production aliases
const GEMINI_MODELS = [
  { name: "gemini-2.5-flash", apiVersion: "v1beta" },
  { name: "gemini-2.5-pro", apiVersion: "v1beta" },
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
  suggestedFilename?: string;
  slides: SlideSpec[];
};

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

const MAX_BULLETS = 5;
const MAX_BULLET_CHARS = 140; 
const MAX_BODY_CHARS = 300;  
const MAX_TITLE_CHARS = 50;

function generateSafeFilename(courseName: string, courseCode: string, topic: string): string {
  const parts = [courseCode, courseName, topic].filter(Boolean);
  let rawName = parts.join("_");
  if (!rawName) rawName = "MIU_Lecture_Deck";
  return rawName.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function clamp(text: string, max: number): string {
  const t = (text ?? "").toString().trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

const SLIDE_TYPES = new Set(["title", "identification", "content", "list", "takeaway"]);

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
    .filter((s) => typeof s.heading === "string" || typeof s.description === "string")
    .slice(0, 3)
    .map((s) => ({
      heading: clamp(typeof s.heading === "string" ? s.heading : "", 35),
      description: clamp(typeof s.description === "string" ? s.description : "", 120),
    }));

  const hasSections = sections.length > 0;
  const hasBullets = bullets.length > 0;

  let finalBody = typeof spec.body === "string" && spec.body.trim()
      ? clamp(spec.body, MAX_BODY_CHARS)
      : undefined;
  
  let finalBullets = undefined;
  let finalSections = undefined;

  if (hasSections) {
    finalSections = sections;
    finalBody = undefined; 
    finalBullets = undefined;
  } else if (hasBullets) {
    finalBullets = bullets;
  }

  return {
    type,
    title: clamp(typeof spec.title === "string" ? spec.title : "", MAX_TITLE_CHARS),
    subtitle: typeof spec.subtitle === "string" && spec.subtitle.trim() ? clamp(spec.subtitle, 80) : undefined,
    body: finalBody,
    bullets: finalBullets,
    sections: finalSections,
  };
}

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
          type: { type: "STRING", enum: ["title", "identification", "content", "list", "takeaway"] },
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

function buildAnalysisPrompt(data: GenerateInputT): string {
  const content = data.mode === "paste" ? data.pastedContent : `Topic: ${data.topic}`;
  const contentSlideCount = Math.max(1, data.slideCount - 3);

  return `You are an expert curriculum designer and educational strategist. Your task is to DEEPLY ANALYZE educational content and structure it optimally for learning.

ANALYZE this material and provide intelligent insights about its structure, prerequisites, and learning progression:

${content}

Return ONLY valid JSON matching the exact schema requirements.

REASONING TO APPLY:
1. Identify natural cognitive progression (simple → complex)
2. Detect prerequisite knowledge
3. Find concept connections
4. Suggest an optimal learning sequence divided into EXACTLY ${contentSlideCount} distinct, sequential topics for the 'suggestedStructure' array.
5. Identify practical applications`;
}

async function analyzeContent(apiKey: string, data: GenerateInputT): Promise<ContentAnalysis> {
  const prompt = buildAnalysisPrompt(data);
  try {
    const response = await callGeminiWithSmartFallback(apiKey, prompt, analysisSchema, false);
    return {
      detectedTopic: response.detectedTopic as string || data.topic || "Lecture",
      keyTopics: Array.isArray(response.keyTopics) ? response.keyTopics : [],
      learningOutcomes: Array.isArray(response.learningOutcomes) ? response.learningOutcomes : [],
      estimatedLevel: response.estimatedLevel as string || "Intermediate",
      suggestedStructure: Array.isArray(response.suggestedStructure) ? response.suggestedStructure : [],
      detectedCourseInfo: (response.detectedCourseInfo as any) || {},
      contentComplexity: (response.contentComplexity as any) || "intermediate",
      recommendedSlideCount: Math.min(Math.max((response.recommendedSlideCount as number) || 10, 4), 24),
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

function buildGenerationPrompt(data: GenerateInputT, analysis: ContentAnalysis): string {
  const courseInfo = [
    data.courseName || analysis.detectedCourseInfo.courseName,
    data.courseCode || analysis.detectedCourseInfo.courseCode,
    data.courseLevel || analysis.detectedCourseInfo.courseLevel,
    data.creditUnits || analysis.detectedCourseInfo.creditUnits,
    data.contactTime || analysis.detectedCourseInfo.contactTime,
  ].filter(Boolean).join(" | ");

  const structureGuidance = analysis.suggestedStructure.length > 0
      ? `SLIDE-BY-SLIDE PROGRESSION MAP (For Slides 3 to ${data.slideCount - 1}):\n${analysis.suggestedStructure
          .map((s, i) => `Slide ${i + 3}: ${s}`)
          .join("\n")}\n\n`
      : "";

  return `You are building a world-class, ULTRA-MINIMALIST university lecture deck for Metropolitan International University (MIU).

STRATEGIC CONTENT ANALYSIS:
- Primary Topic: ${analysis.detectedTopic}
- Key Concepts: ${analysis.keyTopics.slice(0, 4).join(", ")}
- Learning Outcomes: ${analysis.learningOutcomes.slice(0, 3).join("; ")}
- Level: ${analysis.estimatedLevel} | Complexity: ${analysis.contentComplexity}

${structureGuidance}

GENERATION REQUIREMENTS:
- Create an array of EXACTLY ${data.slideCount} slides in strictly sequential order.
- You MUST follow this precise structural order:
  [Slide 1] type "title" — Topic: "${analysis.detectedTopic}"
  [Slide 2] type "identification" — Course details (${courseInfo || "Course Information"})
  [Slides 3 to ${data.slideCount - 1}] Follow the PROGRESSION MAP closely.
  [Slide ${data.slideCount}] type "takeaway" — 4 essential learner takeaways

CONTENT RULES (MODERN PRESENTATION WITH DEEP EXPLANATION):
- DEEP EXPLANATION: Move beyond basic summaries. Provide profound, analytical explanations of the 'why' and 'how' for each concept.
- BALANCED STRUCTURE: You MUST combine a 'body' paragraph (for the core deep explanation) with 'bullets' (to break down the key supporting mechanisms).
- Titles: Maximum 5 words. Make them impactful.
- Body text: Use this for your deep explanation. Max ${MAX_BODY_CHARS} characters.
- Bullets: Max ${MAX_BULLETS} bullets. Explain the details clearly (up to 20 words per bullet).
- Sections: Max 3 sections. Use for comparing concepts. Never mix sections with body/bullets.

${data.mode === "paste" ? `Source Material:\n"""\n${data.pastedContent}\n"""` : ""}
${data.extraNotes ? `Instructor Guidance: ${data.extraNotes}` : ""}

RETURN ONLY: Valid JSON matching the slide schema. No markdown. No explanation.`;
}

type GeminiErrorCode = "MODEL_NOT_FOUND" | "THINKING_UNSUPPORTED" | "RATE_LIMITED" | "AUTH" | "BAD_REQUEST" | "SERVER_ERROR" | "TIMEOUT" | "EMPTY_RESPONSE" | "PARSE_ERROR" | "UNKNOWN";

class GeminiError extends Error {
  status?: number;
  code: GeminiErrorCode;
  constructor(message: string, code: GeminiErrorCode = "UNKNOWN", status?: number) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS_THINKING = 90_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithThinking(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  useThinking: boolean,
  modelConfig: { name: string; apiVersion: string } = { name: "gemini-2.5-flash", apiVersion: "v1beta" },
): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/${modelConfig.apiVersion}/models/${modelConfig.name}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutMs = useThinking ? REQUEST_TIMEOUT_MS_THINKING : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const baseGenerationConfig: Record<string, unknown> = {
    temperature: 0.7,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    responseSchema: schema,
  };

  if (useThinking) {
    baseGenerationConfig.thinkingConfig = { thinkingBudget: 2048 };
  }

  const body = {
    systemInstruction: {
      parts: [
        {
          text: useThinking
            ? "You are an expert curriculum designer. Think deeply and reason through optimal educational structure. Ensure slides follow cognitive learning progression."
            : "You are an expert curriculum designer. Ensure slides follow cognitive learning progression and learning science principles.",
        },
      ],
    },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: baseGenerationConfig,
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
        throw new GeminiError(`MODEL_NOT_FOUND: "${modelConfig.name}".`, "MODEL_NOT_FOUND", 404);
      }
      if (res.status === 400 && /thinking/i.test(errorDetail)) {
        throw new GeminiError(`Thinking unsupported.`, "THINKING_UNSUPPORTED", 400);
      }
      if (res.status === 429) {
        throw new GeminiError("Rate limited.", "RATE_LIMITED", 429);
      }
      if (res.status === 401 || res.status === 403) {
        throw new GeminiError(`Auth failed.`, "AUTH", res.status);
      }

      throw new GeminiError(`Gemini failed: ${errorDetail.slice(0, 200)}`, "SERVER_ERROR", res.status);
    }

    const json = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? "").join("") : "";

    if (!text.trim()) throw new GeminiError("Empty response.", "EMPTY_RESPONSE");

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new GeminiError("Malformed JSON.", "PARSE_ERROR");
    }
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GeminiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeminiError(`Timed out.`, "TIMEOUT");
    }
    throw new GeminiError(err instanceof Error ? err.message : "Unknown error", "UNKNOWN");
  }
}

async function generateSlidesWithFullAnalysis(apiKey: string, data: GenerateInputT): Promise<SlideDeck> {
  const analysis = await analyzeContent(apiKey, data);
  const prompt = buildGenerationPrompt(data, analysis);
  const parsed = await callGeminiWithSmartFallback(apiKey, prompt, deckSchema, data.enableExtendedThinking);
  return toSlideDeck(data, analysis, parsed);
}

async function callGeminiWithSmartFallback(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  useThinking: boolean,
): Promise<Record<string, unknown>> {
  let lastError: any = null;

  for (const modelConfig of GEMINI_MODELS) {
    try {
      return await callGeminiWithThinking(apiKey, prompt, schema, useThinking, modelConfig);
    } catch (err: any) {
      lastError = err;
      if (err.code === "AUTH") throw err;
      if (err.code === "MODEL_NOT_FOUND") continue;
      if (useThinking && err.code === "THINKING_UNSUPPORTED") {
        try {
          return await callGeminiWithThinking(apiKey, prompt, schema, false, modelConfig);
        } catch (retryErr) {
          lastError = retryErr;
          continue;
        }
      }
      if (err.code === "RATE_LIMITED") {
        await sleep(4000);
        continue;
      }
      continue;
    }
  }

  throw new Error(`All models exhausted. Last error: ${lastError?.message || "Unknown"}`);
}

function toSlideDeck(data: GenerateInputT, analysis: ContentAnalysis, parsed: Record<string, unknown>): SlideDeck {
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const slides = rawSlides
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map(clampSlide)
    .filter((s) => s.title || s.body || s.bullets?.length || s.sections?.length);

  if (!slides.length) throw new Error("No usable slides generated.");

  if (slides[0]) slides[0].type = "title";
  if (slides.length > 1 && slides[1]) slides[1].type = "identification";
  if (slides.length > 2) slides[slides.length - 1].type = "takeaway";

  const topic = analysis.detectedTopic || data.topic || "Untitled Lecture";
  const finalCourseName = data.courseName || analysis.detectedCourseInfo.courseName || "";
  const finalCourseCode = data.courseCode || analysis.detectedCourseInfo.courseCode || "";

  return {
    courseName: finalCourseName,
    courseCode: finalCourseCode,
    courseLevel: data.courseLevel || analysis.detectedCourseInfo.courseLevel || "",
    creditUnits: data.creditUnits || analysis.detectedCourseInfo.creditUnits || "",
    contactTime: data.contactTime || analysis.detectedCourseInfo.contactTime || "",
    topic: clamp(topic, MAX_TITLE_CHARS),
    suggestedFilename: generateSafeFilename(finalCourseName, finalCourseCode, topic) + ".pptx",
    slides,
  };
}

// ========== Fixed Public Server Function Endpoint ==========
export const generateDeck = createServerFn({ method: "POST" })
  .validator(GenerateInput) // Pass schema directly here
  .handler(async ({ data }) => {
    if (!data.apiKey.trim()) {
      throw new Error("Add your Gemini API key.");
    }
    if (data.mode === "paste" && data.pastedContent.trim().length < 20) {
      throw new Error("Please paste substantial course material.");
    }
    if (data.mode === "brief" && !data.topic.trim()) {
      throw new Error("Please enter a lecture topic.");
    }

    try {
      return await generateSlidesWithFullAnalysis(data.apiKey.trim(), data);
    } catch (err: any) {
      throw new Error(err?.message || "Slide generation failed.");
    }
  });
