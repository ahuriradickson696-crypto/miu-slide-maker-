import { describe, expect, it } from "vitest";
import { estimateTokens, chunkText } from "./context-engine";

describe("estimateTokens", () => {
  it("estimates roughly 4 characters per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("returns the whole text as a single chunk when it fits the budget", () => {
    const text = "A short paragraph that easily fits.";
    const chunks = chunkText(text, { maxTokensPerChunk: 1000 });
    expect(chunks).toEqual([text]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunkText("", { maxTokensPerChunk: 1000 })).toEqual([]);
  });

  it("splits on paragraph boundaries once the budget is exceeded", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) =>
      `Paragraph ${i}. `.repeat(20),
    );
    const text = paragraphs.join("\n\n");
    // Small budget forces multiple chunks.
    const chunks = chunkText(text, { maxTokensPerChunk: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be non-empty and each original paragraph's marker
    // text should show up in at least one chunk (nothing silently dropped).
    for (let i = 0; i < paragraphs.length; i++) {
      expect(chunks.some((c) => c.includes(`Paragraph ${i}.`))).toBe(true);
    }
  });

  it("hard-splits a single paragraph that alone exceeds the whole budget", () => {
    const hugeParagraph =
      "This is one long sentence with no paragraph breaks. ".repeat(200);
    const chunks = chunkText(hugeParagraph, { maxTokensPerChunk: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50 * 4 + 1); // small slack for trim()
    }
  });

  it("includes overlap between consecutive chunks when requested", () => {
    const paragraphs = Array.from({ length: 4 }, (_, i) =>
      `Section ${i} content here, quite a bit of text to fill space. `.repeat(
        10,
      ),
    );
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text, {
      maxTokensPerChunk: 60,
      overlapTokens: 20,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // With overlap, chunk[1] should contain a tail fragment of chunk[0].
    const tailOfFirst = chunks[0].slice(-40);
    expect(chunks[1].includes(tailOfFirst.slice(-15))).toBe(true);
  });
});
