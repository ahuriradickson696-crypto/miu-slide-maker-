import { describe, expect, it } from "vitest";
import { lectureNotesToMarkdown } from "./lecture-notes-markdown";
import type { LectureNotes } from "./lecture-notes.functions";

const sampleNotes: LectureNotes = {
  id: "11111111-1111-1111-1111-111111111111",
  deckId: "00000000-0000-0000-0000-000000000000",
  topic: "Introduction to Reports",
  courseName: "Communication Skills",
  courseCode: "BEE 1101",
  courseLevel: "Undergraduate-Degree (Year One)",
  creditUnits: "3 Credit Units",
  contactTime: "3 Hours",
  overview: "This lecture introduces report writing.",
  learningOutcomes: ["Identify report types", "Structure a report correctly"],
  sections: [
    {
      heading: "Types of Reports",
      paragraphs: [
        "There are several types of reports.",
        "Each serves a different purpose.",
      ],
      keyTerms: [
        { term: "Memorandum", definition: "A short internal report." },
      ],
    },
  ],
  keyTakeaways: ["Reports must be structured", "Audience matters"],
  furtherReading: ["A standard business communication textbook"],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

describe("lectureNotesToMarkdown", () => {
  const md = lectureNotesToMarkdown(sampleNotes);

  it("includes the topic as an H1", () => {
    expect(md).toContain("# Introduction to Reports");
  });

  it("includes course metadata", () => {
    expect(md).toContain("BEE 1101");
    expect(md).toContain("Communication Skills");
  });

  it("includes every section heading, numbered", () => {
    expect(md).toContain("## 1. Types of Reports");
  });

  it("includes section paragraphs and key terms", () => {
    expect(md).toContain("There are several types of reports.");
    expect(md).toContain("**Memorandum** — A short internal report.");
  });

  it("includes learning outcomes and key takeaways as bullet lists", () => {
    expect(md).toContain("- Identify report types");
    expect(md).toContain("- Reports must be structured");
  });

  it("includes further reading when present", () => {
    expect(md).toContain("A standard business communication textbook");
  });

  it("omits the Further Reading section entirely when empty", () => {
    const withoutReading = lectureNotesToMarkdown({
      ...sampleNotes,
      furtherReading: [],
    });
    expect(withoutReading).not.toContain("## Further Reading");
  });

  it("mentions the university name", () => {
    expect(md).toContain("Metropolitan International University");
  });
});
