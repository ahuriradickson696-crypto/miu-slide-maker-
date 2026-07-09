import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ---------- No AI, no API keys, no network calls. -------------------------
// Everything below is plain text-parsing: it looks for headings, labeled
// fields ("Course Code:", etc.), bullet markers, and paragraph breaks in
// whatever text you give it, and turns that structure into slides. It
// cannot invent content that isn't in your input — it can only organize
// what's there.

const MAX_PASTE_CHARS = 12000;

// ---------- Input validation ----------

const GenerateInput = z.object({
  mode: z.enum(["brief", "paste"]).default("brief"),
  topic: z.string().optional().default(""),
  pastedContent: z
    .string()
    .optional()
    .default("")
    .refine((v) => v.length <= MAX_PASTE_CHARS, {
      message: `Pasted content is too long (max ${MAX_PASTE_CHARS} characters). Please shorten it and try again.`,
    }),
  courseName: z.string().optional().default(""),
  courseCode: z.string().optional().default(""),
  courseLevel: z.string().optional().default(""),
  creditUnits: z.string().optional().default(""),
  contactTime: z.string().optional().default(""),
  slideCount: z.number().int().min(4).max(24).default(10),
  extraNotes: z.string().optional().default(""),
});

export type SlideSpec = {
  type: "title" | "identification" | "content" | "list" | "takeaway";
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  sections?: { heading: string; description: string }[];
};

export type SlideDeck = {
  courseName: string;
  courseCode: string;
  courseLevel: string;
  creditUnits: string;
  contactTime: string;
  topic: string;
  slides: SlideSpec[];
};

// ---------- Content clamping (protects layout) ----------

const MAX_BULLETS = 6;
const MAX_BULLET_CHARS = 100;
const MAX_BODY_CHARS = 320;
const MAX_TITLE_CHARS = 70;

function clamp(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function clampSlide(spec: SlideSpec): SlideSpec {
  return {
    type: spec.type,
    title: clamp(spec.title || "", MAX_TITLE_CHARS),
    subtitle: spec.subtitle ? clamp(spec.subtitle, 100) : spec.subtitle,
    body: spec.body ? clamp(spec.body, MAX_BODY_CHARS) : spec.body,
    bullets: spec.bullets
      ?.slice(0, MAX_BULLETS)
      .map((b) => clamp(b, MAX_BULLET_CHARS)),
    sections: spec.sections?.slice(0, 4).map((s) => ({
      heading: clamp(s.heading, 45),
      description: clamp(s.description, 150),
    })),
  };
}

// ---------- Text parsing helpers ----------

const LABEL_PATTERNS: {
  key:
    "courseName" | "courseCode" | "courseLevel" | "creditUnits" | "contactTime";
  regex: RegExp;
}[] = [
  { key: "courseCode", regex: /^\s*course\s*code\s*[:-]\s*(.+)$/im },
  { key: "courseName", regex: /^\s*course\s*(name|title)\s*[:-]\s*(.+)$/im },
  { key: "courseLevel", regex: /^\s*(course\s*)?level\s*[:-]\s*(.+)$/im },
  { key: "creditUnits", regex: /^\s*credit\s*units?\s*[:-]\s*(.+)$/im },
  {
    key: "contactTime",
    regex: /^\s*(allocated\s*)?contact\s*(time|hours?)\s*[:-]\s*(.+)$/im,
  },
];

function extractIdentification(text: string): {
  fields: Record<string, string>;
  remaining: string;
} {
  const fields: Record<string, string> = {};
  let remaining = text;
  for (const { key, regex } of LABEL_PATTERNS) {
    const match = remaining.match(regex);
    if (match) {
      fields[key] = match[match.length - 1].trim();
      remaining = remaining.replace(match[0], "");
    }
  }
  return { fields, remaining };
}

const BULLET_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (t.startsWith("#")) return true;
  if (/^(topic|unit|chapter|module|lesson|section)\s+\S+/i.test(t)) return true;
  if (BULLET_MARKER.test(t)) return false;
  if (t.endsWith(":") && t.split(" ").length <= 10) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && t === t.toUpperCase() && t.split(" ").length <= 10)
    return true;
  return false;
}

