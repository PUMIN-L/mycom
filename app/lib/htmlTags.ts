// Which "<" in a piece of PLAIN TEXT starts a real HTML tag. Pure, no
// dependencies — shared by the server (sanitizePlainText) and the browser
// (displayText, the note-replace warning), so what is removed on save and
// what is read as HTML on screen follow the one rule.
//
// Why a rule at all: sanitize-html (like any HTML parser) treats EVERY "<"
// followed by a letter as the start of a tag, and drops it together with the
// text up to the next ">" — or to the end. So a model "PS<B-200" was saved as
// "PS", "Size <M>" as "Size ", "a<b c" as "a". Plain text is always shown as
// text (see sanitizePlainText), so a "<" only needs removing when it really is
// markup — HTML pasted in, or a catalog title (rich text) copied into a plain
// field. Everything else is a character the admin typed.

/** Every HTML element name, current and obsolete, plus the SVG/MathML roots. */
const HTML_ELEMENTS = new Set(
  (
    "a abbr acronym address applet area article aside audio b base basefont bdi bdo bgsound big blink " +
    "blockquote body br button canvas caption center cite code col colgroup data datalist dd del details " +
    "dfn dialog dir div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 " +
    "h4 h5 h6 head header hgroup hr html i iframe image img input ins isindex kbd keygen label legend li " +
    "link listing main map mark marquee math menu menuitem meta meter multicol nav nextid nobr noembed " +
    "noframes noscript object ol optgroup option output p param picture plaintext portal pre progress q rb " +
    "rp rt rtc ruby s samp script search section select slot small source spacer span strike strong style " +
    "sub summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul var " +
    "video wbr xmp"
  ).split(" ")
);

/**
 * Elements that are markup on their own, with no closing tag or attribute
 * needed to show it: void elements and the ones that embed or run something.
 * Any other element counts only when it is closed later or carries an
 * attribute, so "<S>", "<A>" or "<B>" alone (a size, a grade) stays text.
 */
const STANDALONE_ELEMENTS = new Set(
  (
    "area base basefont bgsound br col embed frame hr image img input isindex keygen link meta param " +
    "source spacer track wbr applet audio canvas frameset iframe math noembed noframes noscript object " +
    "plaintext portal script select style svg template textarea video xmp"
  ).split(" ")
);

// The rule, per "<":
//   COMPLETE — "<", an optional "/", a tag name, a boundary (whitespace, "/"
//   or ">"), then the rest up to the next ">". A known element counts when it
//   is a closing tag, a standalone element, carries an attribute, or is
//   closed again later. A name followed by anything else ("<B-200", "<h2o")
//   is not a tag name at all.
//   UNCLOSED — no ">" anywhere after it. Still markup when it is a known
//   element that runs or embeds something, or carries an attribute
//   ("<img src=x onerror=…"): kept as text it would be one ">" away from live
//   HTML wherever a careless caller glued it into markup. "a<b c" or "5<a"
//   stay text.
//
// LINEAR TIME. Everything a decision needs — where the next ">" is, where the
// next character that is not whitespace or "/" is, where the last "=" is, and
// where each element name is last closed — is found in ONE pass over the text
// first; each "<" is then decided in constant time. Deciding each "<" by
// scanning forward was quadratic: a 240 KB note of "<b x" took 7.6 s, and the
// 4 MB a request can carry would hold a function until it timed out.

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[a-zA-Z0-9]/;
const SPACE = /\s/;

interface TagScan {
  text: string;
  /** Index of the first ">" at or after i, or -1. */
  nextGt: Int32Array;
  /** Index of the first character at or after i that is neither whitespace nor "/". */
  nextSignificant: Int32Array;
  lastEquals: number;
  /** Lower-case element name → start index of its last closing tag ("</name" + whitespace or ">"). */
  lastClose: Map<string, number>;
}

function scan(text: string): TagScan {
  const n = text.length;
  const nextGt = new Int32Array(n + 1);
  const nextSignificant = new Int32Array(n + 1);
  nextGt[n] = -1;
  nextSignificant[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    const c = text[i];
    nextGt[i] = c === ">" ? i : nextGt[i + 1];
    nextSignificant[i] = c === "/" || SPACE.test(c) ? nextSignificant[i + 1] : i;
  }
  const lastClose = new Map<string, number>();
  for (const m of text.matchAll(/<\/([a-zA-Z][a-zA-Z0-9]*)(?=[\s>])/g)) {
    lastClose.set(m[1].toLowerCase(), m.index);
  }
  return { text, nextGt, nextSignificant, lastEquals: text.lastIndexOf("="), lastClose };
}

function tagAt(s: TagScan, index: number): boolean {
  const { text } = s;
  if (text[index] !== "<") return false;
  let j = index + 1;
  const closing = text[j] === "/";
  if (closing) j++;
  if (!NAME_START.test(text[j] ?? "")) return false;
  let end = j + 1;
  while (end < text.length && NAME_CHAR.test(text[end])) end++;
  const name = text.slice(j, end).toLowerCase();
  const boundary = text[end]; // undefined at the end of the text
  const gt = s.nextGt[end];

  if (gt !== -1 && (boundary === ">" || boundary === "/" || SPACE.test(boundary))) {
    if (!HTML_ELEMENTS.has(name)) return false;
    if (closing) return true;
    if (STANDALONE_ELEMENTS.has(name)) return true;
    if (s.nextSignificant[end] < gt) return true; // has attributes
    // A plain opening tag ("<b>", "<p>") is markup when it is closed later.
    return (s.lastClose.get(name) ?? -1) > gt;
  }

  if (gt === -1 && !closing && (boundary === undefined || boundary === "/" || SPACE.test(boundary))) {
    return HTML_ELEMENTS.has(name) && (STANDALONE_ELEMENTS.has(name) || s.lastEquals >= end);
  }
  return false;
}

/** Whether the "<" at `index` starts a real HTML tag (see the file header). */
export function isHtmlTagAt(text: string, index: number): boolean {
  return tagAt(scan(text), index);
}

/** Whether `text` holds at least one real HTML tag. */
export function containsHtmlTag(text: string | null | undefined): boolean {
  if (!text || !text.includes("<")) return false;
  const s = scan(text);
  for (let i = text.indexOf("<"); i !== -1; i = text.indexOf("<", i + 1)) {
    if (tagAt(s, i)) return true;
  }
  return false;
}

/**
 * `text` with every "<" that does NOT start a real tag written as "&lt;", so
 * an HTML parser (sanitize-html) reads it as the character it is instead of
 * swallowing the text after it. Real tags are left for the parser to remove.
 */
export function escapeNonTagAngleBrackets(text: string): string {
  if (!text.includes("<")) return text;
  const s = scan(text);
  const parts: string[] = [];
  let from = 0;
  for (let i = text.indexOf("<"); i !== -1; i = text.indexOf("<", i + 1)) {
    if (tagAt(s, i)) continue;
    parts.push(text.slice(from, i), "&lt;");
    from = i + 1;
  }
  parts.push(text.slice(from));
  return parts.join("");
}
