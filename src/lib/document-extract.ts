// Extracts plain text from an uploaded curriculum document so it can be
// fed to Gemini for structure extraction. Server-only (pdf-parse and
// mammoth are Node libraries, not usable in the browser).

const MAX_EXTRACTED_CHARS = 200_000;

export type SupportedDocKind = "pdf" | "docx" | "text";

export function detectDocKind(filename: string, mimeType: string): SupportedDocKind | null {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return "docx";
  }
  if (mimeType.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) return "text";
  return null;
}

export async function extractTextFromDocument(buffer: Buffer, kind: SupportedDocKind): Promise<string> {
  let text: string;

  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    text = buffer.toString("utf-8");
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();

  if (!text) {
    throw new Error(
      "Couldn't find any readable text in that file — if it's a scanned/image-only PDF, this tool can't read it (no OCR support).",
    );
  }

  if (text.length > MAX_EXTRACTED_CHARS) {
    text = text.slice(0, MAX_EXTRACTED_CHARS);
  }

  return text;
}
