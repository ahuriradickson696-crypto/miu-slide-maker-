// Central place to check which pieces of this app's config are present.
// Nothing here is required to run the app — GEMINI_API_KEY is supplied
// per-request by the person using the app, not as a server env var — but
// DATABASE_URL, UPSTASH_REDIS_REST_*, SESSION_SECRET, and the Google OAuth
// vars are all optional server-side config that unlock specific features.
// This module lets both the startup log and the health-check endpoint
// (and, transitively, the "config missing" banner in the UI) agree on one
// definition of "configured" instead of duplicating the same env reads.

import { storageConfigured } from "@/lib/object-storage";

export type ConfigStatus = {
  database: boolean;
  redis: boolean;
  session: boolean;
  googleAuth: boolean;
  passwordAuth: boolean;
  email: boolean;
  adminDashboard: boolean;
  sharedApiKey: boolean;
  groqFallback: boolean;
  deepseekFallback: boolean;
  r2Storage: boolean;
  backupStorage: boolean;
};

export function getConfigStatus(): ConfigStatus {
  const database = !!process.env.DATABASE_URL;
  const redis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const session = !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
  const googleAuth = !!(process.env.GOOGLE_CLIENT_ID && session);
  const passwordAuth = session && database;
  const email = !!process.env.RESEND_API_KEY;
  const adminDashboard = !!(process.env.ADMIN_EMAILS && database);
  const sharedApiKey = !!process.env.GEMINI_API_KEY;
  const groqFallback = !!process.env.GROQ_API_KEY;
  const deepseekFallback = !!process.env.DEEPSEEK_API_KEY;
  const r2Storage = storageConfigured("r2");
  const backupStorage = storageConfigured("backup");
  return {
    database,
    redis,
    session,
    googleAuth,
    passwordAuth,
    email,
    adminDashboard,
    sharedApiKey,
    groqFallback,
    deepseekFallback,
    r2Storage,
    backupStorage,
  };
}

// Called once at server startup (see instrumentation hook in start.ts).
// Logs plain, greppable warnings for anything missing — doesn't throw,
// since every one of these is genuinely optional and the app should still
// boot and serve the core "generate a deck" flow without any of them.
let didLogStartupStatus = false;

export function logStartupConfigStatus() {
  if (didLogStartupStatus) return;
  didLogStartupStatus = true;

  const status = getConfigStatus();
  const notes: string[] = [];
  if (!status.database) {
    notes.push("DATABASE_URL not set — deck History will be unavailable (generation/download still work).");
  }
  if (!status.redis) {
    notes.push(
      "UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting, caching, and call locking will run in best-effort, single-instance mode.",
    );
  }
  if (!status.session) {
    notes.push(
      "SESSION_SECRET not set (or shorter than 32 chars) — Google Sign-In, email/password accounts, and per-user History will be unavailable.",
    );
  }
  if (status.session && !process.env.GOOGLE_CLIENT_ID) {
    notes.push("GOOGLE_CLIENT_ID not set — Google Sign-In will be unavailable even though SESSION_SECRET is configured.");
  }
  if (status.passwordAuth && !status.email) {
    notes.push(
      "RESEND_API_KEY not set — email/password accounts still work, but password reset links will only be logged server-side, not emailed.",
    );
  }
  if (!status.adminDashboard) {
    notes.push("ADMIN_EMAILS not set (or DATABASE_URL missing) — the /admin usage dashboard will be unavailable.");
  }
  if (!status.groqFallback) {
    notes.push(
      "GROQ_API_KEY not set — no fallback provider if Gemini is rate-limited or down; generation will just fail in that case.",
    );
  }
  if (!status.deepseekFallback) {
    notes.push("DEEPSEEK_API_KEY not set — no second-tier fallback after Groq.");
  }
  if (!status.r2Storage) {
    notes.push(
      "R2 storage not fully configured (needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET) — original curriculum files won't be preserved for re-download.",
    );
  }
  if (!status.backupStorage) {
    notes.push(
      "Backup storage not fully configured (needs BACKUP_STORAGE_ENDPOINT, BACKUP_STORAGE_ACCESS_KEY_ID, BACKUP_STORAGE_SECRET_ACCESS_KEY, BACKUP_STORAGE_BUCKET) — the admin 'Backup now' action will be unavailable.",
    );
  }

  if (notes.length === 0) {
    console.log(JSON.stringify({ event: "startup_config_ok", ts: new Date().toISOString() }));
    return;
  }
  console.log(
    JSON.stringify({
      event: "startup_config_incomplete",
      ts: new Date().toISOString(),
      notes,
    }),
  );
}
