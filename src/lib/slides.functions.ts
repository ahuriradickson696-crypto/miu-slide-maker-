import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEXT_MODEL = "gemini-3.5-flash";
// Image generation uses Pollinations (free, unauthenticated) exclusively.
// Gemini's image models (Nano Banana) currently have no free-tier quota —
// on a free GEMINI_API_KEY every call to them fails with 429/403, so
// attempting them first just adds latency and wasted retries before
// falling back anyway. Skipping straight to Pollinations keeps image
// generation fast and fully free.
const USE_GEMINI_IMAGES = false;
const IMAGE_MODELS = ["gemini-3.1-flash-image", "gemini-2.5-flash-image"] as const;

const MAX_PASTE_CHARS = 12000;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 4;
const SLIDES_PER_BATCH = 5; // keeps each Gemini call small & fast
const BATCH_CONCURRENCY = 2; // bounded parallelism, avoids bursting rate limits

// ---------- Schemas sent to Gemini for guaranteed-valid JSON ----------

const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string" },
    courseName: { type: "string" },
    courseCode: { type: "string" },
    courseLevel: { type: "string" },
    creditUnits: { type: "string" },
    contactTime: { type: "string" },
    slideOutline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["title", "identification", "content", "list", "takeaway"] },
          title: { type: "string" },
        },
        required: ["type", "title"],
      },
    },
  },
  required: ["topic", "slideOutline"],
};

const SLIDE_BATCH_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["title", "identification", "content", "list", "takeaway"] },
          title: { type: "string" },
          subtitle: { type: "string" },
          body: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                description: { type: "string" },
              },
              required: ["heading", "description"],
            },
          },
          illustrationPrompt: { type: "string" },
        },
        required: ["type", "title", "illustrationPrompt"],
      },
    },
  },
  required: ["slides"],
};

// ---------- Input validation ----------

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

// ---------- Content clamping (protects layout & keeps payloads small) ----------

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
    bullets: spec.bullets?.slice(0, MAX_BULLETS).map((b) => b.slice(0, MAX_BULLET_CHARS)),
    sections: spec.sections?.slice(0, MAX_SECTIONS).map((s) => ({
      heading: s.heading.slice(0, MAX_SECTION_HEADING_CHARS),
      description: s.description.slice(0, MAX_SECTION_DESC_CHARS),
    })),
    illustrationPrompt: spec.illustrationPrompt || "",
  };
}

// ---------- JSON extraction (tolerant of stray markdown fences) ----------

function extractJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text.trim());
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = (fenced ? fenced[1] : text).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in model response");
    return JSON.parse(raw.slice(start, end + 1));
  }
}

// ---------- Resilient fetch: timeout + retry with backoff ----------

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function callGemini(
  model: string,
  body: Record<string, unknown>,
  { retries = MAX_RETRIES, timeoutMs = FETCH_TIMEOUT_MS }: { retries?: number; timeoutMs?: number } = {}
): Promise<Response> {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        timeoutMs
      );

      if (res.ok) return res;
      if (res.status === 403) {
        throw new Error("Invalid GEMINI_API_KEY, insufficient permissions, or billing required for this model.");
      }
      if (res.status === 429) {
        // Free-tier Gemini quota is tight and shared across text + image
        // calls. Give it real retry headroom before surfacing anything to
        // the user — most 429s clear within a few seconds.
        if (attempt === retries - 1) {
          throw new Error(
            "Gemini usage limit reached for now. This means your API key has hit its request quota (common on the free tier). Wait a minute and try again, use fewer slides per deck, or check your plan/billing at https://aistudio.google.com/apikey."
          );
        }
        lastError = new Error("Rate limited, retrying...");
      } else if (!isRetryableStatus(res.status)) {
        throw new Error(`AI request failed (${res.status}). Please try again in a moment.`);
      } else if (attempt === retries - 1) {
        throw new Error(`AI service is temporarily unavailable (${res.status}). Please try again shortly.`);
      } else {
        lastError = new Error(`AI error ${res.status}, retrying...`);
      }
    } catch (err) {
      lastError = err;
      // Errors we explicitly threw above (clean, user-facing) should not retry further.
      if (
        err instanceof Error &&
        (err.message.startsWith("Invalid GEMINI_API_KEY") ||
          err.message.startsWith("Gemini usage limit reached") ||
          err.message.startsWith("AI request failed") ||
          err.message.startsWith("AI service is temporarily unavailable"))
      ) {
        throw err;
      }
      if (attempt === retries - 1) {
        throw new Error("Couldn't reach the AI service after several attempts. Please check your connection and try again.");
      }
    }
    // 429s get longer backoff since quota windows typically reset on the order of tens of seconds.
    const isRateLimit = lastError instanceof Error && lastError.message.startsWith("Rate limited");
    const base = isRateLimit ? 4000 : 2000;
    const backoffMs = Math.min(base * 2 ** attempt, 20_000) + Math.floor(Math.random() * 300);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini request failed after retries.");
}

