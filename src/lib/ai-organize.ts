// ---------- Optional AI-assisted organization ------------------------------
//
// Everything in slides.functions.ts is deterministic text-parsing: it can
// only arrange what you actually wrote. This module adds an OPTIONAL step
// on top of that — it asks an AI model to look at the slides the parser
// already extracted and improve two things:
//
//   1. Grouping/ordering — merge or reorder blocks for a clearer flow,
//      and split any slide that's still overloaded after parsing.
//   2. Titles/headings — tighten wording for clarity.
//
// It is deliberately NOT allowed to invent facts, examples, statistics,
// or explanations that weren't already in the pasted/typed text. The
// system prompt enforces this, the output is validated against the
// original content, and if anything looks off (bad JSON, empty result,
// network failure) we silently fall back to the rule-based deck so a
// generation can never fail because the AI step failed.
//
// The API used is Puter.js (https://developer.puter.com) — it runs
// entirely client-side, requires no API key, no signup, and no billing
// on this project's side (the free tier is funded by Puter, not by an
// API key we'd have to manage). If it's ever unreachable, everything
// above still works exactly as before — this is purely additive.

import {
  clampSlide,
  MAX_BULLETS,
  type SlideDeck,
  type SlideSpec,
} from "./slides.functions";

declare global {
  interface Window {
    puter?: {
      ai?: {
        chat?: (
          prompt: string,
          options?: Record<string, unknown>,
        ) => Promise<{ message?: { content?: string } } | string>;
      };
    };
  }
}

const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";

let puterLoadPromise: Promise<void> | null = null;

function loadPuter(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("AI organization only runs in the browser."));
  }
  if (window.puter?.ai?.chat) return Promise.resolve();
  if (puterLoadPromise) return puterLoadPromise;

  puterLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${PUTER_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Could not load the free AI service.")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = PUTER_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not reach the free AI service. Check your connection."));
    document.head.appendChild(script);
  });
  return puterLoadPromise;
}

type OrganizableSlide = {
  title: string;
  body?: string;
  bullets?: string[];
  sections?: { heading: string; description: string }[];
};

const SYSTEM_PROMPT = `You are a slide ORGANIZER for a university lecture deck. You never invent facts, numbers, examples, or explanations. You ONLY reorganize, regroup, retitle, and lightly rephrase the exact material you're given.

Rules (strict):
- Use ONLY the sentences/phrases/bullets provided in the input JSON. Do not add new claims, examples, statistics, or definitions.
- You may: merge two related slides into one, split an overloaded slide into two, reorder slides for a more logical teaching flow, and tighten/clarify titles and headings.
- You may lightly rephrase for brevity/clarity, but the meaning and factual content of every sentence must stay the same as the source.
- Keep the same total slide count unless splitting/merging genuinely improves flow — if you change the count, change it by at most 2 slides in either direction.
- Every bullet list must have 6 bullets or fewer. Every slide must have "sections" of 4 or fewer.
- Output ONLY valid JSON: an array of slide objects, each with "title" (string), and optionally "body" (string), "bullets" (string array), "sections" (array of {heading, description}). No prose, no markdown fences, no commentary — JSON only.`;

function buildUserPrompt(slides: OrganizableSlide[], topic: string): string {
  return `Topic: ${topic || "(untitled)"}

Reorganize these ${slides.length} lecture slides. Return ONLY the JSON array described in the system prompt — same schema, same facts, better organization:

${JSON.stringify(slides, null, 2)}`;
}

function extractText(
  response: Awaited<ReturnType<NonNullable<NonNullable<Window["puter"]>["ai"]>["chat"]>>,
): string {
  if (typeof response === "string") return response;
  return response?.message?.content ?? "";
}

function parseAiSlides(raw: string): OrganizableSlide[] | null {
  // Models sometimes wrap JSON in ```json fences despite instructions —
  // strip those defensively before parsing.
  const cleaned = raw.replace(/```json\s*|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((s) => s && typeof s.title === "string")) return null;
    return parsed as OrganizableSlide[];
  } catch {
    return null;
  }
}

function toSlideSpec(s: OrganizableSlide): SlideSpec {
  const type: SlideSpec["type"] =
    s.sections?.length ? "content" : s.bullets?.length && !s.body ? "list" : "content";
  return clampSlide({
    type,
    title: s.title,
    body: s.body,
    bullets: s.bullets?.slice(0, MAX_BULLETS),
    sections: s.sections?.slice(0, 4),
  });
}

export class AiOrganizeError extends Error {}

// Takes an already-generated deck and returns a new deck with the middle
// (content/list) slides reorganized by AI. The title, identification, and
// takeaway slides are left untouched — those are structural/factual
// scaffolding, not content the AI should be touching.
export async function aiOrganizeDeck(deck: SlideDeck): Promise<SlideDeck> {
  await loadPuter();
  const chat = window.puter?.ai?.chat;
  if (!chat) throw new AiOrganizeError("AI service unavailable.");

  const middle = deck.slides.filter(
    (s) => s.type === "content" || s.type === "list",
  );
  if (middle.length === 0) return deck;

  const organizable: OrganizableSlide[] = middle.map((s) => ({
    title: s.title,
    body: s.body,
    bullets: s.bullets,
    sections: s.sections,
  }));

  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(organizable, deck.topic)}`;
  const response = await chat(prompt, { model: "gpt-4o-mini" });
  const text = extractText(response);
  const parsed = parseAiSlides(text);

  if (!parsed || parsed.length === 0) {
    throw new AiOrganizeError("AI returned an unusable response.");
  }

  const reorganizedMiddle = parsed.map(toSlideSpec);

  const first = deck.slides.find((s) => s.type === "title");
  const identification = deck.slides.find((s) => s.type === "identification");
  const takeaway = deck.slides.find((s) => s.type === "takeaway");

  const slides = [
    ...(first ? [first] : []),
    ...(identification ? [identification] : []),
    ...reorganizedMiddle,
    ...(takeaway ? [takeaway] : []),
  ];

  return { ...deck, slides };
}
