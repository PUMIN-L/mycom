/**
 * pdfTypes.ts — THE SHARED CONTRACT for the browser PDF editor.
 *
 * TYPE DECLARATIONS ONLY. No runtime code, no imports, no dependencies — this
 * file is compiled against by every layer of the feature (the pdfjs read layer,
 * the React editor UI and the pdf-lib write layer), on both the client and in
 * Node under vitest, so it must stay as inert as `app/lib/types.ts`.
 *
 * THE GOVERNING IDEA
 *   pdfjs  is strictly READ-ONLY  — parse, render, measure, extract.
 *   pdf-lib is strictly WRITE-ONLY — called once, on download.
 *   Between them sits this plain-JSON edit model, which neither library knows
 *   about. That separation is what keeps the ArrayBuffer-detachment hazard
 *   structural rather than accidental, and what makes the core unit-testable.
 *
 * WHY A MODEL RATHER THAN MUTATING BYTES AS YOU GO: the admin must be able to
 * place ten things, change his mind, undo, and only then press download. Bytes
 * cannot be un-drawn.
 *
 * NOTE: there is NO `protect` field. Password / no-copy / no-print is CUT.
 * Redaction is CUT too — a "whiteout" only COVERS text, it does not remove it,
 * and the covered text can still be extracted from the saved file.
 */

/** One per uploaded PDF. */
export type SourceId = string;

/** One page of the edited document. Stable across reorder, rotate and undo. */
export type PageId = string;

/** One per uploaded or drawn image (a picture, or a signature stroke bitmap). */
export type AssetId = string;

/** Page rotation, always normalised into the quarter turns PDF allows. */
export type Rotation = 0 | 90 | 180 | 270;

export type DocPage = {
  id: PageId;
  src: SourceId;
  /** Index of this page inside its ORIGINAL source document (0-based). */
  srcIndex: number;
  /** Rotation the admin added in the editor, on top of the file's own. */
  addedRotation: Rotation;
  /** The `/Rotate` the page already carried when it was uploaded. */
  baseRotation: Rotation;
  /** Unrotated page box, in points. */
  widthPt: number;
  heightPt: number;
};

/**
 * A rectangle in PDF USER SPACE: points, BOTTOM-LEFT origin, UNROTATED,
 * CropBox accounted for. Never screen pixels — see `pdfCoords.ts` for the
 * conversion, which must map both opposite corners because at /Rotate 90 the
 * viewport matrix is a reflection.
 */
export type Rect = { x: number; y: number; width: number; height: number };

export type RGB = { r: number; g: number; b: number };

export type TextAlign = "left" | "center" | "right";

export type WhiteoutAnnotation = {
  kind: "whiteout";
  id: string;
  pageId: PageId;
  rect: Rect;
};

export type TextAnnotation = {
  kind: "text";
  id: string;
  pageId: PageId;
  rect: Rect;
  text: string;
  sizePt: number;
  color: RGB;
  bold: boolean;
  angleDeg: number;
  align: TextAlign;
};

export type ImageAnnotation = {
  kind: "image";
  id: string;
  pageId: PageId;
  rect: Rect;
  assetId: AssetId;
  opacity: number;
};

export type SignatureAnnotation = {
  kind: "signature";
  id: string;
  pageId: PageId;
  rect: Rect;
  assetId: AssetId;
};

export type Annotation =
  | WhiteoutAnnotation
  | TextAnnotation
  | ImageAnnotation
  | SignatureAnnotation;

export type AnnotationKind = Annotation["kind"];

/** The value an AcroForm field can hold: text/choice, checkbox, multi-select. */
export type FormValue = string | boolean | string[];

export type EditModel = {
  /** ARRAY ORDER *IS* THE OUTPUT PAGE ORDER. */
  pages: DocPage[];
  /** ARRAY ORDER *IS* THE Z-ORDER (last drawn wins). */
  annotations: Annotation[];
  formValues: Record<string, FormValue>;
  flattenForm: boolean;
};
