import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";
import { currentUserId, loadDeckById } from "@/lib/deck-storage.functions";
import type { SlideDeck } from "@/lib/slides.functions";
import {
  callGeminiWithRetry,
  containsDisallowedContent,
  sanitizeForPrompt,
  assertNotRateLimited,
  withKeyQueue,
  logEvent,
  GeminiError,
  clamp,
  resolveApiKey,
} from "@/lib/slides.functions";

// ========== Types ==========

export type LectureNoteSection = {
  heading: string;
  paragraphs: string[];
  keyTerms?: { term: string; definition: string }[];
};

export type LectureNotes = {
  deckId: string;
  topic: string;
  courseName: string;
  courseCode: string;
  courseLevel: string;
  creditUnits: string;
  contactTime: string;
  overview: string;
  learningOutcomes: string[];
  sections: LectureNoteSection[];
  keyTakeaways: string[];
  furtherReading: string[];
  generatedAt: string;
};

const MAX_SECTIONS = 10;
const MAX_PARAGRAPHS_PER_SECTION = 4;
const MAX_PARAGRAPH_CHARS = 900;
const MAX_TERMS_PER_SECTION = 6;
const MAX_LIST_ITEMS = 8;
const MAX_LIST_ITEM_CHARS = 220;

// ========== Gemini schema ==========

const lectureNotesSchema = {
  type: "OBJECT",
  properties: {
    overview: { type: "STRING" },
    learningOutcomes: { type: "ARRAY", items: { type: "STRING" } },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          paragraphs: { type: "ARRAY", items: { type: "STRING" } },
          keyTerms: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                term: { type: "STRING" },
                definition: { type: "STRING" },
              },
              required: ["term", "definition"],
            },
          },
        },
        required: ["heading", "paragraphs"],
      },
    },
    keyTakeaways: { type: "ARRAY", items: { type: "STRING" } },
    furtherReading: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["overview", "learningOutcomes", "sections", "keyTakeaways"],
};

// ========== Prompt ==========

