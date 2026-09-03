import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    callOpenAiCompatJSON: vi.fn(),
    providerConfigured: vi.fn(() => false),
    readCachedResponse: vi.fn(async () => null),
    writeCachedResponse: vi.fn(async () => undefined),
    logEvent: vi.fn(),
  };
});

import { generateStructured } from "./orchestrator";
import * as client from "./client";
import { AiServiceError } from "./schemas";

const TestSchema = z.object({ title: z.string(), count: z.number() });

const baseOpts = {
  apiKey: "test-key",
  systemPrompt: "system rules",
  userPrompt: "user content",
  schema: TestSchema,
  jsonSchema: { type: "object" },
};

/**
 * Both Groq and DeepSeek are called through the same callOpenAiCompatJSON
 * function, distinguished only by which OpenAiCompatConfig is passed as
 * the first argument. This inspects that argument so tests can mock
 * "Groq responds" vs "DeepSeek responds" independently, mirroring how the
 * real orchestrator calls GROQ_CONFIG first and DEEPSEEK_CONFIG on fallback.
 */
function mockGroqThenDeepseek(
  groqImpl: () => Promise<Record<string, unknown>>,
  deepseekImpl?: () => Promise<Record<string, unknown>>,
) {
  vi.mocked(client.callOpenAiCompatJSON).mockImplementation(async (config) => {
    if (config.name === "groq") return groqImpl();
    if (config.name === "deepseek" && deepseekImpl) return deepseekImpl();
    throw new Error(`Unexpected provider call: ${config.name}`);
  });
}

afterEach(() => {
  vi.mocked(client.callOpenAiCompatJSON).mockReset();
  vi.mocked(client.providerConfigured).mockReset().mockReturnValue(false);
  vi.mocked(client.readCachedResponse).mockReset().mockResolvedValue(null);
  vi.mocked(client.writeCachedResponse)
    .mockReset()
    .mockResolvedValue(undefined);
});

