import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  callAiWithRetry,
  containsDisallowedContent,
  sanitizeForPrompt,
  assertNotRateLimited,
  withKeyQueue,
  logEvent,
  AiCallError,
  clamp,
  resolveApiKey,
} from "@/lib/slides.functions";

const chatReplySchema = {
  type: "OBJECT",
  properties: { reply: { type: "STRING" } },
  required: ["reply"],
};

const MAX_HISTORY_TURNS = 8; // keep the prompt bounded — this is a chat widget, not a transcript archive
const MAX_MESSAGE_LEN = 2000;
const MAX_REPLY_LEN = 4000;

const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

const AskAssistantInput = z.object({
  apiKey: z.string().optional().default(""),
  contextLabel: z.string().optional().default(""),
  contextSummary: z.string().optional().default(""),
  history: z
    .array(ChatMessage)
    .max(MAX_HISTORY_TURNS * 2)
    .optional()
    .default([]),
  message: z.string().min(1).max(MAX_MESSAGE_LEN),
});

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AskAssistantInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = resolveApiKey(data.apiKey);
    if (!apiKey) {
      throw new Error("Add an API key in Settings to enable AI generation.");
    }

    const allText = [data.message, ...data.history.map((h) => h.text)].join(
      " ",
    );
    if (containsDisallowedContent(allText)) {
      throw new Error(
        "This request isn't something the assistant can help with.",
      );
    }

    const historyText = data.history
      .slice(-MAX_HISTORY_TURNS * 2)
      .map(
        (h) =>
          `${h.role === "user" ? "Student/Lecturer" : "Assistant"}: ${sanitizeForPrompt(h.text)}`,
      )
      .join("\n");

    const prompt = `You are a helpful teaching assistant embedded in MIU Studio, a university course-material tool. Answer the person's question conversationally and concisely — a few sentences, not an essay, unless they clearly ask for more depth.

${data.contextLabel ? `They're currently viewing: ${sanitizeForPrompt(data.contextLabel)}\n` : ""}${data.contextSummary ? `Content summary for grounding your answer:\n"""\n${sanitizeForPrompt(data.contextSummary)}\n"""\n` : ""}
${historyText ? `Recent conversation:\n${historyText}\n` : ""}
New message: ${sanitizeForPrompt(data.message)}

Ground your answer in the content above when it's relevant to their question. If they ask something unrelated to the material, you can still help, but keep it brief and steer back to being useful for their coursework. Return ONLY valid JSON matching the schema — a "reply" string, plain text (no markdown formatting). No commentary outside the JSON.`;

    const startedAt = Date.now();
    try {
      await assertNotRateLimited(apiKey);
      const parsed = await withKeyQueue(apiKey, () =>
        callAiWithRetry(apiKey, prompt, chatReplySchema, {
          maxOutputTokens: 1024,
          timeoutMs: 30_000,
        }),
      );
      const reply = clamp(
        typeof parsed.reply === "string" ? parsed.reply : "",
        MAX_REPLY_LEN,
      );
      logEvent("chat_reply_generated", { ms: Date.now() - startedAt });
      if (!reply)
        throw new Error(
          "The assistant didn't return a usable reply. Please try again.",
        );
      return { reply };
    } catch (err) {
      logEvent("chat_reply_failed", {
        ms: Date.now() - startedAt,
        code: err instanceof AiCallError ? err.code : "UNKNOWN",
      });
      if (err instanceof AiCallError && err.code === "RATE_LIMITED") {
        const retryAfter = (err as any).retryAfterSeconds ?? 60;
        throw new Error(
          `RATE_LIMITED::${retryAfter}::You've hit the AI service's rate limit. Wait ${retryAfter}s and try again.`,
        );
      }
      throw new Error(
        err instanceof Error && err.message
          ? err.message
          : "The assistant couldn't respond. Please try again.",
      );
    }
  });
