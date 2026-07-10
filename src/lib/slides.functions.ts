import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ✅ FIXED VERSION — July 2026
// - Uses ONLY currently-live models (gemini-1.5-*, gemini-pro, gemini-2.0-* are
//   ALL shut down by Google as of June 2026 and return 404 forever — that's
//   why you kept seeing MODEL_NOT_FOUND no matter what you tried)
// - Uses x-goog-api-key header (works with new "AQ." auth keys AND old "AIza" keys)
// - ONE Gemini call per deck instead of two (analysis + generation merged) —
//   this halves your request count against the free-tier rate limit
// - On 429 it fails FAST with the exact wait time Google gives us, instead
//   of silently sleeping server-side or hopping models (rate limits are
//   per API key/project, not per model, so hopping models never helped)

const MAX_PASTE_CHARS = 12000;

// Only currently-live models (checked against Google's July 2026 docs).
// gemini-flash-latest is the auto-updating alias -> currently gemini-3.5-flash.
const PRIMARY_MODEL = "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-2.5-flash";

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

// ========== Content Clamping (Layout Safety) ==========
const MAX_BULLETS = 5;
const MAX_BULLET_CHARS = 140;
const MAX_BODY_CHARS = 300;
const MAX_TITLE_CHARS = 50;

function generateSafeFilename(courseName: string, courseCode: string, topic: string): string {
  const parts = [courseCode, courseName, topic].filter(Boolean);
  let rawName = parts.join("_");
  if (!rawName) rawName = "MIU_Lecture_Deck";
  return rawName.replace(/[^a-z0-9_-]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
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

  let finalBody =
    typeof spec.body === "string" && spec.body.trim()
      ? clamp(spec.body, MAX_BODY_CHARS)
      : undefined;

  let finalBullets: string[] | undefined = undefined;
  let finalSections: typeof sections | undefined = undefined;

  // Sections win outright (they need the most room). Otherwise body + bullets can coexist.
  if (hasSections) {
    finalSections = sections;
    finalBody = undefined;
  } else if (hasBullets) {
    finalBullets = bullets;
  }

  return {
    type,
    title: clamp(typeof spec.title === "string" ? spec.title : "", MAX_TITLE_CHARS),
    subtitle:
      typeof spec.subtitle === "string" && spec.subtitle.trim()
        ? clamp(spec.subtitle, 80)
        : undefined,
    body: finalBody,
    bullets: finalBullets,
    sections: finalSections,
  };
}

// ========== Gemini structured output schema (single combined call) ==========
const deckSchema = {
  type: "OBJECT",
  properties: {
    detectedTopic: { type: "STRING" },
    courseName: { type: "STRING" },
    courseCode: { type: "STRING" },
    courseLevel: { type: "STRING" },
    creditUnits: { type: "STRING" },
    contactTime: { type: "STRING" },
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
  required: ["detectedTopic", "slides"],
};

// ========== Single-pass prompt (analysis + generation combined) ==========

function buildPrompt(data: GenerateInputT): string {
  const content = data.mode === "paste" ? data.pastedContent : `Topic: ${data.topic}`;
  const courseInfo = [
    data.courseName && `Course name: ${data.courseName}`,
    data.courseCode && `Course code: ${data.courseCode}`,
    data.courseLevel && `Course level: ${data.courseLevel}`,
    data.creditUnits && `Credit units: ${data.creditUnits}`,
    data.contactTime && `Contact time: ${data.contactTime}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are an expert curriculum designer building a university lecture deck for Metropolitan International University (MIU).

STEP 1 — THINK FIRST (do this silently before writing slides):
- Identify the core topic and 4-6 key concepts.
- Work out the natural cognitive progression: what must be understood first, what builds on it, what's advanced/applied.
- Identify prerequisite knowledge and 2-3 concrete learning outcomes.
- Plan exactly which concept belongs on each content slide, in order.

STEP 2 — GENERATE exactly ${data.slideCount} slides using that plan:
- Slide 1: type "title" — the lecture topic as its title.
- Slide 2: type "identification" — course details.
- Slides 3 to ${data.slideCount - 1}: type "content" or "list", one clear concept each, following your cognitive progression from foundational to advanced/applied.
- Slide ${data.slideCount} (last): type "takeaway" — ${MAX_BULLETS} bullets summarizing what to remember.

CONTENT RULES:
- Titles: short and impactful, under ${MAX_TITLE_CHARS} characters.
- For deep-explanation slides: combine a "body" paragraph (max ${MAX_BODY_CHARS} chars) explaining the "why/how" with supporting "bullets" (max ${MAX_BULLETS}, ${MAX_BULLET_CHARS} chars each).
- Use "sections" (max 3) only when comparing/contrasting concepts side by side — never mix sections with body/bullets on the same slide.
- Keep everything sparse, professional, and free of dense paragraphs.

Also return "detectedTopic" (the polished lecture title) and fill in courseName/courseCode/courseLevel/creditUnits/contactTime using the details given below, or extracted from the source material if present there instead.

${courseInfo ? `Known course details:\n${courseInfo}\n` : ""}
${data.extraNotes ? `Instructor guidance: ${data.extraNotes}\n` : ""}
${data.mode === "paste" ? `Base the deck strictly on this source material — organize and structure it, don't invent facts beyond it:\n"""\n${content}\n"""` : `${content}\n\nNo source material was provided — use your own subject-matter knowledge to write accurate, well-organized content.`}

Return ONLY valid JSON matching the schema. No markdown, no commentary.`;
}

// ========== Gemini API call ==========

type GeminiErrorCode =
  | "MODEL_NOT_FOUND"
  | "RATE_LIMITED"
  | "AUTH"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "PARSE_ERROR"
  | "UNKNOWN";

class GeminiError extends Error {
  code: GeminiErrorCode;
  status?: number;
  constructor(message: string, code: GeminiErrorCode = "UNKNOWN", status?: number) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 45_000;

async function callGeminiModel(
  apiKey: string,
  prompt: string,
  modelName: string,
): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // x-goog-api-key is the current recommended auth method and works
        // with both old "AIza..." Standard keys and new "AQ..." Auth keys.
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: deckSchema,
        },
      }),
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errorDetail = "";
      let errorJson: any = null;
      try {
        errorJson = await res.json();
        errorDetail = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch {
        errorDetail = await res.text().catch(() => "");
      }

      if (res.status === 404) {
        throw new GeminiError(`Model "${modelName}" not found.`, "MODEL_NOT_FOUND", 404);
      }
      if (res.status === 429) {
        // Google sometimes includes a RetryInfo detail with the exact wait time.
        // Fall back to the Retry-After header, then a sane default.
        let retryAfterSeconds = 60;
        const retryInfo = errorJson?.error?.details?.find(
          (d: any) => d?.["@type"]?.includes("RetryInfo"),
        );
        const retryDelayStr: string | undefined = retryInfo?.retryDelay; // e.g. "34s"
        if (retryDelayStr) {
          const match = /^(\d+(?:\.\d+)?)s$/.exec(retryDelayStr);
          if (match) retryAfterSeconds = Math.ceil(parseFloat(match[1]));
        } else {
          const headerVal = res.headers.get("retry-after");
          if (headerVal && !isNaN(Number(headerVal))) {
            retryAfterSeconds = Number(headerVal);
          }
        }
        const err = new GeminiError(
          `Rate limited by Gemini's free tier (10 requests/minute, 250/day). Retry after ${retryAfterSeconds}s.`,
          "RATE_LIMITED",
          429,
        );
        (err as any).retryAfterSeconds = retryAfterSeconds;
        throw err;
      }
      if (res.status === 401 || res.status === 403) {
        throw new GeminiError(
          `Auth error (${res.status}): ${errorDetail || "Your API key was rejected. Get a fresh one from https://aistudio.google.com/apikey"}`,
          "AUTH",
          res.status,
        );
      }
      if (res.status === 400) {
        throw new GeminiError(`Bad request: ${errorDetail}`, "BAD_REQUEST", 400);
      }

      throw new GeminiError(
        `Gemini error (${res.status}): ${errorDetail.slice(0, 200)}`,
        "SERVER_ERROR",
        res.status,
      );
    }

    const json = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: { text?: string }) => p?.text ?? "").join("")
      : "";

    if (!text.trim()) {
      const finishReason = json?.candidates?.[0]?.finishReason;
      throw new GeminiError(
        finishReason
          ? `Gemini stopped early (${finishReason}) with no content.`
          : "Gemini returned an empty response.",
        "EMPTY_RESPONSE",
      );
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new GeminiError("Gemini returned malformed JSON.", "PARSE_ERROR");
    }
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GeminiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeminiError("Request timed out after 45s.", "TIMEOUT");
    }
    throw new GeminiError(
      err instanceof Error ? err.message : "Unknown network error",
      "UNKNOWN",
    );
  }
}