function slideToOutlineText(deck: SlideDeck): string {
  return deck.slides
    .filter((s) => s.type !== "title" && s.type !== "identification")
    .map((s, i) => {
      const parts = [`${i + 1}. ${sanitizeForPrompt(s.title)}`];
      if (s.subtitle) parts.push(`   ${sanitizeForPrompt(s.subtitle)}`);
      if (s.body) parts.push(`   ${sanitizeForPrompt(s.body)}`);
      if (s.bullets?.length) parts.push(...s.bullets.map((b) => `   - ${sanitizeForPrompt(b)}`));
      if (s.sections?.length) {
        parts.push(
          ...s.sections.map((sec) => `   - ${sanitizeForPrompt(sec.heading)}: ${sanitizeForPrompt(sec.description)}`),
        );
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

function buildLectureNotesPrompt(deck: SlideDeck): string {
  const courseInfo = [
    deck.courseCode && `Course code: ${sanitizeForPrompt(deck.courseCode)}`,
    deck.courseName && `Course name: ${sanitizeForPrompt(deck.courseName)}`,
    deck.courseLevel && `Level: ${sanitizeForPrompt(deck.courseLevel)}`,
  ]
    .filter(Boolean)
    .join(", ");

  return `You are a university lecturer at Metropolitan International University (MIU) writing formal lecture notes to accompany a slide deck you already presented in class. Students will read this as a standalone study document, so it must read as connected, well-organized academic prose — not a copy of the slide bullets.

Lecture topic: ${sanitizeForPrompt(deck.topic)}
${courseInfo ? `Course: ${courseInfo}\n` : ""}
Here is the slide-by-slide outline this lecture followed (titles, and whatever body/bullet/section content each slide had). Treat this strictly as the topic outline to expand on with your own subject-matter expertise — write full explanatory prose, don't just reformat it:
"""
${slideToOutlineText(deck)}
"""

Write the notes with this structure:
1. "overview": one paragraph (2-4 sentences) framing why this topic matters and what it covers.
2. "learningOutcomes": 3-5 concise "By the end of this lecture, students will be able to..." statements.
3. "sections": one section per major concept from the outline (merge closely related slides into one section where sensible; don't force a rigid 1-slide-to-1-section mapping). Each section needs:
   - "heading": a clear section title.
   - "paragraphs": 1-3 well-developed paragraphs of connected academic prose explaining the concept — reasoning, examples, and context, not bullet fragments restated as sentences.
   - "keyTerms" (optional, only where genuinely useful): important vocabulary introduced in that section, each with a one-sentence definition.
4. "keyTakeaways": 4-6 bullet-point summary statements a student should walk away remembering.
5. "furtherReading" (optional): 2-4 general suggestions for where a student could learn more (e.g. "the relevant chapter of a standard textbook on this subject", "peer-reviewed articles on X") — do not fabricate specific book titles, authors, ISBNs, or URLs you cannot verify.

Tone: clear, professional, and pedagogically sound — the register of a well-written university course pack, not marketing copy and not a dry list. Return ONLY valid JSON matching the schema. No markdown, no commentary.`;
}

// ========== Clamping (mirrors the discipline in slides.functions.ts —
// keep AI output within sane bounds for a printable/PDF-able document) ==========

function clampLectureNotes(deck: SlideDeck, raw: Record<string, unknown>): Omit<LectureNotes, "deckId" | "generatedAt"> {
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: LectureNoteSection[] = rawSections
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .slice(0, MAX_SECTIONS)
    .map((s) => {
      const paragraphs = (Array.isArray(s.paragraphs) ? s.paragraphs : [])
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .slice(0, MAX_PARAGRAPHS_PER_SECTION)
        .map((p) => clamp(p, MAX_PARAGRAPH_CHARS));
      const keyTerms = (Array.isArray(s.keyTerms) ? s.keyTerms : [])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .slice(0, MAX_TERMS_PER_SECTION)
        .map((t) => ({
          term: clamp(typeof t.term === "string" ? t.term : "", 80),
          definition: clamp(typeof t.definition === "string" ? t.definition : "", 240),
        }))
        .filter((t) => t.term && t.definition);
      return {
        heading: clamp(typeof s.heading === "string" ? s.heading : "Untitled section", 120),
        paragraphs: paragraphs.length ? paragraphs : ["(No content generated for this section.)"],
        keyTerms: keyTerms.length ? keyTerms : undefined,
      };
    })
    .filter((s) => s.heading);

  const learningOutcomes = (Array.isArray(raw.learningOutcomes) ? raw.learningOutcomes : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, MAX_LIST_ITEMS)
    .map((x) => clamp(x, MAX_LIST_ITEM_CHARS));

  const keyTakeaways = (Array.isArray(raw.keyTakeaways) ? raw.keyTakeaways : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, MAX_LIST_ITEMS)
    .map((x) => clamp(x, MAX_LIST_ITEM_CHARS));

  const furtherReading = (Array.isArray(raw.furtherReading) ? raw.furtherReading : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, MAX_LIST_ITEMS)
    .map((x) => clamp(x, MAX_LIST_ITEM_CHARS));

  return {
    topic: deck.topic,
    courseName: deck.courseName,
    courseCode: deck.courseCode,
    courseLevel: deck.courseLevel,
    creditUnits: deck.creditUnits,
    contactTime: deck.contactTime,
    overview: clamp(typeof raw.overview === "string" ? raw.overview : "", MAX_PARAGRAPH_CHARS),
    learningOutcomes,
    sections,
    keyTakeaways,
    furtherReading,
  };
}

// ========== Server functions ==========

const GenerateLectureNotesInput = z.object({
  deckId: z.string().uuid(),
  apiKey: z.string().optional().default(""),
});

export const generateLectureNotes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateLectureNotesInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    const deck = await loadDeckById(data.deckId, userId);
    const apiKey = resolveApiKey(data.apiKey);

    if (!apiKey) {
      throw new Error("Add your Gemini API key. Get one at https://aistudio.google.com/apikey");
    }
    if (containsDisallowedContent(deck.topic, deck.courseName)) {
      throw new Error("This deck's content isn't eligible for note generation.");
    }

    const startedAt = Date.now();
    try {
      await assertNotRateLimited(apiKey);
      const prompt = buildLectureNotesPrompt(deck);
      const parsed = await withKeyQueue(apiKey, () => callGeminiWithRetry(apiKey, prompt, lectureNotesSchema));
      logEvent("gemini_lecture_notes_generated", { ms: Date.now() - startedAt, deckId: data.deckId });

      const clamped = clampLectureNotes(deck, parsed);
      const generatedAt = new Date().toISOString();

      await ensureSchema();
      const db = sql();
      await db`
        INSERT INTO lecture_notes (
          deck_id, user_id, topic, course_name, course_code, course_level,
          credit_units, contact_time, overview, learning_outcomes, sections,
          key_takeaways, further_reading, updated_at
        ) VALUES (
          ${data.deckId}, ${userId}, ${clamped.topic}, ${clamped.courseName}, ${clamped.courseCode},
          ${clamped.courseLevel}, ${clamped.creditUnits}, ${clamped.contactTime}, ${clamped.overview},
          ${JSON.stringify(clamped.learningOutcomes)}, ${JSON.stringify(clamped.sections)},
          ${JSON.stringify(clamped.keyTakeaways)}, ${JSON.stringify(clamped.furtherReading)}, now()
        )
        ON CONFLICT (deck_id) DO UPDATE SET
          topic = EXCLUDED.topic,
          course_name = EXCLUDED.course_name,
          course_code = EXCLUDED.course_code,
          course_level = EXCLUDED.course_level,
          credit_units = EXCLUDED.credit_units,
          contact_time = EXCLUDED.contact_time,
          overview = EXCLUDED.overview,
          learning_outcomes = EXCLUDED.learning_outcomes,
          sections = EXCLUDED.sections,
          key_takeaways = EXCLUDED.key_takeaways,
          further_reading = EXCLUDED.further_reading,
          updated_at = now()
      `;

      const notes: LectureNotes = { ...clamped, deckId: data.deckId, generatedAt };
      return notes;
    } catch (err) {
      logEvent("gemini_lecture_notes_failed", {
        ms: Date.now() - startedAt,
        code: err instanceof GeminiError ? err.code : "UNKNOWN",
      });
      if (err instanceof GeminiError && err.code === "RATE_LIMITED") {
        const retryAfter = (err as any).retryAfterSeconds ?? 60;
        throw new Error(
          `RATE_LIMITED::${retryAfter}::You've hit Gemini's free-tier limit (10 requests/minute, 250/day). Wait ${retryAfter}s and try again.`,
        );
      }
      throw new Error(
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong generating lecture notes. Please try again.",
      );
    }
  });

function rowToLectureNotes(row: any): LectureNotes {
  return {
    deckId: row.deck_id as string,
    topic: row.topic as string,
    courseName: row.course_name as string,
    courseCode: row.course_code as string,
    courseLevel: row.course_level as string,
    creditUnits: row.credit_units as string,
    contactTime: row.contact_time as string,
    overview: row.overview as string,
    learningOutcomes: (row.learning_outcomes ?? []) as string[],
    sections: (row.sections ?? []) as LectureNoteSection[],
    keyTakeaways: (row.key_takeaways ?? []) as string[],
    furtherReading: (row.further_reading ?? []) as string[],
    generatedAt: new Date(row.updated_at).toISOString(),
  };
}

const GetLectureNotesInput = z.object({ deckId: z.string().uuid() });

export const getLectureNotes = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => GetLectureNotesInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    // Ownership check reuses the same rule as loading the deck itself.
    await loadDeckById(data.deckId, userId);

    await ensureSchema();
    const db = sql();
    const [row] = await db`SELECT * FROM lecture_notes WHERE deck_id = ${data.deckId}`;
    return row ? rowToLectureNotes(row) : null;
  });

