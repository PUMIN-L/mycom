import "server-only";
import { ApiError } from "./apiHelpers";
import { sanitizeRichText } from "./sanitizeHtml";
import { stripHtml } from "./stripHtml";

// How long a rich-text field (the editor's HTML) may be. Limited by its TEXT —
// what the forms count with stripHtml — and refused when over, never cut.
//
// The stores used to store sanitizeRichText(x).substring(0, 255): a cut by
// length of HTML. Formatting is HTML — a bold, large title carries ~60
// characters of tags, every coloured word ~40 — so a title the form accepted
// (203 characters of text) was 262 of HTML and was stored as
// "…Calibration</span></stro". Rendered on the server, that broken tag
// swallowed the page after it: the next paragraph and links ended up inside
// the <h1>, in bold, and the end of the text was lost without a word.
//
// So the columns hold the whole HTML (TEXT for titles and names, MEDIUMTEXT
// for descriptions — db.ts v46), the server counts text exactly as the forms
// do, and `html` is only a ceiling the database can always hold: 4 bytes per
// character at most (utf8mb4), so 16,000 fits TEXT's 65,535 bytes. For
// descriptions the column (MEDIUMTEXT, 16 MB) is not the limit — the ROW is:
// TiDB refuses an entry over 6 MB (txn-entry-size-limit), and a product row,
// and its revision snapshot, carry all three descriptions and all three
// titles. 3 × 200,000 × 4 + 3 × 16,000 × 4 ≈ 2.6 MB stays well inside, and
// 200,000 is still twenty characters of markup for every one of text.

export interface RichTextLimit {
  /** Characters of text, as stripHtml counts them — the forms' own limit. */
  text: number;
  /** Characters of HTML, tags included. */
  html: number;
}

export const TITLE_LIMIT: RichTextLimit = { text: 255, html: 16_000 };
export const DESCRIPTION_LIMIT: RichTextLimit = { text: 10_000, html: 200_000 };

/** A 400 that names the field, through withRoute like any ApiError. */
export class RichTextTooLongError extends ApiError {
  constructor(message: string) {
    super(400, message);
    this.name = "RichTextTooLongError";
  }
}

/**
 * Sanitized `raw`, whole — or RichTextTooLongError when its text, or its HTML,
 * is over `limit`. `label` names the field in the message ("ชื่อสินค้า
 * (ภาษาไทย)").
 */
export function cleanRichText(raw: string | null | undefined, label: string, limit: RichTextLimit): string {
  const html = sanitizeRichText(raw);
  if (stripHtml(html).length > limit.text) {
    throw new RichTextTooLongError(`${label} ต้องมีความยาวไม่เกิน ${limit.text.toLocaleString("en-US")} ตัวอักษร`);
  }
  if (html.length > limit.html) {
    throw new RichTextTooLongError(`${label} มีการจัดรูปแบบ (สี ตัวหนา ขนาดตัวอักษร) มากเกินไป กรุณาลดการจัดรูปแบบลง`);
  }
  return html;
}
