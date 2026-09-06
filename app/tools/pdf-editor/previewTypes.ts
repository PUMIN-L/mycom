/**
 * previewTypes.ts — the ENTIRE public surface of the interactive preview.
 *
 * Rules this file exists to enforce:
 *  • Props and callbacks ONLY. No behaviour, no state, no store.
 *  • This module must never import the editor store, so that a consumer can
 *    replace the whole `app/tools/pdf-editor` preview surface with a single
 *    `vi.mock(...)` in a jsdom test. Anything that transitively pulls in
 *    react-pdf explodes under jsdom with `ReferenceError: DOMMatrix is not
 *    defined`, so the preview is only ever reachable through
 *    `PdfPreviewWrapper` (dynamic, ssr:false) and is mocked in component tests.
 *  • The only other module it may import from is the shared contract,
 *    `app/lib/pdfTypes`, which every group compiles against.
 */

import type {
  Annotation,
  AssetId,
  DocPage,
  PageId,
  Rect,
  Rotation,
  SourceId,
} from "@/app/lib/pdfTypes";

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A rectangle in the CSS box of a rendered page: top-left origin, CSS pixels.
 *
 * These are only ever produced by `getBoundingClientRect()` and pointer
 * `clientX`/`clientY`. NEVER derive one from `canvas.width`: react-pdf's
 * backing store is `devicePixelRatio`x larger than the CSS box and the CSS then
 * scales it again, so `canvas.width` is off by an unpredictable factor on every
 * retina machine.
 *
 * All conversion between this and PDF user space is delegated to Group A's
 * `app/lib/pdfCoords` — the preview never does that arithmetic itself.
 */
export type CssRect = { x: number; y: number; width: number; height: number };

/* -------------------------------------------------------------------------- */
/* Bytes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One uploaded PDF, by id, plus its MASTER bytes.
 *
 * The preview treats these bytes as READ-ONLY and immutable. pdf.js transfers
 * whatever ArrayBuffer reaches `<Document>` to its worker thread, detaching it
 * in the main thread (`byteLength` becomes 0); if pdf-lib later reads the same
 * buffer on download it throws
 *   "Cannot perform Construct on a detached ArrayBuffer"
 * after the admin has done an hour of work. So the preview hands `<Document>` a
 * disposable `.slice(0)` copy, freshly made on every mount — never these bytes.
 */
export type PdfPreviewSource = {
  sourceId: SourceId;
  bytes: Uint8Array | ArrayBuffer;
};

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

/** Which pointer gesture the overlay is currently offering. */
export type PreviewTool = "select" | "whiteout" | "text" | "image" | "signature";

/** The annotation kinds a drag-to-draw gesture can produce. */
export type DrawableTool = Exclude<PreviewTool, "select">;

/** How a new rectangle came to exist — the owner may want to treat them differently. */
export type RectOrigin =
  /** The admin dragged a rectangle by hand. Always available, on every page. */
  | "drag"
  /** The admin clicked a real line of text and the box was taken from pdfjs. */
  | "snap";

/* -------------------------------------------------------------------------- */
/* Overlay props                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A pdfjs page proxy, typed structurally so this module never imports
 * pdfjs-dist (which would drag DOMMatrix into jsdom).
 */
export type PdfPageLike = {
  /**
   * `/CropBox` as `[x0, y0, x1, y1]`. Feeding it to `pdfCoords.makeViewport`
   * reproduces exactly the viewport pdfjs rendered with, so a page whose crop
   * origin is not (0,0) still maps correctly.
   */
  view?: number[];
  getTextContent(): Promise<{
    items: Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>;
  }>;
};

export type PageOverlayProps = {
  pageId: PageId;
  /** Unrotated page size in points, from the model. */
  widthPt: number;
  heightPt: number;
  /** Total displayed rotation. Always a quarter turn — pdfjs throws otherwise. */
  rotation: Rotation;
  /** Annotations belonging to THIS page, already in z-order. */
  annotations: Annotation[];
  /** `assetId` -> a `blob:`/`data:` URL the owner resolved. Missing ids render as a placeholder. */
  assetUrls: Readonly<Record<AssetId, string>>;
  tool: PreviewTool;
  selectedAnnotationId: string | null;
  /** Set once the page has loaded; `null` while it is still rasterising. */
  pageProxy: PdfPageLike | null;
  /** Bumped by the owner to force snap candidates to be re-extracted. */
  textEpoch?: number;
  disabled?: boolean;

  onSelectAnnotation(id: string | null): void;
  /** A new rectangle was drawn or snapped. `sampleText` is present only for snaps. */
  onCreateRect(
    pageId: PageId,
    rect: Rect,
    tool: DrawableTool,
    origin: RectOrigin,
    snap?: SnapSample,
  ): void;
  /** An existing annotation finished being moved or resized. */
  onCommitRect(annotationId: string, rect: Rect): void;
  /**
   * Fired once per page when pdfjs reports no extractable text — i.e. the page
   * is a scan. The overlay already says so in Thai; this lets the owner react
   * (e.g. disable a "snap to text" affordance in the toolbar).
   */
  onTextUnavailable?(pageId: PageId): void;
};