// ========== Library (list all of the signed-in person's notes) ==========
// Powers the /notes hub page — same paginated/searchable shape as
// listDecks in deck-storage.functions.ts, but against lecture_notes'
// own table.

const ListLectureNotesInput = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(50).optional().default(25),
  query: z.string().optional().default(""),
});

export const listLectureNotes = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => ListLectureNotesInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    const userId = await currentUserId();
    if (!userId) return { notes: [], hasMore: false };

    const likeQuery = data.query.trim() ? `%${data.query.trim()}%` : null;

    const rows = await db`
      SELECT deck_id, topic, course_name, course_code, updated_at
      FROM lecture_notes
      WHERE user_id = ${userId}
        AND (
          ${likeQuery}::text IS NULL
          OR topic ILIKE ${likeQuery}
          OR course_name ILIKE ${likeQuery}
          OR course_code ILIKE ${likeQuery}
        )
      ORDER BY updated_at DESC
      LIMIT ${data.limit + 1}
      OFFSET ${data.offset}
    `;
    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    return {
      notes: page.map((r: any) => ({
        deckId: r.deck_id as string,
        topic: r.topic as string,
        courseName: r.course_name as string,
        courseCode: r.course_code as string,
        updatedAt: r.updated_at as string,
      })),
      hasMore,
    };
  });
