// Real pdf-lib, real Sarabun bytes off disk, real fontkit. The only thing
// stubbed is `fetch`, because pdfFonts downloads the font same-origin and there
// is no server here. Nothing about pdf-lib is mocked.
//
// EVERY ASSERTION IS ABOUT THE OUTPUT BYTES. Each test builds a source PDF,
// runs `applyEdits`, RELOADS what came back, and reads the drawn geometry out
// of the page's content stream. That is the only way to catch the failure this
// module exists to prevent: an editor that places everything half an inch off
// looks like it works, and its unit tests pass, right up until the admin prints
// the file.
//
// THE COORDINATE CONTRACT UNDER TEST
//   The overlay converts a drag through the pdfjs viewport matrix
//   (`pdfCoords.screenRectToPdfRect`) into ABSOLUTE PDF user space — points,
//   bottom-left origin, unrotated, CropBox origin included — and `applyEdits`
//   draws with those numbers untouched. At /Rotate 90 and 270 that matrix is a
//   REFLECTION, so the check below does the whole loop: screen -> PDF -> bytes
//   -> reload -> screen, and demands the box come back where the pointer was.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { inflateSync } from "zlib";
import path from "path";
import { PDFDocument, PDFName, PDFNumber, PDFArray, PDFRawStream } from "pdf-lib";
import {
  applyEdits,
  PdfNoPagesError,
  PdfMissingSourceError,
  PdfMissingAssetError,
  PdfPageIndexError,
  PdfUnsupportedImageError,
} from "@/app/lib/pdfApplyEdits";
import {
  createModel,
  effectiveRotation,
  emptyModel,
  mergeSource,
} from "@/app/lib/pdfEditModel";
import {
  makeViewport,
  pdfRectToScreenRect,
  screenRectToPdfRect,
  type BoxArray,
  type ScreenBox,
} from "@/app/lib/pdfCoords";
import { clearThaiFontByteCache } from "@/app/lib/pdfFonts";
import type { Annotation, EditModel, Rect, Rotation } from "@/app/lib/pdfTypes";

const PUBLIC_DIR = path.resolve(__dirname, "../../public");

/** A Node `Buffer` is a foreign-realm view under jsdom and pdf-lib rejects it
 *  with "was actually of type NaN" — the trap `pdfBytes.toBytes` closes. */
function readAsBytes(relative: string): Uint8Array {
  const buf = readFileSync(path.join(PUBLIC_DIR, relative));
  return new Uint8Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

beforeEach(() => {
  clearThaiFontByteCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const bytes = readAsBytes(String(input));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
      } as unknown as Response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearThaiFontByteCache();
});

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const CROP_W = 400;
const CROP_H = 600;

/**
 * A one-page PDF with a given `/Rotate` and a CropBox that may start away from
 * (0,0) — a print-ready file with bleed does exactly that, and it is the setup
 * that silently shifts every placement if the origin is dropped anywhere in the
 * pipeline. A 40x40 square near the crop's bottom-left marks the page so a test
 * can tell the source's own content from what the editor drew.
 */
async function buildSource(
  rotate: Rotation,
  origin: { x: number; y: number } = { x: 0, y: 0 }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([CROP_W + origin.x * 2, CROP_H + origin.y * 2]);
  page.node.set(
    PDFName.of("CropBox"),
    doc.context.obj([origin.x, origin.y, origin.x + CROP_W, origin.y + CROP_H])
  );
  page.node.set(PDFName.of("Rotate"), PDFNumber.of(rotate));
  page.drawRectangle({ x: origin.x + 10, y: origin.y + 10, width: 40, height: 40 });
  return doc.save();
}

/** The smallest valid PNG: 1x1, opaque. */
const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01,
  0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

/* ------------------------------------------------------------------ *
 * Reading the output back
 * ------------------------------------------------------------------ */

function streamText(stream: unknown): string {
  const s = stream as {
    getContents?: () => Uint8Array;
    dict?: { get?: (k: unknown) => unknown };
  } | null;
  const raw = s?.getContents ? s.getContents() : null;
  if (!raw) return "";
  const buf = Buffer.from(raw);
  const filter = String(s?.dict?.get?.(PDFName.of("Filter")) ?? "");
  if (!/FlateDecode/.test(filter)) return buf.toString("latin1");
  try {
    return inflateSync(buf).toString("latin1");
  } catch {
    return "";
  }
}

