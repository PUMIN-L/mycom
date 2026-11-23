// An address with a space after each label word — the owner's request for the
// accounting papers (2026-11-23): "อำเภอเมือง" → "อำเภอ เมือง". Done when the
// paper is drawn, never in the stored text, so a document already issued
// prints spaced too. Pure and client-safe.
//
// Only AFTER a label at the start of a word, and only when the name follows
// with no space: the name itself is never split ("อำเภอ เมืองนนทบุรี"), a
// label inside a word is left alone ("บ้านเขตร"), and so is a word that only
// begins like one ("หมู่บ้าน", "หมู่ที่" — หมู่ and เลขที่ count as labels
// only before a number).
//
// No lookbehind: older iOS Safari cannot parse one, and the whole page would
// fail to load — the start of a word is a captured group instead.

/** The start of a word: the text's start, a space or line break, a comma, a bracket, a slash. */
const START = "(^|[\\s,(/])";
/** What follows a label that names something: a Thai consonant or leading vowel, or a number. */
const NAME = "(?=[\\u0E01-\\u0E2E\\u0E40-\\u0E440-9\\u0E50-\\u0E59])";
/** A number, Arabic or Thai. */
const NUMBER = "(?=[0-9\\u0E50-\\u0E59])";

const RULES: readonly RegExp[] = [
  new RegExp(`${START}(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|ถนน|ซอย)${NAME}`, "g"),
  new RegExp(`${START}(หมู่|เลขที่)${NUMBER}`, "g"),
  // The short forms: ต. อ. จ. ถ. ซ. before a name, ม. (หมู่) before a number.
  new RegExp(`${START}([ตอจถซ]\\.)${NAME}`, "g"),
  new RegExp(`${START}(ม\\.)${NUMBER}`, "g"),
];

/** `text` with a space after each address label that runs straight into its name. */
export function spaceAddressLabels(text: string): string {
  let out = text;
  for (const rule of RULES) out = out.replace(rule, "$1$2 ");
  return out;
}
