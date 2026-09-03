import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";
import { readSessionUser } from "@/lib/auth.functions";
import { getConfigStatus } from "@/lib/config-status";
import { isSeedAdminEmail } from "@/lib/admin-seed";
import { storageConfigured, uploadObject, deleteObject } from "@/lib/object-storage";

// ========== Shared authorization ==========
// Every admin function in this file goes through this — DB-backed
// is_admin flag first (source of truth once someone's logged in at least
// once), the centralized seed-admin check (hardcoded admin + ADMIN_EMAILS)
// as a bootstrap fallback for accounts that predate the flag. Throws
// rather than returning false so a non-admin hitting any of these
// functions gets a clear, generic "Not authorized" instead of empty/
// zeroed data that could be mistaken for real results.
async function requireAdmin(): Promise<{ id: string; email: string }> {
  const user = await readSessionUser();
  if (!user) throw new Error("Not authorized.");

  await ensureSchema();
  const db = sql();
  const [row] = await db`SELECT is_admin FROM users WHERE id = ${user.id}`;

  const isAdmin = !!row?.is_admin || isSeedAdminEmail(user.email);

  if (!isAdmin) throw new Error("Not authorized.");
  return user;
}

// ========== Usage stats (overview tab) ==========

export const getUsageStats = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  await ensureSchema();
  const db = sql();

  const [deckTotals] = await db`
    SELECT
      COUNT(*)::int AS total_decks,
      COALESCE(SUM(slide_count), 0)::int AS total_slides,
      COALESCE(AVG(slide_count), 0)::float AS avg_slides,
      COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS decks_today,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS decks_this_week,
      COUNT(DISTINCT user_id)::int AS distinct_users
    FROM decks
  `;
  const [notesTotals] = await db`SELECT COUNT(*)::int AS total_notes FROM lecture_notes`;
  const [curriculaTotals] = await db`SELECT COUNT(*)::int AS total_curricula FROM curricula`;
  const [userCount] = await db`SELECT COUNT(*)::int AS count FROM users`;

  const byDay = await db`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM decks
    WHERE created_at > now() - interval '14 days'
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return {
    totalDecks: deckTotals.total_decks as number,
    totalSlides: deckTotals.total_slides as number,
    avgSlides: Math.round((deckTotals.avg_slides as number) * 10) / 10,
    decksToday: deckTotals.decks_today as number,
    decksThisWeek: deckTotals.decks_this_week as number,
    distinctUsers: deckTotals.distinct_users as number,
    totalUsers: userCount.count as number,
    totalNotes: notesTotals.total_notes as number,
    totalCurricula: curriculaTotals.total_curricula as number,
    byDay: byDay.map((r: any) => ({ day: r.day as string, count: r.count as number })),
  };
});

// ========== System / config status (for the API-key & integrations tab) ==========
// Booleans only, same as the public config-status endpoint — but this one
// requires admin auth, so it's a fine place to also confirm which of the
// optional integrations are live from the admin's point of view.

export const getSystemStatus = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return getConfigStatus();
});

// ========== Users ==========

const ListUsersInput = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(50).optional().default(25),
  query: z.string().optional().default(""),
});

export const adminListUsers = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => ListUsersInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();
    const likeQuery = data.query.trim() ? `%${data.query.trim()}%` : null;

    const rows = await db`
      SELECT
        u.id, u.email, u.name, u.picture, u.is_admin, u.email_verified,
        u.created_at, u.last_login_at,
        (u.google_sub IS NOT NULL) AS has_google,
        (u.password_hash IS NOT NULL) AS has_password,
        COALESCE(d.deck_count, 0)::int AS deck_count
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS deck_count FROM decks WHERE user_id IS NOT NULL GROUP BY user_id
      ) d ON d.user_id = u.id
      WHERE ${likeQuery}::text IS NULL OR u.email ILIKE ${likeQuery} OR u.name ILIKE ${likeQuery}
      ORDER BY u.last_login_at DESC
      LIMIT ${data.limit + 1}
      OFFSET ${data.offset}
    `;
    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    return {
      users: page.map((r: any) => ({
        id: r.id as string,
        email: r.email as string,
        name: r.name as string,
        picture: r.picture as string,
        isAdmin: r.is_admin as boolean,
        emailVerified: r.email_verified as boolean,
        hasGoogle: r.has_google as boolean,
        hasPassword: r.has_password as boolean,
        deckCount: r.deck_count as number,
        createdAt: r.created_at as string,
        lastLoginAt: r.last_login_at as string,
      })),
      hasMore,
    };
  });

const SetUserAdminInput = z.object({ userId: z.string().uuid(), isAdmin: z.boolean() });

export const adminSetUserAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SetUserAdminInput.parse(data))
  .handler(async ({ data }) => {
    const requester = await requireAdmin();
    if (requester.id === data.userId && !data.isAdmin) {
      throw new Error("You can't remove your own admin access.");
    }
    await ensureSchema();
    const db = sql();
    await db`UPDATE users SET is_admin = ${data.isAdmin} WHERE id = ${data.userId}`;
    return { ok: true };
  });

// ========== Decks (moderation — any deck, not just the requester's own) ==========

const AdminListDecksInput = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(50).optional().default(25),
  query: z.string().optional().default(""),
});

export const adminListDecks = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => AdminListDecksInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();
    const likeQuery = data.query.trim() ? `%${data.query.trim()}%` : null;

    const rows = await db`
      SELECT d.id, d.topic, d.course_code, d.course_name, d.slide_count, d.created_at,
             u.email AS owner_email
      FROM decks d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE ${likeQuery}::text IS NULL OR d.topic ILIKE ${likeQuery} OR u.email ILIKE ${likeQuery}
      ORDER BY d.created_at DESC
      LIMIT ${data.limit + 1}
      OFFSET ${data.offset}
    `;
    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    return {
      decks: page.map((r: any) => ({
        id: r.id as string,
        topic: r.topic as string,
        courseCode: r.course_code as string,
        courseName: r.course_name as string,
        slideCount: r.slide_count as number,
        createdAt: r.created_at as string,
        ownerEmail: (r.owner_email as string | null) ?? null,
      })),
      hasMore,
    };
  });

const AdminDeleteDeckInput = z.object({ id: z.string().uuid() });

export const adminDeleteDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AdminDeleteDeckInput.parse(data))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();
    // ON DELETE CASCADE handles slides + any linked lecture_notes row.
    await db`DELETE FROM decks WHERE id = ${data.id}`;
    return { ok: true };
  });

// ========== Lecture notes (moderation) ==========

const AdminListNotesInput = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(50).optional().default(25),
  query: z.string().optional().default(""),
});

export const adminListLectureNotes = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => AdminListNotesInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();
    const likeQuery = data.query.trim() ? `%${data.query.trim()}%` : null;

    const rows = await db`
      SELECT n.deck_id, n.topic, n.course_code, n.updated_at, u.email AS owner_email
      FROM lecture_notes n
      LEFT JOIN users u ON u.id = n.user_id
      WHERE ${likeQuery}::text IS NULL OR n.topic ILIKE ${likeQuery} OR u.email ILIKE ${likeQuery}
      ORDER BY n.updated_at DESC
      LIMIT ${data.limit + 1}
      OFFSET ${data.offset}
    `;
    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    return {
      notes: page.map((r: any) => ({
        deckId: r.deck_id as string,
        topic: r.topic as string,
        courseCode: r.course_code as string,
        updatedAt: r.updated_at as string,
        ownerEmail: (r.owner_email as string | null) ?? null,
      })),
      hasMore,
    };
  });

const AdminDeleteNotesInput = z.object({ deckId: z.string().uuid() });

export const adminDeleteLectureNotes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AdminDeleteNotesInput.parse(data))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();
    await db`DELETE FROM lecture_notes WHERE deck_id = ${data.deckId}`;
    return { ok: true };
  });

// ========== Curricula (moderation) ==========

const AdminListCurriculaInput = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(50).optional().default(25),
  query: z.string().optional().default(""),
});

export const adminListCurricula = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => AdminListCurriculaInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();
    const likeQuery = data.query.trim() ? `%${data.query.trim()}%` : null;

    const rows = await db`
      SELECT c.id, c.program_name, c.source_filename, c.created_at, u.email AS owner_email
      FROM curricula c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE ${likeQuery}::text IS NULL OR c.program_name ILIKE ${likeQuery} OR u.email ILIKE ${likeQuery}
      ORDER BY c.created_at DESC
      LIMIT ${data.limit + 1}
      OFFSET ${data.offset}
    `;
    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;

    return {
      curricula: page.map((r: any) => ({
        id: r.id as string,
        programName: r.program_name as string,
        sourceFilename: r.source_filename as string,
        createdAt: r.created_at as string,
        ownerEmail: (r.owner_email as string | null) ?? null,
      })),
      hasMore,
    };
  });

const AdminDeleteCurriculumInput = z.object({ id: z.string().uuid() });

export const adminDeleteCurriculum = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AdminDeleteCurriculumInput.parse(data))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureSchema();
    const db = sql();

    const [row] = await db`SELECT source_file_key FROM curricula WHERE id = ${data.id}`;
    // ON DELETE CASCADE handles curriculum_semester_notes.
    await db`DELETE FROM curricula WHERE id = ${data.id}`;

    if (row?.source_file_key) {
      try {
        await deleteObject("r2", row.source_file_key as string);
      } catch {
        // best-effort — see the same pattern in curriculum.functions.ts's deleteCurriculum
      }
    }

    return { ok: true };
  });

// ========== Backups ==========
// Dumps every module's data as one JSON file to whatever S3-compatible
// storage is configured (Backblaze B2, AWS S3, etc. — see object-storage.ts).
// Deliberately excludes password_hash and any other auth-sensitive column,
// even though this is already admin-only — a leaked backup file should
// still never contain anything that could sign someone in.

export const backupConfigured = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return { configured: storageConfigured("backup") };
});

export const adminTriggerBackup = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  if (!storageConfigured("backup")) {
    throw new Error("Backup storage isn't configured — set BACKUP_STORAGE_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET.");
  }

  await ensureSchema();
  const db = sql();

  const [users, decks, slides, lectureNotes, curricula, curriculumNotes] = await Promise.all([
    db`SELECT id, google_sub, email, name, picture, email_verified, is_admin, created_at, last_login_at FROM users`,
    db`SELECT * FROM decks`,
    db`SELECT * FROM slides`,
    db`SELECT * FROM lecture_notes`,
    db`SELECT id, user_id, program_name, source_filename, source_file_key, structure, created_at FROM curricula`,
    db`SELECT * FROM curriculum_semester_notes`,
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    tables: { users, decks, slides, lectureNotes, curricula, curriculumNotes },
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `miu-slide-studio-backup-${timestamp}.json`;
  await uploadObject("backup", key, JSON.stringify(dump, null, 2), "application/json");

  return {
    ok: true,
    key,
    counts: {
      users: users.length,
      decks: decks.length,
      lectureNotes: lectureNotes.length,
      curricula: curricula.length,
    },
  };
});
