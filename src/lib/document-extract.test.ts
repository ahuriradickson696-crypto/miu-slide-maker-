import { describe, expect, it } from "vitest";
import { detectDocKind } from "./document-extract";

describe("detectDocKind", () => {
  it("detects PDF by mime type", () => {
    expect(detectDocKind("whatever", "application/pdf")).toBe("pdf");
  });

  it("detects PDF by extension when mime type is generic", () => {
    expect(detectDocKind("curriculum.PDF", "application/octet-stream")).toBe("pdf");
  });

  it("detects DOCX by mime type", () => {
    expect(
      detectDocKind("doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("docx");
  });

  it("detects DOCX by extension", () => {
    expect(detectDocKind("curriculum.docx", "application/octet-stream")).toBe("docx");
  });

  it("detects plain text by mime type prefix", () => {
    expect(detectDocKind("notes", "text/plain")).toBe("text");
  });

  it("detects plain text and markdown by extension", () => {
    expect(detectDocKind("notes.txt", "")).toBe("text");
    expect(detectDocKind("notes.md", "")).toBe("text");
  });

  it("returns null for unsupported types", () => {
    expect(detectDocKind("image.png", "image/png")).toBeNull();
    expect(detectDocKind("archive.zip", "application/zip")).toBeNull();
  });
});
