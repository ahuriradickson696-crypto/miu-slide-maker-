import { describe, expect, it } from "vitest";
import { clampLectureNotes } from "./lecture-notes.functions";

const meta = {
  topic: "Cell Biology",
  courseName: "Introductory Biology",
  courseCode: "BIO 1101",
  courseLevel: "Year One",
  creditUnits: "3",
  contactTime: "3 hours/week",
};

describe("clampLectureNotes", () => {
  it("carries the metadata through unchanged", () => {
    const notes = clampLectureNotes(meta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: [{ heading: "Mitochondria", paragraphs: ["Some prose."] }],
      keyTakeaways: ["Remember X"],
    });
    expect(notes.topic).toBe("Cell Biology");
    expect(notes.courseCode).toBe("BIO 1101");
  });

  it("works with empty metadata (standalone notes with no course info supplied)", () => {
    const bareMeta = {
      topic: "Cell Biology",
      courseName: "",
      courseCode: "",
      courseLevel: "",
      creditUnits: "",
      contactTime: "",
    };
    const notes = clampLectureNotes(bareMeta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: [{ heading: "Mitochondria", paragraphs: ["Some prose."] }],
      keyTakeaways: ["Remember X"],
    });
    expect(notes.courseName).toBe("");
    expect(notes.topic).toBe("Cell Biology");
  });

  it("fills a placeholder paragraph when a section has none", () => {
    const notes = clampLectureNotes(meta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: [{ heading: "Empty section", paragraphs: [] }],
      keyTakeaways: ["Remember X"],
    });
    expect(notes.sections[0].paragraphs).toEqual([
      "(No content generated for this section.)",
    ]);
  });

  it("drops key terms missing a term or definition", () => {
    const notes = clampLectureNotes(meta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: [
        {
          heading: "Terms",
          paragraphs: ["Some prose."],
          keyTerms: [
            { term: "Mitochondria", definition: "The powerhouse of the cell." },
            { term: "", definition: "Missing its term." },
          ],
        },
      ],
      keyTakeaways: ["Remember X"],
    });
    expect(notes.sections[0].keyTerms).toHaveLength(1);
  });

  it("caps sections at 10 and paragraphs at 4 per section", () => {
    const manySections = Array.from({ length: 15 }, (_, i) => ({
      heading: `Section ${i}`,
      paragraphs: Array.from({ length: 8 }, (_, j) => `Paragraph ${j}`),
    }));
    const notes = clampLectureNotes(meta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: manySections,
      keyTakeaways: ["Remember X"],
    });
    expect(notes.sections).toHaveLength(10);
    expect(notes.sections[0].paragraphs).toHaveLength(4);
  });

  it("drops sections with an empty-string heading", () => {
    const notes = clampLectureNotes(meta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: [{ heading: "", paragraphs: ["Some prose."] }],
      keyTakeaways: ["Remember X"],
    });
    // An empty string is still a string, so it doesn't hit the
    // "Untitled section" fallback (that's only for a non-string heading);
    // it comes out as "" and gets filtered by the final .filter((s) => s.heading).
    expect(notes.sections).toHaveLength(0);
  });

  it("falls back to a placeholder heading when the field isn't a string at all", () => {
    const notes = clampLectureNotes(meta, {
      overview: "An overview.",
      learningOutcomes: ["Explain X"],
      sections: [{ heading: 42, paragraphs: ["Some prose."] }],
      keyTakeaways: ["Remember X"],
    });
    expect(notes.sections[0].heading).toBe("Untitled section");
  });

  it("returns empty arrays when the response is missing the expected fields entirely", () => {
    const notes = clampLectureNotes(meta, {});
    expect(notes.sections).toEqual([]);
    expect(notes.learningOutcomes).toEqual([]);
    expect(notes.keyTakeaways).toEqual([]);
    expect(notes.furtherReading).toEqual([]);
  });
});
