// Real pdf-lib, real Sarabun bytes off disk, real fontkit. The ONLY thing
// stubbed is `fetch` — the module fetches `/fonts/*.ttf` same-origin in the
// browser, and there is no server here, so the stub reads `public/fonts/`.
// pdf-lib itself is never mocked: every assertion below is about bytes that
// actually came out of `save()`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  loadThaiFont,
  wrapThai,
  clearThaiFontByteCache,
  ThaiFontLoadError,
  THAI_FONT_URLS,
  type TextMeasurer,
} from "@/app/lib/pdfFonts";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import PageOverlay from "@/app/tools/pdf-editor/PageOverlay";

/** PageOverlay only imports `pdfCoords`, but react-pdf sits in its module graph
 *  via the editor's types; stubbing it keeps jsdom from meeting pdfjs. */
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));

const PUBLIC_DIR = path.resolve(__dirname, "../../public");

function fontBytesFromDisk(url: string): ArrayBuffer {
  const buf = readFileSync(path.join(PUBLIC_DIR, url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function okResponse(body: ArrayBuffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body,
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearThaiFontByteCache();
  fetchSpy = vi.fn(async (input: unknown) => okResponse(fontBytesFromDisk(String(input))));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearThaiFontByteCache();
});

const THAI = "ที่ห้องเก็บเครื่องมือวัดอุณหภูมิ ๑๒๓ ABC";

describe("loadThaiFont", () => {
  it("embeds a real Sarabun that can measure and draw Thai, surviving a save/reload", async () => {
    const doc = await PDFDocument.create();
    const font = await loadThaiFont(doc, "regular");

    expect(font.name.toLowerCase()).toContain("sarabun");
    // The whole point: a WinAnsi font throws here, this one does not.
    expect(font.widthOfTextAtSize(THAI, 20)).toBeGreaterThan(0);

    const page = doc.addPage([595, 842]);
    page.drawText(THAI, { x: 50, y: 700, size: 20, font, color: rgb(0, 0, 0) });

    const bytes = await doc.save();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    // Reload proves the subset actually serialised into a valid document.
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("fetches the documented same-origin URL for each weight", async () => {
    const doc = await PDFDocument.create();
    await loadThaiFont(doc, "regular");
    expect(fetchSpy).toHaveBeenCalledWith(THAI_FONT_URLS.regular);
    expect(THAI_FONT_URLS.regular).toBe("/fonts/Sarabun_400Regular.ttf");
    expect(THAI_FONT_URLS.bold).toBe("/fonts/Sarabun_700Bold.ttf");
  });

  it("memoises per document and weight, embedding and fetching only once", async () => {
    const doc = await PDFDocument.create();
    const a = await loadThaiFont(doc, "regular");
    const b = await loadThaiFont(doc, "regular");

    expect(b).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns distinct fonts for regular and bold, both able to measure Thai", async () => {
    const doc = await PDFDocument.create();
    const regular = await loadThaiFont(doc, "regular");
    const bold = await loadThaiFont(doc, "bold");

    expect(bold).not.toBe(regular);
    expect(bold.widthOfTextAtSize(THAI, 20)).toBeGreaterThan(0);
    // Sarabun Bold is wider than Regular at the same size.
    expect(bold.widthOfTextAtSize(THAI, 20)).toBeGreaterThan(
      regular.widthOfTextAtSize(THAI, 20) * 0.9
    );
  });

  it("defaults to the regular weight", async () => {
    const doc = await PDFDocument.create();
    const implicit = await loadThaiFont(doc);
    const explicit = await loadThaiFont(doc, "regular");
    expect(implicit).toBe(explicit);
  });

  it("embeds separately into separate documents (a PDFFont belongs to one doc)", async () => {
    const docA = await PDFDocument.create();
    const docB = await PDFDocument.create();
    const a = await loadThaiFont(docA, "regular");
    const b = await loadThaiFont(docB, "regular");

    expect(b).not.toBe(a);
    // Bytes are cached across documents even though the PDFFont is not.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Each font really is usable in its own document.
    docA.addPage([200, 200]).drawText(THAI, { x: 10, y: 100, size: 12, font: a });
    docB.addPage([200, 200]).drawText(THAI, { x: 10, y: 100, size: 12, font: b });
    expect((await docA.save()).byteLength).toBeGreaterThan(1000);
    expect((await docB.save()).byteLength).toBeGreaterThan(1000);
  });

  it("only registers fontkit once per document even across weights", async () => {
    const doc = await PDFDocument.create();
    const spy = vi.spyOn(doc, "registerFontkit");
    await loadThaiFont(doc, "regular");
    await loadThaiFont(doc, "bold");
    await loadThaiFont(doc, "regular");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls share one embed", async () => {
    const doc = await PDFDocument.create();
    const [a, b, c] = await Promise.all([
      loadThaiFont(doc, "regular"),
      loadThaiFont(doc, "regular"),
      loadThaiFont(doc, "regular"),
    ]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("loadThaiFont failure modes — it must fail LOUDLY", () => {
  it("proves why: a WinAnsi standard font cannot even measure Thai", async () => {
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    expect(() => helvetica.widthOfTextAtSize("ที่", 12)).toThrow(/WinAnsi cannot encode/);
    const page = doc.addPage([200, 200]);
    expect(() => page.drawText("ที่", { x: 10, y: 10, font: helvetica })).toThrow(
      /WinAnsi cannot encode/
    );
  });

  it("throws ThaiFontLoadError on a non-OK response instead of falling back", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    const doc = await PDFDocument.create();

    await expect(loadThaiFont(doc, "regular")).rejects.toBeInstanceOf(ThaiFontLoadError);
    await expect(loadThaiFont(doc, "regular")).rejects.toThrow(/HTTP 404/);
  });

  it("throws ThaiFontLoadError when the network call itself rejects", async () => {
    fetchSpy.mockRejectedValue(new Error("Failed to fetch"));
    const doc = await PDFDocument.create();

    const err = await loadThaiFont(doc, "regular").catch((e) => e);
    expect(err).toBeInstanceOf(ThaiFontLoadError);
    expect(err.url).toBe(THAI_FONT_URLS.regular);
    expect(err.message).toContain("Failed to fetch");
  });

  it("rejects a 200 that is actually an HTML error page, not a font", async () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html>404</html>");
    fetchSpy.mockResolvedValue(
      okResponse(html.buffer.slice(0) as ArrayBuffer)
    );
    const doc = await PDFDocument.create();

    await expect(loadThaiFont(doc, "regular")).rejects.toThrow(/ไม่ใช่ฟอนต์/);
  });

  it("evicts the failure so a later attempt can still succeed", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    const doc = await PDFDocument.create();

    await expect(loadThaiFont(doc, "regular")).rejects.toBeInstanceOf(ThaiFontLoadError);

    const font = await loadThaiFont(doc, "regular");
    expect(font.widthOfTextAtSize(THAI, 12)).toBeGreaterThan(0);
  });

  it("rejects an unknown weight without touching the network", async () => {
    const doc = await PDFDocument.create();
    await expect(
      loadThaiFont(doc, "heavy" as unknown as "regular")
    ).rejects.toBeInstanceOf(ThaiFontLoadError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("carries a Thai message an admin can act on", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const doc = await PDFDocument.create();
    const err = await loadThaiFont(doc).catch((e) => e);
    expect(err.message).toContain("โหลดฟอนต์ภาษาไทยไม่สำเร็จ");
  });
});

// ---------------------------------------------------------------------------
// wrapThai — measured against the REAL embedded Sarabun, not a fake ruler.
// ---------------------------------------------------------------------------

describe("wrapThai", () => {
  let font: Awaited<ReturnType<typeof loadThaiFont>>;

  beforeEach(async () => {
    const doc = await PDFDocument.create();
    font = await loadThaiFont(doc, "regular");
  });

  const widthOf = (s: string, size: number) => font.widthOfTextAtSize(s, size);

  it("returns [] for empty text", () => {
    expect(wrapThai("", font, 12, 200)).toEqual([]);
  });

  it("leaves text that already fits on one line", () => {
    const text = "สวัสดี";
    const w = widthOf(text, 12);
    expect(wrapThai(text, font, 12, w + 10)).toEqual([text]);
  });

  it("wraps Thai that pdf-lib's own maxWidth could not — every line fits", () => {
    const text =
      "ที่ห้องเก็บเครื่องมือวัดอุณหภูมิและความชื้นสำหรับห้องปฏิบัติการทดสอบมาตรฐาน";
    const size = 14;
    const maxWidth = 120;

    // Baseline: unwrapped, this really is far too wide. That is the bug.
    expect(widthOf(text, size)).toBeGreaterThan(maxWidth * 3);

    const lines = wrapThai(text, font, size, maxWidth);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(widthOf(line, size)).toBeLessThanOrEqual(maxWidth);
    }
    // Nothing lost, nothing invented.
    expect(lines.join("")).toBe(text);
  });

  it("breaks at Thai word boundaries, not mid-word", () => {
    // Intl.Segmenter("th") segments this as ที่·ห้อง·เก็บ·เครื่อง·มือ·วัด·อุณหภูมิ
    const text = "ที่ห้องเก็บเครื่องมือวัดอุณหภูมิ";
    const lines = wrapThai(text, font, 14, 120);

    expect(lines.length).toBeGreaterThan(1);
    const words = ["ที่", "ห้อง", "เก็บ", "เครื่อง", "มือ", "วัด", "อุณหภูมิ"];
    for (const line of lines) {
      // Each emitted line is a whole number of segmenter words.
      let rest = line;
      while (rest.length > 0) {
        const hit = words.find((w) => rest.startsWith(w));
        expect(hit, `line "${line}" broke inside a word at "${rest}"`).toBeTruthy();
        rest = rest.slice(hit!.length);
      }
    }
  });

  it("packs greedily — a wider line holds fewer breaks", () => {
    const text =
      "ที่ห้องเก็บเครื่องมือวัดอุณหภูมิและความชื้นสำหรับห้องปฏิบัติการทดสอบมาตรฐาน";
    const narrow = wrapThai(text, font, 14, 100);
    const wide = wrapThai(text, font, 14, 300);
    expect(wide.length).toBeLessThan(narrow.length);
  });

  it("hard-breaks a single segment longer than the whole line", () => {
    const long = "อุณหภูมิ".repeat(12);
    const size = 14;
    const maxWidth = 60;

    const lines = wrapThai(long, font, size, maxWidth);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(widthOf(line, size)).toBeLessThanOrEqual(maxWidth);
    }
    expect(lines.join("")).toBe(long);
  });

  it("keeps a Thai combining mark attached to its base when hard-breaking", () => {
    // ที่ = ท + สระอิ (U+0E34) + ไม้เอก (U+0E48). A code-unit split would
    // strand the marks at the start of a line.
    const long = "ที่".repeat(40);
    const lines = wrapThai(long, font, 14, 30);

    const COMBINING = /[ัิ-ฺ็-๎]/;
    for (const line of lines) {
      expect(COMBINING.test(line[0]), `line starts with a bare mark: ${line}`).toBe(
        false
      );
    }
    expect(lines.join("")).toBe(long);
  });

  it("emits a very narrow line rather than looping forever", () => {
    const lines = wrapThai("อุณหภูมิ", font, 14, 0.5);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("อุณหภูมิ");
  });

  it("handles text mixing Thai and Latin", () => {
    const text = "เครื่องวัด Model ABC-123 ของ Fluke Corporation ที่ห้องแล็บ";
    const size = 12;
    const maxWidth = 110;
    const lines = wrapThai(text, font, size, maxWidth);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(widthOf(line, size)).toBeLessThanOrEqual(maxWidth);
    }
    // Only the whitespace consumed by a break may go missing.
    expect(lines.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });

  it("wraps pure Latin on spaces without splitting words", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const lines = wrapThai(text, font, 12, 90);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith(" ")).toBe(false);
      expect(line.endsWith(" ")).toBe(false);
      expect(widthOf(line, 12)).toBeLessThanOrEqual(90);
    }
    expect(lines.join(" ")).toBe(text);
  });

  it("honours explicit newlines as hard breaks and keeps blank lines", () => {
    expect(wrapThai("บรรทัดหนึ่ง\nบรรทัดสอง", font, 12, 500)).toEqual([
      "บรรทัดหนึ่ง",
      "บรรทัดสอง",
    ]);
    expect(wrapThai("ก\n\nข", font, 12, 500)).toEqual(["ก", "", "ข"]);
  });

  it("normalises CRLF", () => {
    expect(wrapThai("ก\r\nข", font, 12, 500)).toEqual(["ก", "ข"]);
    expect(wrapThai("ก\rข", font, 12, 500)).toEqual(["ก", "ข"]);
  });

  it("does not wrap when maxWidthPt is unusable", () => {
    const text = "ที่ห้องเก็บเครื่องมือวัดอุณหภูมิ";
    expect(wrapThai(text, font, 14, 0)).toEqual([text]);
    expect(wrapThai(text, font, 14, -5)).toEqual([text]);
    expect(wrapThai(text, font, 14, Number.NaN)).toEqual([text]);
    expect(wrapThai(text, font, 14, Number.POSITIVE_INFINITY)).toEqual([text]);
  });

  it("keeps a whitespace-only paragraph from producing a stray indent", () => {
    expect(wrapThai("   ", font, 12, 100)).toEqual([""]);
  });

  // These two are the regression. `commitTextDraft` used to `.trim()` the
  // admin's text, so typed indentation vanished on confirm. Removing that trim
  // was not enough: the wrapper dropped a leading-whitespace segment on every
  // line, including the first, so the fix simply moved the trim here and the
  // PDF still disagreed with the preview (which renders `whitespace-pre-wrap`).
  it("keeps indentation the admin typed at the START of a paragraph", () => {
    expect(wrapThai("    รายการ", font, 12, 1000)).toEqual(["    รายการ"]);
    expect(wrapThai("  Hello", font, 12, 1000)).toEqual(["  Hello"]);
  });

  it("keeps trailing whitespace on the LAST line, which shifts a centred line", () => {
    expect(wrapThai("รายการ  ", font, 12, 1000)).toEqual(["รายการ  "]);
  });

  it("still drops the whitespace that a WRAP lands on, so no line is indented by the break", () => {
    // 10pt per character makes the break point checkable by hand.
    const ruler: TextMeasurer = {
      widthOfTextAtSize: (t, size) => t.length * size,
    };
    // "  aaa bbb" — the two leading spaces are the author's and survive; the
    // space between aaa and bbb is the break and must not indent line 2.
    expect(wrapThai("  aaa bbb", ruler, 1, 5)).toEqual(["  aaa", "bbb"]);
  });

  it("works with any measurer, not just PDFFont", () => {
    // 10pt per character, so the arithmetic is checkable by hand.
    const ruler: TextMeasurer = {
      widthOfTextAtSize: (t, size) => t.length * size,
    };
    expect(wrapThai("aaa bbb ccc", ruler, 1, 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapThai("aaa bbb ccc", ruler, 1, 3)).toEqual(["aaa", "bbb", "ccc"]);
    expect(wrapThai("abcdefgh", ruler, 1, 3)).toEqual(["abc", "def", "gh"]);
  });
});

// ---------------------------------------------------------------------------
// Preview vs export: the same text must land in the same place on screen and
// in the downloaded PDF, for left, centre and right.
//
// A reviewer put it to us that `white-space: pre-wrap` HANGS trailing spaces
// instead of counting them toward alignment, which would make the trailing
// space `wrapThai` deliberately keeps a preview/PDF divergence. It does not, in
// this markup. Measured in headless Chromium against the overlay's real CSS
// (a `pre-wrap` span in a 200px box, 16px sans-serif, one space = 4.45px):
//
//   "abc   " right-aligned   line box [160.86, 200]   glyphs end at 186.66
//   "ab  \ncd" centred       line 1 [86.66, 113.34] — the 2 spaces are inside
//   "aaaa bbbb" right, 60px  "aaaa" ends at 60, the WRAP space hangs to 64.45
//
// So the browser counts a trailing space that a newline or the end of the text
// ends, and hangs only the one a soft wrap lands on — exactly the split
// `wrapParagraph` implements. What did NOT line up was alignment of a wrapped
// block, and that was the preview's fault: see the PageOverlay test below.
// ---------------------------------------------------------------------------

/** The export's own arithmetic, from `drawTextAnnotation` in pdfApplyEdits.ts. */
function lineOffset(
  lineWidth: number,
  frameWidth: number,
  align: "left" | "center" | "right"
): number {
  if (align === "center") return (frameWidth - lineWidth) / 2;
  if (align === "right") return frameWidth - lineWidth;
  return 0;
}

describe("wrapThai — what the export then does with the lines", () => {
  let font: Awaited<ReturnType<typeof loadThaiFont>>;

  beforeEach(async () => {
    const doc = await PDFDocument.create();
    font = await loadThaiFont(doc, "regular");
  });

  const SIZE = 12;
  const FRAME = 300;
  const w = (s: string) => font.widthOfTextAtSize(s, SIZE);

  it("lets a trailing space shift a centred and a right-aligned line, exactly as the preview does", () => {
    const typed = "รายการ  ";
    const [line] = wrapThai(typed, font, SIZE, FRAME);
    expect(line).toBe(typed);

    const spaces = w(typed) - w("รายการ");
    expect(spaces).toBeGreaterThan(0);

    // Where the last GLYPH ends: offset of the line + width of its visible part.
    const glyphEnd = (align: "left" | "center" | "right") =>
      lineOffset(w(line), FRAME, align) + w("รายการ");

    expect(glyphEnd("left")).toBeCloseTo(w("รายการ"), 5);
    // Right: the text stops one trailing space short of the right edge — which
    // is where the browser puts it too, because the space is inside the line
    // box that `text-align: right` pushes flush.
    expect(glyphEnd("right")).toBeCloseTo(FRAME - spaces, 5);
    // Centre: half a space short of centre.
    expect(glyphEnd("center")).toBeCloseTo((FRAME + w("รายการ")) / 2 - spaces / 2, 5);

    // This is the bite: stripping the trailing space (what `.trim()` used to do,
    // and what the reviewer's reading would have us restore) moves the glyphs.
    expect(glyphEnd("right")).toBeLessThan(
      lineOffset(w("รายการ"), FRAME, "right") + w("รายการ")
    );
  });

  it("does not let the space a WRAP lands on push a line off its alignment", () => {
    // 10pt per character: "aaa bbb" at width 5 breaks after "aaa".
    const ruler: TextMeasurer = { widthOfTextAtSize: (t, size) => t.length * size };
    const lines = wrapThai("aaa bbb", ruler, 1, 5);
    expect(lines).toEqual(["aaa", "bbb"]);

    for (const align of ["left", "center", "right"] as const) {
      for (const line of lines) {
        const width = ruler.widthOfTextAtSize(line, 1);
        const end = lineOffset(width, 10, align) + width;
        // Flush against the edge the alignment picks, with no phantom space —
        // the browser hangs that space outside the line box, so it must not be
        // measured here either.
        expect(end).toBeCloseTo(align === "left" ? 3 : align === "center" ? 6.5 : 10, 5);
      }
    }
  });

  it("keeps a right-aligned line flush right even when the admin indented it", () => {
    const lines = wrapThai("    รายการ", font, SIZE, FRAME);
    expect(lines).toEqual(["    รายการ"]);
    // The indent is inside the line, so the text still ends at the right edge
    // and the gap shows up on the left — same as `text-align: right` on a
    // `pre-wrap` span, which never hangs LEADING space.
    expect(lineOffset(w(lines[0]), FRAME, "right") + w(lines[0])).toBeCloseTo(FRAME, 5);
    expect(lineOffset(w(lines[0]), FRAME, "left")).toBe(0);
  });

  it("gives a whitespace-only paragraph no offset to carry", () => {
    const lines = wrapThai("ก\n   \nข", font, SIZE, FRAME);
    expect(lines).toEqual(["ก", "", "ข"]);
    // "" is skipped by the export; were the spaces kept, a centred block would
    // have a blank line sticking out to the left of the two real ones.
    expect(w(lines[1])).toBe(0);
  });

  it("aligns EVERY line on its own, so a ragged wrapped block is not a block", () => {
    const ruler: TextMeasurer = { widthOfTextAtSize: (t, size) => t.length * size };
    const lines = wrapThai("aaaa\nbb", ruler, 1, 10);
    expect(lines).toEqual(["aaaa", "bb"]);

    const dx = (line: string, align: "left" | "center" | "right") =>
      lineOffset(ruler.widthOfTextAtSize(line, 1), 10, align);

    expect([dx(lines[0], "center"), dx(lines[1], "center")]).toEqual([3, 4]);
    expect([dx(lines[0], "right"), dx(lines[1], "right")]).toEqual([6, 8]);
    // The short line is NOT left-aligned under the long one. The preview used
    // to draw it that way; PageOverlay now matches this.
    expect(dx(lines[1], "center")).not.toBe(dx(lines[0], "center"));
  });
});

// ---------------------------------------------------------------------------
// The preview half of the same contract. It lives here, next to the arithmetic
// it has to agree with, because this pair of assertions IS the fix: the export
// offsets each line inside the whole rectangle, so the overlay has to align
// each line inside the whole rectangle too — a shrink-to-fit span justified by
// its flex parent centres the BLOCK and leaves the lines ragged-left inside it.
// jsdom does no layout, so what is checked is the markup that produces the
// layout: a full-width span carrying `text-align`, not a parent carrying
// `justify-content`.
// ---------------------------------------------------------------------------

describe("PageOverlay — a text annotation's preview markup", () => {
  const ALIGNS = ["left", "center", "right"] as const;

  /** jsdom measures every element as 0x0, and a zero-size box makes the overlay
   *  render no annotations at all (`ready` is false). This is that measurement. */
  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 600,
      bottom: 600,
      width: 600,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    rectSpy.mockRestore();
  });

  function renderText(align: (typeof ALIGNS)[number]) {
    const ann = {
      kind: "text" as const,
      id: `txt_${align}`,
      pageId: "pg_1",
      rect: { x: 40, y: 40, width: 200, height: 80 },
      text: "  บรรทัดที่หนึ่ง\nสอง  ",
      sizePt: 14,
      color: { r: 0, g: 0, b: 0 },
      bold: false,
      align,
      angleDeg: 0,
    };
    const { container } = render(
      createElement(PageOverlay, {
        pageId: "pg_1",
        widthPt: 600,
        heightPt: 600,
        rotation: 0,
        annotations: [ann],
        assetUrls: {},
        tool: "select",
        selectedAnnotationId: null,
        pageProxy: null,
        onSelectAnnotation: () => {},
        onCreateRect: () => {},
        onCommitRect: () => {},
      })
    );
    const span = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === ann.text
    );
    expect(span, "the annotation's text span is not in the overlay").toBeTruthy();
    return { span: span as HTMLSpanElement, parent: (span as HTMLSpanElement).parentElement! };
  }

  for (const align of ALIGNS) {
    it(`aligns each line inside the full rectangle when align is "${align}"`, () => {
      const { span, parent } = renderText(align);

      // Per-line alignment, over the rectangle's whole width.
      expect(span.style.textAlign).toBe(align);
      expect(span.className).toContain("w-full");
      // ...and NOT block alignment, which is what put a wrapped centred
      // annotation in a different place on screen than in the PDF.
      expect(parent.style.justifyContent).toBe("");
      // Still the whitespace mode the wrapper's leading/trailing rules assume.
      expect(span.className).toContain("whitespace-pre-wrap");
    });
  }

  it("renders the admin's leading and trailing spaces verbatim", () => {
    const { span } = renderText("center");
    expect(span.textContent).toBe("  บรรทัดที่หนึ่ง\nสอง  ");
  });
});