function pageContent(doc: PDFDocument, index: number): string {
  const ctx = doc.context;
  const resolved = ctx.lookup(doc.getPages()[index].node.get(PDFName.of("Contents")));
  const parts =
    resolved instanceof PDFArray
      ? Array.from({ length: resolved.size() }, (_, i) => ctx.lookup(resolved.get(i)))
      : [resolved];
  return parts.map(streamText).join("\n");
}

type M6 = [number, number, number, number, number, number];

/**
 * Every filled path in the stream, as an axis-aligned box in ABSOLUTE user
 * space — the `cm` matrices in force are composed and applied, so a rectangle
 * pdf-lib emitted as `translate + rotate + 0 0 w h path` comes back as the
 * rectangle the admin actually sees. (pdf-lib draws rectangles as `m`/`l`
 * paths, not as the `re` operator, so both are read.)
 */
function filledBoxes(content: string): Rect[] {
  const tokens = content.split(/\s+/).filter(Boolean);
  const mul = (m: M6, n: M6): M6 => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
  let ctm: M6 = [1, 0, 0, 1, 0, 0];
  const stack: M6[] = [];
  const points: Array<{ x: number; y: number }> = [];
  const out: Rect[] = [];

  const at = (px: number, py: number) => ({
    x: ctm[0] * px + ctm[2] * py + ctm[4],
    y: ctm[1] * px + ctm[3] * py + ctm[5],
  });

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "q") stack.push([...ctm] as M6);
    else if (t === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (t === "cm") {
      const n = tokens.slice(i - 6, i).map(Number) as M6;
      if (n.every(Number.isFinite)) ctm = mul(n, ctm);
    } else if (t === "re") {
      const [x, y, w, h] = tokens.slice(i - 4, i).map(Number);
      if ([x, y, w, h].every(Number.isFinite)) points.push(at(x, y), at(x + w, y + h));
    } else if (t === "m" || t === "l") {
      const [x, y] = tokens.slice(i - 2, i).map(Number);
      if ([x, y].every(Number.isFinite)) points.push(at(x, y));
    } else if ((t === "f" || t === "f*" || t === "B") && points.length) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      out.push({
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      });
      points.length = 0;
    }
  }
  return out;
}

/** The Error a rejected `applyEdits` produced. Fails loudly if it resolved —
 *  a silent pass here would mean the refusal under test has stopped happening. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected applyEdits to reject, but it resolved");
}

function expectRectClose(actual: Rect | undefined, expected: Rect) {
  expect(actual).toBeDefined();
  expect(actual!.x).toBeCloseTo(expected.x, 1);
  expect(actual!.y).toBeCloseTo(expected.y, 1);
  expect(actual!.width).toBeCloseTo(expected.width, 1);
  expect(actual!.height).toBeCloseTo(expected.height, 1);
}

/* ------------------------------------------------------------------ *
 * The round trip
 * ------------------------------------------------------------------ */

/** Mirrors what `PageOverlay` builds: the viewport pdfjs rendered with, whose
 *  `viewBox` is `page.view` — i.e. the CropBox, origin included. */
function overlayViewport(rotation: Rotation, origin: { x: number; y: number }) {
  const viewBox: BoxArray = [
    origin.x,
    origin.y,
    origin.x + CROP_W,
    origin.y + CROP_H,
  ];
  return makeViewport(CROP_W, CROP_H, rotation, 1, viewBox);
}

