// pdfApplyEdits.ts — the edit model becomes bytes. Called ONCE, on download.
//
// Bytes in, bytes out. No DOM: no document, window, File, Blob or URL anywhere
// in this file or the ones it imports. If a caller thinks it needs a Blob here,
// the caller is wrong — take the Uint8Array this returns and wrap it there.
//
// pdf-lib is pulled in with `await import("pdf-lib")` (via pdfFormFill's memoised
// loader) so the library stays out of every bundle that never downloads a PDF.
// app/lib/xlsxExport.ts is the repo's precedent for that.
//
// ======================================================================
// WHY THE OUTPUT IS REBUILT RATHER THAN EDITED
// ======================================================================
// Every page operation the editor offers — delete, reorder, rotate, merge in
// another file, split pages out — is expressed the same way: `model.pages` is
// the list of pages the output should have, in order. So there is exactly ONE
// code path: `copyPages` the requested pages, in the requested order, into a
// FRESH document.
//
// The alternative — removePage/insertPage arithmetic on a loaded document — is
// where index-shift bugs live. Delete page 2 and every later index moves; do it
// in a loop and half the deletions hit the wrong page. None of that can happen
// here because no index is ever recomputed: `model.pages[i].srcIndex` always
// refers to the ORIGINAL document, which is never mutated.
//
// ======================================================================
// CALL ORDER IS Z-ORDER
// ======================================================================
// pdf-lib appends operators to the page's content stream, so whatever is drawn
// last is painted on top. Per page the order is fixed:
//
//   1. whiteouts     — opaque covers, so they must go underneath
//   2. images and signatures
//   3. text          — always readable, never buried
//
// Within a kind, `model.annotations` array order decides, as the contract says.
//
// AND A WARNING THE UI MUST REPEAT IN THAI: a whiteout COVERS text, it does not
// remove it. The original characters are still in the file and can be extracted.
// This tool does not redact.
//
// ======================================================================
// NEVER page.getSize()
// ======================================================================
// It returns the UNROTATED MediaBox and ignores both /Rotate and the CropBox —
// measured: a 400x600 page with /Rotate 90 and a CropBox of 300x500 still
// reports 400x600. It therefore does not describe what the user saw, and no
// placement in this file is derived from it. Coordinates arrive from the model
// already in PDF user space (points, bottom-left origin, unrotated, CropBox
// accounted for) and are used as they are.

import type {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  PDFRef as PDFRefType,
} from "pdf-lib";
import type {
  Annotation,
  AssetId,
  EditModel,
  ImageAnnotation,
  PageId,
  Rect,
  SignatureAnnotation,
  SourceId,
  TextAnnotation,
  WhiteoutAnnotation,
} from "./pdfTypes";
import { rotatedDrawAnchor, normalizeQuarterTurn } from "./pdfCoords";
import { effectiveRotation } from "./pdfEditModel";
import { sniffImageKind, toBytes, type ByteSource } from "./pdfBytes";
import { loadThaiFont, wrapThai } from "./pdfFonts";
import {
  applyFormValuesToDoc,
  openPdfDocument,
  pdfLib,
} from "./pdfFormFill";

/* ------------------------------------------------------------------ *
 * Layout constants — the write layer's half of a contract with the UI
 * ------------------------------------------------------------------ */

/**
 * Baseline-to-baseline distance as a multiple of the font size. The on-screen
 * overlay must use the same number or the preview and the download disagree.
 */
export const LINE_HEIGHT_RATIO = 1.2;

/* ------------------------------------------------------------------ *
 * Errors — Thai, because the editor shows them verbatim
 * ------------------------------------------------------------------ */

export class PdfNoPagesError extends Error {
  constructor() {
    super("ไม่มีหน้าเอกสารเหลืออยู่ จึงบันทึกไฟล์ PDF ไม่ได้");
    this.name = "PdfNoPagesError";
  }
}

export class PdfMissingSourceError extends Error {
  readonly sourceId: SourceId;
  constructor(sourceId: SourceId) {
    super(`ไม่พบไฟล์ต้นฉบับของหน้าเอกสารบางหน้า (${sourceId}) กรุณาอัปโหลดใหม่`);
    this.name = "PdfMissingSourceError";
    this.sourceId = sourceId;
  }
}

export class PdfPageIndexError extends Error {
  constructor(sourceId: SourceId, index: number, pageCount: number) {
    super(
      `หน้าที่ ${index + 1} ไม่มีอยู่ในไฟล์ต้นฉบับ (${sourceId}) ` +
        `ซึ่งมีทั้งหมด ${pageCount} หน้า`
    );
    this.name = "PdfPageIndexError";
  }
}

