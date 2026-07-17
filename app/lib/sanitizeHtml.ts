import "server-only";
import sanitize from "sanitize-html";

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
  // http(s)/mailto/tel only — blocks javascript: and data: URLs.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  // Text inside removed <script>/<style> tags is discarded, not leaked as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
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
  return sanitize(html, SANITIZE_OPTIONS);
}