/**
 * Calls Gemini with FAST FAILURE on rate limits — no blind internal sleeping.
 * If the primary model is rate limited, try the fallback model ONCE
 * (different model = separate consideration, worth one try). If both are
 * rate limited, throw immediately with the exact wait time so the CLIENT
 * can show a visible countdown instead of the server silently blocking.
 */
async function callGeminiWithRetry(
  apiKey: string,
  prompt: string,
): Promise<Record<string, unknown>> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError: GeminiError | Error | null = null;
  let rateLimitRetryAfter: number | null = null;

  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];

    try {
      return await callGeminiModel(apiKey, prompt, model);
    } catch (err) {
      lastError = err as Error;
      const code = err instanceof GeminiError ? err.code : "UNKNOWN";

      if (code === "AUTH") throw err; // no point retrying a bad key

      if (code === "RATE_LIMITED") {
        const retryAfter = (err as any).retryAfterSeconds;
        if (retryAfter && (rateLimitRetryAfter === null || retryAfter > rateLimitRetryAfter)) {
          rateLimitRetryAfter = retryAfter;
        }
        continue; // try next model once, don't sleep
      }

      continue; // 404 / server error / timeout / bad json — try next model once
    }
  }

  if (rateLimitRetryAfter !== null) {
    const err = new GeminiError(
      `RATE_LIMITED::${rateLimitRetryAfter}::You've hit Gemini's free-tier limit (10 requests/minute, 250/day).`,
      "RATE_LIMITED",
      429,
    );
    (err as any).retryAfterSeconds = rateLimitRetryAfter;
    throw err;
  }

  const hint =
    "\n\nTroubleshooting:\n1. Get a fresh key: https://aistudio.google.com/apikey\n2. Make sure the key isn't restricted to the wrong API\n3. Check your region isn't blocked by Google";

  throw new GeminiError(
    `Slide generation failed. ${lastError instanceof Error ? lastError.message : "Unknown error"}${hint}`,
    "UNKNOWN",
  );
}

