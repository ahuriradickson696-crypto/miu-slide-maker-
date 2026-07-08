import PptxGenJS from "pptxgenjs";
import type { SlideDeck, SlideSpec } from "./slides.functions";
import logoAsset from "@/assets/miu-logo.jpg";

const GREEN = "0F7A3A";
const RED = "C8102E";
const WHITE = "FFFFFF";
const DARK = "1F2937";
const MUTED = "6B7280";

async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function addFooter(slide: PptxGenJS.Slide, logo: string) {
  slide.addImage({ data: logo, x: 0.35, y: 5.05, w: 0.45, h: 0.45 });
  slide.addText("Metropolitan International University", {
    x: 0.85,
    y: 5.05,
    w: 3.2,
    h: 0.22,
    fontSize: 10,
    bold: true,
    color: GREEN,
    fontFace: "Calibri",
  });
  slide.addText("www.miu.ac.ug  |  info@miu.ac.ug  |  +256 772 561 957  |  Kampala • Mbarara • Kisoro Campuses", {
    x: 0.85,
    y: 5.27,
    w: 8.5,
    h: 0.22,
    fontSize: 9,
    color: MUTED,
    fontFace: "Calibri",
  });
}

function renderTitle(slide: PptxGenJS.Slide, spec: SlideSpec, deck: SlideDeck, logo: string) {
  slide.background = { color: GREEN };
  slide.addImage({ data: logo, x: 4.35, y: 0.4, w: 1.3, h: 1.3, rounding: true });
  slide.addText("METROPOLITAN INTERNATIONAL UNIVERSITY", {
    x: 0.5, y: 1.9, w: 9, h: 0.5,
    fontSize: 26, bold: true, color: WHITE, align: "center", fontFace: "Calibri",
  });
  slide.addText(spec.title, {
    x: 0.5, y: 2.5, w: 9, h: 0.6,
    fontSize: 32, color: WHITE, align: "center", fontFace: "Calibri",
  });
  const pills = [deck.courseCode, deck.courseName, deck.contactTime].filter(Boolean);
  pills.forEach((p, i) => {
    const w = 2.6;
    const gap = 0.2;
    const total = pills.length * w + (pills.length - 1) * gap;
    const startX = (10 - total) / 2;
    slide.addShape("roundRect", {
      x: startX + i * (w + gap), y: 3.4, w, h: 0.55,
      fill: { color: RED }, line: { color: RED }, rectRadius: 0.1,
    });
    slide.addText(p, {
      x: startX + i * (w + gap), y: 3.4, w, h: 0.55,
      fontSize: 12, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: "Calibri",
    });
  });
}

function renderIdentification(slide: PptxGenJS.Slide, deck: SlideDeck, logo: string, illus?: string) {
  slide.background = { color: WHITE };
  slide.addText("COURSE IDENTIFICATION DETAILS", {
    x: 0.5, y: 0.35, w: 9, h: 0.55, fontSize: 26, bold: true, color: GREEN, fontFace: "Calibri",
  });
  const rows = [
    ["Course Name:", deck.courseName || "—"],
    ["Course Code:", deck.courseCode || "—"],
    ["Course Level:", deck.courseLevel || "—"],
    ["Credit Units:", deck.creditUnits || "—"],
    ["Contact Time:", deck.contactTime || "—"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 1.15 + i * 0.6;
    slide.addShape("ellipse", { x: 0.7, y: y + 0.05, w: 0.35, h: 0.35, fill: { color: GREEN }, line: { color: GREEN } });
    slide.addText([
      { text: k + " ", options: { bold: true, color: RED } },
      { text: v, options: { color: DARK } },
    ], { x: 1.25, y, w: illus ? 5.2 : 8.2, h: 0.45, fontSize: 15, fontFace: "Calibri", valign: "middle" });
  });
  if (illus) slide.addImage({ data: illus, x: 6.7, y: 1.2, w: 2.8, h: 2.8 });
  addFooter(slide, logo);
}

function renderContent(slide: PptxGenJS.Slide, spec: SlideSpec, logo: string, illus?: string) {
  slide.background = { color: WHITE };
  slide.addText(spec.title, {
    x: 0.5, y: 0.35, w: 9, h: 0.55, fontSize: 24, bold: true, color: GREEN, fontFace: "Calibri",
  });
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 14, italic: true, color: RED, fontFace: "Calibri",
    });
  }
  const contentW = illus ? 5.4 : 8.5;
  let y = 1.35;
  if (spec.body) {
    slide.addText(spec.body, {
      x: 0.5, y, w: contentW, h: 0.9, fontSize: 13, color: DARK, fontFace: "Calibri",
    });
    y += 0.95;
  }
  if (spec.sections?.length) {
    spec.sections.forEach((s) => {
      slide.addText(s.heading, {
        x: 0.5, y, w: contentW, h: 0.3, fontSize: 14, bold: true, color: RED, fontFace: "Calibri",
      });
      slide.addText(s.description, {
        x: 0.5, y: y + 0.3, w: contentW, h: 0.35, fontSize: 12, color: DARK, fontFace: "Calibri",
      });
      y += 0.75;
    });
  }
  if (spec.bullets?.length) {
    slide.addText(
      spec.bullets.map((b) => ({ text: b, options: { bullet: { code: "25A0" }, color: DARK } })),
      { x: 0.5, y, w: contentW, h: 2.5, fontSize: 13, fontFace: "Calibri", paraSpaceAfter: 6 },
    );
  }
  if (illus) slide.addImage({ data: illus, x: 6.2, y: 1.35, w: 3.3, h: 3.3 });
  addFooter(slide, logo);
}

function renderTakeaway(slide: PptxGenJS.Slide, spec: SlideSpec, logo: string, illus?: string) {
  slide.background = { color: WHITE };
  slide.addText(spec.title, {
    x: 0.5, y: 0.35, w: 9, h: 0.55, fontSize: 26, bold: true, color: GREEN, fontFace: "Calibri",
  });
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 0.95, w: 9, h: 0.35, fontSize: 14, italic: true, color: RED, fontFace: "Calibri",
    });
  }
  const items = spec.bullets ?? (spec.body ? [spec.body] : []);
  slide.addText(
    items.map((b) => ({ text: b, options: { bullet: { code: "2713" }, color: DARK } })),
    { x: 0.5, y: 1.45, w: illus ? 5.5 : 8.5, h: 3.2, fontSize: 14, fontFace: "Calibri", paraSpaceAfter: 8 },
  );
  if (illus) slide.addImage({ data: illus, x: 6.3, y: 1.45, w: 3.2, h: 3.2 });
  addFooter(slide, logo);
}

export async function exportDeckToPptx(
  deck: SlideDeck,
  illustrations: (string | null)[],
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.defineLayout({ name: "STD", width: 10, height: 5.63 });
  pptx.layout = "STD";
  pptx.title = `${deck.topic} — ${deck.courseCode}`;
  pptx.company = "Metropolitan International University";

  const logo = await urlToBase64(logoAsset);

  deck.slides.forEach((spec, i) => {
    const slide = pptx.addSlide();
    const illus = illustrations[i] ?? undefined;
    if (spec.type === "title") renderTitle(slide, spec, deck, logo);
    else if (spec.type === "identification") renderIdentification(slide, deck, logo, illus);
    else if (spec.type === "takeaway") renderTakeaway(slide, spec, logo, illus);
    else renderContent(slide, spec, logo, illus);
  });

  const safe = deck.topic.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  await pptx.writeFile({ fileName: `${safe || "MIU_Deck"}.pptx` });
}
