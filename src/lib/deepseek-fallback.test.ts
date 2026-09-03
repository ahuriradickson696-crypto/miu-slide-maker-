import { describe, expect, it, afterEach } from "vitest";
import { deepseekConfigured } from "./deepseek-fallback";

const original = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = original;
});

describe("deepseekConfigured", () => {
  it("is false when DEEPSEEK_API_KEY isn't set", () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(deepseekConfigured()).toBe(false);
  });

  it("is true whenever DEEPSEEK_API_KEY is set to any non-empty value", () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-key";
    expect(deepseekConfigured()).toBe(true);
  });
});
