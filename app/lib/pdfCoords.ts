/**
 * pdfCoords.ts — screen ⇄ PDF user space, as plain arithmetic.
 *
 * Everything here takes the viewport transform as SIX PLAIN NUMBERS, never a
 * pdfjs object, so the whole module tests as arithmetic in a Node environment
 * with no DOM and no pdfjs import.
 *
 * THE TRAP THIS MODULE EXISTS TO CLOSE
 *   At /Rotate 90 the pdfjs viewport matrix is a REFLECTION (determinant -1):
 *   the canvas top-left is not the PDF top-left, and canvas X maps to PDF Y.
 *   A naive `pdfY = height - clickY` silently places every annotation wrong —
 *   the difference between an editor that works and one that looks like it
 *   works. So a rectangle is converted by mapping BOTH opposite corners through
 *   the real inverse matrix and then taking min/max.
 *
 * MEASUREMENT RULE
 *   The overlay measures the canvas with `getBoundingClientRect()`, NEVER
 *   `canvas.width`. `canvas.width` is in device pixels (devicePixelRatio) while
 *   pointer events are in CSS pixels, and the canvas may additionally be
 *   CSS-scaled. Every function here therefore takes the bounding box and scales
 *   through it, which makes the maths independent of devicePixelRatio.
 */

import type { Rect, Rotation } from "./pdfTypes";

/** `[a, b, c, d, e, f]` — the same six numbers pdfjs puts in `viewport.transform`. */
export type Matrix6 = readonly [number, number, number, number, number, number];

export type Point = { x: number; y: number };

/** A `getBoundingClientRect()` result (CSS pixels, client coordinates). */
export type ScreenBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** The parts of a pdfjs `PageViewport` this module is allowed to know about. */
export type ViewportLike = {
  /** PDF user space → viewport space. */
  transform: Matrix6;
  /** Viewport size in viewport units (NOT device pixels). */
  width: number;
  height: number;
};

/** A rectangle in client (CSS pixel) coordinates. */
export type ScreenRect = { x: number; y: number; width: number; height: number };

/** [x0, y0, x1, y1] — a PDF box such as MediaBox or CropBox. */
export type BoxArray = readonly [number, number, number, number];

/* ------------------------------------------------------------------ *
 * Matrix primitives
 * ------------------------------------------------------------------ */

/** Apply `[a,b,c,d,e,f]`: `(x, y) → (a·x + c·y + e, b·x + d·y + f)`. */
export function applyMatrix(m: Matrix6, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

/**
 * Apply the inverse of `[a,b,c,d,e,f]`. Works for the reflections pdfjs
 * produces at /Rotate 90 and 270 (determinant -1), which is the entire point.
 */
export function applyInverseMatrix(m: Matrix6, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det || !Number.isFinite(det)) {
    throw new Error("pdfCoords: viewport transform is not invertible");
  }
  const dx = p.x - e;
  const dy = p.y - f;
  return { x: (d * dx - c * dy) / det, y: (a * dy - b * dx) / det };
}

/**
 * Rebuild the six numbers pdfjs would produce for a page, so callers (and
 * tests) can do the maths without instantiating pdfjs. This mirrors pdfjs's
 * `PageViewport` exactly, including the CropBox origin handling.
 *
 * `rotationDeg` is the EFFECTIVE rotation (the page's own /Rotate plus any the
 * admin added), and `viewBox` defaults to `[0, 0, widthPt, heightPt]`.
 */
export function makeViewport(
  widthPt: number,
  heightPt: number,
  rotationDeg = 0,
  scale = 1,
  viewBox?: BoxArray,
): ViewportLike {
  const box: BoxArray = viewBox ?? [0, 0, widthPt, heightPt];
  const [x0, y0, x1, y1] = box;
  const centerX = (x1 + x0) / 2;
  const centerY = (y1 + y0) / 2;

  let rotation = rotationDeg % 360;
  if (rotation < 0) rotation += 360;

  let rotateA: number, rotateB: number, rotateC: number, rotateD: number;
  switch (rotation) {
    case 180:
      rotateA = -1; rotateB = 0; rotateC = 0; rotateD = 1;
      break;
    case 90:
      rotateA = 0; rotateB = 1; rotateC = 1; rotateD = 0;
      break;
    case 270:
      rotateA = 0; rotateB = -1; rotateC = -1; rotateD = 0;
      break;
    default:
      rotateA = 1; rotateB = 0; rotateC = 0; rotateD = -1;
      break;
  }

  let offsetCanvasX: number, offsetCanvasY: number, width: number, height: number;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - y0) * scale;
    offsetCanvasY = Math.abs(centerX - x0) * scale;
    width = Math.abs(y1 - y0) * scale;
    height = Math.abs(x1 - x0) * scale;
  } else {
    offsetCanvasX = Math.abs(centerX - x0) * scale;
    offsetCanvasY = Math.abs(centerY - y0) * scale;
    width = Math.abs(x1 - x0) * scale;
    height = Math.abs(y1 - y0) * scale;
  }

  const transform: Matrix6 = [
    rotateA * scale,
    rotateB * scale,
    rotateC * scale,
    rotateD * scale,
    offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
    offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
  ];

  return { transform, width, height };
}

