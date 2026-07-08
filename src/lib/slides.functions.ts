import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEXT_MODEL = "gemini-2.5-flash";
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

// Hard caps so generated content can never overflow a slide's fixed layout box.
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

function callGemini(sys: string, userMsg: string) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: sys }] },
          { role: "user", parts: [{ text: userMsg }] },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );
}

async function handleGeminiErrors(res: Response) {
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limit — please wait a moment and try again.");
    if (res.status === 403) throw new Error("Invalid GEMINI_API_KEY or insufficient permissions.");
    throw new Error(`AI error ${res.status}: ${t}`);
  }
}

const SCHEMA_HINT = `Return STRICT JSON of this shape:
{
  "topic": "short topic title",
  "courseName": "...", "courseCode": "...", "courseLevel": "...", "creditUnits": "...", "contactTime": "...",
  "slides": [
    {
      "type": "title" | "identification" | "content" | "list" | "takeaway",
      "title": "SHORT ALL-CAPS TITLE (<=6 words)",
      "subtitle": "optional italic tagline",
      "body": "optional 1-2 SHORT sentences, max 40 words total",
      "bullets": ["at most 5 bullets, each <=10 words"],
      "sections": [{"heading":"Sub-heading (<=5 words)","description":"<=16 words"}],
      "illustrationPrompt": "concise prompt for a clean flat vector illustration (no text, no logos)"
    }
  ]
}
Rules:
- Every slide's content MUST be short enough to fit comfortably on a single fixed-size slide — do not overflow. Prefer fewer, punchier bullets/sections over long ones.
- At most 4 sections OR 5 bullets per slide (never both on the same slide).
- Slide 1 MUST be type "title".
- Slide 2 MUST be type "identification".
- Final slide MUST be type "takeaway".
- Middle slides mix "content" (short paragraph + 2-4 sections) and "list" (bullets).
- Every slide MUST have a non-empty illustrationPrompt.
- Fill topic/courseName/courseCode/courseLevel/creditUnits/contactTime by extracting from the input; if a value is missing, use "".
- Output JSON only.`;

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    const sys = `You are a curriculum designer for Metropolitan International University (MIU). You design clear, professional academic lecture decks. ${SCHEMA_HINT}`;

    const userMsg =
      data.mode === "paste"
        ? `Turn the following raw course material into a ${data.slideCount}-slide lecture deck. Extract the topic and course identification details from the text if present; otherwise leave those fields empty. Keep the student-friendly academic tone.\n\nRAW MATERIAL:\n"""\n${data.pastedContent}\n"""\n\nOPTIONAL EXTRA GUIDANCE: ${data.extraNotes || "(none)"}`
        : `Design a ${data.slideCount}-slide lecture deck.
TOPIC: ${data.topic}
COURSE NAME: ${data.courseName}
COURSE CODE: ${data.courseCode}
COURSE LEVEL: ${data.courseLevel}
CREDIT UNITS: ${data.creditUnits}
CONTACT TIME: ${data.contactTime}
EXTRA NOTES: ${data.extraNotes}`;

    const res = await callGemini(sys, userMsg);
    await handleGeminiErrors(res);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(text) as {
      slides: SlideSpec[];
      topic?: string;
      courseName?: string;
      courseCode?: string;
      courseLevel?: string;
      creditUnits?: string;
      contactTime?: string;
    };
    if (!parsed.slides?.length) throw new Error("Model returned no slides");

    const deck: SlideDeck = {
      courseName: data.courseName || parsed.courseName || "",
      courseCode: data.courseCode || parsed.courseCode || "",
      courseLevel: data.courseLevel || parsed.courseLevel || "",
      creditUnits: data.creditUnits || parsed.creditUnits || "",
      contactTime: data.contactTime || parsed.contactTime || "",
      topic: data.topic || parsed.topic || "Untitled Lecture",
      slides: parsed.slides.map(clampSlide),
    };
    return deck;
  });

const RegenerateSlideInput = z.object({
  slideType: z.enum(["title", "identification", "content", "list", "takeaway"]),
  topic: z.string().optional().default(""),
  courseName: z.string().optional().default(""),
  courseCode: z.string().optional().default(""),
  currentTitle: z.string().optional().default(""),
  guidance: z.string().optional().default(""),
});

// Regenerates a single slide's text content (title/body/bullets/sections),
// keeping its type/position fixed, without regenerating the whole deck.
export const regenerateSlide = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RegenerateSlideInput.parse(data))
  .handler(async ({ data }) => {
    const sys = `You are a curriculum designer for Metropolitan International University (MIU). Write ONE replacement slide of type "${data.slideType}" for a lecture deck on "${data.topic}" (course: ${data.courseName} ${data.courseCode}). ${SCHEMA_HINT}
Return the SAME JSON shape as before, but with "slides" containing EXACTLY ONE slide object of type "${data.slideType}".`;

    const userMsg = `Write a fresh alternative version of this slide (different wording/angle than before). Current title was: "${data.currentTitle}". Extra guidance: ${data.guidance || "(none — just make it better and different)"}`;

    const res = await callGemini(sys, userMsg);
    await handleGeminiErrors(res);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(text) as { slides?: SlideSpec[] };
    const slide = parsed.slides?.[0];
    if (!slide) throw new Error("Model returned no slide");
    return { slide: clampSlide({ ...slide, type: data.slideType }) };
  });

const IllustrationInput = z.object({ prompt: z.string().min(2) });

export const generateIllustration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IllustrationInput.parse(data))
  .handler(async ({ data }) => {
    const styled = `Minimal flat vector illustration, educational, professional, clean white background, muted green (#0F7A3A) and red (#C8102E) accent palette, no text, no letters, no logos, no watermarks. Subject: ${data.prompt}`;

    // Pollinations.ai — free, no API key, no billing required.
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=800&height=800&seed=${seed}&nologo=true`;

    const res = await fetch(url);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit — please wait a moment and try again.");
      throw new Error(`Image error ${res.status}: ${t}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    return { dataUrl: `data:${mimeType};base64,${base64}` };
  });