describe("applyEdits — the coordinate round trip", () => {
  // A quarter turn at a time, with and without a CropBox that starts away from
  // the origin. At 90 and 270 the viewport matrix is a reflection; a placement
  // derived from one corner plus width/height comes out mirrored, and only a
  // check that reloads the OUTPUT can see it.
  const rotations: Rotation[] = [0, 90, 180, 270];
  const origins = [
    { x: 0, y: 0 },
    { x: 37, y: 53 },
  ];

  for (const rotation of rotations) {
    for (const origin of origins) {
      it(`puts a dragged box back where the pointer was — /Rotate ${rotation}, CropBox origin (${origin.x},${origin.y})`, async () => {
        const source = await buildSource(rotation, origin);
        const model = createModel("src", [
          { widthPt: CROP_W, heightPt: CROP_H, baseRotation: rotation },
        ]);
        const page = model.pages[0];

        const vp = overlayViewport(rotation, origin);
        // The canvas is the viewport times a zoom, in CSS pixels — the overlay
        // measures it with getBoundingClientRect and scales through it, which
        // is what makes the maths independent of devicePixelRatio.
        const zoom = 1.7;
        const box: ScreenBox = {
          left: 0,
          top: 0,
          width: vp.width * zoom,
          height: vp.height * zoom,
        };
        const from = { x: box.width * 0.1, y: box.height * 0.1 };
        const to = { x: box.width * 0.4, y: box.height * 0.25 };
        const rect = screenRectToPdfRect(from, to, box, vp);

        // The converted rectangle must sit inside the visible page.
        expect(rect.x).toBeGreaterThanOrEqual(origin.x - 0.01);
        expect(rect.y).toBeGreaterThanOrEqual(origin.y - 0.01);
        expect(rect.x + rect.width).toBeLessThanOrEqual(origin.x + CROP_W + 0.01);
        expect(rect.y + rect.height).toBeLessThanOrEqual(origin.y + CROP_H + 0.01);

        const withBox: EditModel = {
          ...model,
          annotations: [{ kind: "whiteout", id: "a1", pageId: page.id, rect }],
        };
        const outBytes = await applyEdits({ sources: { src: source }, model: withBox });

        // RELOAD THE OUTPUT — not the model, not the input.
        const out = await PDFDocument.load(outBytes);
        const outPage = out.getPages()[0];

        expect(outPage.getRotation().angle).toBe(effectiveRotation(page));
        const crop = outPage.getCropBox();
        expect(crop.x).toBeCloseTo(origin.x, 2);
        expect(crop.y).toBeCloseTo(origin.y, 2);
        expect(crop.width).toBeCloseTo(CROP_W, 2);

        // The whiteout is drawn after the source's own 40x40 marker.
        const boxes = filledBoxes(pageContent(out, 0));
        expectRectClose(boxes[boxes.length - 1], rect);

        // And the whole loop closes: rebuild the viewport a reader would use
        // for the OUTPUT and map the drawn rectangle back onto the screen.
        const outVp = makeViewport(
          crop.width,
          crop.height,
          outPage.getRotation().angle,
          1,
          [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height] as BoxArray
        );
        const outBox: ScreenBox = {
          left: 0,
          top: 0,
          width: outVp.width * zoom,
          height: outVp.height * zoom,
        };
        const back = pdfRectToScreenRect(boxes[boxes.length - 1], outBox, outVp);
        expect(back.x).toBeCloseTo(Math.min(from.x, to.x), 1);
        expect(back.y).toBeCloseTo(Math.min(from.y, to.y), 1);
        expect(back.width).toBeCloseTo(Math.abs(to.x - from.x), 1);
        expect(back.height).toBeCloseTo(Math.abs(to.y - from.y), 1);
      });
    }
  }

  it("writes the ABSOLUTE rotation, so applying the same model twice is idempotent", async () => {
    const source = await buildSource(90);
    const base = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 90 },
    ]);
    // The admin adds another quarter turn on top of the file's own /Rotate 90.
    const model: EditModel = {
      ...base,
      pages: [{ ...base.pages[0], addedRotation: 90 }],
    };
    const once = await PDFDocument.load(
      await applyEdits({ sources: { src: source }, model })
    );
    expect(once.getPages()[0].getRotation().angle).toBe(180);

    const twice = await PDFDocument.load(
      await applyEdits({ sources: { src: source }, model })
    );
    expect(twice.getPages()[0].getRotation().angle).toBe(180);
  });
});

