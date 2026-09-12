// Thai font loading + Thai-aware line breaking for the browser PDF editor.
//
// THIS IS THE ONLY PLACE IN THE BUILD THAT OBTAINS A FONT. Nothing else may
// call `pdfDoc.embedFont`. The reason is that pdf-lib's built-in fonts are
// WinAnsi-encoded, and WinAnsi cannot represent a single Thai character:
// BOTH `page.drawText` AND `font.widthOfTextAtSize` throw
//   `WinAnsi cannot encode "ท" (0x0e17)`
// So there is no degraded mode and no partial success — either the Sarabun
// bytes are embedded, or the operation must fail loudly. A silent fallback to
// Helvetica produces one of two outcomes, both worse than an error message:
// a crash deep inside `save()`, or a PDF whose text is simply invisible.
//
// The .ttf files live in `public/fonts/` and are served same-origin, which is
// what the enforcing CSP in next.config.ts (`connect-src 'self'`) allows.
// next/font cannot supply these bytes — it hands back CSS, not an ArrayBuffer.
//
// No DOM here: this module touches `fetch` and nothing else. No document,
// window, File, Blob or URL.

import type { PDFDocument, PDFFont } from "pdf-lib";

export type ThaiFontWeight = "regular" | "bold";

/** Same-origin URLs of the two Sarabun weights shipped in `public/fonts/`. */
export const THAI_FONT_URLS: Readonly<Record<ThaiFontWeight, string>> = {
  regular: "/fonts/Sarabun_400Regular.ttf",
  bold: "/fonts/Sarabun_700Bold.ttf",
};

/**
 * Thrown when the Thai font cannot be fetched, is not a real font file, or
 * cannot be embedded. Callers MUST surface this to the admin rather than
 * carrying on — see the file header for why there is no fallback.
 *
 * `message` is Thai because it is shown in the editor UI verbatim.
 */
export class ThaiFontLoadError extends Error {
  readonly url: string;
  /** The underlying failure, when there was one (network error, parse error). */
  readonly detail: string;

  constructor(url: string, detail: string) {
    super(`โหลดฟอนต์ภาษาไทยไม่สำเร็จ (${url}) — ${detail}`);
    this.name = "ThaiFontLoadError";
    this.url = url;
    this.detail = detail;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Raw font bytes
// ---------------------------------------------------------------------------

/**
 * Cache of downloaded font bytes, keyed by URL. Shared across documents —
 * the same ~81KB does not need re-fetching for every PDF the admin opens.
 * A rejected fetch is evicted so a later attempt can retry.
 */
const byteCache = new Map<string, Promise<ArrayBuffer>>();

/**
 * A file that starts with one of these is a real sfnt/WOFF font. We check
 * because a dev server (or a misconfigured deploy) answers a missing
 * `/fonts/*.ttf` with a 200 and an HTML error page, and handing THAT to
 * fontkit produces an unreadable stack trace instead of "the font is missing".
 */
function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === "true" || tag === "ttcf" || tag === "OTTO" || tag === "wOFF") {
    return true;
  }
  // TrueType: 0x00010000 — the magic the shipped Sarabun files actually carry.
  return (
    bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00
  );
}

