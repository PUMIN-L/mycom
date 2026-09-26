// Showing rich text (the RichTextEditor's HTML) the way the editor showed it.
// Pure, no dependencies beyond this folder — used by server and client pages.
//
// What the editor (Quill 2) does that a plain HTML render does not:
//   * SPACES. Its editing area is `white-space: pre-wrap`, so two spaces are
//     two spaces and a line may start with a space. getSemanticHTML (what
//     react-quill-new hands onChange) even writes EVERY space as &nbsp;. The
//     pages turned those into ordinary spaces so lines can wrap
//     (normalizeNbsp) — and then, rendered as normal HTML, every run of spaces
//     collapsed to one. Render with the `rich-text` class (globals.css), which
//     is pre-wrap again: ordinary spaces that are kept AND wrap.
//   * LINES. Enter makes a new paragraph with no gap before it; an empty line
//     is an empty paragraph. `rich-text` gives paragraphs no margin, as the
//     editor does, where the pages used to add one to every paragraph — or
//     laid them out inline, joining every line into one.
//   * SIZES. The size menu writes classes (ql-size-small/large/huge) that only
//     the editor's own stylesheet styled; `rich-text` styles them too.
//
// Stored HTML is already sanitised (sanitizeRichText); nothing here adds
// markup except <br> and list markers.

import { normalizeNbsp } from "./stripHtml";

const BLOCK_TAGS = "p|div|h[1-6]|blockquote|pre|ol|ul|li";
// Whitespace between two block tags. It is dropped — except when it is the
// whole content of one element ("<p>  </p>": an opening tag, then its closing
// one), which is a line of spaces the author typed.
const BETWEEN_BLOCKS = new RegExp(
  `(<(\\/?)(?:${BLOCK_TAGS})\\b[^>]*>)\\s+(?=<(\\/?)(?:${BLOCK_TAGS})\\b)`,
  "gi"
);
const dropBetweenBlocks = (html: string) =>
  html.replace(BETWEEN_BLOCKS, (match, tag: string, closeA: string, closeB: string) =>
    closeA === "" && closeB === "/" ? match : tag
  );

/**
 * Stored rich text, ready for `dangerouslySetInnerHTML` inside an element with
 * the `rich-text` class. Non-breaking spaces become ordinary ones (they wrap;
 * pre-wrap keeps every one). Whitespace between block tags is dropped — under
 * pre-wrap it would show as an extra line — and a raw line break in the source
 * reads as one space, as it does in HTML: the editor never writes one, and
 * loading such text into the editor shows it that way too.
 */
export function richTextHtml(html: string | null | undefined): string {
  if (!html) return "";
  const parts = normalizeNbsp(html)
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    // A <pre> (only pasted content has one — the toolbar has no code block)
    // keeps its line breaks and spacing: that is what <pre> means.
    .split(/(<pre\b[\s\S]*?<\/pre>)/i);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let out = dropBetweenBlocks(part)
        .replace(/[ \t]*[\r\n]+[ \t]*/g, " ")
        // A paragraph with nothing in it has no height; the editor shows it
        // as an empty line (its own empty lines carry a <br>).
        .replace(/<p(\b[^>]*)><\/p>/gi, "<p$1><br></p>");
      // Whitespace against a <pre> is between two blocks too.
      if (i > 0) out = out.replace(/^\s+(?=<|$)/, "");
      if (i < parts.length - 1) out = out.replace(/(^|>)\s+$/, "$1");
      return out;
    })
    .join("");
}

/** Plain text made safe to place where rich text's HTML goes — for a fallback
 *  (an id, a placeholder) shown in the same dangerouslySetInnerHTML slot. */
export function escapeHtmlText(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>$/;
const LINE_BLOCKS = /^(p|div|h[1-6]|blockquote|pre)$/;

/**
 * Stored rich text for a COMPACT place — a product card, a category in a
 * list, a chip — where the text runs inline (so the card can clamp it to a
 * line or two) yet each line the author typed must still start a new line.
 * Paragraphs become <br>s (an empty paragraph one empty line), list items a
 * "• " or "1. " line, and blank lines at the very start or end are dropped;
 * inline formatting (bold, colour, size…) is kept. Render inside `rich-text`.
 */
export function richTextInline(html: string | null | undefined): string {
  const h = richTextHtml(html).replace(/<p(\b[^>]*)>\s*<br\s*\/?>\s*<\/p>/gi, "<p$1></p>");
  let out = "";
  let started = false;
  const lists: { ordered: boolean; n: number }[] = [];
  // A new line: a break after real content; before any, drop what came first
  // (only whitespace and empty formatting), so a blank first line is no line.
  const lineBreak = () => {
    if (started) out += "<br>";
    else out = "";
  };

  for (const part of h.split(/(<[^>]*>)/)) {
    if (!part) continue;
    const m = TAG.exec(part);
    if (!m) {
      out += part;
      if (part.trim() !== "") started = true;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (name === "ul" || name === "ol") {
      if (closing) lists.pop();
      else lists.push({ ordered: name === "ol", n: 0 });
    } else if (name === "li") {
      if (!closing) {
        lineBreak();
        const list = lists[lists.length - 1];
        const depth = Math.max(0, lists.length - 1);
        const marker = list?.ordered ? `${++list.n}. ` : "• ";
        out += "  ".repeat(depth) + marker;
        started = true;
      }
    } else if (LINE_BLOCKS.test(name)) {
      if (!closing) lineBreak();
    } else if (name === "br") {
      out += "<br>";
      started = true;
    } else {
      out += part; // inline formatting: span, strong, em, u, s, a, sub, sup…
    }
  }
  // Blank lines at the end — empty, or holding only spaces — are no lines.
  return out.replace(/(?:<br>\s*)+$/, "");
}

/**
 * The alignment the editor's align menu gave EVERY line of `html` —
 * "center", "right" or "justify" — or undefined (left, or lines aligned
 * differently). For compact places: richTextInline drops the paragraphs and
 * with them their ql-align-* classes, so the container takes this instead.
 * Empty lines do not count.
 */
export function richTextAlign(html: string | null | undefined): "center" | "right" | "justify" | undefined {
  const h = richTextHtml(html).replace(/<p\b[^>]*>\s*(?:<br\s*\/?>)?\s*<\/p>/gi, "");
  const aligns = new Set<string>();
  for (const m of h.matchAll(/<(?:p|div|h[1-6]|li|blockquote|pre)\b([^>]*)>/gi)) {
    aligns.add(/\bql-align-(center|right|justify)\b/.exec(m[1])?.[1] ?? "left");
  }
  const [only] = aligns;
  return aligns.size === 1 && only !== "left" ? (only as "center" | "right" | "justify") : undefined;
}

/**
 * Rich text as PLAIN TEXT that keeps its lines and spaces — for text-only
 * places (the catalog cards, which ship text to stay light) rendered with
 * `white-space: pre-wrap`. Like htmlToText, but a paragraph or <br> is a
 * newline and a run of spaces stays a run. Blank lines at the start or end
 * are dropped. For <title>, meta or JSON-LD use htmlToText (one line).
 */
export function htmlToTextLines(html: string | null | undefined): string {
  if (!html) return "";
  const text = richTextInline(html)
    .replace(/<br>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
      const lower = body.toLowerCase();
      if (lower.startsWith("#")) {
        const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[lower] ?? entity;
    });
  return text.replace(/^\s*\n/, "").replace(/\n\s*$/, "").replace(/\s+$/, "");
}
