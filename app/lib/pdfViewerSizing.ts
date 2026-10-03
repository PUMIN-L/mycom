// How big the public PDF viewer (/document/[id]) draws each page. Pure — the
// viewer measures its own width and asks here.
//
// It used to draw every page at a fixed scale of 1.5 (an A4 page ≈ 893 CSS px
// wide) and squeeze the canvas to the screen with CSS. On a phone that meant a
// canvas several times larger than the screen, times a device pixel ratio of
// 3, for EVERY page of a catalog at once — enough to stall or blank the page
// on an iPhone — while the text layer, which CSS did not squeeze, stuck out
// sideways. Now a page is drawn as wide as it is shown.

/** Zoom is relative to "fit": 1 = the page fills the viewer's width. */
export const PDF_ZOOM_MIN = 0.5;
export const PDF_ZOOM_MAX = 3;
export const PDF_ZOOM_STEP = 0.25;

/** Never wider than this at zoom 1 — about what scale 1.5 drew on a desktop. */
const MAX_FIT_WIDTH = 900;

/** Space kept either side of a page: less on a phone, where width is scarce. */
export function pdfGutter(containerWidth: number): number {
  return containerWidth < 640 ? 8 : 16;
}

/** CSS width to draw each page at, or null before the viewer is measured. */
export function pdfPageWidth(containerWidth: number, zoom: number): number | null {
  if (!(containerWidth > 0)) return null;
  const available = Math.max(0, containerWidth - 2 * pdfGutter(containerWidth));
  const fit = Math.min(available, MAX_FIT_WIDTH);
  const clamped = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, zoom));
  return Math.max(1, Math.round(fit * clamped));
}

/** Pixels in one canvas, at most. iOS Safari refuses (draws blank) canvases
 *  over 16,777,216; this leaves headroom. */
const MAX_CANVAS_PIXELS = 12_000_000;
/** A phone at 3× gains little over 2× for a document and costs 2.25× the memory. */
const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * The device pixel ratio to draw a page `width` CSS px wide (height
 * `width × aspect`) at: the screen's own, capped at 2, and lowered further so
 * that one canvas stays under MAX_CANVAS_PIXELS when zoomed in far.
 */
export function pdfDevicePixelRatio(width: number, aspect: number, screenRatio: number): number {
  const wanted = Math.min(Math.max(screenRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
  const cssPixels = width * width * Math.max(aspect, 0.01);
  const fits = Math.sqrt(MAX_CANVAS_PIXELS / cssPixels);
  return Math.max(0.5, Math.min(wanted, fits));
}
