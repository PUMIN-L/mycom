import { containsHtmlTag } from "./htmlTags";

function stripTags(html: string): string {
  return html.replace(/<[^>]*>?/gm, "");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Character references → characters, ONCE ("&amp;lt;" reads "&lt;"). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[lower] ?? entity;
  });
}

/**
 * Rich text (HTML) → its text, spaces and line layout aside: tags removed,
 * then character references decoded once. For labels, alt text, search and
 * length checks on a catalog title or category name.
 *
 * It used to remove the tags only, so every "&" sanitize-html had stored as
 * "&amp;" showed as "&amp;" — in the product pickers, the home cards'
 * English line, and the product names it put on quotations.
 *
 * NOT for plain text (a `<` there is a character — see displayText), and the
 * result is text: render it as a text node or attribute, never as HTML.
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  return decodeEntities(stripTags(html));
}

/**
 * Rich text → the plain text a reader sees, for places that are NOT HTML:
 * <title>, meta descriptions, alt text, JSON-LD, URL slugs.
 *
 * stripHtml alone leaves entities behind, and sanitize-html (every stored
 * rich-text field, §5) escapes `&` `<` `>` `"` in text — so a category named
 * "Hardness & Durometer" is stored as "Hardness &amp; Durometer", and a title
 * built with stripHtml showed "&amp;" to Google. Tags go first — a line or
 * paragraph break becomes a space, so "<p>A</p><p>B</p>" reads "A B", not
 * "AB" — then entities are decoded ONCE (so "&amp;lt;" reads "&lt;", as the
 * author typed it), then whitespace — including non-breaking spaces —
 * collapses to single spaces.
 *
 * The result is text: render it as a React text node or attribute (escaped),
 * never back into dangerouslySetInnerHTML.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  return decodeEntities(stripTags(html.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th)\b[^>]*>/gi, " ")))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A value that may be rich text OR plain text, as text for display.
 *
 * Some fields mix the two — an equipment's product name is the name typed on
 * the machine (plain text, sanitizePlainText) or, when it has none, the
 * catalog title (rich text, "<p>A &amp; B</p>"); see EQUIPMENT_SELECT in
 * crmStore.ts. stripHtml showed the catalog's "&amp;" literally; htmlToText
 * on a plain name would cut "5 < 10" down to "5". So only a value holding a
 * real tag is read as HTML, and a plain one is shown as typed. "Real tag" is
 * the same rule sanitizePlainText saves by (lib/htmlTags.ts), so a model
 * "PS<B-200>" the save kept is not then hidden on screen.
 *
 * Returns text: render it as a React text node, never as HTML.
 */
export function displayText(value: string | null | undefined): string {
  if (!value) return "";
  return containsHtmlTag(value) ? htmlToText(value) : value.trim();
}

/**
 * Plain text cut to at most `max` characters (code points), at a word when
 * one ends reasonably close, and marked with "…" when anything was cut.
 * For meta descriptions — Google shows ~160 characters — and card blurbs.
 */
export function clipText(text: string, max = 160): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join("");
  const atSpace = cut.lastIndexOf(" ");
  return `${(atSpace > cut.length * 0.6 ? cut.slice(0, atSpace) : cut).trimEnd()}…`;
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
