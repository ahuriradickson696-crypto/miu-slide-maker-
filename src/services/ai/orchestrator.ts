// The centerpiece of the shared AI layer: generateStructured() calls Groq
// (primary) and falls back to DeepSeek if Groq is rate-limited or erroring.
// If the response doesn't validate against the caller's Zod schema, the
// validation error is fed back to the model and retried (up to 3 attempts
// total) instead of silently clamping bad output into shape.
// generateStream() wraps the same logic as Server-Sent Events for a live
// "Generating… / Validating…" progress UI.
//
// KNOWN GAP: slides.functions.ts (the original, still-in-production deck
// generator) has its own independent copy of the rate-limit/lock/cache
// logic this file's callWithProviderFallback also runs — see client.ts's
// header comment. Until slides.functions.ts is migrated to call through
// here, deck generation and everything routed through this orchestrator
// track Groq's rate limit in SEPARATE counters, so heavy simultaneous use
// of both could together exceed the real, account-wide limit without
// either counter individually catching it. Low real-world likelihood (one
// person, one key, unlikely to fire both paths at once), but worth closing
// when slides.functions.ts migrates.

import type { z } from "zod";
import {
  callOpenAiCompatJSON,
  providerConfigured,
  GROQ_CONFIG,
  DEEPSEEK_CONFIG,
  AiProviderError,
  logEvent,
  readCachedResponse,
  writeCachedResponse,
  assertNotRateLimited,
  withKeyLock,
} from "./client";
import {
  AiServiceError,
  type AiProvider,
  type AiProgressEvent,
  type AiGenerationResult,
} from "./schemas";

function jitterMs(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs);
}

