import { describe, expect, it, vi, afterEach } from "vitest";
import { streamSse } from "./sse-client";

function mockStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamSse", () => {
  it("parses multiple complete frames delivered in one chunk", async () => {
    const body = `data: ${JSON.stringify({ stage: "generating", message: "Go" })}\n\ndata: ${JSON.stringify({ stage: "done", result: { ok: true } })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockStreamResponse([body])),
    );

    const events: any[] = [];
    await streamSse("/api/fake", {}, (e) => events.push(e));

    expect(events).toHaveLength(2);
    expect(events[0].stage).toBe("generating");
    expect(events[1]).toMatchObject({ stage: "done", result: { ok: true } });
  });

  it("reassembles a single frame split across two chunks", async () => {
    const full = `data: ${JSON.stringify({ stage: "done", result: { value: 42 } })}\n\n`;
    const splitAt = Math.floor(full.length / 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockStreamResponse([full.slice(0, splitAt), full.slice(splitAt)]),
      ),
    );

    const events: any[] = [];
    await streamSse("/api/fake", {}, (e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stage: "done", result: { value: 42 } });
  });

  it("skips a malformed frame instead of throwing", async () => {
    const body = `data: not-json\n\ndata: ${JSON.stringify({ stage: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockStreamResponse([body])),
    );

    const events: any[] = [];
    await expect(
      streamSse("/api/fake", {}, (e) => events.push(e)),
    ).resolves.toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe("done");
  });

  it("throws with the server's error message when the initial request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Add an API key in Settings." }),
            { status: 400 },
          ),
      ),
    );

    await expect(streamSse("/api/fake", {}, () => {})).rejects.toThrow(
      "Add an API key in Settings.",
    );
  });

  it("propagates a real error the caller's onEvent throws, instead of swallowing it like a malformed frame", async () => {
    // This is the actual pattern quiz.tsx/notes.tsx use: throw inside
    // onEvent when the server reports stage:"error", so the surrounding
    // try/catch in the UI can show the real failure reason. A prior bug
    // wrapped this call in the same try/catch used to skip malformed JSON,
    // silently discarding the throw instead of letting it propagate.
    const body = `data: ${JSON.stringify({ stage: "error", message: "Rate limited, retry in 42s" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockStreamResponse([body])),
    );

    await expect(
      streamSse("/api/fake", {}, (e) => {
        if (e.stage === "error") throw new Error(e.message);
      }),
    ).rejects.toThrow("Rate limited, retry in 42s");
  });

  it("still skips a genuinely malformed frame that arrives alongside a real one", async () => {
    const body = `data: not-json\n\ndata: ${JSON.stringify({ stage: "generating", message: "ok" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockStreamResponse([body])),
    );

    const events: any[] = [];
    await streamSse("/api/fake", {}, (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe("generating");
  });
});
