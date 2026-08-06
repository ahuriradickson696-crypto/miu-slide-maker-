// Second-tier fallback, tried after Groq if that also fails (or isn't
// configured). Only activates if DEEPSEEK_API_KEY is a real environment
// variable set by whoever deploys this app — never hardcoded here.
//
// DeepSeek's API is OpenAI-compatible, same shape as Groq's. Its output
// goes through the exact same clamp/validation as every other provider's
// output before being trusted — see groq-fallback.ts for the full
// reasoning on why a schema-less JSON mode is safe to use this way.

const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_TIMEOUT_MS = 45_000; // DeepSeek's reasoning-oriented models can run slower than Groq

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export async function callDeepSeekJSON(
  prompt: string,
  options?: { maxOutputTokens?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DeepSeek fallback isn't configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEEPSEEK_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
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
        max_tokens: options?.maxOutputTokens ? Math.min(options.maxOutputTokens, 8192) : 8192,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DeepSeek request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned an empty response.");

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error("DeepSeek's response wasn't valid JSON.");
    }
  } finally {
    clearTimeout(timer);
  }
}