describe("generateStructured", () => {
  it("succeeds on the first attempt when the model returns valid data", async () => {
    mockGroqThenDeepseek(async () => ({ title: "Hello", count: 3 }));

    const result = await generateStructured(baseOpts);

    expect(result.data).toEqual({ title: "Hello", count: 3 });
    expect(result.meta.attempts).toBe(1);
    expect(result.meta.repaired).toBe(false);
    expect(result.meta.provider).toBe("groq");
    expect(client.callOpenAiCompatJSON).toHaveBeenCalledTimes(1);
  });

  it("self-heals: feeds the validation error back and succeeds on the repaired attempt", async () => {
    let call = 0;
    vi.mocked(client.callOpenAiCompatJSON).mockImplementation(async () => {
      call++;
      if (call === 1) return { title: "Hello", count: "not-a-number" }; // fails schema
      return { title: "Hello", count: 3 }; // corrected
    });

    const result = await generateStructured(baseOpts);

    expect(result.data).toEqual({ title: "Hello", count: 3 });
    expect(result.meta.attempts).toBe(2);
    expect(result.meta.repaired).toBe(true);
    expect(client.callOpenAiCompatJSON).toHaveBeenCalledTimes(2);

    // The repaired attempt's prompt must actually mention what was wrong.
    const secondCallArgs = vi.mocked(client.callOpenAiCompatJSON).mock.calls[1];
    const secondCallPrompt = secondCallArgs[2]; // (config, systemPrompt, userPrompt, options)
    expect(secondCallPrompt).toContain("count");
  });

  it("throws AiServiceError('validation_failed') once repair attempts are exhausted", async () => {
    mockGroqThenDeepseek(async () => ({ title: "Hello", count: "still-bad" }));

    await expect(generateStructured(baseOpts)).rejects.toMatchObject({
      name: "AiServiceError",
      code: "validation_failed",
    });
    expect(client.callOpenAiCompatJSON).toHaveBeenCalledTimes(3); // default maxRepairAttempts
  });

  it("respects a custom maxRepairAttempts", async () => {
    mockGroqThenDeepseek(async () => ({ title: "Hello", count: "still-bad" }));

    await expect(
      generateStructured({ ...baseOpts, maxRepairAttempts: 1 }),
    ).rejects.toThrow(AiServiceError);
    expect(client.callOpenAiCompatJSON).toHaveBeenCalledTimes(1);
  });

  it("returns a cached result without calling any provider", async () => {
    vi.mocked(client.readCachedResponse).mockResolvedValueOnce({
      title: "Cached",
      count: 1,
    });

    const result = await generateStructured({
      ...baseOpts,
      cacheKey: "abc123",
    });

    expect(result.data).toEqual({ title: "Cached", count: 1 });
    expect(result.meta.cached).toBe(true);
    expect(client.callOpenAiCompatJSON).not.toHaveBeenCalled();
  });

  it("ignores a cached blob that no longer matches the schema and regenerates instead", async () => {
    vi.mocked(client.readCachedResponse).mockResolvedValueOnce({
      wrong: "shape",
    });
    mockGroqThenDeepseek(async () => ({ title: "Fresh", count: 9 }));

    const result = await generateStructured({
      ...baseOpts,
      cacheKey: "abc123",
    });

    expect(result.data).toEqual({ title: "Fresh", count: 9 });
    expect(result.meta.cached).toBe(false);
  });

  it("falls through to DeepSeek when Groq fails, and reports which provider actually answered", async () => {
    mockGroqThenDeepseek(
      async () => {
        throw new client.AiProviderError("boom", "SERVER_ERROR", 500);
      },
      async () => ({ title: "From DeepSeek", count: 7 }),
    );
    vi.mocked(client.providerConfigured).mockImplementation(
      (cfg) => cfg.name === "deepseek",
    );

    const result = await generateStructured(baseOpts);

    expect(result.meta.provider).toBe("deepseek");
    expect(result.data).toEqual({ title: "From DeepSeek", count: 7 });
  }, 10_000);

  it("throws AiServiceError('all_providers_failed') when nothing is configured as a fallback", async () => {
    mockGroqThenDeepseek(async () => {
      throw new client.AiProviderError("boom", "SERVER_ERROR", 500);
    });

    await expect(generateStructured(baseOpts)).rejects.toMatchObject({
      code: "all_providers_failed",
    });
  }, 10_000);

  it("does not retry the same key against Groq's second model after an auth error, and surfaces a clear message when no fallback provider is configured", async () => {
    mockGroqThenDeepseek(async () => {
      throw new client.AiProviderError("bad key", "AUTH", 401);
    });
    // providerConfigured() defaults to false in this suite's mock (see
    // afterEach above), so DeepSeek is "not configured" here.

    await expect(generateStructured(baseOpts)).rejects.toThrow(
      "Groq API key was rejected",
    );
    // Only 1 call: an AUTH error on Groq shouldn't burn a retry with the
    // same denied key.
    expect(client.callOpenAiCompatJSON).toHaveBeenCalledTimes(1);
  });

  it("falls through to DeepSeek when Groq returns an AUTH error and a fallback provider IS configured", async () => {
    mockGroqThenDeepseek(
      async () => {
        throw new client.AiProviderError(
          "Auth error (403): key revoked",
          "AUTH",
          403,
        );
      },
      async () => ({ title: "Hello", count: 3 }),
    );
    vi.mocked(client.providerConfigured).mockImplementation(
      (config) => config.name === "deepseek",
    );

    const result = await generateStructured(baseOpts);

    expect(result.data).toEqual({ title: "Hello", count: 3 });
    expect(result.meta.provider).toBe("deepseek");
    // Still only 1 Groq call — AUTH shouldn't burn a retry — but the
    // fallback chain must still be reached instead of throwing early.
    expect(client.callOpenAiCompatJSON).toHaveBeenCalledTimes(2); // 1 Groq + 1 DeepSeek
  });

  it("surfaces the exact retryAfterSeconds when every provider is rate-limited", async () => {
    mockGroqThenDeepseek(async () => {
      const err = new client.AiProviderError("limited", "RATE_LIMITED", 429);
      err.retryAfterSeconds = 42;
      throw err;
    });

    await expect(generateStructured(baseOpts)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 42,
    });
  });
});
