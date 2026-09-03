// Browser-side counterpart to services/ai/orchestrator.ts's createSseStream.
// Deliberately zero server dependencies (no node:crypto, no db) so it's
// safe to import from any client component.

export interface SseEvent {
  stage:
    | "queued"
    | "context"
    | "generating"
    | "validating"
    | "repairing"
    | "done"
    | "error";
  message?: string;
  attempt?: number;
  provider?: string;
  result?: unknown;
  code?: string;
  retryAfterSeconds?: number;
}

/**
 * POSTs to an SSE route and calls onEvent for each frame as it arrives.
 * Resolves once the stream closes (after a "done" or "error" frame).
 * Throws if the initial request itself fails (bad input, missing key —
 * the route returns a normal JSON error before ever opening the stream).
 */
export async function streamSse(
  url: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error) message = errJson.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;

      let event: SseEvent;
      try {
        event = JSON.parse(dataLine.slice(6)) as SseEvent;
      } catch {
        continue; // only a malformed frame gets skipped — not the callback's own errors
      }
      onEvent(event); // intentionally outside the try/catch above: if the caller's
      // callback throws (e.g. to report a "stage: error" event as a real
      // failure), that must propagate out of streamSse, not get silently
      // discarded as if it were a parse failure.
    }
  }
}
