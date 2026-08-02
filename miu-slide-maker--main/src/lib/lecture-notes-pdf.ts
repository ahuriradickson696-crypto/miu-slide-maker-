import { jsPDF } from "jspdf";
import type { LectureNotes } from "./lecture-notes.functions";
import { getTheme, type ThemeId } from "./themes";
import { MIU_FACTS } from "./miu-facts";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A4 portrait — this is a document meant to be read/printed like a course
// pack, not a fixed-aspect slide, so it uses standard flowing pagination
// instead of one-region-per-page like the slide PDF export.
const PAGE_W = 8.27;
const PAGE_H = 11.69;
const MARGIN_X = 0.85;
const MARGIN_TOP = 0.9;
const MARGIN_BOTTOM = 0.85;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

export async function exportLectureNotesToPdf(notes: LectureNotes, options?: { theme?: ThemeId }): Promise<void> {
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
    doc.text(
      `${MIU_FACTS.legalName} • ${MIU_FACTS.website} • ${MIU_FACTS.campusesShort}`,
      MARGIN_X,
      PAGE_H - 0.45,
    );
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

  function writeParagraph(text: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean; italic?: boolean; gapAfter?: number } = {}) {
    const size = opts.size ?? 10.5;
    const color = opts.color ?? DARK;
    doc.setFont("helvetica", opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
    const lineHeight = size / 56; // empirical inches-per-line at this font size scale
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, MARGIN_X, y);
      y += lineHeight;
    }
    y += opts.gapAfter ?? 0.12;
  }

  function writeHeading(text: string, opts: { size?: number; color?: [number, number, number]; gapBefore?: number; gapAfter?: number } = {}) {
    ensureSpace(0.5);
    y += opts.gapBefore ?? 0.15;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(opts.size ?? 14);
    doc.setTextColor(...(opts.color ?? GREEN));
    doc.text(text, MARGIN_X, y);
    y += (opts.size ?? 14) / 56 + (opts.gapAfter ?? 0.15);
  }

  function writeBulletList(items: string[], opts: { color?: [number, number, number] } = {}) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...(opts.color ?? DARK));
    for (const item of items) {
      const lines = doc.splitTextToSize(`•  ${item}`, CONTENT_W - 0.15) as string[];
      for (const line of lines) {
        ensureSpace(0.2);
        doc.text(line, MARGIN_X + 0.1, y);
        y += 0.2;
      }
      y += 0.03;
    }
    y += 0.1;
  }

  // ===== Letterhead =====
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, PAGE_W, 0.14, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(MIU_FACTS.legalName.toUpperCase(), MARGIN_X, 0.55);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(`"${MIU_FACTS.motto}"`, PAGE_W - MARGIN_X, 0.55, { align: "right" });
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.02);
  doc.line(MARGIN_X, 0.68, PAGE_W - MARGIN_X, 0.68);
  y = 1.0;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...GREEN);
  const titleLines = doc.splitTextToSize(notes.topic || "Untitled Lecture", CONTENT_W) as string[];
  titleLines.forEach((line) => {
    doc.text(line, MARGIN_X, y);
    y += 0.32;
  });
  y += 0.05;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const meta = [notes.courseCode, notes.courseName, notes.courseLevel].filter(Boolean).join("  •  ");
  if (meta) {
    doc.text(meta, MARGIN_X, y);
    y += 0.22;
  }
  doc.text(`Lecture notes generated ${new Date(notes.generatedAt).toLocaleDateString()}`, MARGIN_X, y);
  y += 0.35;

  // ===== Overview =====
  if (notes.overview) {
    writeHeading("Overview", { size: 13 });
    writeParagraph(notes.overview, { gapAfter: 0.2 });
  }

  // ===== Learning outcomes =====
  if (notes.learningOutcomes.length) {
    writeHeading("Learning Outcomes", { size: 13 });
    writeParagraph("By the end of this lecture, students will be able to:", { italic: true, size: 9.5, color: MUTED, gapAfter: 0.08 });
    writeBulletList(notes.learningOutcomes);
  }

  // ===== Sections =====
  notes.sections.forEach((section, i) => {
    writeHeading(`${i + 1}. ${section.heading}`, { size: 14, gapBefore: 0.15 });
    section.paragraphs.forEach((p) => writeParagraph(p, { gapAfter: 0.14 }));
    if (section.keyTerms?.length) {
      ensureSpace(0.3);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...RED);
      doc.text("KEY TERMS", MARGIN_X, y);
      y += 0.2;
      section.keyTerms.forEach((t) => {
        writeParagraph(`${t.term} — ${t.definition}`, { size: 9.5, color: DARK, gapAfter: 0.06 });
      });
      y += 0.08;
    }
  });

  // ===== Key takeaways =====
  if (notes.keyTakeaways.length) {
    writeHeading("Key Takeaways", { size: 13, gapBefore: 0.2 });
    writeBulletList(notes.keyTakeaways, { color: DARK });
  }

  // ===== Further reading =====
  if (notes.furtherReading.length) {
    writeHeading("Further Reading", { size: 12 });
    writeBulletList(notes.furtherReading, { color: MUTED });
  }

  addFooter();

  const safe = (notes.topic || "Lecture_Notes").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  doc.save(`${safe || "MIU_Lecture_Notes"}.pdf`);
}
