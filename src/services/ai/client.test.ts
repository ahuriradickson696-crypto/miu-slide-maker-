import { afterEach, describe, expect, it } from "vitest";
import {
  apiKeyHash,
  containsDisallowedContent,
  sanitizeForPrompt,
  providerConfigured,
  resolveApiKey,
  DEEPSEEK_CONFIG,
  GROQ_CONFIG,
} from "./client";

describe("apiKeyHash", () => {
  it("is deterministic for the same key", () => {
    expect(apiKeyHash("my-secret-key")).toBe(apiKeyHash("my-secret-key"));
  });

  it("differs for different keys", () => {
    expect(apiKeyHash("key-a")).not.toBe(apiKeyHash("key-b"));
  });

  it("never leaks the raw key in the hash", () => {
    const key = "AIzaSuperSecretValue123";
    expect(apiKeyHash(key)).not.toContain(key);
  });
});

describe("resolveApiKey", () => {
  const originalEnv = process.env.GROQ_API_KEY;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalEnv;
  });

  it("prefers the user-provided key over the server env var", () => {
    process.env.GROQ_API_KEY = "server-key";
    expect(resolveApiKey("user-key")).toBe("user-key");
  });

  it("falls back to the server env var when no user key is given", () => {
    process.env.GROQ_API_KEY = "server-key";
    expect(resolveApiKey("")).toBe("server-key");
  });

  it("returns an empty string when neither is set", () => {
    delete process.env.GROQ_API_KEY;
    expect(resolveApiKey(undefined)).toBe("");
  });
});

describe("providerConfigured", () => {
  const originalDeepseek = process.env.DEEPSEEK_API_KEY;
  const originalGroq = process.env.GROQ_API_KEY;
  afterEach(() => {
    if (originalDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepseek;
    if (originalGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroq;
  });

  it("is false when the relevant env var isn't set", () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(providerConfigured(DEEPSEEK_CONFIG)).toBe(false);
  });

  it("is true once the relevant env var is set", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    expect(providerConfigured(GROQ_CONFIG)).toBe(true);
  });
});

describe("containsDisallowedContent", () => {
  it("flags obviously disallowed topics", () => {
    expect(containsDisallowedContent("how to make a bomb")).toBe(true);
  });

  it("allows ordinary academic content", () => {
    expect(containsDisallowedContent("Introduction to Thermodynamics")).toBe(
      false,
    );
  });
});

describe("sanitizeForPrompt", () => {
  it("neutralizes triple-quote sequences that could break the prompt's guard block", () => {
    expect(sanitizeForPrompt('some text """ injected """ more text')).toBe(
      "some text ''' injected ''' more text",
    );
  });
});