describe("applyEdits — page assembly", () => {
  it("emits pages in MODEL order across two sources, with each box on its own page", async () => {
    const a = await buildSource(0);
    const b = await buildSource(90, { x: 37, y: 53 });

    const first = createModel("A", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const merged = mergeSource(first, "B", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 90 },
    ]);
    expect(merged.pages.map((p) => p.src)).toEqual(["A", "B"]);

    const target = merged.pages[1];
    const vp = overlayViewport(90, { x: 37, y: 53 });
    const box: ScreenBox = { left: 0, top: 0, width: vp.width, height: vp.height };
    const rect = screenRectToPdfRect(
      { x: box.width * 0.55, y: box.height * 0.6 },
      { x: box.width * 0.8, y: box.height * 0.75 },
      box,
      vp
    );

    const out = await PDFDocument.load(
      await applyEdits({
        sources: { A: a, B: b },
        model: {
          ...merged,
          annotations: [{ kind: "whiteout", id: "w", pageId: target.id, rect }],
        },
      })
    );

    expect(out.getPageCount()).toBe(2);
    // Page 1 still carries only its own 40x40 marker.
    const onFirst = filledBoxes(pageContent(out, 0));
    expect(onFirst).toHaveLength(1);
    expect(onFirst[0].width).toBeCloseTo(40, 1);
    // Page 2 carries its marker AND the whiteout, at the right coordinates.
    const onSecond = filledBoxes(pageContent(out, 1));
    expectRectClose(onSecond[onSecond.length - 1], rect);
    expect(out.getPages()[1].getRotation().angle).toBe(90);
    expect(out.getPages()[1].getCropBox().x).toBeCloseTo(37, 2);
  });

  it("drops an annotation whose page is no longer in the document rather than failing the download", async () => {
    const source = await buildSource(0);
    const model = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const stranded: EditModel = {
      ...model,
      annotations: [
        {
          kind: "whiteout",
          id: "ghost",
          pageId: "pg-that-was-deleted",
          rect: { x: 10, y: 10, width: 50, height: 50 },
        },
      ],
    };
    const out = await PDFDocument.load(
      await applyEdits({ sources: { src: source }, model: stranded })
    );
    // Only the source's own marker survives.
    expect(filledBoxes(pageContent(out, 0))).toHaveLength(1);
  });
});

describe("applyEdits — z-order", () => {
  it("puts the whiteout underneath and the picture on top of it, whatever order they were added in", async () => {
    const source = await buildSource(0);
    const model = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const pageId = model.pages[0].id;
    const annotations: Annotation[] = [
      // Added picture-first on purpose: Z_RANK, not array order, decides
      // between kinds, or an opaque cover would bury the picture under it.
      {
        kind: "image",
        id: "img",
        pageId,
        rect: { x: 100, y: 100, width: 80, height: 80 },
        assetId: "png",
        opacity: 1,
      },
      {
        kind: "whiteout",
        id: "cover",
        pageId,
        rect: { x: 90, y: 90, width: 120, height: 120 },
      },
    ];

    const outBytes = await applyEdits({
      sources: { src: source },
      assets: { png: PNG_1PX },
      model: { ...model, annotations },
    });
    const content = pageContent(await PDFDocument.load(outBytes), 0);

    // The cover's fill must be emitted BEFORE the image's `Do`.
    const coverAt = content.indexOf("1 1 1 rg");
    const imageAt = content.search(/\bDo\b/);
    expect(coverAt).toBeGreaterThanOrEqual(0);
    expect(imageAt).toBeGreaterThanOrEqual(0);
    expect(coverAt).toBeLessThan(imageAt);
  });
});

