// Same pattern as api.curriculum-notes-stream.ts and api.quiz-stream.ts.

import { createFileRoute } from "@tanstack/react-router";
import { currentUserId } from "@/lib/deck-storage.functions";
import {
  GenerateLectureNotesInput,
  runLectureNotesJob,
} from "@/lib/lecture-notes.functions";
import { resolveApiKey } from "@/services/ai/client";
import { createSseStream } from "@/services/ai/orchestrator";

export const Route = createFileRoute("/api/lecture-notes-stream")({
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

        const parsed = GenerateLectureNotesInput.safeParse(body);
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
          runLectureNotesJob({
            deckId: parsed.data.deckId,
            topic: parsed.data.topic,
            sourceText: parsed.data.sourceText,
            courseName: parsed.data.courseName,
            courseCode: parsed.data.courseCode,
            courseLevel: parsed.data.courseLevel,
            creditUnits: parsed.data.creditUnits,
            contactTime: parsed.data.contactTime,
            apiKey,
            userId,
            onProgress: emit,
          }),
        );
      },
    },
  },
});
