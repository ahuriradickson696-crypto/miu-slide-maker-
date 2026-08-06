import { describe, expect, it } from "vitest";
import { clampStructure, clampTopicNotes, batchCourseUnits, type CourseUnit } from "./curriculum.functions";

describe("clampStructure", () => {
  it("keeps a well-formed structure intact", () => {
    const raw = {
      programName: "BSc Computer Science",
      years: [
        {
          year: "Year 1",
          semesters: [
            {
              semester: "Semester 1",
              courseUnits: [{ code: "CS101", title: "Intro to Programming", topics: ["Variables", "Loops"] }],
            },
          ],
        },
      ],
    };
    const result = clampStructure(raw);
    expect(result.programName).toBe("BSc Computer Science");
    expect(result.years).toHaveLength(1);
    expect(result.years[0].semesters[0].courseUnits[0].topics).toEqual(["Variables", "Loops"]);
  });

  it("drops semesters with no course units, and years with no semesters", () => {
    const raw = {
      programName: "Empty Program",
      years: [
        { year: "Year 1", semesters: [{ semester: "Semester 1", courseUnits: [] }] },
        {
          year: "Year 2",
          semesters: [{ semester: "Semester 1", courseUnits: [{ title: "Unit A", topics: ["Topic 1"] }] }],
        },
      ],
    };
    const result = clampStructure(raw);
    expect(result.years).toHaveLength(1);
    expect(result.years[0].year).toBe("Year 2");
  });

  it("drops course units with no topics", () => {
    const raw = {
      programName: "P",
      years: [
        {
          year: "Year 1",
          semesters: [
            {
              semester: "Semester 1",
              courseUnits: [
                { title: "No topics unit", topics: [] },
                { title: "Real unit", topics: ["A topic"] },
              ],
            },
          ],
        },
      ],
    };
    const result = clampStructure(raw);
    expect(result.years[0].semesters[0].courseUnits).toHaveLength(1);
    expect(result.years[0].semesters[0].courseUnits[0].title).toBe("Real unit");
  });

  it("handles completely malformed input without throwing", () => {
    expect(() => clampStructure({})).not.toThrow();
    expect(clampStructure({}).years).toEqual([]);
  });

  it("defaults a missing/non-string code to an empty string", () => {
    const raw = {
      programName: "P",
      years: [
        {
          year: "Year 1",
          semesters: [{ semester: "S1", courseUnits: [{ title: "Unit", topics: ["T1"] }] }],
        },
      ],
    };
    const result = clampStructure(raw);
    expect(result.years[0].semesters[0].courseUnits[0].code).toBe("");
  });
});

describe("clampTopicNotes", () => {
  const units: CourseUnit[] = [{ code: "CS101", title: "Intro", topics: ["Variables", "Loops"] }];

  it("keeps well-formed topic notes", () => {
    const raw = [
      {
        courseUnitCode: "CS101",
        courseUnitTitle: "Intro",
        topicTitle: "Variables",
        definition: "A variable stores data.",
        keyPrinciples: ["Declared with a type", "Can be reassigned"],
        application: "Used to store a user's age in a form.",
        summary: "Variables hold data that can change.",
      },
    ];
    const result = clampTopicNotes(raw, units);
    expect(result).toHaveLength(1);
    expect(result[0].topicTitle).toBe("Variables");
  });

  it("drops entries missing a title or definition", () => {
    const raw = [{ topicTitle: "", definition: "Something" }, { topicTitle: "Has title", definition: "" }];
    expect(clampTopicNotes(raw, units)).toHaveLength(0);
  });

  it("caps keyPrinciples at 8 items", () => {
    const raw = [
      {
        topicTitle: "T",
        definition: "D",
        keyPrinciples: Array.from({ length: 20 }, (_, i) => `Point ${i}`),
      },
    ];
    expect(clampTopicNotes(raw, units)[0].keyPrinciples).toHaveLength(8);
  });

  it("never throws on garbage input", () => {
    expect(() => clampTopicNotes([null, undefined, "string", 42, {}], units)).not.toThrow();
  });
});

describe("batchCourseUnits", () => {
  it("keeps small semesters in a single batch", () => {
    const units: CourseUnit[] = [
      { code: "A", title: "Unit A", topics: ["1", "2"] },
      { code: "B", title: "Unit B", topics: ["3"] },
    ];
    expect(batchCourseUnits(units)).toHaveLength(1);
  });

  it("splits a large semester into multiple batches capped around 12 topics each", () => {
    const units: CourseUnit[] = Array.from({ length: 6 }, (_, i) => ({
      code: `U${i}`,
      title: `Unit ${i}`,
      topics: ["a", "b", "c", "d", "e"], // 5 topics each, 6 units = 30 topics total
    }));
    const batches = batchCourseUnits(units);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const topicCount = batch.reduce((n, u) => n + u.topics.length, 0);
      expect(topicCount).toBeLessThanOrEqual(15); // some slack allowed by the batching rule
    }
  });

  it("never drops a unit, even a very large one that exceeds the batch cap alone", () => {
    const units: CourseUnit[] = [{ code: "X", title: "Huge unit", topics: Array.from({ length: 25 }, (_, i) => `t${i}`) }];
    const batches = batchCourseUnits(units);
    const totalUnits = batches.flat().length;
    expect(totalUnits).toBe(1);
  });

  it("returns an empty array for no course units", () => {
    expect(batchCourseUnits([])).toEqual([]);
  });
});
