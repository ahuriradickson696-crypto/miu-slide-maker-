import { jsPDF } from "jspdf";
import type { SlideDeck, SlideSpec } from "./slides.functions";
import { getTheme, type ThemeId } from "./themes";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Page is landscape 10x5.63in to match the pptx aspect ratio.
const PAGE_W = 10;
const PAGE_H = 5.63;
const MARGIN = 0.5;
const CONTENT_W = PAGE_W - MARGIN * 2;

function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth);
}

function renderSlide(doc: jsPDF, spec: SlideSpec, deck: SlideDeck, index: number, theme: ReturnType<typeof getTheme>) {
  const GREEN = hexToRgb(theme.primary);
  const RED = hexToRgb(theme.accent);
  const DARK = hexToRgb(theme.dark);
  const MUTED = hexToRgb(theme.muted);
  let y = MARGIN + 0.15;

  if (spec.type === "title") {
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("METROPOLITAN INTERNATIONAL UNIVERSITY", PAGE_W / 2, 2.1, { align: "center" });
    doc.setFontSize(22);
    doc.text(wrapText(doc, spec.title, CONTENT_W), PAGE_W / 2, 2.6, { align: "center" });
    const pills = [deck.courseCode, deck.courseName].filter(Boolean).join("   •   ");
    if (pills) {
      doc.setFontSize(11);
      doc.text(pills, PAGE_W / 2, 3.4, { align: "center" });
    }
    return;
  }

  doc.setTextColor(255, 255, 255);
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  doc.setTextColor(...GREEN);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(wrapText(doc, spec.title, CONTENT_W), MARGIN, y);
  y += 0.35;

  if (spec.subtitle) {
    doc.setTextColor(...RED);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.text(spec.subtitle, MARGIN, y);
    y += 0.3;
  }

  y += 0.1;
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  if (spec.body) {
    const lines = wrapText(doc, spec.body, CONTENT_W);
    doc.text(lines, MARGIN, y);
    y += lines.length * 0.2 + 0.15;
  }

  if (spec.sections?.length) {
    for (const s of spec.sections) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...RED);
      doc.text(s.heading, MARGIN, y);
      y += 0.2;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...DARK);
      const lines = wrapText(doc, s.description, CONTENT_W);
      doc.text(lines, MARGIN, y);
      y += lines.length * 0.18 + 0.15;
    }
  }

  if (spec.bullets?.length) {
    for (const b of spec.bullets) {
      const lines = wrapText(doc, `•  ${b}`, CONTENT_W - 0.2);
      doc.text(lines, MARGIN + 0.15, y);
      y += lines.length * 0.2 + 0.06;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("MIU • www.miu.ac.ug • Kampala • Mbarara • Kisoro", MARGIN, PAGE_H - 0.25);
  doc.text(`${index + 1}`, PAGE_W - MARGIN, PAGE_H - 0.25, { align: "right" });
}

export async function exportDeckToPdf(deck: SlideDeck, options?: { theme?: ThemeId }): Promise<void> {
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
    throw new Error("There's nothing to export yet — generate a deck first.");
  }
  const theme = getTheme(options?.theme);

  const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [PAGE_W, PAGE_H] });

  deck.slides.forEach((spec, i) => {
    if (i > 0) doc.addPage([PAGE_W, PAGE_H], "landscape");
    renderSlide(doc, spec, deck, i, theme);
  });

  const safe = (deck.topic || "MIU_Deck").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  doc.save(`${safe || "MIU_Deck"}.pdf`);
}