async function callWithProviderFallback(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  _jsonSchema: Record<string, unknown>,
  options: { maxOutputTokens?: number; timeoutMs?: number } | undefined,
  onProgress: ((event: AiProgressEvent) => void) | undefined,
): Promise<{ raw: Record<string, unknown>; provider: AiProvider }> {
  let lastError: Error | null = null;
  let rateLimitRetryAfter: number | null = null;
  let authFailed = false;

  // Primary: Groq, with the caller's key (their own, or the shared
  // server-side GROQ_API_KEY resolved by resolveApiKey upstream).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      onProgress?.({
        stage: "generating",
        message: `Generating with ${GROQ_CONFIG.model}…`,
        provider: "groq",
        attempt,
      });
      const raw = await callOpenAiCompatJSON(
        GROQ_CONFIG,
        systemPrompt,
        userPrompt,
        {
          ...options,
          apiKeyOverride: apiKey,
        },
      );
      return { raw, provider: "groq" };
    } catch (err) {
      lastError = err as Error;
      const code = err instanceof AiProviderError ? err.code : "UNKNOWN";

      if (code === "AUTH") {
        authFailed = true;
        break; // stop retrying Groq with the same denied key, fall through to DeepSeek
      }
      if (code === "RATE_LIMITED") {
        const retryAfter = (err as AiProviderError).retryAfterSeconds;
        if (
          retryAfter &&
          (rateLimitRetryAfter === null || retryAfter > rateLimitRetryAfter)
        ) {
          rateLimitRetryAfter = retryAfter;
        }
        break; // move straight to DeepSeek, no blind sleep
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, jitterMs(400)));
        continue;
      }
      break;
    }
  }

  // Fallback: DeepSeek, using its own server-side DEEPSEEK_API_KEY (never
  // the person's Groq key — the two providers aren't key-compatible).
  if (providerConfigured(DEEPSEEK_CONFIG)) {
    try {
      onProgress?.({
        stage: "generating",
        message: "Falling back to DeepSeek…",
        provider: "deepseek",
      });
      const raw = await callOpenAiCompatJSON(
        DEEPSEEK_CONFIG,
        systemPrompt,
        userPrompt,
        options,
      );
      return { raw, provider: "deepseek" };
    } catch (err) {
      logEvent("ai_deepseek_fallback_failed", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  if (rateLimitRetryAfter !== null) {
    throw new AiServiceError(
      `All providers exhausted — Groq is rate-limited, retry after ${rateLimitRetryAfter}s.`,
      "rate_limited",
      { retryAfterSeconds: rateLimitRetryAfter },
    );
  }

  if (authFailed && !providerConfigured(DEEPSEEK_CONFIG)) {
    throw new AiServiceError(
      "Auth error: Your Groq API key was rejected. " +
        "Set DEEPSEEK_API_KEY as a fallback, or get a fresh Groq key from https://console.groq.com/keys",
      "all_providers_failed",
    );
  }

  throw new AiServiceError(
    `All providers failed. ${lastError instanceof Error ? lastError.message : "Unknown error"}`,
    "all_providers_failed",
  );
}

export interface GenerateStructuredOptions<T> {
  apiKey: string;
  /** Task rules / persona / output-shape description. */
  systemPrompt: string;
  /** The actual content-specific prompt (topic, pasted material, etc). */
  userPrompt: string;
  /** Zod schema — the source of truth for validation and the self-heal loop. */
  schema: z.ZodType<T>;
  /** Kept for signature compatibility with earlier schema-enforcing providers; unused by Groq/DeepSeek's plain JSON mode — the Zod schema above is the real validator. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** If provided, a successful validated result is cached 30 min and reused for an identical cacheKey. */
  cacheKey?: string;
  /** Total attempts including the first — default 3 (1 initial + 2 self-heal retries). */
  maxRepairAttempts?: number;
  onProgress?: (event: AiProgressEvent) => void;
}

export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
): Promise<AiGenerationResult<T>> {
  const startedAt = Date.now();
  const maxRepairAttempts = opts.maxRepairAttempts ?? 3;

  if (opts.cacheKey) {
    const cached = await readCachedResponse(opts.cacheKey);
    if (cached) {
      const parsed = opts.schema.safeParse(cached);
      if (parsed.success) {
        opts.onProgress?.({ stage: "done", message: "Loaded from cache." });
        return {
          data: parsed.data,
          meta: {
            provider: "groq",
            attempts: 0,
            repaired: false,
            cached: true,
            elapsedMs: Date.now() - startedAt,
          },
        };
      }
      // Cached blob doesn't match the current schema (e.g. the schema
      // changed since caching) — fall through and regenerate.
    }
  }

  // Proactive check (Redis-backed counters, best-effort) — once per
  // logical request, not once per internal repair attempt. The reactive
  // 429 handling inside callWithProviderFallback remains the real
  // backstop for anything this early check misses.
  await assertNotRateLimited(opts.apiKey);

  let correctionBlock = "";
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < maxRepairAttempts; attempt++) {
    const userPromptThisAttempt = correctionBlock
      ? `${opts.userPrompt}\n\n${correctionBlock}`
      : opts.userPrompt;

    const { raw, provider } = await withKeyLock(opts.apiKey, () =>
      callWithProviderFallback(
        opts.apiKey,
        opts.systemPrompt,
        userPromptThisAttempt,
        opts.jsonSchema,
        { maxOutputTokens: opts.maxOutputTokens, timeoutMs: opts.timeoutMs },
        opts.onProgress,
      ),
    );

    opts.onProgress?.({
      stage: "validating",
      message: "Validating the response against the schema…",
      provider,
      attempt,
    });
    const parsed = opts.schema.safeParse(raw);

    if (parsed.success) {
      if (opts.cacheKey) await writeCachedResponse(opts.cacheKey, raw);
      opts.onProgress?.({ stage: "done", message: "Done.", provider });
      return {
        data: parsed.data,
        meta: {
          provider,
          attempts: attempt + 1,
          repaired: attempt > 0,
          cached: false,
          elapsedMs: Date.now() - startedAt,
        },
      };
    }

    lastIssues = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    logEvent("ai_validation_failed", { attempt, provider, issues: lastIssues });

    if (attempt + 1 >= maxRepairAttempts) {
      throw new AiServiceError(
        `The model's response didn't match the required structure after ${maxRepairAttempts} attempt(s).`,
        "validation_failed",
        { issues: lastIssues },
      );
    }

    opts.onProgress?.({
      stage: "repairing",
      message: `Response didn't match the expected shape — asking the model to fix ${lastIssues.length} issue(s)…`,
      provider,
      attempt: attempt + 1,
    });
    correctionBlock = `Your previous response failed schema validation with these issues:\n${lastIssues.map((i) => `- ${i}`).join("\n")}\n\nReturn a corrected JSON object that fixes every issue above, keeping everything else that was already correct. Return ONLY the corrected JSON object — no markdown fences, no commentary.`;
  }

  // Unreachable — the loop above always returns or throws — but keeps
  // TypeScript satisfied that every path returns a value.
  throw new AiServiceError(
    "Generation failed for an unknown reason.",
    "all_providers_failed",
  );
}

// ========== SSE streaming ==========

/**
 * Wraps an async operation as a Server-Sent Events Response: each call to
 * `emit` becomes one `data: {...}\n\n` frame, followed by a final
 * `{stage:"done", result}` frame (or `{stage:"error", ...}` on failure).
 * Return this directly from a TanStack Start Server Route GET/POST handler
 * — see src/routes/api.ai-stream.curriculum-notes.ts for a working example.
 */
export function createSseStream<T>(
  run: (emit: (event: AiProgressEvent) => void) => Promise<T>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
          );
        } catch {
          closed = true; // client disconnected mid-stream
        }
      };
      const emit = (event: AiProgressEvent) => write(event);

      try {
        const result = await run(emit);
        write({ stage: "done", message: "Complete.", result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const code = err instanceof AiServiceError ? err.code : "unknown";
        const retryAfterSeconds =
          err instanceof AiServiceError ? err.retryAfterSeconds : undefined;
        write({ stage: "error", message, code, retryAfterSeconds });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Convenience wrapper matching the spec's `aiService.generateStream({...})` shape. */
export function generateStream<T>(
  opts: Omit<GenerateStructuredOptions<T>, "onProgress">,
): Response {
  return createSseStream<T>((emit) =>
    generateStructured({ ...opts, onProgress: emit }).then((r) => r.data),
  );
}