/**
 * What a click-to-snap gesture managed to read off the existing text.
 *
 * The BOX is the reliable part: `transform[4], [5]` is byte-identical to the
 * x/y that were handed to `drawText`. Everything else is a hint —
 * `text` in particular can be mojibake on a bad `/ToUnicode` map, so the owner
 * may pre-fill an input with it but must never treat it as authoritative, and
 * dragging a rectangle by hand stays an equal path on every page.
 */
export type SnapSample = {
  /** pdfjs's decoded string. May be wrong. May be empty. */
  text: string;
  /** Font size implied by the text matrix, in points. */
  sizePt: number;
  /** Baseline angle, counter-clockwise degrees. */
  angleDeg: number;
};

/* -------------------------------------------------------------------------- */
/* Thumbnail strip props                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A page proxy source the strip can render from, keyed by `SourceId`. The strip
 * never loads bytes itself.
 */
export type PdfProxyMap = Readonly<Record<SourceId, unknown>>;

export type PageThumbnailStripProps = {
  pages: DocPage[];
  proxies: PdfProxyMap;
  activePageId: PageId | null;
  disabled?: boolean;
  onSelectPage(pageId: PageId): void;
  /**
   * Drag-to-reorder finished. The reordering maths itself is Group A's pure,
   * tested `movePage(from, to)` — the strip only reports the indices.
   */
  onMovePage(from: number, to: number): void;
  /** `delta` is always +90 or -90; the owner normalises into `addedRotation`. */
  onRotatePage(pageId: PageId, delta: 90 | -90): void;
  onDeletePage(pageId: PageId): void;
};

/* -------------------------------------------------------------------------- */
/* Signature pad props                                                        */
/* -------------------------------------------------------------------------- */

export type SignatureResult = {
  /** PNG data URL, TRIMMED to the ink bounding box. */
  dataUrl: string;
  /** Natural size of the trimmed image, in CSS pixels — use it for the aspect ratio. */
  width: number;
  height: number;
};

export type SignaturePadProps = {
  open: boolean;
  /**
   * Deliberately NOT "ลายเซ็นดิจิทัล": this produces an IMAGE of a signature,
   * not a cryptographic one. Callers must not relabel it.
   */
  onConfirm(result: SignatureResult): void;
  onCancel(): void;
  /** Stroke colour, CSS. Defaults to near-black. */
  inkColor?: string;
};

/* -------------------------------------------------------------------------- */
/* Preview props                                                              */
/* -------------------------------------------------------------------------- */

export type PdfPreviewProps = {
  /** Every source referenced by `pages`. Merging a second PDF in adds an entry. */
  sources: PdfPreviewSource[];
  /** Model order IS output order. */
  pages: DocPage[];
  /** Whole-document annotation list; the preview buckets it per page itself. */
  annotations: Annotation[];
  assetUrls: Readonly<Record<AssetId, string>>;

  /**
   * Bump this whenever the bytes behind a `sourceId` must be re-read — a new
   * upload, an undo that restores a page, anything structural. It is half of
   * the `(sourceId, previewEpoch)` key that guarantees `<Document>` gets a
   * FRESH `.slice(0)` rather than a buffer pdf.js has already detached.
   */
  previewEpoch: number;

  tool: PreviewTool;
  zoom: number;
  activePageId: PageId | null;
  selectedAnnotationId: string | null;
  showThumbnails?: boolean;
  disabled?: boolean;

  onSelectPage(pageId: PageId): void;
  onSelectAnnotation(id: string | null): void;
  onCreateRect(
    pageId: PageId,
    rect: Rect,
    tool: DrawableTool,
    origin: RectOrigin,
    snap?: SnapSample,
  ): void;
  onCommitRect(annotationId: string, rect: Rect): void;
  onMovePage(from: number, to: number): void;
  onRotatePage(pageId: PageId, delta: 90 | -90): void;
  onDeletePage(pageId: PageId): void;
  onTextUnavailable?(pageId: PageId): void;

  /** A source finished parsing. */
  onSourceLoad?(sourceId: SourceId, numPages: number): void;
  /**
   * A source could not be opened. `message` is already Thai and safe to show.
   * A password-protected file lands here: pdf-lib 1.17.1 cannot decrypt, so the
   * only honest answer is to refuse the file.
   */
  onSourceError?(sourceId: SourceId, message: string): void;
};

/*
 * NOTE: rotation normalisation deliberately lives in Group A's
 * `pdfCoords.normalizeQuarterTurn`, not here. pdfjs builds its viewport from
 * that number and THROWS on anything that is not a multiple of 90 — which takes
 * down the whole preview, not one page — so it is worth having exactly one
 * implementation, and a unit-tested one.
 */
