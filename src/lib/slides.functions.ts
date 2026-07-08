import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEXT_MODEL = "gemini-3.5-flash"; 
const MAX_PASTE_CHARS = 12000;

// Schema representing student interaction feedback to continuous adaptation loop
const FeedbackItem = z.object({
  rating: z.number().min(1).max(5),
  topic: z.string(),
  successfulTraits: z.array(z.string()), // e.g. ["high-density", "bullet-minimal", "visual-heavy"]
});

const GenerateInput = z.object({
  mode: z.enum(["brief", "paste"]).default("brief"),
  topic: z.string().optional().default(""),
  pastedContent: z
    .string()
    .optional()
    .default("")
    .refine((v) => v.length <= MAX_PASTE_CHARS, {
      message: `Pasted content is too long (max ${MAX_PASTE_CHARS} characters). Please shorten it and try again.`,
    }),
  courseName: z.string().optional().default(""),
  courseCode: z.string().optional().default(""),
  courseLevel: z.string().optional().default(""),
  creditUnits: z.string().optional().default(""),
  contactTime: z.string().optional().default(""),
  slideCount: z.number().int().min(4).max(24).default(10),
  extraNotes: z.string().optional().default(""),
  feedbackHistory: z.array(FeedbackItem).optional().default([]), // The machine learning feedback loop input
});

export type SlideSpec = {
  type: "title" | "identification" | "content" | "list" | "takeaway";
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  sections?: { heading: string; description: string }[];
  illustrationPrompt: string;
};

export type SlideDeck = {
  courseName: string;
  courseCode: string;
  courseLevel: string;
  creditUnits: string;
  contactTime: string;
  topic: string;
  exportFilename: string; // Automated generated safe filename
  slides: SlideSpec[];
};

const MAX_BULLETS = 6;
const MAX_BULLET_CHARS = 100;
const MAX_SECTIONS = 4;
const MAX_SECTION_HEADING_CHARS = 45;
const MAX_SECTION_DESC_CHARS = 150;
const MAX_BODY_CHARS = 320;
const MAX_TITLE_CHARS = 70;
const MAX_SUBTITLE_CHARS = 100;

function clampSlide(spec: SlideSpec): SlideSpec {
  return {
    type: spec.type,
    title: (spec.title || "").slice(0, MAX_TITLE_CHARS),
    subtitle: spec.subtitle ? spec.subtitle.slice(0, MAX_SUBTITLE_CHARS) : spec.subtitle,
    body: spec.body ? spec.body.slice(0, MAX_BODY_CHARS) : spec.body,
    bullets: spec.bullets
      ?.slice(0, MAX_BULLETS)
      .map((b) => b.slice(0, MAX_BULLET_CHARS)),
    sections: spec.sections?.slice(0, MAX_SECTIONS).map((s) => ({
      heading: s.heading.slice(0, MAX_SECTION_HEADING_CHARS),
      description: s.description.slice(0, MAX_SECTION_DESC_CHARS),
    })),
    illustrationPrompt: spec.illustrationPrompt || "",
  };
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(start, end + 1));
}

async function handleGeminiErrors(res: Response) {
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Rate limit — please wait a moment and try again.");
    if (res.status === 403) throw new Error("Invalid GEMINI_API_KEY or insufficient permissions.");
    throw new Error(`AI error ${res.status}: ${t}`);
  }
}

async function callGemini(sys: string, userMsg: string, retries = 3) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  for (let i = 0; i < retries; i++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: sys }, { text: userMsg }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (res.status === 429) {
      const waitTime = Math.pow(2, i) * 2000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      continue;
    }
    return res;
  }
  throw new Error("Rate limit exceeded after retries.");
}

