export function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, '');
}

/**
 * Replace non-breaking spaces (U+00A0 / `&nbsp;`) with regular ones.
 *
 * Content pasted from Word or a manufacturer spec page routinely carries
 * `&nbsp;` in place of normal spaces. A browser will NEVER break a line at
 * U+00A0 — that is the one thing the character is defined to do — so a run of
 * "words" joined only by non-breaking spaces reads to the layout engine as one
 * long unbreakable token. `overflow-wrap: break-word` (the wrapping rule this
 * project uses everywhere rich text is shown) then has no real word boundary
 * left to break at and starts chopping every word mid-letter to avoid
 * overflowing its column — the exact "W / orkplace" mid-word wrapping this
 * fixes. Plain CSS cannot fix this: no `white-space` or `word-break` value
 * changes whether U+00A0 counts as a break opportunity, since that is fixed by
 * the Unicode character itself, not by styling. The only fix is to not have
 * the character there at all.
 */
export function normalizeNbsp(html: string): string {
  if (!html) return "";
  return html.replace(/ /g, " ");
}
