import type { LectureNotes } from "./lecture-notes.functions";
import { MIU_FACTS } from "./miu-facts";

export function lectureNotesToMarkdown(notes: LectureNotes): string {
  const lines: string[] = [];
  lines.push(`# ${notes.topic || "Untitled Lecture"}`);
  const meta = [notes.courseCode, notes.courseName, notes.courseLevel].filter(Boolean).join(" • ");
  if (meta) lines.push(`*${meta}*`);
  lines.push("");
  lines.push(`> ${MIU_FACTS.legalName} — Lecture Notes`);
  lines.push(`> Generated ${new Date(notes.generatedAt).toLocaleDateString()}`);
  lines.push("");

  if (notes.overview) {
    lines.push("## Overview", "", notes.overview, "");
  }

  if (notes.learningOutcomes.length) {
    lines.push("## Learning Outcomes", "", "By the end of this lecture, students will be able to:", "");
    for (const o of notes.learningOutcomes) lines.push(`- ${o}`);
    lines.push("");
  }

  notes.sections.forEach((section, i) => {
    lines.push(`## ${i + 1}. ${section.heading}`, "");
    for (const p of section.paragraphs) lines.push(p, "");
    if (section.keyTerms?.length) {
      lines.push("**Key terms:**", "");
      for (const t of section.keyTerms) lines.push(`- **${t.term}** — ${t.definition}`);
      lines.push("");
    }
  });

  if (notes.keyTakeaways.length) {
    lines.push("## Key Takeaways", "");
    for (const k of notes.keyTakeaways) lines.push(`- ${k}`);
    lines.push("");
  }

  if (notes.furtherReading.length) {
    lines.push("## Further Reading", "");
    for (const f of notes.furtherReading) lines.push(`- ${f}`);
    lines.push("");
  }

  lines.push("---", `${MIU_FACTS.website} • ${MIU_FACTS.campusesShort}`);
  return lines.join("\n");
}

export function downloadLectureNotesMarkdown(notes: LectureNotes): void {
  const markdown = lectureNotesToMarkdown(notes);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safe = (notes.topic || "Lecture_Notes").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safe || "MIU_Lecture_Notes"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}
