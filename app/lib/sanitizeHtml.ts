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
  return sanitize(html, SANITIZE_OPTIONS);
}

/**
 * Sanitize plain-text fields (like titles) that shouldn't contain any HTML tags.
 */
export function sanitizePlainText(text: string | null | undefined): string {
  if (!text) return "";
  return sanitize(text, { allowedTags: [], allowedAttributes: {} });
}
