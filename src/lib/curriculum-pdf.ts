import { jsPDF } from "jspdf";
import type { SemesterNotes } from "./curriculum.functions";
import { getTheme, type ThemeId } from "./themes";
import { MIU_FACTS } from "./miu-facts";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PAGE_W = 8.27;
const PAGE_H = 11.69;
const MARGIN_X = 0.85;
const MARGIN_TOP = 0.9;
const MARGIN_BOTTOM = 0.85;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

export async function exportCurriculumSemesterToPdf(
  programName: string,
  notes: SemesterNotes,
  options?: { theme?: ThemeId },
): Promise<void> {
  const theme = getTheme(options?.theme);
  const GREEN = hexToRgb(theme.primary);
  const RED = hexToRgb(theme.accent);
  const DARK = hexToRgb(theme.dark);
  const MUTED = hexToRgb(theme.muted);

  const doc = new jsPDF({ orientation: "portrait", unit: "in", format: [PAGE_W, PAGE_H] });
  let y = MARGIN_TOP;
  let pageNum = 1;

  function addFooter() {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(`${MIU_FACTS.legalName} • ${MIU_FACTS.website} • ${MIU_FACTS.campusesShort}`, MARGIN_X, PAGE_H - 0.45);
    doc.text(String(pageNum), PAGE_W - MARGIN_X, PAGE_H - 0.45, { align: "right" });
  }

  function newPage() {
    addFooter();
    doc.addPage([PAGE_W, PAGE_H], "portrait");
    pageNum++;
    y = MARGIN_TOP;
  }

  function ensureSpace(needed: number) {
    if (y + needed > PAGE_H - MARGIN_BOTTOM) newPage();
  }

  function writeParagraph(
    text: string,
    opts: { size?: number; color?: [number, number, number]; bold?: boolean; italic?: boolean; gapAfter?: number } = {},
  ) {
    const size = opts.size ?? 10.5;
    doc.setFont("helvetica", opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? DARK));
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
    const lineHeight = size / 56;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, MARGIN_X, y);
      y += lineHeight;
    }
    y += opts.gapAfter ?? 0.12;
  }

  function writeLabel(text: string, color: [number, number, number]) {
    ensureSpace(0.25);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...color);
    doc.text(text.toUpperCase(), MARGIN_X, y);
    y += 0.18;
  }

  function writeBullets(items: string[]) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    for (const item of items) {
      const lines = doc.splitTextToSize(`•  ${item}`, CONTENT_W - 0.15) as string[];
      for (const line of lines) {
        ensureSpace(0.19);
        doc.text(line, MARGIN_X + 0.1, y);
        y += 0.19;
      }
    }
    y += 0.08;
  }

  // ===== Letterhead =====
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, PAGE_W, 0.14, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(MIU_FACTS.legalName.toUpperCase(), MARGIN_X, 0.55);
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.02);
  doc.line(MARGIN_X, 0.68, PAGE_W - MARGIN_X, 0.68);
  y = 1.0;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...GREEN);
  const titleLines = doc.splitTextToSize(`${notes.yearLabel} — ${notes.semesterLabel}`, CONTENT_W) as string[];
  titleLines.forEach((line) => {
    doc.text(line, MARGIN_X, y);
    y += 0.3;
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(programName, MARGIN_X, y);
  y += 0.22;
  doc.text(`Generated ${new Date(notes.generatedAt).toLocaleDateString()}`, MARGIN_X, y);
  y += 0.35;

  // ===== Topics =====
  notes.topics.forEach((t, i) => {
    ensureSpace(0.5);
    if (t.courseUnitTitle) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...RED);
      doc.text(`${t.courseUnitCode ? `${t.courseUnitCode} — ` : ""}${t.courseUnitTitle}`.toUpperCase(), MARGIN_X, y);
      y += 0.2;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...GREEN);
    const topicLines = doc.splitTextToSize(`${i + 1}. ${t.topicTitle}`, CONTENT_W) as string[];
    topicLines.forEach((line) => {
      ensureSpace(0.24);
      doc.text(line, MARGIN_X, y);
      y += 0.24;
    });
    y += 0.06;

    writeLabel("Definition & Core Concepts", MUTED);
    writeParagraph(t.definition, { gapAfter: 0.14 });

    if (t.keyPrinciples.length) {
      writeLabel("Key Principles", MUTED);
      writeBullets(t.keyPrinciples);
    }

    writeLabel("Real-World Application", MUTED);
    writeParagraph(t.application, { gapAfter: 0.14 });

    writeLabel("Takeaway", GREEN);
    writeParagraph(t.summary, { italic: true, gapAfter: 0.05 });

    y += 0.18;
  });

  addFooter();

  const safe = `${programName}_${notes.yearLabel}_${notes.semesterLabel}`.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  doc.save(`${safe || "Curriculum_Notes"}.pdf`);
}
