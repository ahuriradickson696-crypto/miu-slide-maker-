import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";

const GenerateInput = z.object({
  mode: z.enum(["brief", "paste"]).default("brief"),
  topic: z.string().optional().default(""),
  pastedContent: z.string().optional().default(""),
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

function extractJson(text: string): { slides: SlideSpec[]; topic?: string; courseName?: string; courseCode?: string; courseLevel?: string; creditUnits?: string; contactTime?: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(start, end + 1));
}

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

    const schemaHint = `Return STRICT JSON of this shape:
{
  "topic": "short topic title",
  "courseName": "...", "courseCode": "...", "courseLevel": "...", "creditUnits": "...", "contactTime": "...",
  "slides": [
    {
      "type": "title" | "identification" | "content" | "list" | "takeaway",
      "title": "SHORT ALL-CAPS TITLE (<=6 words)",
      "subtitle": "optional italic tagline",
      "body": "optional 1-3 sentence intro paragraph",
      "bullets": ["optional bullet <=12 words"],
      "sections": [{"heading":"Sub-heading","description":"<=20 words"}],
      "illustrationPrompt": "concise prompt for a clean flat vector illustration (no text, no logos)"
    }
  ]
}
Rules:
- Slide 1 MUST be type "title".
- Slide 2 MUST be type "identification".
- Final slide MUST be type "takeaway".
- Middle slides mix "content" (paragraph + 2-4 sections) and "list" (bullets).
- Every slide MUST have a non-empty illustrationPrompt.
- Fill topic/courseName/courseCode/courseLevel/creditUnits/contactTime by extracting from the input; if a value is missing, use "".
- Output JSON only.`;

    const sys = `You are a curriculum designer for Metropolitan International University (MIU). You design clear, professional academic lecture decks. ${schemaHint}`;

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

    const res = await fetch(
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
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limit — please wait a moment and try again.");
      if (res.status === 403) throw new Error("Invalid GEMINI_API_KEY or insufficient permissions.");
      throw new Error(`AI error ${res.status}: ${t}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJson(text);
    if (!parsed.slides?.length) throw new Error("Model returned no slides");

    const deck: SlideDeck = {
      courseName: data.courseName || parsed.courseName || "",
      courseCode: data.courseCode || parsed.courseCode || "",
      courseLevel: data.courseLevel || parsed.courseLevel || "",
      creditUnits: data.creditUnits || parsed.creditUnits || "",
      contactTime: data.contactTime || parsed.contactTime || "",
      topic: data.topic || parsed.topic || "Untitled Lecture",
      slides: parsed.slides,
    };
    return deck;
  });

const IllustrationInput = z.object({ prompt: z.string().min(2) });

export const generateIllustration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IllustrationInput.parse(data))
  .handler(async ({ data }) => {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

    const styled = `Minimal flat vector illustration, educational, professional, clean white background, muted green (#0F7A3A) and red (#C8102E) accent palette, no text, no letters, no logos, no watermarks. Subject: ${data.prompt}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: styled }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limit — please wait a moment and try again.");
      if (res.status === 403) throw new Error("Invalid GEMINI_API_KEY or insufficient permissions.");
      throw new Error(`Image error ${res.status}: ${t}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) throw new Error("No image returned");
    const mimeType = imagePart.inlineData.mimeType || "image/png";
    return { dataUrl: `data:${mimeType};base64,${imagePart.inlineData.data}` };
  });