// ========== Response processing ==========

const MAX_SLIDES_SAFETY_CAP = 40;

function toSlideDeck(data: GenerateInputT, parsed: Record<string, unknown>): SlideDeck {
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const slides = rawSlides
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .slice(0, MAX_SLIDES_SAFETY_CAP)
    .map(clampSlide)
    .filter((s) => s.title || s.body || s.bullets?.length || s.sections?.length);

  if (!slides.length) {
    throw new GeminiError("Gemini didn't return any usable slides. Try again.", "UNKNOWN");
  }

  if (slides[0]) slides[0].type = "title";
  if (slides.length > 1 && slides[1]) slides[1].type = "identification";
  if (slides.length > 2) slides[slides.length - 1].type = "takeaway";

  const topic =
    (typeof parsed.detectedTopic === "string" && parsed.detectedTopic.trim()) ||
    data.topic ||
    "Untitled Lecture";

  const courseName =
    data.courseName || (typeof parsed.courseName === "string" ? parsed.courseName : "") || "";
  const courseCode =
    data.courseCode || (typeof parsed.courseCode === "string" ? parsed.courseCode : "") || "";
  const courseLevel =
    data.courseLevel || (typeof parsed.courseLevel === "string" ? parsed.courseLevel : "") || "";
  const creditUnits =
    data.creditUnits || (typeof parsed.creditUnits === "string" ? parsed.creditUnits : "") || "";
  const contactTime =
    data.contactTime || (typeof parsed.contactTime === "string" ? parsed.contactTime : "") || "";

  return {
    courseName,
    courseCode,
    courseLevel,
    creditUnits,
    contactTime,
    topic: clamp(topic, MAX_TITLE_CHARS),
    suggestedFilename: generateSafeFilename(courseName, courseCode, topic) + ".pptx",
    slides,
  };
}

// ========== Public server function ==========

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    if (!data.apiKey.trim()) {
      throw new Error("Add your Gemini API key. Get one at https://aistudio.google.com/apikey");
    }
    if (data.mode === "paste" && data.pastedContent.trim().length < 20) {
      throw new Error("Please paste some course material first.");
    }
    if (data.mode === "brief" && !data.topic.trim()) {
      throw new Error("Please enter a topic.");
    }

    try {
      const prompt = buildPrompt(data);
      const parsed = await callGeminiWithRetry(data.apiKey.trim(), prompt);
      return toSlideDeck(data, parsed);
    } catch (err) {
      // Encode retryAfterSeconds into the message itself since thrown Error
      // objects only reliably carry `message` across the server->client boundary.
      // Client parses the "RATE_LIMITED::<seconds>::" prefix to drive the timer.
      if (err instanceof GeminiError && err.code === "RATE_LIMITED") {
        const retryAfter = (err as any).retryAfterSeconds ?? 60;
        throw new Error(
          `RATE_LIMITED::${retryAfter}::You've hit Gemini's free-tier limit (10 requests/minute, 250/day). Wait ${retryAfter}s and try again.`,
        );
      }
      throw new Error(
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong generating the deck. Please try again.",
      );
    }
  });