async function generateJson<T>(sys: string, userMsg: string, schema: unknown): Promise<T> {
  const res = await callGemini(TEXT_MODEL, {
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    system_instruction: { parts: [{ text: sys }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      maxOutputTokens: 16384,
    },
  });
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Model returned an empty response.");
  return extractJson(text) as T;
}

// ---------- Bounded-concurrency batch runner ----------

async function runBatches<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    return next();
  }
  await Promise.all(new Array(Math.min(concurrency, items.length)).fill(0).map(() => next()));
  return results;
}

// ---------- Prompts ----------

const SCHEMA_HINT = `Rules:
- Every slide's content MUST be short enough to fit comfortably on a single fixed-size slide.
- At most 4 sections OR 6 bullets per slide (never both on the same slide).
- Every slide MUST have a non-empty illustrationPrompt describing a clean flat vector illustration (no text, no logos).`;

// ---------- Public server functions ----------

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

    // Step 1: fast outline call — decides structure & metadata only.
    const outlineSys = `You are a curriculum designer for Metropolitan International University (MIU). Design the STRUCTURE of a ${data.slideCount}-slide academic lecture deck.
Rules:
- Slide 1 MUST be type "title".
- Slide 2 MUST be type "identification".
- Final slide MUST be type "takeaway".
- Middle slides mix "content" and "list" types.
- Output exactly ${data.slideCount} entries in slideOutline, in slide order.
- Carefully scan the input for course identification details, which are often given as labeled lines near the top of course material (e.g. "Course Code:", "Course Name:", "Credit Units:", "Level:", "Contact Hours:", "Semester:"). Extract these exactly as written wherever present.
- Fill topic/courseName/courseCode/courseLevel/creditUnits/contactTime from what you find in the input. If a field genuinely isn't present anywhere in the input, use "" — do not invent or guess values.`;

    const outlineUserMsg =
      data.mode === "paste"
        ? `Extract a lecture structure from this raw course material:\n"""\n${data.pastedContent}\n"""\n\nEXTRA GUIDANCE: ${data.extraNotes || "(none)"}`
        : `TOPIC: ${data.topic}\nCOURSE NAME: ${data.courseName}\nCOURSE CODE: ${data.courseCode}\nCOURSE LEVEL: ${data.courseLevel}\nCREDIT UNITS: ${data.creditUnits}\nCONTACT TIME: ${data.contactTime}\nEXTRA NOTES: ${data.extraNotes}`;

    const outline = await generateJson<{
      topic?: string;
      courseName?: string;
      courseCode?: string;
      courseLevel?: string;
      creditUnits?: string;
      contactTime?: string;
      slideOutline: { type: SlideSpec["type"]; title: string }[];
    }>(outlineSys, outlineUserMsg, OUTLINE_SCHEMA);

    if (!outline.slideOutline?.length) throw new Error("Model returned no slide outline.");

    // Step 2: expand each slide's full content in small parallel batches.
    // Small payloads per call = fast, low truncation risk, and one failed
    // batch can be retried independently without redoing the whole deck.
    const batches: { start: number; items: typeof outline.slideOutline }[] = [];
    for (let i = 0; i < outline.slideOutline.length; i += SLIDES_PER_BATCH) {
      batches.push({ start: i, items: outline.slideOutline.slice(i, i + SLIDES_PER_BATCH) });
    }

    const contextLine = data.mode === "paste"
      ? `Base all content on this source material:\n"""\n${data.pastedContent.slice(0, 6000)}\n"""`
      : `Topic: ${data.topic}. Extra notes: ${data.extraNotes || "(none)"}`;

    const batchResults = await runBatches(batches, BATCH_CONCURRENCY, async (batch) => {
      const sys = `You are a curriculum designer for MIU, writing full slide content for specific slides in a lecture deck. ${SCHEMA_HINT}`;
      const userMsg = `${contextLine}\n\nWrite full content for EXACTLY these ${batch.items.length} slides, in this exact order, preserving each "type" and "title" verbatim:\n${JSON.stringify(batch.items, null, 2)}`;
      const result = await generateJson<{ slides: SlideSpec[] }>(sys, userMsg, SLIDE_BATCH_SCHEMA);
      if (!result.slides?.length) throw new Error(`Batch starting at slide ${batch.start + 1} returned no content.`);
      return result.slides;
    });

    const slides = batchResults.flat().map((s, i) => {
      const clamped = clampSlide(s);
      // Guarantee the outline's structural type/title win, even if the
      // model drifted, so slide 1/2/last always match required types.
      const outlineEntry = outline.slideOutline[i];
      return outlineEntry ? { ...clamped, type: outlineEntry.type, title: clamped.title || outlineEntry.title } : clamped;
    });

    if (!slides.length) throw new Error("Deck generation produced no slides.");

    const deck: SlideDeck = {
      courseName: data.courseName || outline.courseName || "",
      courseCode: data.courseCode || outline.courseCode || "",
      courseLevel: data.courseLevel || outline.courseLevel || "",
      creditUnits: data.creditUnits || outline.creditUnits || "",
      contactTime: data.contactTime || outline.contactTime || "",
      topic: data.topic || outline.topic || "Untitled Lecture",
      slides,
    };
    return deck;
  });

