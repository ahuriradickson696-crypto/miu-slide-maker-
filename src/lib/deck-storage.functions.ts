import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";
import type { SlideDeck, SlideSpec } from "@/lib/slides.functions";
import { readSessionUser } from "@/lib/auth.functions";

// Best-effort: if SESSION_SECRET isn't configured yet, treat every request
// as signed-out rather than failing deck generation/saving outright.
export async function currentUserId(): Promise<string | null> {
  try {
    const user = await readSessionUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

// Shared by getDeck below and by other modules (e.g. lecture-notes) that
// need the full deck + slides for an id, with the same ownership rule:
// a deck with no owner (pre-auth data, or auth never configured) is
// readable by anyone; an owned deck only by its owner.
export async function loadDeckById(
  id: string,
  requestingUserId: string | null,
): Promise<SlideDeck> {
  await ensureSchema();
  const db = sql();

  const [deckRow] = await db`SELECT * FROM decks WHERE id = ${id}`;
  if (!deckRow) throw new Error("Deck not found — it may have been deleted.");
  if (deckRow.user_id && deckRow.user_id !== requestingUserId) {
    throw new Error("You don't have access to this deck.");
  }

  const slideRows = await db`
    SELECT * FROM slides WHERE deck_id = ${id} ORDER BY position ASC
  `;

  const slides: SlideSpec[] = slideRows.map((s: any) => ({
    type: s.type,
    title: s.title,
    subtitle: s.subtitle ?? undefined,
    body: s.body ?? undefined,
    bullets: s.bullets ?? undefined,
    sections: s.sections ?? undefined,
  }));

  return {
    courseName: deckRow.course_name,
    courseCode: deckRow.course_code,
    courseLevel: deckRow.course_level,
    creditUnits: deckRow.credit_units,
    contactTime: deckRow.contact_time,
    topic: deckRow.topic,
    suggestedFilename: deckRow.suggested_filename,
    slides,
  };
}

// Used only by the public /shared/:token viewer — that route validates the
// share token first (see share.functions.ts's getSharedLink), so by the
// time this runs, token possession has already stood in for the normal
// session-ownership check. Never expose this to a path that skips that
// token check.
export async function loadDeckByIdPublic(id: string): Promise<SlideDeck> {
  await ensureSchema();
  const db = sql();

  const [deckRow] = await db`SELECT * FROM decks WHERE id = ${id}`;
  if (!deckRow) throw new Error("Deck not found — it may have been deleted.");

  const slideRows = await db`
    SELECT * FROM slides WHERE deck_id = ${id} ORDER BY position ASC
  `;
  const slides: SlideSpec[] = slideRows.map((s: any) => ({
    type: s.type,
    title: s.title,
    subtitle: s.subtitle ?? undefined,
    body: s.body ?? undefined,
    bullets: s.bullets ?? undefined,
    sections: s.sections ?? undefined,
  }));

  return {
    courseName: deckRow.course_name,
    courseCode: deckRow.course_code,
    courseLevel: deckRow.course_level,
    creditUnits: deckRow.credit_units,
    contactTime: deckRow.contact_time,
    topic: deckRow.topic,
    suggestedFilename: deckRow.suggested_filename,
    slides,
  };
}

// ========== Save ==========
// Called right after a deck is generated so every deck (and every slide
// inside it) is durably stored online instead of only living in the
// browser tab. One deck row + N slide rows per save.

const SlideSpecInput = z.object({
  type: z.enum(["title", "identification", "content", "list", "takeaway", "references"]),
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
    const userId = await currentUserId();

    const [deckRow] = await db`
      INSERT INTO decks (
        topic, course_name, course_code, course_level,
        credit_units, contact_time, suggested_filename, slide_count, user_id
      ) VALUES (
        ${data.topic}, ${data.courseName}, ${data.courseCode}, ${data.courseLevel},
        ${data.creditUnits}, ${data.contactTime}, ${data.suggestedFilename}, ${data.slides.length}, ${userId}
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
// Paginated via offset/limit so a heavy user's History isn't hard-capped
// at the first 50 decks with no way to see older ones.

const ListDecksInput = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(50).optional().default(25),
});

export const listDecks = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => ListDecksInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    const userId = await currentUserId();
    // No account, no history — decks are personal once auth is configured.
    if (!userId) return { decks: [], hasMore: false };

    // Fetch one extra row to cheaply know if there's a next page, without
    // a separate COUNT(*) query.
    const rows = await db`
      SELECT id, topic, course_name, course_code, suggested_filename, slide_count, created_at
      FROM decks
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${data.limit + 1}
      OFFSET ${data.offset}
    `;
    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    return {
      decks: page.map((r: any) => ({
        id: r.id as string,
        topic: r.topic as string,
        courseName: r.course_name as string,
        courseCode: r.course_code as string,
        suggestedFilename: r.suggested_filename as string,
        slideCount: r.slide_count as number,
        createdAt: r.created_at as string,
      })),
      hasMore,
    };
  });

// ========== Load one deck (with all its slides) ==========

const GetDeckInput = z.object({ id: z.string().uuid() });

export const getDeck = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => GetDeckInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    return loadDeckById(data.id, userId);
  });

// ========== Delete ==========

const DeleteDeckInput = z.object({ id: z.string().uuid() });

export const deleteDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => DeleteDeckInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    const userId = await currentUserId();
    const [deckRow] = await db`SELECT user_id FROM decks WHERE id = ${data.id}`;
    if (deckRow && deckRow.user_id && deckRow.user_id !== userId) {
      throw new Error("You don't have access to this deck.");
    }
    // ON DELETE CASCADE on slides.deck_id handles the slide rows.
    await db`DELETE FROM decks WHERE id = ${data.id}`;
    return { ok: true };
  });

// ========== Version history ==========
// Edits made in the browser (regenerating a slide, reordering, manual
// text changes) only live in React state until this is called — there
// was previously no way to persist them at all. Calling this both
// updates the live deck (so reloading/reopening from History reflects
// the edit) and snapshots a restorable version.

async function replaceLiveSlides(db: ReturnType<typeof sql>, deckId: string, slides: SlideSpec[]): Promise<void> {
  await db`DELETE FROM slides WHERE deck_id = ${deckId}`;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    await db`
      INSERT INTO slides (deck_id, position, type, title, subtitle, body, bullets, sections)
      VALUES (
        ${deckId}, ${i}, ${s.type}, ${s.title},
        ${s.subtitle ?? null}, ${s.body ?? null},
        ${s.bullets ? JSON.stringify(s.bullets) : null},
        ${s.sections ? JSON.stringify(s.sections) : null}
      )
    `;
  }
  await db`UPDATE decks SET slide_count = ${slides.length} WHERE id = ${deckId}`;
}

const SaveDeckVersionInput = z.object({
  deckId: z.string().uuid(),
  slides: z.array(SlideSpecInput).min(1),
  note: z.string().optional().default(""),
});

export const saveDeckVersion = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SaveDeckVersionInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    const userId = await currentUserId();

    const [deckRow] = await db`SELECT user_id FROM decks WHERE id = ${data.deckId}`;
    if (!deckRow) throw new Error("Deck not found — it may have been deleted.");
    if (deckRow.user_id && deckRow.user_id !== userId) {
      throw new Error("You don't have access to this deck.");
    }

    const [maxRow] = await db`
      SELECT COALESCE(MAX(version_number), 0) AS max_version FROM deck_versions WHERE deck_id = ${data.deckId}
    `;
    const versionNumber = (maxRow.max_version as number) + 1;

    await db`
      INSERT INTO deck_versions (deck_id, version_number, slides, note, created_by)
      VALUES (${data.deckId}, ${versionNumber}, ${JSON.stringify(data.slides)}, ${data.note}, ${userId})
    `;
    await replaceLiveSlides(db, data.deckId, data.slides as SlideSpec[]);

    return { versionNumber };
  });

const ListDeckVersionsInput = z.object({ deckId: z.string().uuid() });

export const listDeckVersions = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => ListDeckVersionsInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    const userId = await currentUserId();

    const [deckRow] = await db`SELECT user_id FROM decks WHERE id = ${data.deckId}`;
    if (deckRow && deckRow.user_id && deckRow.user_id !== userId) {
      throw new Error("You don't have access to this deck.");
    }

    const rows = await db`
      SELECT version_number, note, created_at, jsonb_array_length(slides) AS slide_count
      FROM deck_versions
      WHERE deck_id = ${data.deckId}
      ORDER BY version_number DESC
    `;
    return rows.map((r: any) => ({
      versionNumber: r.version_number as number,
      note: r.note as string,
      createdAt: r.created_at as string,
      slideCount: r.slide_count as number,
    }));
  });

const RestoreDeckVersionInput = z.object({ deckId: z.string().uuid(), versionNumber: z.number().int().min(1) });

export const restoreDeckVersion = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RestoreDeckVersionInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();
    const userId = await currentUserId();

    const [deckRow] = await db`SELECT user_id FROM decks WHERE id = ${data.deckId}`;
    if (!deckRow) throw new Error("Deck not found — it may have been deleted.");
    if (deckRow.user_id && deckRow.user_id !== userId) {
      throw new Error("You don't have access to this deck.");
    }

    const [versionRow] = await db`
      SELECT slides FROM deck_versions WHERE deck_id = ${data.deckId} AND version_number = ${data.versionNumber}
    `;
    if (!versionRow) throw new Error("That version wasn't found — it may have been superseded.");

    const restoredSlides = versionRow.slides as SlideSpec[];

    // A restore is itself logged as a new version rather than silently
    // rewriting history, so "undo the restore" is always possible too.
    const [maxRow] = await db`
      SELECT COALESCE(MAX(version_number), 0) AS max_version FROM deck_versions WHERE deck_id = ${data.deckId}
    `;
    const newVersionNumber = (maxRow.max_version as number) + 1;
    await db`
      INSERT INTO deck_versions (deck_id, version_number, slides, note, created_by)
      VALUES (${data.deckId}, ${newVersionNumber}, ${JSON.stringify(restoredSlides)}, ${`Restored from version ${data.versionNumber}`}, ${userId})
    `;
    await replaceLiveSlides(db, data.deckId, restoredSlides);

    return { slides: restoredSlides, versionNumber: newVersionNumber };
  });
