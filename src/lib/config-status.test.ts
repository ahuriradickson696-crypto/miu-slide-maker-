import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getConfigStatus } from "./config-status";

const ENV_KEYS = [
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "ADMIN_EMAILS",
  "RESEND_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_BUCKET",
  "BACKUP_STORAGE_ENDPOINT",
  "BACKUP_STORAGE_ACCESS_KEY_ID",
  "BACKUP_STORAGE_SECRET_ACCESS_KEY",
  "BACKUP_STORAGE_BUCKET",
] as const;

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("getConfigStatus", () => {
  it("reports everything unconfigured when no env vars are set", () => {
    const status = getConfigStatus();
    expect(status).toEqual({
      database: false,
      redis: false,
      session: false,
      googleAuth: false,
      passwordAuth: false,
      email: false,
      adminDashboard: false,
      sharedApiKey: false,
      deepseekFallback: false,
      r2Storage: false,
      backupStorage: false,
    });
  });

  it("deepseekFallback is configured whenever DEEPSEEK_API_KEY is set", () => {
    expect(getConfigStatus().deepseekFallback).toBe(false);
    process.env.DEEPSEEK_API_KEY = "sk-test-key";
    expect(getConfigStatus().deepseekFallback).toBe(true);
  });

  it("r2Storage requires all four R2 vars to count as configured", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "key-id";
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret";
    expect(getConfigStatus().r2Storage).toBe(false);
    process.env.CLOUDFLARE_R2_BUCKET = "bucket";
    expect(getConfigStatus().r2Storage).toBe(true);
  });

  it("backupStorage requires all four backup vars to count as configured", () => {
    process.env.BACKUP_STORAGE_ENDPOINT = "s3.example.com";
    process.env.BACKUP_STORAGE_ACCESS_KEY_ID = "key-id";
    process.env.BACKUP_STORAGE_SECRET_ACCESS_KEY = "secret";
    expect(getConfigStatus().backupStorage).toBe(false);
    process.env.BACKUP_STORAGE_BUCKET = "bucket";
    expect(getConfigStatus().backupStorage).toBe(true);
  });

  it("sharedApiKey is configured whenever GROQ_API_KEY is set", () => {
    expect(getConfigStatus().sharedApiKey).toBe(false);
    process.env.GROQ_API_KEY = "gsk_test_key";
    expect(getConfigStatus().sharedApiKey).toBe(true);
  });

  it("passwordAuth requires both a valid session secret and a configured database", () => {
    process.env.SESSION_SECRET = "a".repeat(32);
    expect(getConfigStatus().passwordAuth).toBe(false);
    process.env.DATABASE_URL = "postgres://example";
    expect(getConfigStatus().passwordAuth).toBe(true);
  });

  it("email is configured whenever RESEND_API_KEY is set", () => {
    expect(getConfigStatus().email).toBe(false);
    process.env.RESEND_API_KEY = "re_test_key";
    expect(getConfigStatus().email).toBe(true);
  });

  it("requires both Upstash vars for redis to count as configured", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    expect(getConfigStatus().redis).toBe(false);
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    expect(getConfigStatus().redis).toBe(true);
  });

  it("rejects a session secret shorter than 32 characters", () => {
    process.env.SESSION_SECRET = "too-short";
    expect(getConfigStatus().session).toBe(false);
    process.env.SESSION_SECRET = "a".repeat(32);
    expect(getConfigStatus().session).toBe(true);
  });

  it("googleAuth requires both a client id and a valid session secret", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    expect(getConfigStatus().googleAuth).toBe(false);
    process.env.SESSION_SECRET = "a".repeat(32);
    expect(getConfigStatus().googleAuth).toBe(true);
  });

  it("adminDashboard requires both ADMIN_EMAILS and a configured database", () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    expect(getConfigStatus().adminDashboard).toBe(false);
    process.env.DATABASE_URL = "postgres://example";
    expect(getConfigStatus().adminDashboard).toBe(true);
  });
});