const RegenerateInput = z.object({
  slideType: z.enum(["title", "identification", "content", "list", "takeaway"]),
  currentTitle: z.string(),
  topic: z.string().optional().default(""),
});

export const regenerateSlide = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RegenerateInput.parse(data))
  .handler(async ({ data }) => {
    if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
    const sys = `You are a curriculum designer. Write ONE replacement slide of type "${data.slideType}" for a deck about "${data.topic}". ${SCHEMA_HINT}`;
    const result = await generateJson<{ slides: SlideSpec[] }>(
      sys,
      `Write an alternative version of a slide currently titled: "${data.currentTitle}"`,
      SLIDE_BATCH_SCHEMA
    );
    const slide = result.slides?.[0];
    if (!slide) throw new Error("Model returned no slide.");
    return { slide: clampSlide({ ...slide, type: data.slideType }) };
  });

// ---------- Image generation with layered fallback ----------

const IllustrationInput = z.object({ prompt: z.string().min(2) });

function buildStyledPrompt(prompt: string) {
  return `Minimal flat vector illustration, educational, professional, clean white background, muted green (#0F7A3A) and red (#C8102E) accent palette, no text, no letters, no logos, no watermarks. Subject: ${prompt}`;
}

async function tryGeminiImage(styled: string, model: string): Promise<{ dataUrl: string } | null> {
  try {
    const res = await callGemini(
      model,
      {
        contents: [{ role: "user", parts: [{ text: styled }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      { retries: 3, timeoutMs: 30_000 }
    );
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) return null;
    const mimeType = imagePart.inlineData.mimeType || "image/png";
    return { dataUrl: `data:${mimeType};base64,${imagePart.inlineData.data}` };
  } catch (err) {
    console.error(`Gemini image model ${model} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function tryPollinationsImage(prompt: string, retries = 3): Promise<{ dataUrl: string } | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const seed = Math.floor(Math.random() * 1_000_000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=800&seed=${seed}&nologo=true`;
      const res = await fetchWithTimeout(url, {}, 25_000);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return { dataUrl: `data:image/jpeg;base64,${base64}` };
      }
      if (res.status !== 429 && res.status < 500) return null; // non-retryable client error
    } catch (err) {
      if (attempt === retries - 1) {
        console.error("Pollinations image generation failed:", err instanceof Error ? err.message : err);
      }
    }
    if (attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  return null;
}

export const generateIllustration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IllustrationInput.parse(data))
  .handler(async ({ data }) => {
    const styled = buildStyledPrompt(data.prompt);

    if (USE_GEMINI_IMAGES) {
      for (const model of IMAGE_MODELS) {
        const result = await tryGeminiImage(styled, model);
        if (result) return result;
      }
    }

    const fallback = await tryPollinationsImage(styled);
    if (fallback) return fallback;

    throw new Error("Image generation failed on all providers. The slide will use a placeholder.");
  });
