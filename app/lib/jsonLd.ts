// Structured data for <script type="application/ld+json">.

// "<" written as its JSON unicode escape (backslash, "u003c"), so a value
// holding "</script>" cannot close the tag. Built from two strings so the
// escape stays literal in this source file.
const LT_ESCAPE = "\\" + "u003c";

/** The script tag's inner HTML: JSON with every "<" escaped. */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, LT_ESCAPE);
}
