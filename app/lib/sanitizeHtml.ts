import DOMPurify from "isomorphic-dompurify";

// Allowlist tuned to what the RichTextEditor (react-quill-new) can produce:
// basic inline formatting, lists, links, headings, and inline color/size
// styling. Anything outside this set (scripts, event handlers, iframes,
// javascript:/data: URLs) is stripped by DOMPurify.
const ALLOWED_TAGS = [
  "p", "br", "span", "div",
  "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup",
  "ol", "ul", "li",
  "a", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
];
const ALLOWED_ATTR = ["href", "target", "rel", "style", "class"];

/**
 * Sanitize admin-authored rich-text HTML *before it is stored*, so it can be
 * safely rendered with dangerouslySetInnerHTML on public pages. Called from the
 * server-only stores, so isomorphic-dompurify runs in Node (never bundled into
 * the client). Strips scripts / event handlers / dangerous URLs while keeping
 * the formatting the editor emits.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