async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const cached = byteCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new ThaiFontLoadError(url, `เชื่อมต่อไม่ได้: ${describe(err)}`);
    }
    if (!res.ok) {
      throw new ThaiFontLoadError(url, `เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    if (!looksLikeFont(new Uint8Array(buffer))) {
      throw new ThaiFontLoadError(
        url,
        `ไฟล์ที่ได้ไม่ใช่ฟอนต์ (${buffer.byteLength} ไบต์)`
      );
    }
    return buffer;
  })();

  byteCache.set(
    url,
    pending.catch((err) => {
      byteCache.delete(url);
      throw err;
    })
  );
  return byteCache.get(url)!;
}

// ---------------------------------------------------------------------------
// Per-document embedding
// ---------------------------------------------------------------------------

/**
 * Embedded fonts are per-document objects, so the memo has to be keyed by
 * document as well as weight. A WeakMap means a discarded PDFDocument (every
 * undo/redo in the editor builds a new one) does not pin its font.
 */
const docCache = new WeakMap<PDFDocument, Map<ThaiFontWeight, Promise<PDFFont>>>();
const fontkitRegistered = new WeakSet<PDFDocument>();

/**
 * Embed Sarabun into `pdfDoc` and return the PDFFont, memoised per document
 * and weight. Registers fontkit on the document exactly once (pdf-lib needs it
 * before `embedFont` will accept a .ttf at all).
 *
 * @throws {ThaiFontLoadError} if the font cannot be fetched or embedded.
 *   Do not catch this and fall back to a standard font — see the file header.
 */
export async function loadThaiFont(
  pdfDoc: PDFDocument,
  weight: ThaiFontWeight = "regular"
): Promise<PDFFont> {
  const url = THAI_FONT_URLS[weight];
  if (!url) {
    throw new ThaiFontLoadError(String(weight), "ไม่รู้จักน้ำหนักฟอนต์ที่ขอมา");
  }

  let perDoc = docCache.get(pdfDoc);
  if (!perDoc) {
    perDoc = new Map();
    docCache.set(pdfDoc, perDoc);
  }
  const existing = perDoc.get(weight);
  if (existing) return existing;

  const pending = embedThaiFont(pdfDoc, url).catch((err) => {
    // Evict on failure so a retry (e.g. after the network comes back) is possible.
    perDoc!.delete(weight);
    throw err;
  });
  perDoc.set(weight, pending);
  return pending;
}

async function embedThaiFont(pdfDoc: PDFDocument, url: string): Promise<PDFFont> {
  const buffer = await fetchFontBytes(url);

  if (!fontkitRegistered.has(pdfDoc)) {
    // Dynamic so fontkit stays out of every bundle that never edits a PDF.
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    pdfDoc.registerFontkit(fontkit);
    fontkitRegistered.add(pdfDoc);
  }

  try {
    // A fresh copy per embed: the cached ArrayBuffer is handed out repeatedly
    // and must never be the buffer a consumer might detach or mutate.
    return await pdfDoc.embedFont(new Uint8Array(buffer.slice(0)), {
      subset: true,
    });
  } catch (err) {
    throw new ThaiFontLoadError(url, `ฝังฟอนต์ลงไฟล์ PDF ไม่สำเร็จ: ${describe(err)}`);
  }
}

/** Drop the cached font bytes. Exists for tests; harmless in production. */
export function clearThaiFontByteCache(): void {
  byteCache.clear();
}

// ---------------------------------------------------------------------------
// Thai-aware line breaking
// ---------------------------------------------------------------------------

/** The slice of PDFFont that wrapThai needs. PDFFont satisfies it. */
export interface TextMeasurer {
  widthOfTextAtSize(text: string, size: number): number;
}

let wordSegmenter: Intl.Segmenter | null | undefined;
let graphemeSegmenter: Intl.Segmenter | null | undefined;

function segmentWords(text: string): string[] {
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter =
        typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
          ? new Intl.Segmenter("th", { granularity: "word" })
          : null;
    } catch {
      wordSegmenter = null;
    }
  }
  if (!wordSegmenter) {
    // Whitespace-only fallback. Thai will not wrap, but nothing crashes.
    return text.match(/\s+|\S+/g) ?? [];
  }
  const out: string[] = [];
  for (const { segment } of wordSegmenter.segment(text)) out.push(segment);
  return out;
}

function segmentGraphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    try {
      graphemeSegmenter =
        typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
          ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
          : null;
    } catch {
      graphemeSegmenter = null;
    }
  }
  // Graphemes, not code units: Thai combining marks (U+0E31, U+0E34–U+0E3A,
  // U+0E47–U+0E4E) are non-spacing marks, so grapheme segmentation keeps each
  // one glued to the consonant it sits on. Splitting by code unit would strand
  // a lone สระอิ at the start of a line.
  if (!graphemeSegmenter) return Array.from(text);
  const out: string[] = [];
  for (const { segment } of graphemeSegmenter.segment(text)) out.push(segment);
  return out;
}

function isBlank(segment: string): boolean {
  return segment.trim().length === 0;
}

/**
 * Break a single over-long segment (a URL, a run of Thai with no word
 * boundary the segmenter recognises) into chunks that each fit `maxWidthPt`.
 * A single grapheme wider than the line is emitted alone rather than looping
 * forever.
 */
function hardBreak(
  segment: string,
  width: (s: string) => number,
  maxWidthPt: number
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const grapheme of segmentGraphemes(segment)) {
    const candidate = current + grapheme;
    if (current !== "" && width(candidate) > maxWidthPt) {
      chunks.push(current);
      current = grapheme;
    } else {
      current = candidate;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks.length > 0 ? chunks : [segment];
}

function wrapParagraph(
  paragraph: string,
  width: (s: string) => number,
  maxWidthPt: number
): string[] {
  const lines: string[] = [];
  let line = "";

  // A paragraph made only of whitespace is a BLANK LINE, not an indent with
  // nothing after it — collapse it so a spacer line cannot carry a phantom
  // offset into a centred or right-aligned block.
  if (isBlank(paragraph)) return [""];

  for (const segment of segmentWords(paragraph)) {
    // Whitespace at the start of a WRAPPED line is the break itself, and
    // keeping it would indent every continuation line. Whitespace at the start
    // of the PARAGRAPH is different: it is indentation the admin typed, it is
    // visible in the preview (which renders `whitespace-pre-wrap`), and
    // dropping it here is what made the PDF disagree with what was on screen.
    // `lines.length > 0` is the difference between the two: nothing has been
    // emitted yet only at the very start of the paragraph.
    if (line === "" && lines.length > 0 && isBlank(segment)) continue;

    const candidate = line + segment;
    if (width(candidate) <= maxWidthPt) {
      line = candidate;
      continue;
    }

    if (line !== "") {
      lines.push(line.replace(/\s+$/, ""));
      line = "";
      if (isBlank(segment)) continue;
    }

    if (width(segment) <= maxWidthPt) {
      line = segment;
      continue;
    }

    const chunks = hardBreak(segment, width, maxWidthPt);
    for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]);
    line = chunks[chunks.length - 1];
  }

  // The LAST line keeps its trailing whitespace: unlike the strip at a wrap
  // point above (where the space IS the break), trailing space here is text the
  // admin typed. It is invisible when left-aligned but shifts a centred or
  // right-aligned line, and the preview already renders it.
  if (line !== "") lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/**
 * Wrap `text` to `maxWidthPt` and return the lines.
 *
 * WHY THIS EXISTS AT ALL: pdf-lib's own `drawText({ maxWidth })` cannot wrap
 * Thai. It breaks on `doc.defaultWordBreaks`, which is `[" "]`, and Thai does
 * not put spaces between words — so it hands back ONE enormous line that runs
 * straight off the page. We segment with `Intl.Segmenter("th", { granularity:
 * "word" })` instead, pack greedily by measured width, and emit the breaks
 * ourselves. The caller then draws the lines (joined with "\n", or one at a
 * time when it needs per-line alignment) and never passes `maxWidth`.
 *
 * Pure arithmetic over `font.widthOfTextAtSize` — no PDF is touched.
 *
 * Existing "\n" in `text` are honoured as hard paragraph breaks, and a blank
 * line stays a blank line.
 *
 * @param text        The text to wrap. "" yields [].
 * @param font        Any object with `widthOfTextAtSize`; in practice the
 *                    embedded Sarabun PDFFont, which is the only font that can
 *                    measure Thai at all.
 * @param sizePt      Font size in points.
 * @param maxWidthPt  Line width in points. Non-finite or <= 0 disables
 *                    wrapping (paragraphs are returned as-is).
 */
export function wrapThai(
  text: string,
  font: TextMeasurer,
  sizePt: number,
  maxWidthPt: number
): string[] {
  if (typeof text !== "string" || text.length === 0) return [];

  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");

  if (!Number.isFinite(maxWidthPt) || maxWidthPt <= 0) return paragraphs;

  const width = (s: string) => (s === "" ? 0 : font.widthOfTextAtSize(s, sizePt));

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    lines.push(...wrapParagraph(paragraph, width, maxWidthPt));
  }
  return lines;
}