const SCHEMA_HINT = `Return STRICT JSON of this shape:
{
  "topic": "extracted short topic title",
  "courseName": "extracted course name", 
  "courseCode": "extracted course ID/code", 
  "courseLevel": "extracted level", 
  "creditUnits": "extracted credits", 
  "contactTime": "extracted contact time",
  "slides": [
    {
      "type": "title" | "identification" | "content" | "list" | "takeaway",
      "title": "SHORT ALL-CAPS TITLE (<=6 words)",
      "subtitle": "optional italic tagline",
      "body": "optional sentences describing core context",
      "bullets": ["at most 5 bullets, each <=10 words"],
      "sections": [{"heading":"Sub-heading (<=5 words)","description":"<=16 words"}],
      "illustrationPrompt": "concise prompt for a clean flat vector illustration (no text, no logos)"
    }
  ]
}
Rules:
- Slide 1 MUST be type "title", populated with Course ID, Topic, and Course Name.
- Slide 2 MUST be type "identification" or "content", designed as a "Topic Overview" slide containing deep, prescribed details of the topic extracted from raw input to capture full contextual framework.
- Every slide's content MUST fit cleanly on a single slide layout.
- At most 4 sections OR 5 bullets per slide (never both on the same slide).
- Final slide MUST be type "takeaway".
- Output JSON only.`;

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    // 1. Build Adaptive ML Instructions from past feedback metrics
    let mlLayoutDirectives = "";
    if (data.feedbackHistory && data.feedbackHistory.length > 0) {
      const highlyRated = data.feedbackHistory.filter(f => f.rating >= 4);
      if (highlyRated.length > 0) {
        const preferredTraits = Array.from(new Set(highlyRated.flatMap(h => h.successfulTraits)));
        mlLayoutDirectives = `
[ADAPTATION ENGINE RULES]:
Based on verified past successful generations, apply these user-preferred structural traits:
- Strongly prioritize layout patterns matching: ${preferredTraits.join(", ")}.
- Optimize density, readability levels, and bullet configurations according to success profiles.
`;
      }
    }

    const sys = `You are an expert curriculum systems architect. Analyze input hierarchies, extract metadata, and compile high-quality student educational content. ${SCHEMA_HINT} ${mlLayoutDirectives}`;
    
    const userMsg = data.mode === "paste"
        ? `Task: Extract hierarchical course metrics and build a ${data.slideCount}-slide deck.
           Analyze the text structure to pull Course Code/ID, Course Name, Topic, and metadata.
           
           RAW MATERIAL:
           ${data.pastedContent}
           
           ADDITIONAL GUIDANCE: ${data.extraNotes || "(none)"}`
        : `Design a ${data.slideCount}-slide deck for topic: ${data.topic}`;

    const res = await callGemini(sys, userMsg);
    await handleGeminiErrors(res);
    const json = (await res.json()) as any;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(text) as any;
    
    if (!parsed.slides?.length) throw new Error("Model returned no slides");

    // 2. Fallback Protection and Strict File Naming Synthesizer
    const timestamp = Date.now();
    const finalCourseCode = (data.courseCode || parsed.courseCode || "").trim() || `MissingCourseID_${timestamp}`;
    const finalTopic = (data.topic || parsed.topic || "").trim() || `MissingTopic_${timestamp}`;
    const finalCourseName = (data.courseName || parsed.courseName || "").trim() || `MissingCourseName_${timestamp}`;

    // Apply strict naming formatting: [Course ID][Topic][Course Name]
    const rawFilename = `[${finalCourseCode}][${finalTopic}][${finalCourseName}]`;
    const exportFilename = rawFilename
      .replace(/[/\\?%*:|"<>]/g, "-") // Sanitize OS filesystem hostile symbols
      .replace(/\s+/g, "_"); // Streamline whitespace to flat snake notation

    return {
      courseName: data.courseName || parsed.courseName || "General Course",
      courseCode: data.courseCode || parsed.courseCode || "GEN-101",
      courseLevel: data.courseLevel || parsed.courseLevel || "",
      creditUnits: data.creditUnits || parsed.creditUnits || "",
      contactTime: data.contactTime || parsed.contactTime || "",
      topic: data.topic || parsed.topic || "Topic Overview",
      exportFilename,
      slides: parsed.slides.map(clampSlide),
    };
  });

export const regenerateSlide = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.any().parse(data))
  .handler(async ({ data }) => {
    const sys = `You are a curriculum designer. Write ONE replacement slide of type "${data.slideType}". ${SCHEMA_HINT}`;
    const res = await callGemini(sys, `Write alternative: ${data.currentTitle}`);
    await handleGeminiErrors(res);
    const json = (await res.json()) as any;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(text) as any;
    const slide = parsed.slides?.[0];
    if (!slide) throw new Error("Model returned no slide");
    return { slide: clampSlide({ ...slide, type: data.slideType }) };
  });

const IllustrationInput = z.object({ prompt: z.string().min(2) });

export const generateIllustration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IllustrationInput.parse(data))
  .handler(async ({ data }) => {
    const styled = `Minimal flat vector illustration, ${data.prompt}`;
    
    let retries = 3;
    while (retries > 0) {
      const seed = Math.floor(Math.random() * 1_000_000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=800&height=800&seed=${seed}&nologo=true`;
      const res = await fetch(url);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        retries--;
        continue;
      }
      
      if (!res.ok) throw new Error("Image generation failed.");
      
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return { dataUrl: `data:image/jpeg;base64,${base64}` };
    }
    throw new Error("Rate limit exceeded for image generation.");
  });
