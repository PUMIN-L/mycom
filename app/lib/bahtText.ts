// Convert an amount to Thai text ("หนึ่งแสนสองหมื่นห้าร้อยบาทถ้วน") — the
// "(ตัวอักษร: …)" line every Thai quotation/receipt carries. Behaviour matches
// Excel's BAHTTEXT: satang rounded to 2 decimals, "เอ็ด" for a trailing 1 in
// numbers ≥ 11, "ยี่สิบ" for 2 in the tens position, groups of six digits
// joined with "ล้าน".

const DIGIT_WORDS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const POSITION_WORDS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/**
 * Read a group of up to 6 digits (0 – 999,999) as Thai words.
 * `hasHigherGroup` marks that a "ล้าน" group precedes this one, so a lone
 * trailing 1 still reads "เอ็ด" (1,000,001 → หนึ่งล้านเอ็ด).
 */
function readGroup(group: number, hasHigherGroup: boolean): string {
  if (group === 0) return "";
  let text = "";
  const digits = String(group).split("").map(Number);
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    const digit = digits[i];
    const position = len - i - 1; // 0 = units, 1 = tens, …
    if (digit === 0) continue;
    if (position === 0) {
      // Units: 1 → "เอ็ด" when anything precedes it (สิบเอ็ด, ร้อยเอ็ด, ล้านเอ็ด)
      if (digit === 1 && (len > 1 || hasHigherGroup)) text += "เอ็ด";
      else text += DIGIT_WORDS[digit];
    } else if (position === 1) {
      // Tens: 1 → "สิบ", 2 → "ยี่สิบ"
      if (digit === 1) text += "สิบ";
      else if (digit === 2) text += "ยี่สิบ";
      else text += DIGIT_WORDS[digit] + "สิบ";
    } else {
      text += DIGIT_WORDS[digit] + POSITION_WORDS[position];
    }
  }
  return text;
}

/** Read a non-negative integer as Thai words (groups of 6 joined by "ล้าน"). */
function readInteger(n: number): string {
  if (n === 0) return DIGIT_WORDS[0];
  // Split into 6-digit groups, most significant first.
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.unshift(rest % 1_000_000);
    rest = Math.floor(rest / 1_000_000);
  }
  let text = "";
  for (let i = 0; i < groups.length; i++) {
    const isLast = i === groups.length - 1;
    // A group has "higher groups" when any ล้าน-group precedes it (i > 0) —
    // that's what turns a trailing 1 into เอ็ด (1,000,001 → หนึ่งล้านเอ็ด)
    // while keeping the leading group's 1 as หนึ่ง (1,000,000 → หนึ่งล้าน).
    text += readGroup(groups[i], i > 0);
    if (!isLast) text += "ล้าน";
  }
  return text;
}

/**
 * Format `amount` (in baht) as Thai text, e.g. 1234.50 →
 * "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์". Whole amounts end in "ถ้วน".
 * Not meaningful beyond ~1e15 (Number precision); returns "" for non-finite.
 */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const negative = amount < 0;
  // Round to satang first so 99.999 → 100 บาทถ้วน, matching BAHTTEXT.
  const totalSatang = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(totalSatang / 100);
  const satang = totalSatang % 100;

  let text = readInteger(baht) + "บาท";
  text += satang === 0 ? "ถ้วน" : readInteger(satang) + "สตางค์";
  return negative ? "ลบ" + text : text;
}
