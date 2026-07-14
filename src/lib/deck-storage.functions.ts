import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";
import type { SlideDeck, SlideSpec } from "@/lib/slides.functions";

// ========== Save ==========
// Called right after a deck is generated so every deck (and every slide
// inside it) is durably stored online instead of only living in the
// browser tab. One deck row + N slide rows per save.

const SlideSpecInput = z.object({
  type: z.enum(["title", "identification", "content", "list", "takeaway"]),
  title: z.string(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  sections: z
    .array(z.object({ heading: z.string(), description: z.string() }))
    .optional(),
});

const SaveDeckInput = z.object({
  courseName: z.string().optional().default(""),
  courseCode: z.string().optional().default(""),
  courseLevel: z.string().optional().default(""),
  creditUnits: z.string().optional().default(""),
  contactTime: z.string().optional().default(""),
  topic: z.string().optional().default(""),
  suggestedFilename: z.string().optional().default(""),
  slides: z.array(SlideSpecInput).min(1),
});

export const saveDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SaveDeckInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();

    const [deckRow] = await db`
      INSERT INTO decks (
        topic, course_name, course_code, course_level,
        credit_units, contact_time, suggested_filename, slide_count
      ) VALUES (
        ${data.topic}, ${data.courseName}, ${data.courseCode}, ${data.courseLevel},
        ${data.creditUnits}, ${data.contactTime}, ${data.suggestedFilename}, ${data.slides.length}
      )
      RETURNING id, created_at
    `;

    // Insert slides one by one (decks are small — max 40 slides — so this
    // stays well within a single request's time budget and keeps each row
    // easy to reason about; no bulk-insert complexity needed).
    for (let i = 0; i < data.slides.length; i++) {
      const s = data.slides[i];
      await db`
        INSERT INTO slides (deck_id, position, type, title, subtitle, body, bullets, sections)
        VALUES (
          ${deckRow.id}, ${i}, ${s.type}, ${s.title},
          ${s.subtitle ?? null}, ${s.body ?? null},
          ${s.bullets ? JSON.stringify(s.bullets) : null},
          ${s.sections ? JSON.stringify(s.sections) : null}
        )
      `;
    }

    return { id: deckRow.id as string, createdAt: deckRow.created_at as string };
  });

// ========== List (history) ==========
// Lightweight — no slide bodies, just enough to show a history list.

export const listDecks = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT id, topic, course_name, course_code, suggested_filename, slide_count, created_at
    FROM decks
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return rows.map((r: any) => ({
    id: r.id as string,
    topic: r.topic as string,
    courseName: r.course_name as string,
    courseCode: r.course_code as string,
    suggestedFilename: r.suggested_filename as string,
    slideCount: r.slide_count as number,
    createdAt: r.created_at as string,
  }));
});

// ========== Load one deck (with all its slides) ==========

const GetDeckInput = z.object({ id: z.string().uuid() });

export const getDeck = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => GetDeckInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();

    const [deckRow] = await db`SELECT * FROM decks WHERE id = ${data.id}`;
    if (!deckRow) throw new Error("Deck not found — it may have been deleted.");

    const slideRows = await db`
      SELECT * FROM slides WHERE deck_id = ${data.id} ORDER BY position ASC
    `;

    const slides: SlideSpec[] = slideRows.map((s: any) => ({
      type: s.type,
      title: s.title,
      subtitle: s.subtitle ?? undefined,
      body: s.body ?? undefined,
      bullets: s.bullets ?? undefined,
      sections: s.sections ?? undefined,
    }));

    const deck: SlideDeck = {
      courseName: deckRow.course_name,
      courseCode: deckRow.course_code,
      courseLevel: deckRow.course_level,
      creditUnits: deckRow.credit_units,
      contactTime: deckRow.contact_time,
      topic: deckRow.topic,
      suggestedFilename: deckRow.suggested_filename,
      slides,
    };

    return deck;
  });

// ========== Delete ==========

const DeleteDeckInput = z.object({ id: z.string().uuid() });

export const deleteDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => DeleteDeckInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    // ON DELETE CASCADE on slides.deck_id handles the slide rows.
    await db`DELETE FROM decks WHERE id = ${data.id}`;
    return { ok: true };
  });
