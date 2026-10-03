// Thai phone numbers, for links and structured data. Pure — used by client
// components (Contact, Footer) as well as the server, which is why it is not
// in settingsStore (that module talks to the database).

/**
 * Thai domestic phone display format (e.g. "062-012-9895") -> E.164 (e.g.
 * "+66620129895"), for structured data and tel: links. Thai mobile/landline
 * numbers drop the leading 0 and prepend the country code.
 *
 * Admin-entered free text, so it may already be in international format
 * (e.g. "+66-62-012-9895") — only bare local numbers ("062-012-9895") get the
 * leading 0 stripped and +66 prepended; anything already carrying the
 * country code is passed through as-is instead of getting +66 doubled up.
 */
export function toThaiE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.replace(/\D/g, "")}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  // A real Thai local number always starts with "0" once stripped of
  // formatting — a leading "66" (with no "+") only happens when the country
  // code was typed without the plus sign.
  if (digits.startsWith("66") && digits.length > 9) {
    return `+${digits}`;
  }
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+66${local}`;
}

export interface PhonePart {
  /** Exactly as typed — separators, labels and all. */
  text: string;
  /** "tel:+66…" for a part that is a phone number; null for anything else. */
  href: string | null;
}

/** Between numbers: a comma, slash, semicolon, bar, "หรือ" or "or". */
const SEPARATOR = /(\s*(?:,|\/|;|\||หรือ|\bor\b)\s*)/i;
/** An extension, which the dialler must not get: "ต่อ 12", "ext. 12". */
const EXTENSION = /\s*(?:ต่อ|ext\.?)\s*\d.*$/i;

/**
 * A Thai number has a fixed shape once the 0 is dropped: a landline is 8
 * digits from 2–7, a mobile 9 digits from 6, 8 or 9. Anything else — "02-123-
 * 4567-8" (4567 or 4568) is 10 digits from 2 — would DIAL A WRONG NUMBER if
 * linked, so it stays text. A number outside Thailand is taken at E.164's own
 * 8–15 digits.
 */
function isDiallable(e164: string): boolean {
  if (e164.startsWith("+66")) return /^(?:[2-7]\d{7}|[689]\d{8})$/.test(e164.slice(3));
  return /^\+\d{8,15}$/.test(e164);
}

/**
 * The company phone field, split so each number in it can be TAPPED to call
 * on a phone ("02-123-4567, 081-234-5678" is two links). Joined back, the
 * parts are the text exactly as the admin typed it. A part is linked only
 * when, its extension set aside, it is a whole number of the right shape
 * (isDiallable); "02-123-4567/8" links the first number and leaves "/8" as
 * text.
 */
export function phoneParts(text: string): PhonePart[] {
  return text
    .split(SEPARATOR)
    .filter((part) => part !== "")
    .map((part) => {
      const number = part.replace(EXTENSION, "");
      const digits = number.replace(/\D/g, "");
      if (digits.length < 9) return { text: part, href: null };
      const e164 = toThaiE164(number);
      return isDiallable(e164) ? { text: part, href: `tel:${e164}` } : { text: part, href: null };
    });
}
