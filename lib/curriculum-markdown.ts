import type { SemesterNotes } from "./curriculum.functions";
import { MIU_FACTS } from "./miu-facts";

export function curriculumSemesterToMarkdown(programName: string, notes: SemesterNotes): string {
  const lines: string[] = [];
  lines.push(`# ${notes.yearLabel} — ${notes.semesterLabel}`);
  lines.push(`*${programName}*`);
  lines.push("");
  lines.push(`> ${MIU_FACTS.legalName} — Curriculum Notes`);
  lines.push(`> Generated ${new Date(notes.generatedAt).toLocaleDateString()}`);
  lines.push("");

  notes.topics.forEach((t, i) => {
    if (t.courseUnitTitle) {
      lines.push(`**${[t.courseUnitCode, t.courseUnitTitle].filter(Boolean).join(" — ")}**`, "");
    }
    lines.push(`## ${i + 1}. ${t.topicTitle}`, "");
    lines.push("**Definition & Core Concepts**", "", t.definition, "");
    if (t.keyPrinciples.length) {
      lines.push("**Key Principles**", "");
      for (const p of t.keyPrinciples) lines.push(`- ${p}`);
      lines.push("");
    }
    lines.push("**Real-World Application**", "", t.application, "");
    lines.push("**Takeaway**", "", t.summary, "");
    lines.push("---", "");
  });

  lines.push(`${MIU_FACTS.website} • ${MIU_FACTS.campusesShort}`);
  return lines.join("\n");
}

export function downloadCurriculumSemesterMarkdown(programName: string, notes: SemesterNotes): void {
  const markdown = curriculumSemesterToMarkdown(programName, notes);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safe = `${programName}_${notes.yearLabel}_${notes.semesterLabel}`.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safe || "Curriculum_Notes"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}
