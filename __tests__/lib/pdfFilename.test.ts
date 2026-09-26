// @vitest-environment node
/**
 * pdfContentDisposition — the name a PDF from /api/documents/proxy is saved
 * under: the document's title, safe as a file name and as a header value,
 * instead of "document.pdf" for every file.
 */
import { describe, it, expect } from "vitest";
import { cleanPdfBaseName, pdfContentDisposition } from "@/app/lib/pdfFilename";

/** What a browser does with `filename*`: percent-decode the UTF-8 value. */
function savedName(header: string): string {
  const star = /filename\*=UTF-8''([^;]+)/.exec(header);
  if (star) return decodeURIComponent(star[1]);
  return /filename="([^"]*)"/.exec(header)![1];
}

describe("pdfContentDisposition", () => {
  it("names a Thai title in UTF-8, with an ASCII fallback from its Latin letters", () => {
    const header = pdfContentDisposition("attachment", "แคตตาล็อก Ohaus 2026");
    expect(savedName(header)).toBe("แคตตาล็อก Ohaus 2026.pdf");
    expect(header).toContain('filename="Ohaus 2026.pdf"');
    expect(header.startsWith("attachment; ")).toBe(true);
  });

  it('falls back to "document.pdf" in the ASCII part when the title has no Latin letters', () => {
    const header = pdfContentDisposition("inline", "คู่มือการใช้งาน");
    expect(header).toContain('filename="document.pdf"');
    expect(savedName(header)).toBe("คู่มือการใช้งาน.pdf");
  });

  it("keeps the old header when there is no name", () => {
    expect(pdfContentDisposition("inline", null)).toBe('inline; filename="document.pdf"');
    expect(pdfContentDisposition("attachment", "   ")).toBe('attachment; filename="document.pdf"');
    expect(pdfContentDisposition("attachment", '/\\:*?"<>|')).toBe('attachment; filename="document.pdf"');
  });

  it("is always a valid header value — ASCII only, whatever the title", () => {
    for (const title of ["แคตตาล็อก 😀 สินค้า", "a\r\nSet-Cookie: x=1", "ราคา (ลด 50%) * พิเศษ's"]) {
      const header = pdfContentDisposition("attachment", title);
      expect(header).toMatch(/^[\x20-\x7e]+$/);
      expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
    }
  });

  it("cannot be used to inject a header or end the quoted name early", () => {
    const header = pdfContentDisposition("attachment", 'x"; filename="evil.exe');
    // Every quote became a space, so the quoted ASCII name has exactly two
    // quotes around it and the name still ends in .pdf.
    expect(header).toBe(
      `attachment; filename="x ; filename= evil.exe.pdf"; filename*=UTF-8''${encodeURIComponent("x ; filename= evil.exe.pdf")}`
    );
    expect(savedName(header)).toBe("x ; filename= evil.exe.pdf");
  });
});

describe("cleanPdfBaseName", () => {
  it("turns characters no file system accepts into spaces and collapses them", () => {
    expect(cleanPdfBaseName("Price list: 2026/Q3 <draft>")).toBe("Price list 2026 Q3 draft");
  });

  it("drops a .pdf the title already ends with, so it is not doubled", () => {
    expect(cleanPdfBaseName("Manual.PDF")).toBe("Manual");
  });

  it("caps the length by character, never splitting an emoji", () => {
    const long = "😀".repeat(200);
    const cut = cleanPdfBaseName(long);
    expect(Array.from(cut)).toHaveLength(120);
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });
});
