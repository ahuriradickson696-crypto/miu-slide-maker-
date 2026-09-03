// First real proof of the /services/ai streaming layer: an SSE endpoint
// that reports live progress ("Preparing batch 2 of 4…", "Generating with
// openai/gpt-oss-120b…", "Validating…") while semester notes generate,
// instead of the client just waiting on the single non-streaming
// generateSemesterNotes server function (still there, unchanged, and still
// what the current UI calls).
//
// Deliberately a createFileRoute Server Route (not a raw server.ts
// handler like /api/health) — Server Routes run inside TanStack Start's
// normal request pipeline, so readSessionUser()'s cookie-based auth works
// the same way it does for every other server function. /api/health uses
// the server.ts bypass specifically because it's unauthenticated and needs
// to answer even if the app's own router is unhealthy; that reasoning
// doesn't apply here.
//
// No UI calls this endpoint yet — building that is part of the still-to-do
// Curriculum Engine UI work, not this pass.

import { createFileRoute } from "@tanstack/react-router";
import { currentUserId } from "@/lib/deck-storage.functions";
import {
  GenerateSemesterNotesInput,
  runSemesterNotesJob,
} from "@/lib/curriculum.functions";
import { resolveApiKey } from "@/services/ai/client";
import { createSseStream } from "@/services/ai/orchestrator";

export const Route = createFileRoute("/api/curriculum-notes-stream")({
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

        const parsed = GenerateSemesterNotesInput.safeParse(body);
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

        // Runs inside the normal request pipeline, so this reads the same
        // session cookie every other server function on this app does.
        const userId = await currentUserId();

        return createSseStream((emit) =>
          runSemesterNotesJob({
            curriculumId: parsed.data.curriculumId,
            yearLabel: parsed.data.yearLabel,
            semesterLabel: parsed.data.semesterLabel,
            apiKey,
            userId,
            onProgress: emit,
          }),
        );
      },
    },
  },
});
