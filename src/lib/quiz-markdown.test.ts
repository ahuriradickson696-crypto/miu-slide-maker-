import { describe, expect, it } from "vitest";
import { quizToMarkdown } from "./quiz-markdown";
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

describe("quizToMarkdown", () => {
  const md = quizToMarkdown(sampleQuiz);

  it("includes the topic as a heading", () => {
    expect(md).toContain("# Intro to Thermodynamics — Quiz");
  });

  it("marks the correct MCQ option", () => {
    expect(md).toContain("A. Energy is conserved **[correct]**");
  });

  it("does not mark incorrect options", () => {
    expect(md).not.toContain("B. Entropy always increases **[correct]**");
  });

  it("includes the model answer for short-answer questions", () => {
    expect(md).toContain("*Model answer:* A measure of disorder in a system.");
  });

  it("numbers every question", () => {
    expect(md).toContain("## Question 1");
    expect(md).toContain("## Question 2");
  });
});
