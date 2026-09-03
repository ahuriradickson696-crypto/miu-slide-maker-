// Shared types for the /services/ai layer. Kept dependency-free (no db.ts,
// no redis.ts imports here) so this file is safe to import from client-side
// code too — e.g. a route can import AiProgressEvent to type an SSE reader
// without pulling in server-only modules.

export type AiProvider = "groq" | "deepseek";

export type AiStage =
  | "queued"
  | "context" // chunking / summarizing oversized input
  | "generating" // calling a model
  | "validating" // schema-checking the response
  | "repairing" // self-heal retry after a validation failure
  | "done"
  | "error";

export interface AiProgressEvent {
  stage: AiStage;
  message: string;
  attempt?: number;
  provider?: AiProvider;
}

export interface AiGenerationMeta {
  provider: AiProvider;
  attempts: number;
  repaired: boolean;
  cached: boolean;
  elapsedMs: number;
}

export interface AiGenerationResult<T> {
  data: T;
  meta: AiGenerationMeta;
}

export type AiServiceErrorCode =
  | "no_api_key"
  | "disallowed_content"
  | "rate_limited"
  | "all_providers_failed"
  | "validation_failed";

export class AiServiceError extends Error {
  code: AiServiceErrorCode;
  retryAfterSeconds?: number;
  /** The last Zod validation issue list, when code === "validation_failed". */
  issues?: string[];

  constructor(
    message: string,
    code: AiServiceErrorCode,
    extra?: { retryAfterSeconds?: number; issues?: string[] },
  ) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.retryAfterSeconds = extra?.retryAfterSeconds;
    this.issues = extra?.issues;
  }
}
