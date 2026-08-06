// Optional last-resort fallback when Gemini is unavailable (rate-limited
// or erroring on both models). Only activates if GROQ_API_KEY is set as a
// real environment variable by whoever deploys this app — no key is ever
// hardcoded here or anywhere else in this codebase.
//
// Groq's chat completions API is OpenAI-compatible and supports a
// `response_format: { type: "json_object" }` mode that guarantees valid
// JSON, but — unlike Gemini's `responseSchema` — it does NOT enforce a
// specific shape. Our prompts already describe the desired JSON shape in
// plain English (written for a human/LLM reader, not just Gemini's schema
// param), and the caller always runs the result through the same
// clamp/validation functions used for Gemini's output, so a slightly
// imperfect shape from Groq is coerced safely rather than trusted blindly.

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_TIMEOUT_MS = 30_000;

export function groqConfigured(): boolean {
  return !!process.env.GROQ_API_KEY;
}

export async function callGroqJSON(
  prompt: string,
  options?: { maxOutputTokens?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq fallback isn't configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? GROQ_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You respond with a single valid JSON object only — no markdown fences, no commentary, no text before or after the JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: options?.maxOutputTokens ? Math.min(options.maxOutputTokens, 32768) : 8192,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned an empty response.");

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error("Groq's response wasn't valid JSON.");
    }
  } finally {
    clearTimeout(timer);
  }
}