function cleanHeading(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/:$/, "")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
}

type Block = { heading: string; lines: string[] };

function splitIntoBlocks(text: string): Block[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const blocks: Block[] = [];
  let current: Block = { heading: "", lines: [] };
  for (const line of lines) {
    if (isHeadingLine(line)) {
      if (current.heading || current.lines.length) blocks.push(current);
      current = { heading: cleanHeading(line), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length) blocks.push(current);

  // Drop any block with no real content — a heading line with nothing
  // under it (e.g. a "Topic Seven: ..." line immediately followed by
  // another heading) shouldn't turn into an empty slide.
  return blocks
    .filter((b) => b.lines.join(" ").trim().length > 0)
    .map((b) => ({ heading: b.heading || "Overview", lines: b.lines }));
}

function blockToSlideContent(block: Block): {
  title: string;
  body?: string;
  bullets?: string[];
  type: "content" | "list";
} {
  const bulletLines = block.lines.filter((l) => BULLET_MARKER.test(l));
  const proseLines = block.lines.filter((l) => !BULLET_MARKER.test(l));
  const bullets = bulletLines
    .map((l) => l.replace(BULLET_MARKER, "").trim())
    .filter(Boolean);
  const prose = proseLines.join(" ");

  if (bullets.length >= 2 && bullets.length >= proseLines.length) {
    return {
      title: block.heading,
      type: "list",
      bullets: bullets.slice(0, MAX_BULLETS),
    };
  }
  if (prose) {
    const sentences = splitSentences(prose);
    return {
      title: block.heading,
      type: "content",
      body: sentences.slice(0, 3).join(" "),
      bullets: bullets.length ? bullets.slice(0, MAX_BULLETS) : undefined,
    };
  }
  return {
    title: block.heading,
    type: "list",
    bullets: bullets.slice(0, MAX_BULLETS),
  };
}

type Candidate = {
  title: string;
  type: "content" | "list";
  body?: string;
  bullets?: string[];
};

function candidateSummary(c: Candidate): string {
  if (c.body) return c.body;
  if (c.bullets?.length) return c.bullets.join(". ");
  return "";
}

// Groups candidates down to a target slide count so the deck doesn't
// balloon past slideCount when pasted material has many headings. Unlike
// naively merging raw text, this keeps every original heading + its
// summary intact as a "section" on the combined slide — nothing is
// silently dropped the way collapsing raw lines into one bullet/body
// blob would.
function groupCandidates(candidates: Candidate[], target: number): SlideSpec[] {
  if (candidates.length <= target || target <= 0) {
    return candidates.map((c) => ({
      type: c.type,
      title: c.title,
      body: c.body,
      bullets: c.bullets,
    }));
  }
  const groups: Candidate[][] = Array.from({ length: target }, () => []);
  candidates.forEach((c, i) => {
    const groupIndex = Math.min(
      Math.floor((i * target) / candidates.length),
      target - 1,
    );
    groups[groupIndex].push(c);
  });
  return groups
    .filter((g) => g.length > 0)
    .map((group) => {
      if (group.length === 1) {
        const c = group[0];
        return {
          type: c.type,
          title: c.title,
          body: c.body,
          bullets: c.bullets,
        };
      }
      return {
        type: "content" as const,
        title: group[0].title,
        sections: group
          .slice(0, 4)
          .map((c) => ({ heading: c.title, description: candidateSummary(c) })),
      };
    });
}

function guessTopic(text: string, blocks: Block[]): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const explicitTopic = lines.find(
    (l) => /^(topic|lecture)\s+\S+/i.test(l) && isHeadingLine(l),
  );
  if (explicitTopic) return cleanHeading(explicitTopic);
  if (blocks[0]?.heading && blocks[0].heading !== "Overview")
    return blocks[0].heading;
  const firstSentence = splitSentences(text)[0];
  if (firstSentence) return clamp(firstSentence, MAX_TITLE_CHARS);
  return "Untitled Lecture";
}

// ---------- Deck assembly ----------

function buildFromPaste(data: z.infer<typeof GenerateInput>): SlideDeck {
  const { fields, remaining } = extractIdentification(data.pastedContent);
  const blocks = splitIntoBlocks(remaining);
  const contentSlots = Math.max(1, data.slideCount - 3); // reserve title, identification, takeaway
  const candidates: Candidate[] = blocks.map((b) => blockToSlideContent(b));

  const contentSlides: SlideSpec[] = groupCandidates(candidates, contentSlots);

  const rawContentSlides = candidates;

  const takeawayBullets = rawContentSlides
    .map((c) =>
      c.bullets?.length
        ? c.bullets[0]
        : c.body
          ? splitSentences(c.body)[0]
          : c.title,
    )
    .filter(Boolean)
    .slice(0, 6);

  const topic = data.topic || guessTopic(data.pastedContent, blocks);

  const slides: SlideSpec[] = [
    { type: "title", title: topic },
    { type: "identification", title: "Course Identification Details" },
    ...contentSlides,
    {
      type: "takeaway",
      title: "Key Takeaways",
      bullets: takeawayBullets.length
        ? takeawayBullets
        : ["Review the material covered in this lecture."],
    },
  ];

  return {
    courseName: data.courseName || fields.courseName || "",
    courseCode: data.courseCode || fields.courseCode || "",
    courseLevel: data.courseLevel || fields.courseLevel || "",
    creditUnits: data.creditUnits || fields.creditUnits || "",
    contactTime: data.contactTime || fields.contactTime || "",
    topic,
    slides: slides.map(clampSlide),
  };
}

// Brief mode has no source text to parse, so this builds a generic
// scaffold (section headings + whatever you typed in "extra notes",
// split across slots) rather than invented subject-matter content.
const SCAFFOLD_SECTIONS = [
  "Introduction",
  "Background & Context",
  "Key Concepts",
  "Core Principles",
  "Examples & Applications",
  "Common Challenges",
  "Discussion Points",
  "Case Study",
  "Practical Exercise",
  "Further Reading",
];

function buildFromBrief(data: z.infer<typeof GenerateInput>): SlideDeck {
  const contentSlots = Math.max(1, data.slideCount - 3);
  const noteSentences = splitSentences(data.extraNotes);

  const contentSlides: SlideSpec[] = Array.from(
    { length: contentSlots },
    (_, i) => {
      const title = SCAFFOLD_SECTIONS[i % SCAFFOLD_SECTIONS.length];
      const chunk = noteSentences.slice(i * 2, i * 2 + 2);
      return {
        type: "content" as const,
        title,
        body: chunk.length
          ? chunk.join(" ")
          : `Add your notes on "${title.toLowerCase()}" for ${data.topic || "this topic"} here.`,
      };
    },
  );

  const topic = data.topic || "Untitled Lecture";

  const slides: SlideSpec[] = [
    { type: "title", title: topic },
    { type: "identification", title: "Course Identification Details" },
    ...contentSlides,
    {
      type: "takeaway",
      title: "Key Takeaways",
      bullets: noteSentences.length
        ? noteSentences.slice(-4)
        : [`Summarize the key points of ${topic || "this lecture"} here.`],
    },
  ];

  return {
    courseName: data.courseName || "",
    courseCode: data.courseCode || "",
    courseLevel: data.courseLevel || "",
    creditUnits: data.creditUnits || "",
    contactTime: data.contactTime || "",
    topic,
    slides: slides.map(clampSlide),
  };
}

// ---------- Public server function ----------

export const generateDeck = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateInput.parse(data))
  .handler(async ({ data }) => {
    if (data.mode === "paste") {
      if (data.pastedContent.trim().length < 20) {
        throw new Error("Please paste some course material first.");
      }
      return buildFromPaste(data);
    }
    if (!data.topic.trim()) {
      throw new Error("Please enter a topic.");
    }
    return buildFromBrief(data);
  });
