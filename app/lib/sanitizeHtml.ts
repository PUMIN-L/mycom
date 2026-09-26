import "server-only";
import sanitize from "sanitize-html";
import { normalizeNbsp } from "./stripHtml";
import { escapeNonTagAngleBrackets } from "./htmlTags";

// Server-side HTML sanitizer. Previously DOMPurify via isomorphic-dompurify,
// whose jsdom backend failed to LOAD on Vercel's serverless runtime
// (ERR_REQUIRE_ESM deep inside jsdom's dependency tree), 500-ing every page
// that imports a store — while working fine locally. sanitize-html is pure JS
// (htmlparser2), needs no DOM, and loads anywhere Node runs.
//
// Allowlist tuned to what the RichTextEditor (react-quill-new) can produce:
// basic inline formatting, lists, links, headings, and inline color/size
// styling. Anything outside this set (scripts, event handlers, iframes,
// javascript:/data: URLs, data-* attributes) is stripped.
const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: [
    "p", "br", "span", "div",
    "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup",
    "ol", "ul", "li",
    "a", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    "*": ["style", "class"],
    a: ["href", "target", "rel"],
  },
  // The editor's toolbar only ever emits color/background-color/font-size —
  // anything else in a `style` attribute (position, background-image url(),
  // etc.) has no legitimate source and is dropped rather than trusted as-is.
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/, /^[a-zA-Z]+$/],
      "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/, /^[a-zA-Z]+$/],
      "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
    },
  },
  // http(s)/mailto/tel only — blocks javascript: and data: URLs.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  // Text inside removed <script>/<style> tags is discarded, not leaked as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  // A target="_blank" link the editor produces gets a window handle to the
  // page that opened it (via window.opener) unless rel carries noopener —
  // that lets the linked page navigate the original tab to a phishing page
  // ("reverse tabnabbing"). noreferrer additionally withholds the Referer
  // header. Force both onto any anchor with a target, preserving whatever
  // rel tokens (if any) were already there.
  transformTags: {
    a: (tagName: string, attribs: Record<string, string>) => {
      if (attribs.target) {
        const rel = new Set((attribs.rel || "").split(/\s+/).filter(Boolean));
        rel.add("noopener");
        rel.add("noreferrer");
        attribs.rel = Array.from(rel).join(" ");
      }
      return { tagName, attribs };
    },
  },
};

/**
 * Sanitize admin-authored rich-text HTML *before it is stored*, so it can be
 * safely rendered with dangerouslySetInnerHTML on public pages. Called from the
 * server-only stores (this module is `server-only`), so the sanitizer is never
 * bundled into the client. Strips scripts / event handlers / dangerous URLs
 * while keeping the formatting the editor emits.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return "";
  // Runs before the tag/attribute allowlist below — this is a plain character
  // substitution in text content, not a markup concern, and doing it first
  // means every new save is clean regardless of where the editor put the
  // nbsp. See normalizeNbsp for why the character has to go, not just be
  // styled around. Existing rows saved before this landed are handled
  // separately at render time (ShowcaseClient.tsx) rather than by a migration
  // — there is no better source of truth for "what did the admin actually
  // write" than the row itself, and rewriting it isn't needed to fix display.
  return sanitize(normalizeNbsp(html), SANITIZE_OPTIONS);
}

/**
 * Plain-text fields (names, notes, references, addresses…): every tag is
 * removed, and the result is PLAIN TEXT.
 *
 * sanitize-html removes the tags and then, like any HTML serialiser, escapes
 * what is left — `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;` (those three
 * only; nothing else comes out encoded). That is right for HTML and was wrong
 * here: every one of these fields is shown as TEXT — a React text node, a PDF,
 * an Excel cell, a text email — so the escapes were shown literally.
 * "A&B Co., Ltd." read "A&amp;B Co., Ltd." on screen, on quotations and on the
 * public site, and a note search for "A&B" found nothing. The three escapes
 * are undone here, `&amp;` LAST, so an escaped entity such as "&amp;lt;"
 * comes back as the "&lt;" that was typed rather than as "<".
 *
 * Only REAL tags are removed (`escapeNonTagAngleBrackets`, lib/htmlTags.ts):
 * an HTML parser takes every "<" followed by a letter for a tag and drops it
 * with the text after it, so "PS<B-200" used to be saved as "PS". Such a "<"
 * is handed to the parser as "&lt;" and comes back as the character. HTML
 * pasted in, or a catalog title copied into a plain field, is still stripped.
 *
 * ⚠️ The result may contain `<`, `>` and `&` as characters. Render it as text
 * (React escapes it); never put it into dangerouslySetInnerHTML or an HTML
 * string. Rows written before v44 were decoded by the bootstrap
 * (decodeStoredPlainText in db.ts).
 */
export function sanitizePlainText(text: string | null | undefined): string {
  if (!text) return "";
  return sanitize(escapeNonTagAngleBrackets(text), { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
