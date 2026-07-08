import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEXT_MODEL = "gemini-1.5-flash";
const MAX_PASTE_CHARS = 12000;

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

// Fixed: Added the missing error handler function
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

const SCHEMA_HINT = `Return STRICT JSON of this shape: { "topic": "...", "slides": [...] }`;

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    const sys = `You are a curriculum designer... ${SCHEMA_HINT}`;
    const userMsg = "..."; // (Your prompt logic here)

    const res = await callGemini(sys, userMsg);
    await handleGeminiErrors(res);
    
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(text) as any;
    
    if (!parsed.slides?.length) throw new Error("Model returned no slides");

    return {
      courseName: data.courseName || parsed.courseName || "",
      courseCode: data.courseCode || parsed.courseCode || "",
      courseLevel: data.courseLevel || parsed.courseLevel || "",
      creditUnits: data.creditUnits || parsed.creditUnits || "",
      contactTime: data.contactTime || parsed.contactTime || "",
      topic: data.topic || parsed.topic || "Untitled Lecture",
      slides: parsed.slides.map(clampSlide),
    };
  });

export const regenerateSlide = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.any().parse(data))
  .handler(async ({ data }) => {
    const sys = `...`; 
    const res = await callGemini(sys, "...");
    await handleGeminiErrors(res);
    // ... (rest of logic)
    return { slide: clampSlide({ ...data, type: data.slideType }) };
  });

export const generateIllustration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IllustrationInput.parse(data))
  .handler(async ({ data }) => {
    const styled = `...`;
    
    // Fixed: Added retry logic for illustration requests
    let retries = 3;
    let res;
    while(retries > 0) {
      res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?seed=${Math.random()}`);
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        retries--;
        continue;
      }
      break;
    }

    if (!res || !res.ok) throw new Error("Image generation failed.");
    
    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { dataUrl: `data:image/jpeg;base64,${base64}` };
  });

const IllustrationInput = z.object({ prompt: z.string().min(2) });