/* ------------------------------------------------------------------ *
 * Client ⇄ viewport (this is where devicePixelRatio dies)
 * ------------------------------------------------------------------ */

/** Client (CSS px, page coordinates) → viewport units. */
export function clientToViewport(p: Point, box: ScreenBox, vp: ViewportLike): Point {
  if (!box.width || !box.height) {
    throw new Error("pdfCoords: canvas bounding box has zero size");
  }
  return {
    x: (p.x - box.left) * (vp.width / box.width),
    y: (p.y - box.top) * (vp.height / box.height),
  };
}

/** Viewport units → client (CSS px, page coordinates). */
export function viewportToClient(p: Point, box: ScreenBox, vp: ViewportLike): Point {
  if (!vp.width || !vp.height) {
    throw new Error("pdfCoords: viewport has zero size");
  }
  return {
    x: box.left + p.x * (box.width / vp.width),
    y: box.top + p.y * (box.height / vp.height),
  };
}

/* ------------------------------------------------------------------ *
 * The public conversions
 * ------------------------------------------------------------------ */

/**
 * A pointer position (clientX/clientY) → a point in PDF user space.
 * Correct at every rotation because it uses the real inverse matrix.
 */
export function screenPointToPdf(p: Point, box: ScreenBox, vp: ViewportLike): Point {
  return applyInverseMatrix(vp.transform, clientToViewport(p, box, vp));
}

/** A point in PDF user space → a client (CSS px) position. */
export function pdfPointToScreen(p: Point, box: ScreenBox, vp: ViewportLike): Point {
  return viewportToClient(applyMatrix(vp.transform, p), box, vp);
}

/**
 * A drag between two OPPOSITE CORNERS on screen → a `Rect` in PDF user space.
 *
 * BOTH corners are mapped and only THEN reduced with min/max. Mapping one
 * corner and adding the width/height is the bug this module exists to prevent:
 * at /Rotate 90 the matrix is a reflection, so screen-width becomes PDF-height
 * and the sign of each axis flips.
 */
export function screenRectToPdfRect(
  a: Point,
  b: Point,
  box: ScreenBox,
  vp: ViewportLike,
): Rect {
  const p1 = screenPointToPdf(a, box, vp);
  const p2 = screenPointToPdf(b, box, vp);
  return rectFromCorners(p1, p2);
}

/** Same as `screenRectToPdfRect`, for a caller that already has a screen box. */
export function screenBoxToPdfRect(
  drawn: ScreenRect,
  box: ScreenBox,
  vp: ViewportLike,
): Rect {
  return screenRectToPdfRect(
    { x: drawn.x, y: drawn.y },
    { x: drawn.x + drawn.width, y: drawn.y + drawn.height },
    box,
    vp,
  );
}

/**
 * The inverse, for re-rendering an existing annotation onto the overlay.
 * Both opposite corners are mapped and reduced with min/max for the same
 * reason as above. The result is in CLIENT coordinates — an overlay positioned
 * inside the canvas box subtracts `box.left` / `box.top` (see `toLocalRect`).
 */