describe("applyEdits — Thai text", () => {
  it("draws typed Thai with the embedded Sarabun and hands it back intact from the saved bytes", async () => {
    const THAI = "ที่อยู่: ๑๒๓ ถนนสุขุมวิท ผู้รับผิดชอบ นายพุฒิ";
    const source = await buildSource(0);
    const model = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const outBytes = await applyEdits({
      sources: { src: source },
      model: {
        ...model,
        annotations: [
          {
            kind: "text",
            id: "t",
            pageId: model.pages[0].id,
            rect: { x: 40, y: 400, width: 320, height: 120 },
            text: THAI,
            sizePt: 16,
            color: { r: 0, g: 0, b: 0 },
            bold: false,
            angleDeg: 0,
            align: "left",
          },
        ],
      },
    });

    const out = await PDFDocument.load(outBytes);

    // 1. The face is Sarabun. A standard-14 face here would mean WinAnsi, and
    //    WinAnsi cannot encode a single Thai character.
    const baseFonts: string[] = [];
    out.context.enumerateIndirectObjects().forEach(([, obj]) => {
      const bf = (obj as { get?: (k: unknown) => unknown }).get?.(
        PDFName.of("BaseFont")
      );
      if (bf) baseFonts.push(String(bf));
    });
    expect(baseFonts.join(",")).toMatch(/Sarabun/i);
    expect(baseFonts.join(",")).not.toMatch(/Helvetica|Times|Courier/i);

    // 2. Glyphs were actually shown.
    const content = pageContent(out, 0);
    const shows = content.match(/<([0-9A-Fa-f]+)>\s*Tj/g) ?? [];
    expect(shows.length).toBeGreaterThan(0);

    // 3. The /ToUnicode CMap maps every glyph back to the character typed —
    //    which is what makes the result searchable and copy-pasteable, as the
    //    in-page guide promises. Combining marks (สระ / วรรณยุกต์) included.
    let cmap = "";
    out.context.enumerateIndirectObjects().forEach(([, obj]) => {
      if (obj instanceof PDFRawStream) {
        const text = streamText(obj);
        if (text.includes("beginbfchar") || text.includes("beginbfrange")) {
          cmap += text;
        }
      }
    });
    const toUnicode = new Map<string, string>();
    for (const m of cmap.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>/g)) {
      let value = "";
      for (let i = 0; i < m[2].length; i += 4) {
        value += String.fromCharCode(parseInt(m[2].slice(i, i + 4), 16));
      }
      toUnicode.set(m[1].toUpperCase(), value);
    }
    let recovered = "";
    for (const show of shows) {
      const hex = show.match(/<([0-9A-Fa-f]+)>/)![1];
      for (let i = 0; i < hex.length; i += 4) {
        recovered += toUnicode.get(hex.slice(i, i + 4).toUpperCase()) ?? "�";
      }
    }
    expect(recovered).not.toContain("�");
    // Every typed code point comes back, in order. A subsequence rather than
    // equality because the shaper decomposes สระอำ (U+0E33) into นิคหิต +
    // ลากข้าง, so the reverse map can report one extra code point there — a
    // ToUnicode artefact, not lost text.
    let cursor = 0;
    for (const ch of THAI.replace(/\s/g, "")) {
      const found = recovered.replace(/\s/g, "").indexOf(ch, cursor);
      expect(found, `code point U+${ch.codePointAt(0)!.toString(16)} is missing`).toBeGreaterThanOrEqual(0);
      cursor = found + 1;
    }
  });
});

describe("applyEdits — refusals, in Thai", () => {
  it("refuses a model with no pages instead of writing a zero-page PDF", async () => {
    await expect(
      applyEdits({ sources: { src: await buildSource(0) }, model: emptyModel() })
    ).rejects.toBeInstanceOf(PdfNoPagesError);

    const error = await rejection(applyEdits({ sources: {}, model: emptyModel() }));
    expect(error.message).toMatch(/[฀-๿]/);
  });

  it("names the missing file when a page's source bytes were not passed", async () => {
    const model = createModel("gone", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const error = await rejection(applyEdits({ sources: {}, model }));
    expect(error).toBeInstanceOf(PdfMissingSourceError);
    expect(error.message).toContain("gone");
    expect(error.message).toMatch(/[฀-๿]/);
  });

  it("refuses a page index past the end of its source", async () => {
    const model = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const broken: EditModel = {
      ...model,
      pages: [{ ...model.pages[0], srcIndex: 7 }],
    };
    const error = await rejection(applyEdits({
      sources: { src: await buildSource(0) },
      model: broken,
    }));
    expect(error).toBeInstanceOf(PdfPageIndexError);
    expect(error.message).toMatch(/[฀-๿]/);
  });

  it("names the missing picture rather than silently dropping it", async () => {
    const model = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    const error = await rejection(applyEdits({
      sources: { src: await buildSource(0) },
      assets: {},
      model: {
        ...model,
        annotations: [
          {
            kind: "signature",
            id: "s",
            pageId: model.pages[0].id,
            rect: { x: 10, y: 10, width: 50, height: 20 },
            assetId: "missing-asset",
          },
        ],
      },
    }));
    expect(error).toBeInstanceOf(PdfMissingAssetError);
    expect(error.message).toContain("missing-asset");
  });

  it("judges a picture by its MAGIC BYTES, not by what it was called", async () => {
    const model = createModel("src", [
      { widthPt: CROP_W, heightPt: CROP_H, baseRotation: 0 },
    ]);
    // A GIF renamed to .png: `file.type` would say image/png, the bytes do not.
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
    const error = await rejection(applyEdits({
      sources: { src: await buildSource(0) },
      assets: { fake: gif },
      model: {
        ...model,
        annotations: [
          {
            kind: "image",
            id: "i",
            pageId: model.pages[0].id,
            rect: { x: 10, y: 10, width: 50, height: 20 },
            assetId: "fake",
            opacity: 1,
          },
        ],
      },
    }));
    expect(error).toBeInstanceOf(PdfUnsupportedImageError);
    expect(error.message).toMatch(/PNG|JPG/);
  });
});
