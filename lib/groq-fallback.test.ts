import { describe, expect, it, afterEach } from "vitest";
import { groqConfigured } from "./groq-fallback";

const original = process.env.GROQ_API_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = original;
});

describe("groqConfigured", () => {
  it("is false when GROQ_API_KEY isn't set", () => {
    delete process.env.GROQ_API_KEY;
    expect(groqConfigured()).toBe(false);
  });

  it("is true whenever GROQ_API_KEY is set to any non-empty value", () => {
    process.env.GROQ_API_KEY = "gsk_test_key";
    expect(groqConfigured()).toBe(true);
  });
});