export function pdfRectToScreenRect(
  rect: Rect,
  box: ScreenBox,
  vp: ViewportLike,
): ScreenRect {
  const p1 = pdfPointToScreen({ x: rect.x, y: rect.y }, box, vp);
  const p2 = pdfPointToScreen(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    box,
    vp,
  );
  const r = rectFromCorners(p1, p2);
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Client coordinates → coordinates relative to the canvas box (for CSS `left`/`top`). */
export function toLocalRect(rect: ScreenRect, box: ScreenBox): ScreenRect {
  return {
    x: rect.x - box.left,
    y: rect.y - box.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Normalise two opposite corners into a positive-size rectangle. */
export function rectFromCorners(p1: Point, p2: Point): Rect {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  return {
    x,
    y,
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

/* ------------------------------------------------------------------ *
 * pdf-lib draw anchors
 * ------------------------------------------------------------------ */

export type DrawAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
};

/**
 * pdf-lib rotates a drawn box ABOUT ITS OWN x,y ANCHOR (counter-clockwise), so
 * the anchor you must pass is NOT the rectangle's bottom-left once an angle is
 * involved, and at 90/270 the width and height swap.
 *
 * Given the rectangle the admin sees (axis-aligned, PDF user space) and the
 * angle to draw at, this returns exactly what `drawRectangle` / `drawImage`
 * need so the result lands inside that rectangle:
 *
 *     0°   → (x,           y            )  w×h
 *     90°  → (x + width,   y            )  h×w   ← swapped
 *     180° → (x + width,   y + height   )  w×h
 *     270° → (x,           y + height   )  h×w   ← swapped
 */
export function rotatedDrawAnchor(rect: Rect, angleDeg: number): DrawAnchor {
  const angle = normalizeQuarterTurn(angleDeg);
  switch (angle) {
    case 90:
      return {
        x: rect.x + rect.width,
        y: rect.y,
        width: rect.height,
        height: rect.width,
        angleDeg: 90,
      };
    case 180:
      return {
        x: rect.x + rect.width,
        y: rect.y + rect.height,
        width: rect.width,
        height: rect.height,
        angleDeg: 180,
      };
    case 270:
      return {
        x: rect.x,
        y: rect.y + rect.height,
        width: rect.height,
        height: rect.width,
        angleDeg: 270,
      };
    default:
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        angleDeg: 0,
      };
  }
}

/** Snap any angle to the quarter turn PDF page rotation allows. */
export function normalizeQuarterTurn(angleDeg: number): Rotation {
  const n = ((Math.round(angleDeg / 90) * 90) % 360 + 360) % 360;
  return n as Rotation;
}

/* ------------------------------------------------------------------ *
 * Reading an existing line of text
 * ------------------------------------------------------------------ */

/**
 * A pdfjs text item's `transform` → the font size and angle to pre-fill a
 * white-out/retype box with. `sizePt` is the length of the matrix's first
 * basis vector; `angleDeg` is its direction (counter-clockwise, -180…180).
 */
export function textMatrixToSizeAndAngle(m: Matrix6): {
  sizePt: number;
  angleDeg: number;
} {
  const [a, b] = m;
  const angle = (Math.atan2(b, a) * 180) / Math.PI;
  return { sizePt: Math.hypot(a, b), angleDeg: angle === 0 ? 0 : angle };
}

/**
 * The baseline origin of a text item — `transform[4]`, `transform[5]`. Those
 * two numbers ARE the x,y that were handed to `drawText`, which is what makes
 * click-to-snap over existing text exact.
 */
export function textMatrixOrigin(m: Matrix6): Point {
  return { x: m[4], y: m[5] };
}

/* ------------------------------------------------------------------ *
 * Page geometry guard
 * ------------------------------------------------------------------ */

export type PageGeometry = {
  /** `/UserUnit`. Absent means the default, 1. */
  userUnit?: number;
  /** `/CropBox` as `[x0, y0, x1, y1]`. */
  cropBox?: BoxArray;
  /** `/MediaBox` as `[x0, y0, x1, y1]`. */
  mediaBox?: BoxArray;
};

export type GeometryIssue = {
  code: "user-unit" | "crop-origin";
  messageTh: string;
};

export type GeometryReport = {
  /** True when the page uses the ordinary 1-unit-per-point, origin-at-(0,0) space. */
  ok: boolean;
  issues: GeometryIssue[];
  /** The CropBox origin. Add it to a CropBox-relative point to get user space. */
  originOffset: Point;
  /** `/UserUnit` — points per unit. 1 for every ordinary page. */
  userUnit: number;
};

/**
 * Guard for the two page setups that quietly break the arithmetic above:
 *
 *  • `/UserUnit` other than 1 — the file redefines how big a "point" is, so
 *    every size we compute is off by that factor.
 *  • a `/CropBox` whose origin is not (0,0) — the visible page starts at an
 *    offset, so a coordinate measured from the canvas is shifted by it. pdfjs
 *    bakes the offset into the viewport transform, but pdf-lib does NOT apply
 *    it when drawing, so the two disagree unless the caller compensates with
 *    `originOffset`.
 *
 * Callers should surface `issues` to the admin rather than silently drawing in
 * the wrong place.
 */
export function inspectPageGeometry(g: PageGeometry): GeometryReport {
  const userUnit = typeof g.userUnit === "number" && g.userUnit > 0 ? g.userUnit : 1;
  const box = g.cropBox ?? g.mediaBox;
  const originOffset: Point = box ? { x: box[0], y: box[1] } : { x: 0, y: 0 };
  const issues: GeometryIssue[] = [];

  if (userUnit !== 1) {
    issues.push({
      code: "user-unit",
      messageTh: `ไฟล์นี้กำหนดหน่วยวัดพิเศษ (UserUnit = ${userUnit}) ตำแหน่งและขนาดที่วางอาจคลาดเคลื่อน`,
    });
  }
  if (originOffset.x !== 0 || originOffset.y !== 0) {
    issues.push({
      code: "crop-origin",
      messageTh: `หน้านี้มีขอบเขตการแสดงผล (CropBox) เริ่มที่ (${originOffset.x}, ${originOffset.y}) ไม่ใช่ (0, 0) ตำแหน่งที่วางอาจเลื่อนจากที่เห็น`,
    });
  }

  return { ok: issues.length === 0, issues, originOffset, userUnit };
}

/** CropBox-relative point → PDF user space. */
export function cropRelativeToUserSpace(p: Point, report: GeometryReport): Point {
  return { x: p.x + report.originOffset.x, y: p.y + report.originOffset.y };
}

/** PDF user space → CropBox-relative point. */
export function userSpaceToCropRelative(p: Point, report: GeometryReport): Point {
  return { x: p.x - report.originOffset.x, y: p.y - report.originOffset.y };
}
