// Text layout numbers the PDF export (pdfApplyEdits) and the editor's
// on-screen preview (PageOverlay) must agree on, or the downloaded PDF stops
// looking like what the admin saw. Kept apart from pdfApplyEdits — which pulls
// in pdf-lib and is loaded only when he downloads — so the preview can import
// them for free.

/**
 * Baseline-to-baseline distance as a multiple of the font size. The on-screen
 * overlay must use the same number or the preview and the download disagree.
 */
export const LINE_HEIGHT_RATIO = 1.2;
