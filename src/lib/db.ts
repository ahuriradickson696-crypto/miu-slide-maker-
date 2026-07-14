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
let sqlClient: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!sqlClient) sqlClient = neon(getConnectionString());
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
    })();
  }
  return schemaReady;
}