export class PdfMissingAssetError extends Error {
  readonly assetId: AssetId;
  constructor(assetId: AssetId) {
    super(`ไม่พบรูปภาพหรือลายเซ็นที่ใช้ในเอกสาร (${assetId}) กรุณาเพิ่มใหม่อีกครั้ง`);
    this.name = "PdfMissingAssetError";
    this.assetId = assetId;
  }
}

export class PdfUnsupportedImageError extends Error {
  readonly assetId: AssetId;
  constructor(assetId: AssetId) {
    super(
      `รูปภาพ (${assetId}) ไม่ใช่ไฟล์ PNG หรือ JPG จึงใส่ลงใน PDF ไม่ได้ ` +
        "กรุณาบันทึกเป็น PNG หรือ JPG แล้วลองใหม่"
    );
    this.name = "PdfUnsupportedImageError";
    this.assetId = assetId;
  }
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export type ApplyEditsInput = {
  /** Original bytes of every uploaded PDF, keyed by `SourceId`. */
  sources: Record<SourceId, ByteSource>;
  /** PNG/JPEG bytes of every uploaded picture and drawn signature. */
  assets?: Record<AssetId, ByteSource>;
  model: EditModel;
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;

/** Whiteouts underneath, then pictures, then text on top. */
const Z_RANK: Record<Annotation["kind"], number> = {
  whiteout: 0,
  image: 1,
  signature: 1,
  text: 2,
};

/** Is this angle already one of the quarter turns rotatedDrawAnchor handles? */
function isQuarterTurn(angleDeg: number): boolean {
  const wrapped = ((angleDeg % 360) + 360) % 360;
  return Math.abs(wrapped - normalizeQuarterTurn(angleDeg)) < 1e-6;
}

/* ------------------------------------------------------------------ *
 * applyEdits
 * ------------------------------------------------------------------ */

/**
 * Turn the edit model into a finished PDF.
 *
 * @throws {PdfEncryptedError}        a source is password-protected — pdf-lib
 *                                    1.17.1 cannot decrypt, and half-opening
 *                                    one produces a file of garbage.
 * @throws {PdfNoPagesError}          the model has no pages.
 * @throws {PdfMissingSourceError}    a page refers to bytes that were not passed.
 * @throws {PdfPageIndexError}        a page refers past the end of its source.
 * @throws {PdfMissingAssetError}     an annotation refers to a missing image.
 * @throws {PdfUnsupportedImageError} an asset is neither PNG nor JPEG.
 * @throws {ThaiFontLoadError}        Sarabun could not be loaded. There is no
 *                                    fallback on purpose — see pdfFonts.ts.
 */
export async function applyEdits({
  sources,
  assets = {},
  model,
}: ApplyEditsInput): Promise<Uint8Array> {
  if (!model.pages.length) throw new PdfNoPagesError();

  const { PDFDocument, degrees, rgb } = await pdfLib();

  /* --- 1. Open every source ONCE, memoised by id ------------------- */

  const openedSources = new Map<SourceId, PDFDocument>();
  const getSource = async (id: SourceId): Promise<PDFDocument> => {
    const cached = openedSources.get(id);
    if (cached) return cached;
    const bytes = sources[id];
    if (bytes === undefined) throw new PdfMissingSourceError(id);
    // openPdfDocument copies the bytes, so a buffer pdf.js already transferred
    // to its worker cannot be read back here as a detached one.
    const doc = await openPdfDocument(bytes);
    openedSources.set(id, doc);
    return doc;
  };

  /* --- 2. Form values go in BEFORE the pages are copied ------------ */
  //
  // `copyPages` does NOT carry an AcroForm across: the widget annotations come
  // over but the destination catalog never lists them, so the output has zero
  // fields (measured). Filling the SOURCE first sidesteps that entirely —
  // flattening bakes the values into page content, which copies perfectly, and
  // when the admin wants the fields left fillable they are re-homed in step 5.

  const wantsForm =
    Object.keys(model.formValues).length > 0 || model.flattenForm;

  if (wantsForm) {
    const srcIds = Array.from(new Set(model.pages.map((p) => p.src)));
    for (const id of srcIds) {
      const doc = await getSource(id);
      // Not strict: after merging a second PDF a value legitimately belongs to
      // only one of the sources, and the other must not fail the download.
      await applyFormValuesToDoc(doc, model.formValues, {
        flatten: model.flattenForm,
        strict: false,
      });
    }
  }

  /* --- 3. Copy the pages into a FRESH document, in model order ----- */
  //
  // One `copyPages` call per source (batching is what pdf-lib is optimised
  // for), then each returned page is dropped into the slot its model entry
  // occupies. Duplicate `srcIndex` values are fine — pdf-lib returns a distinct
  // page object for each, which is what makes "split out page 3 twice" work.

  const outDoc = await PDFDocument.create();

  type Batch = { indices: number[]; slots: number[] };
  const batches = new Map<SourceId, Batch>();
  model.pages.forEach((page, slot) => {
    let batch = batches.get(page.src);
    if (!batch) {
      batch = { indices: [], slots: [] };
      batches.set(page.src, batch);
    }
    batch.indices.push(page.srcIndex);
    batch.slots.push(slot);
  });

  const orderedPages = new Array<PDFPage>(model.pages.length);
  for (const [srcId, batch] of batches) {
    const srcDoc = await getSource(srcId);
    const pageCount = srcDoc.getPageCount();
    for (const index of batch.indices) {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
        throw new PdfPageIndexError(srcId, index, pageCount);
      }
    }
    const copied = await outDoc.copyPages(srcDoc, batch.indices);
    copied.forEach((page, k) => {
      orderedPages[batch.slots[k]] = page;
    });
  }
  for (const page of orderedPages) outDoc.addPage(page);

  /* --- 4. Rotation ------------------------------------------------- */
  //
  // Set the ABSOLUTE angle (the file's own /Rotate plus whatever the admin
  // added), not a delta, so the operation is idempotent and matches exactly
  // what the preview showed.

  model.pages.forEach((docPage, i) => {
    orderedPages[i].setRotation(degrees(effectiveRotation(docPage)));
  });

  /* --- 5. Keep the form interactive, if that is what was asked ----- */

  if (wantsForm && !model.flattenForm) {
    await rehomeAcroForm(outDoc);
  }

  /* --- 6. Draw ----------------------------------------------------- */

  const pageById = new Map<PageId, PDFPage>();
  model.pages.forEach((docPage, i) => pageById.set(docPage.id, orderedPages[i]));

  const imageCache = new Map<AssetId, PDFImage>();
  const embedAsset = async (assetId: AssetId): Promise<PDFImage> => {
    const cached = imageCache.get(assetId);
    if (cached) return cached;

    const raw = assets[assetId];
    if (raw === undefined) throw new PdfMissingAssetError(assetId);

    // MAGIC BYTES, never a declared MIME type: the browser fills `file.type`
    // from the extension, so a renamed file lies about what it is.
    const bytes = toBytes(raw);
    const kind = sniffImageKind(bytes);
    if (!kind) throw new PdfUnsupportedImageError(assetId);

    const image =
      kind === "png" ? await outDoc.embedPng(bytes) : await outDoc.embedJpg(bytes);
    imageCache.set(assetId, image);
    return image;
  };

  const fontCache = new Map<"regular" | "bold", PDFFont>();
  const getFont = async (bold: boolean): Promise<PDFFont> => {
    const weight = bold ? "bold" : "regular";
    const cached = fontCache.get(weight);
    if (cached) return cached;
    const font = await loadThaiFont(outDoc, weight);
    fontCache.set(weight, font);
    return font;
  };

  for (const docPage of model.pages) {
    const page = pageById.get(docPage.id)!;

    // Annotations stranded on a page that is no longer in the document are
    // dropped rather than thrown on — that is the "annotation left on page 7
    // of a three-page file" failure, and it must not block a download.
    const forPage = model.annotations.filter((a) => a.pageId === docPage.id);
    // Array#sort is stable, so array order still decides within a kind.
    forPage.sort((a, b) => Z_RANK[a.kind] - Z_RANK[b.kind]);

    for (const ann of forPage) {
      switch (ann.kind) {
        case "whiteout":
          drawWhiteout(page, ann, rgb);
          break;
        case "image":
        case "signature":
          await drawImageAnnotation(page, ann, await embedAsset(ann.assetId));
          break;
        case "text":
          await drawTextAnnotation(page, ann, await getFont(ann.bold), degrees, rgb);
          break;
      }
    }
  }

  /* --- 7. Save ----------------------------------------------------- */
  //
  // updateFieldAppearances MUST stay false: pdfFormFill already generated the
  // appearances with Sarabun, and letting pdf-lib redo them means Helvetica,
  // which throws on the first Thai character.
  return outDoc.save({ updateFieldAppearances: false });
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

type RgbFn = (typeof import("pdf-lib"))["rgb"];
type DegreesFn = (typeof import("pdf-lib"))["degrees"];

function drawWhiteout(page: PDFPage, ann: WhiteoutAnnotation, rgb: RgbFn): void {
  const box = rotatedDrawAnchor(ann.rect, 0);
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
}

async function drawImageAnnotation(
  page: PDFPage,
  ann: ImageAnnotation | SignatureAnnotation,
  image: PDFImage
): Promise<void> {
  const box = rotatedDrawAnchor(ann.rect, 0);
  page.drawImage(image, {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    // A signature is always fully opaque; only a picture carries an opacity.
    opacity: ann.kind === "image" ? clamp01(ann.opacity) : 1,
  });
}

/**
 * Lay the text out inside its rectangle and draw it line by line.
 *
 * ONE LINE AT A TIME, not one `drawText` with newlines, because alignment
 * needs each line's measured width — and because `drawText({ maxWidth })`
 * cannot wrap Thai at all (pdf-lib breaks on `defaultWordBreaks`, which is
 * `[" "]`; Thai has no spaces between words, so it returns a single line that
 * runs off the page). `wrapThai` does the segmentation instead.
 *
 * PLACEMENT. pdf-lib rotates drawn content about the x,y it is given, and for
 * text that x,y is the FIRST LINE'S BASELINE START. So the rectangle is treated
 * as a local frame — origin and dimensions from `rotatedDrawAnchor`, which at a
 * quarter turn returns the corner and the swapped width/height that make the
 * rotated box land back inside the rectangle the admin drew — and each line's
 * offset inside that frame is rotated into page space by hand.
 */
async function drawTextAnnotation(
  page: PDFPage,
  ann: TextAnnotation,
  font: PDFFont,
  degrees: DegreesFn,
  rgb: RgbFn
): Promise<void> {
  if (ann.text === "") return;

  const size = ann.sizePt;
  // A free-form angle (read off an existing skewed line) has no "fits the
  // rectangle" answer, so it pivots about the rectangle's own corner instead.
  const frame = isQuarterTurn(ann.angleDeg)
    ? rotatedDrawAnchor(ann.rect, ann.angleDeg)
    : { ...ann.rect, angleDeg: ann.angleDeg };

  const lines = wrapThai(ann.text, font, size, frame.width);
  if (lines.length === 0) return;

  const lineHeight = size * LINE_HEIGHT_RATIO;
  const ascent = font.heightAtSize(size, { descender: false });

  const radians = (frame.angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotation = degrees(frame.angleDeg);
  const color = rgb(
    clamp01(ann.color.r),
    clamp01(ann.color.g),
    clamp01(ann.color.b)
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;

    const lineWidth = font.widthOfTextAtSize(line, size);
    const dx =
      ann.align === "center"
        ? (frame.width - lineWidth) / 2
        : ann.align === "right"
          ? frame.width - lineWidth
          : 0;
    // Text fills the box from the TOP down: the first baseline sits one
    // ascender below the top edge.
    const dy = frame.height - ascent - i * lineHeight;

    page.drawText(line, {
      x: frame.x + dx * cos - dy * sin,
      y: frame.y + dx * sin + dy * cos,
      size,
      font,
      color,
      rotate: rotation,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Keeping a copied form interactive
 * ------------------------------------------------------------------ */

/**
 * `copyPages` brings a page's widget annotations across but NOT the AcroForm
 * that owns them, so the output document has zero form fields even though the
 * widgets are sitting right there on the page (measured against pdf-lib
 * 1.17.1). This walks each page's /Annots, climbs each widget's /Parent chain
 * to the root field, and registers those roots in the output's AcroForm — after
 * which `getFields()`, the values and the appearance streams all work again.
 *
 * The appearance streams carry their own /Resources, so nothing depends on the
 * source AcroForm's /DR, which cannot be copied across documents here.
 *
 * KNOWN LIMIT, and the guide must say so: merging two PDFs that both use the
 * same field name yields two fields with that name, which readers may treat as
 * one field shown twice. Flattening avoids the question entirely.
 */
async function rehomeAcroForm(outDoc: PDFDocument): Promise<void> {
  const { PDFName, PDFDict, PDFRef } = await pdfLib();
  const SUBTYPE = PDFName.of("Subtype");
  const PARENT = PDFName.of("Parent");

  const roots: PDFRefType[] = [];
  const seen = new Set<string>();

  for (const page of outDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      if (!(annotRef instanceof PDFRef)) continue;

      let dict = outDoc.context.lookupMaybe(annotRef, PDFDict);
      if (!dict) continue;
      if (String(dict.get(SUBTYPE)) !== "/Widget") continue;

      // Climb to the root field. A widget may BE the field (a merged dict), or
      // hang off one, or off a whole /Parent chain for a radio group.
      let rootRef = annotRef;
      for (let depth = 0; depth < 32; depth++) {
        const parent = dict?.get(PARENT);
        if (!(parent instanceof PDFRef)) break;
        rootRef = parent;
        dict = outDoc.context.lookupMaybe(parent, PDFDict);
      }

      const key = String(rootRef);
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(rootRef);
    }
  }

  if (roots.length === 0) return;

  // getOrCreateAcroForm, NOT getForm(): getForm() populates pdf-lib's form
  // cache, and a cached form makes save() regenerate every appearance with
  // Helvetica — the WinAnsi crash this build spends so much effort avoiding.
  const acroForm = outDoc.catalog.getOrCreateAcroForm();
  const fields = acroForm.normalizedEntries().Fields;
  for (const ref of roots) fields.push(ref);
}
