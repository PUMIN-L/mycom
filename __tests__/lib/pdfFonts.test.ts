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
