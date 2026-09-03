import { createServerFn } from "@tanstack/react-start";
import { clearSession } from "@tanstack/react-start/server";
import { ensureSchema, sql } from "@/lib/db";
import { readSessionUser, sessionConfig } from "@/lib/auth.functions";
import { storageConfigured, deleteObject } from "@/lib/object-storage";

// ========== Download my data ==========
// Everything tied to the signed-in person's own account — never another
// user's data, and never password_hash (there's no legitimate reason a
// data-export file should ever contain a password hash, even one only
// the account owner can download).

export const exportMyData = createServerFn({ method: "GET" }).handler(async () => {
  const user = await readSessionUser();
  if (!user) throw new Error("Not signed in.");

  await ensureSchema();
  const db = sql();

  const [profileRows, decks, slides, lectureNotes, curricula, curriculumNotes] = await Promise.all([
    db`SELECT id, email, name, picture, email_verified, created_at, last_login_at FROM users WHERE id = ${user.id}`,
    db`SELECT * FROM decks WHERE user_id = ${user.id}`,
    db`SELECT s.* FROM slides s JOIN decks d ON d.id = s.deck_id WHERE d.user_id = ${user.id}`,
    db`SELECT * FROM lecture_notes WHERE user_id = ${user.id}`,
    db`SELECT id, program_name, source_filename, structure, created_at FROM curricula WHERE user_id = ${user.id}`,
    db`SELECT csn.* FROM curriculum_semester_notes csn JOIN curricula c ON c.id = csn.curriculum_id WHERE c.user_id = ${user.id}`,
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: profileRows[0] ?? null,
    decks,
    slides,
    lectureNotes,
    curricula,
    curriculumNotes,
  };
});

// ========== Delete my account ==========
// Real deletion, not a soft-delete flag:
// 1. Look up any R2 object keys this account owns (curriculum source
//    files) BEFORE deleting the DB rows that reference them.
// 2. Delete the user row — every other table (decks, slides,
//    lecture_notes, curricula, curriculum_semester_notes) has
//    ON DELETE CASCADE back to users.id, so this cascades automatically.
// 3. Best-effort purge those R2 objects — object storage is never
//    touched by a SQL cascade, so this has to happen explicitly or a
//    deleted account's files would silently linger in the bucket.
// 4. Clear the session so the (now-deleted) account is signed out.

export const deleteMyAccount = createServerFn({ method: "POST" }).handler(async () => {
  const user = await readSessionUser();
  if (!user) throw new Error("Not signed in.");

  await ensureSchema();
  const db = sql();

  let fileKeys: string[] = [];
  if (storageConfigured("r2")) {
    const rows = await db`
      SELECT source_file_key FROM curricula WHERE user_id = ${user.id} AND source_file_key IS NOT NULL
    `;
    fileKeys = rows.map((r: any) => r.source_file_key as string).filter(Boolean);
  }

  await db`DELETE FROM users WHERE id = ${user.id}`;

  const storageErrors: string[] = [];
  for (const key of fileKeys) {
    try {
      await deleteObject("r2", key);
    } catch (err) {
      // The account is already deleted at this point — a storage cleanup
      // failure shouldn't be reported as "deletion failed" to the person,
      // but it's worth knowing about server-side.
      storageErrors.push(key);
      console.error(
        JSON.stringify({ event: "account_deletion_r2_cleanup_failed", key, message: err instanceof Error ? err.message : "unknown" }),
      );
    }
  }

  await clearSession(sessionConfig());

  return { ok: true, filesPurged: fileKeys.length - storageErrors.length, filesFailedToPurge: storageErrors.length };
});
