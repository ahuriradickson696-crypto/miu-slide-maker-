import { describe, expect, it } from "vitest";
import { clampQuiz, GenerateQuizInput } from "./quiz.functions";

describe("GenerateQuizInput", () => {
  it("accepts a deckId with no topic (existing deck-based path)", () => {
    const result = GenerateQuizInput.safeParse({
      deckId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a topic with no deckId (new standalone path)", () => {
    const result = GenerateQuizInput.safeParse({ topic: "Cell biology" });
    expect(result.success).toBe(true);
  });

  it("accepts a topic plus optional sourceText", () => {
    const result = GenerateQuizInput.safeParse({
      topic: "Cell biology",
      sourceText: "Mitochondria are...",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a request with neither deckId nor topic", () => {
    const result = GenerateQuizInput.safeParse({ questionCount: 5 });
    expect(result.success).toBe(false);
  });

  it("defaults questionCount and mix when omitted", () => {
    const result = GenerateQuizInput.parse({ topic: "Cell biology" });
    expect(result.questionCount).toBe(8);
    expect(result.mix).toBe("mixed");
  });
});

describe("clampQuiz", () => {
  it("keeps a well-formed mcq question", () => {
    const questions = clampQuiz({
      questions: [
        {
          type: "mcq",
          question: "2+2?",
          options: ["1", "2", "3", "4"],
          correctIndex: 3,
        },
      ],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ type: "mcq", correctIndex: 3 });
  });

  it("keeps a well-formed short_answer question", () => {
    const questions = clampQuiz({
      questions: [
        {
          type: "short_answer",
          question: "Define entropy.",
          sampleAnswer: "A measure of disorder.",
        },
      ],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("short_answer");
  });

  it("drops an mcq question that doesn't have exactly 4 options", () => {
    const questions = clampQuiz({
      questions: [
        {
          type: "mcq",
          question: "Bad question",
          options: ["a", "b"],
          correctIndex: 0,
        },
      ],
    });
    expect(questions).toHaveLength(0);
  });

  it("drops an mcq question with an out-of-range correctIndex", () => {
    const questions = clampQuiz({
      questions: [
        {
          type: "mcq",
          question: "Bad question",
          options: ["a", "b", "c", "d"],
          correctIndex: 7,
        },
      ],
    });
    expect(questions).toHaveLength(0);
  });

  it("drops a short_answer question with no sampleAnswer", () => {
    const questions = clampQuiz({
      questions: [{ type: "short_answer", question: "No answer given" }],
    });
    expect(questions).toHaveLength(0);
  });

  it("drops an entry with an unrecognized type", () => {
    const questions = clampQuiz({
      questions: [{ type: "essay", question: "Not supported" }],
    });
    expect(questions).toHaveLength(0);
  });

  it("caps at 25 questions even if the model returns more", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: "short_answer",
      question: `Q${i}`,
      sampleAnswer: "A",
    }));
    const questions = clampQuiz({ questions: many });
    expect(questions).toHaveLength(25);
  });

  it("returns an empty array when questions is missing or malformed", () => {
    expect(clampQuiz({})).toEqual([]);
    expect(clampQuiz({ questions: "not-an-array" })).toEqual([]);
  });
});
