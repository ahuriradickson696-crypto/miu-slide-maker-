import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { storageConfigured } from "./object-storage";

const ENV_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_BUCKET",
  "BACKUP_STORAGE_ENDPOINT",
  "BACKUP_STORAGE_ACCESS_KEY_ID",
  "BACKUP_STORAGE_SECRET_ACCESS_KEY",
  "BACKUP_STORAGE_BUCKET",
  "BACKUP_STORAGE_REGION",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("storageConfigured('r2')", () => {
  it("is false when no R2 vars are set", () => {
    expect(storageConfigured("r2")).toBe(false);
  });

  it("requires all four R2 vars", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "key";
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret";
    expect(storageConfigured("r2")).toBe(false);
    process.env.CLOUDFLARE_R2_BUCKET = "bucket";
    expect(storageConfigured("r2")).toBe(true);
  });
});

describe("storageConfigured('backup')", () => {
  it("is false when no backup vars are set", () => {
    expect(storageConfigured("backup")).toBe(false);
  });

  it("requires all four backup vars", () => {
    process.env.BACKUP_STORAGE_ENDPOINT = "s3.example.com";
    process.env.BACKUP_STORAGE_ACCESS_KEY_ID = "key";
    process.env.BACKUP_STORAGE_SECRET_ACCESS_KEY = "secret";
    expect(storageConfigured("backup")).toBe(false);
    process.env.BACKUP_STORAGE_BUCKET = "bucket";
    expect(storageConfigured("backup")).toBe(true);
  });

  it("does not require BACKUP_STORAGE_REGION (has a default)", () => {
    process.env.BACKUP_STORAGE_ENDPOINT = "s3.example.com";
    process.env.BACKUP_STORAGE_ACCESS_KEY_ID = "key";
    process.env.BACKUP_STORAGE_SECRET_ACCESS_KEY = "secret";
    process.env.BACKUP_STORAGE_BUCKET = "bucket";
    expect(storageConfigured("backup")).toBe(true);
  });
});
