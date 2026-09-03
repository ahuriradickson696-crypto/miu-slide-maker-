// Chunking / token-budget management for oversized inputs (long PDFs, full
// transcripts) so they get summarized down to a safe size before hitting
// the main generation prompt, instead of silently truncating mid-sentence
// or blowing past a model's context window.
//
// Pure functions (estimateTokens, chunkText) have no network dependency and
// are unit-tested directly. prepareContext is the only part that calls out
// to a model, and is designed to degrade — never throw — on failure: a
// worse-than-ideal context beats a hard failure on an otherwise-good request.

import { callOpenAiCompatJSON, AiProviderError, GROQ_CONFIG } from "./client";
import type { AiProgressEvent } from "./schemas";

// Rough heuristic (~4 chars/token for English prose) — good enough for a
// chunking budget, not meant to match a real tokenizer exactly. Erring
// slightly conservative (fewer estimated tokens than a strict BPE tokenizer
// might count) is safer here than erring generous, since the cost of being
// wrong is a slightly-smaller-than-necessary chunk, not a truncated one.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ChunkOptions {
  maxTokensPerChunk: number;
  overlapTokens?: number;
}

/**
 * Splits text into chunks under a token budget, preferring paragraph
 * boundaries so a chunk never cuts a sentence in half unless a single
 * paragraph itself exceeds the budget (rare, but handled by a hard split).
 * Consecutive chunks overlap by `overlapTokens` so context isn't lost
 * exactly at a boundary (e.g. a definition started in one chunk and
 * finished in the next).
 */
export function chunkText(text: string, opts: ChunkOptions): string[] {
  const maxChars = opts.maxTokensPerChunk * CHARS_PER_TOKEN;
  const overlapChars = (opts.overlapTokens ?? 0) * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text.trim() ? [text.trim()] : [];

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    // Current chunk is full — close it out before handling this paragraph.
    pushCurrent();

    if (para.length <= maxChars) {
      // Start the next chunk with the tail of the previous one, for overlap.
      const tail = overlapChars > 0 ? current.slice(-overlapChars) : "";
      current = tail ? `${tail}\n\n${para}` : para;
    } else {
      // A single paragraph bigger than the whole budget — hard split it on
      // sentence boundaries where possible.
      const sentences = para.split(/(?<=[.!?])\s+/);
      let piece = "";
      for (const sentence of sentences) {
        const withSentence = piece ? `${piece} ${sentence}` : sentence;
        if (withSentence.length <= maxChars) {
          piece = withSentence;
        } else {
          if (piece.trim()) chunks.push(piece.trim());
          // A single sentence longer than the budget (pathological input) —
          // fall back to a raw character split as the last resort.
          piece =
            sentence.length > maxChars ? sentence.slice(0, maxChars) : sentence;
        }
      }
      current = piece;
    }
  }
  pushCurrent();

  return chunks;
}

export interface PrepareContextOptions {
  apiKey: string;
  /** Token budget for the text this returns, ready to drop into the main prompt. */
  maxInputTokens?: number;
  maxTokensPerChunk?: number;
  /** What the summarizer should preserve, e.g. "course topics, learning outcomes, numbered lists". */
  focusHint?: string;
  onProgress?: (event: AiProgressEvent) => void;
}

export interface PrepareContextResult {
  text: string;
  wasChunked: boolean;
  originalTokens: number;
  finalTokens: number;
  chunkCount: number;
}

// Groq's JSON mode doesn't enforce a schema the way a typed responseSchema
// would — the prompt below spells out the desired { "summary": "..." }
// shape in plain English instead, and the result is read defensively.
const SUMMARY_SYSTEM_PROMPT =
  'Respond with a single valid JSON object of the shape { "summary": "..." } — no markdown fences, no commentary, no text before or after the JSON.';

async function summarizeOneChunk(
  chunk: string,
  apiKey: string,
  focusHint: string | undefined,
  index: number,
  total: number,
): Promise<string> {
  const prompt = `Condense the following excerpt (part ${index + 1} of ${total} from a larger document) into a dense summary that preserves every concrete fact, term, number, and named concept a reader would need${focusHint ? ` — especially anything related to: ${focusHint}` : ""}. Drop filler and repetition, but never invent information that isn't in the excerpt. Return only the summary text.\n\n"""${chunk.replace(/"""/g, "'''")}"""`;

  try {
    const result = await callOpenAiCompatJSON(
      GROQ_CONFIG,
      SUMMARY_SYSTEM_PROMPT,
      prompt,
      {
        maxOutputTokens: 1024,
        timeoutMs: 30_000,
        apiKeyOverride: apiKey,
      },
    );
    const summary =
      typeof result.summary === "string" ? result.summary.trim() : "";
    return summary || chunk.slice(0, 800); // empty summary is worse than a truncated original
  } catch {
    // Degrade, don't fail the whole request over one chunk's summary call.
    return chunk.slice(0, 800);
  }
}

/**
 * Returns text guaranteed to fit within maxInputTokens, summarizing via
 * chunking if the input is oversized. Never throws — a summarization
 * failure degrades to truncation rather than blocking generation entirely.
 */
export async function prepareContext(
  text: string,
  opts: PrepareContextOptions,
): Promise<PrepareContextResult> {
  const maxInputTokens = opts.maxInputTokens ?? 6000;
  const originalTokens = estimateTokens(text);

  if (originalTokens <= maxInputTokens) {
    return {
      text,
      wasChunked: false,
      originalTokens,
      finalTokens: originalTokens,
      chunkCount: 1,
    };
  }

  opts.onProgress?.({
    stage: "context",
    message: `Chunking ${originalTokens.toLocaleString()} tokens of input for summarization…`,
  });

  const chunks = chunkText(text, {
    maxTokensPerChunk: opts.maxTokensPerChunk ?? 3000,
    overlapTokens: 150,
  });

  // Bounded concurrency (3 at a time) — enough to be fast without hammering
  // the free-tier rate limit this same key is about to use for the main call.
  const summaries: string[] = new Array(chunks.length);
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const i = cursor++;
      opts.onProgress?.({
        stage: "context",
        message: `Summarizing section ${i + 1} of ${chunks.length}…`,
      });
      summaries[i] = await summarizeOneChunk(
        chunks[i],
        opts.apiKey,
        opts.focusHint,
        i,
        chunks.length,
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker),
  );

  let combined = summaries.join("\n\n");
  let finalTokens = estimateTokens(combined);

  // Rare: even the concatenated summaries overflow the budget (huge source
  // document). One more compaction pass over the summaries themselves,
  // falling back to a hard truncation if that also doesn't fit in time.
  if (finalTokens > maxInputTokens) {
    opts.onProgress?.({
      stage: "context",
      message: "Condensing further to fit the context budget…",
    });
    try {
      combined = await summarizeOneChunk(
        combined,
        opts.apiKey,
        opts.focusHint,
        0,
        1,
      );
      finalTokens = estimateTokens(combined);
    } catch {
      // fall through to hard truncation below
    }
    if (finalTokens > maxInputTokens) {
      combined = combined.slice(0, maxInputTokens * CHARS_PER_TOKEN);
      finalTokens = estimateTokens(combined);
    }
  }

  return {
    text: combined,
    wasChunked: true,
    originalTokens,
    finalTokens,
    chunkCount: chunks.length,
  };
}

export { AiProviderError };
