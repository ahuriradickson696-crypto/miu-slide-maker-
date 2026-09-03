import type { Quiz } from "./quiz.functions";
import { MIU_FACTS } from "./miu-facts";

export function quizToMarkdown(quiz: Quiz): string {
  const lines: string[] = [];
  lines.push(`# ${quiz.topic} — Quiz`);
  lines.push(`*${MIU_FACTS.legalName} • Generated ${new Date(quiz.generatedAt).toLocaleDateString()}*`);
  lines.push("");

  quiz.questions.forEach((q, i) => {
    lines.push(`## Question ${i + 1}`, "", q.question, "");
    if (q.type === "mcq" && q.options) {
      q.options.forEach((opt, oi) => {
        const marker = oi === q.correctIndex ? "**[correct]**" : "";
        lines.push(`${String.fromCharCode(65 + oi)}. ${opt} ${marker}`.trim());
      });
      lines.push("");
    } else if (q.sampleAnswer) {
      lines.push(`*Model answer:* ${q.sampleAnswer}`, "");
    }
  });

  return lines.join("\n");
}

export function downloadQuizMarkdown(quiz: Quiz): void {
  const markdown = quizToMarkdown(quiz);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safe = quiz.topic.replace(/[^a-z0-9]+/gi, "_").slice(0, 50);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safe || "quiz"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}
