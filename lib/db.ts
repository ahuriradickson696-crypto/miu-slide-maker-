import { neon } from "@neondatabase/serverless";

// ========== Database client ==========
// Uses Neon's HTTP driver — works over plain fetch, so it runs fine on
// Vercel's serverless functions with zero connection-pool setup. Only
// needs one env var: DATABASE_URL (Neon gives you this on project creation).
//
// Set it in Vercel: Project Settings -> Environment Variables ->
// DATABASE_URL = postgres://... (Production, Preview, Development).
// See DEPLOYMENT.md for the full walkthrough.

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Neon Postgres connection string in Vercel's Environment Variables (see DEPLOYMENT.md).",
    );
  }
  return url;
}

// Lazily created so the app doesn't crash at import time if the env var
// isn't set yet (e.g. during local `vite build` without a .env).
let sqlClient: ReturnType<typeof neon<false, false>> | null = null;

export function sql() {
  if (!sqlClient) sqlClient = neon<false, false>(getConnectionString());
  return sqlClient;
}

// ========== Schema ==========
// One row per deck, one row per slide (slides belong to a deck via
// deck_id). Kept as two small tables instead of one big JSON blob so
// individual slides can be queried, counted, or edited later without
// re-parsing a whole deck.

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          google_sub TEXT UNIQUE,
          email TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          picture TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Migrate older deployments where google_sub was NOT NULL (Google-only
      // sign-in) — password accounts need to be able to omit it.
      await db`ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL`;
      // Password auth support. password_hash is null for Google-only
      // accounts. email is the true identity key once password auth
      // exists — a person can have both a Google identity and a password
      // on the same row, matched by email. email_verified starts true for
      // Google sign-ins (Google already verified it) and false for fresh
      // password signups until they click the emailed verification link;
      // when email sending isn't configured, verification is skipped
      // entirely rather than permanently locking accounts out.
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`;
      // Admin control is DB-backed (toggleable from the admin panel)
      // rather than only the ADMIN_EMAILS env var — the env var still
      // works too (checked in auth.functions.ts) and is treated as a
      // "seed" list of admins on first login, but promoting/demoting
      // people afterward doesn't require a redeploy.
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (lower(email))
      `;
      await db`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'reset',
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens (token_hash)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens (user_id)
      `;
      await db`
        CREATE TABLE IF NOT EXISTS decks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          topic TEXT NOT NULL DEFAULT '',
          course_name TEXT NOT NULL DEFAULT '',
          course_code TEXT NOT NULL DEFAULT '',
          course_level TEXT NOT NULL DEFAULT '',
          credit_units TEXT NOT NULL DEFAULT '',
          contact_time TEXT NOT NULL DEFAULT '',
          suggested_filename TEXT NOT NULL DEFAULT '',
          slide_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Ties a deck to the Google account that generated it. Nullable so
      // decks saved before login existed (or by a signed-out visitor)
      // don't break — they just won't show up in anyone's History.
      await db`ALTER TABLE decks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`;
      await db`
        CREATE TABLE IF NOT EXISTS slides (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          deck_id UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          subtitle TEXT,
          body TEXT,
          bullets JSONB,
          sections JSONB
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_slides_deck_id ON slides(deck_id)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_decks_created_at ON decks(created_at DESC)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_decks_user_id ON decks(user_id)
      `;
      // Short-lived cache of full Gemini responses, keyed by a hash of the
      // generation request. Lets an identical re-submit (double-click,
      // browser back/forward, retry after a network blip) skip burning a
      // free-tier request. Best-effort only — this is not a queue or a
      // guarantee, just a courtesy against accidental duplicate calls.
      await db`
        CREATE TABLE IF NOT EXISTS generation_cache (
          request_hash TEXT PRIMARY KEY,
          response JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // ========== Lecture notes (its own dedicated table/module) ==========
      // Deliberately NOT a generic "deck_documents" blob table — each
      // feature module (slide decks above, lecture notes here, and
      // whatever's added next — quizzes, flashcards, etc.) gets its own
      // purpose-built table with real columns, so each is independently
      // queryable, indexable, and evolvable without dragging the others
      // along. One row per deck (a deck's notes are regenerated in place,
      // not versioned) — enforced by the UNIQUE constraint on deck_id.
      await db`
        CREATE TABLE IF NOT EXISTS lecture_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          deck_id UUID NOT NULL UNIQUE REFERENCES decks(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          topic TEXT NOT NULL DEFAULT '',
          course_name TEXT NOT NULL DEFAULT '',
          course_code TEXT NOT NULL DEFAULT '',
          course_level TEXT NOT NULL DEFAULT '',
          credit_units TEXT NOT NULL DEFAULT '',
          contact_time TEXT NOT NULL DEFAULT '',
          overview TEXT NOT NULL DEFAULT '',
          learning_outcomes JSONB NOT NULL DEFAULT '[]',
          sections JSONB NOT NULL DEFAULT '[]',
          key_takeaways JSONB NOT NULL DEFAULT '[]',
          further_reading JSONB NOT NULL DEFAULT '[]',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_lecture_notes_user_id ON lecture_notes(user_id)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_lecture_notes_created_at ON lecture_notes(created_at DESC)
      `;

      // ========== Curriculum (its own dedicated module/tables) ==========
      // A person uploads a heavy curriculum document (PDF/DOCX/TXT); we
      // extract its academic hierarchy once (program → years → semesters →
      // course units → topics) and store that structure here. Detailed
      // topic-by-topic notes are generated later, one semester at a time
      // (mirroring how a human would work through a large document), and
      // stored separately per (curriculum, year, semester) so re-generating
      // one semester never touches another.
      await db`
        CREATE TABLE IF NOT EXISTS curricula (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          program_name TEXT NOT NULL DEFAULT '',
          source_filename TEXT NOT NULL DEFAULT '',
          structure JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Object key of the original uploaded file in R2 (if R2 storage is
      // configured) — null when R2 isn't set up, or if the R2 upload
      // failed (best-effort, never blocks the curriculum import itself).
      await db`ALTER TABLE curricula ADD COLUMN IF NOT EXISTS source_file_key TEXT`;
      await db`
        CREATE INDEX IF NOT EXISTS idx_curricula_user_id ON curricula(user_id)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_curricula_created_at ON curricula(created_at DESC)
      `;
      await db`
        CREATE TABLE IF NOT EXISTS curriculum_semester_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          curriculum_id UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
          year_label TEXT NOT NULL,
          semester_label TEXT NOT NULL,
          topics JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (curriculum_id, year_label, semester_label)
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_curriculum_notes_curriculum_id ON curriculum_semester_notes(curriculum_id)
      `;
    })();
  }
  return schemaReady;
}
