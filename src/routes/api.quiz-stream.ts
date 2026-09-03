// Same pattern as api.curriculum-notes-stream.ts — a proper createFileRoute
// Server Route (not a server.ts bypass) so readSessionUser()'s cookie-based
// auth works normally. See that file's header comment for the full
// reasoning. No UI calls this yet; see this pass's status notes.

import { createFileRoute } from "@tanstack/react-router";
import { currentUserId } from "@/lib/deck-storage.functions";
import { GenerateQuizInput, runQuizJob } from "@/lib/quiz.functions";
import { resolveApiKey } from "@/services/ai/client";
import { createSseStream } from "@/services/ai/orchestrator";

export const Route = createFileRoute("/api/quiz-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const parsed = GenerateQuizInput.safeParse(body);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({
              error: "Invalid request.",
              issues: parsed.error.issues,
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          );
        }

        const apiKey = resolveApiKey(parsed.data.apiKey);
        if (!apiKey) {
          return new Response(
            JSON.stringify({
              error:
                "Add your Groq API key. Get one free at https://console.groq.com/keys",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const userId = await currentUserId();

        return createSseStream((emit) =>
          runQuizJob({
            deckId: parsed.data.deckId,
            topic: parsed.data.topic,
            sourceText: parsed.data.sourceText,
            apiKey,
            userId,
            questionCount: parsed.data.questionCount,
            mix: parsed.data.mix,
            onProgress: emit,
          }),
        );
      },
    },
  },
});
