import { describe, expect, it } from "vitest";
import { quizToQti } from "./quiz-qti-export";
import type { Quiz } from "./quiz.functions";

const sampleQuiz: Quiz = {
  id: "11111111-1111-1111-1111-111111111111",
  deckId: "00000000-0000-0000-0000-000000000000",
  topic: "Intro to Thermodynamics",
  generatedAt: "2026-01-01T00:00:00.000Z",
  questions: [
    {
      type: "mcq",
      question: "What is the first law of thermodynamics?",
      options: [
        "Energy is conserved",
        "Entropy always increases",
        "Heat flows one way",
        "None of these",
      ],
      correctIndex: 0,
    },
    {
      type: "short_answer",
      question: "Define entropy in your own words.",
      sampleAnswer: "A measure of disorder in a system.",
    },
  ],
};

describe("quizToQti", () => {
  const xml = quizToQti(sampleQuiz);

  it("produces valid QTI 1.2 root elements", () => {
    expect(xml).toContain("<questestinterop");
    expect(xml).toContain("ims_qtiasiv1p2");
    expect(xml).toContain("</questestinterop>");
  });

  it("includes one <item> per question", () => {
    const itemCount = (xml.match(/<item /g) ?? []).length;
    expect(itemCount).toBe(sampleQuiz.questions.length);
  });

  it("marks the correct MCQ option via a respcondition", () => {
    expect(xml).toContain(
      '<varequal respident="response1">choice_1</varequal>',
    );
  });

  it("includes the model answer for short-answer questions as feedback", () => {
    expect(xml).toContain("A measure of disorder in a system.");
  });

  it("escapes special XML characters in question text", () => {
    const quizWithSpecialChars: Quiz = {
      ...sampleQuiz,
      questions: [
        {
          type: "short_answer",
          question: 'What does "A & B < C" mean?',
          sampleAnswer: "A test of escaping.",
        },
      ],
    };
    const escaped = quizToQti(quizWithSpecialChars);
    expect(escaped).toContain("&amp;");
    expect(escaped).toContain("&lt;");
    expect(escaped).not.toContain("A & B < C");
  });
});
