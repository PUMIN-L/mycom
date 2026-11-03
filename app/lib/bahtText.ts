// An amount in Thai words, as a Thai quotation or invoice prints it under the
// total: 124,655.00 → "หนึ่งแสนสองหมื่นสี่พันหกร้อยห้าสิบห้าบาทถ้วน".

const DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/**
 * 0 – 999,999 in words. The two irregular readings: a 1 in the tens is just
 * "สิบ" (not "หนึ่งสิบ") and a 2 there is "ยี่สิบ"; a 1 in the units of a
 * number above 9 is "เอ็ด" (11 = สิบเอ็ด, 101 = หนึ่งร้อยเอ็ด).
 */
function belowMillion(n: number): string {
  const digits = String(n).split("").map(Number);
  const len = digits.length;
  let out = "";
  digits.forEach((d, i) => {
    if (d === 0) return;
    const place = len - 1 - i;
    if (place === 1) {
      out += (d === 1 ? "" : d === 2 ? "ยี่" : DIGITS[d]) + "สิบ";
    } else if (place === 0) {
      out += d === 1 && n > 9 ? "เอ็ด" : DIGITS[d];
    } else {
      out += DIGITS[d] + PLACES[place];
    }
  });
  return out;
}

/** Any whole number in words; every six digits more is another "ล้าน"
 *  (1,000,000 = หนึ่งล้าน, 2,000,000,000,000 = สองล้านล้าน). */
function wholeInWords(n: number): string {
  if (n === 0) return "ศูนย์";
  let out = "";
  let rest = n;
  let millions = 0;
  const groups: { words: string; millions: number }[] = [];
  while (rest > 0) {
    const group = rest % 1_000_000;
    if (group > 0) groups.push({ words: belowMillion(group), millions });
    rest = Math.floor(rest / 1_000_000);
    millions++;
  }
  for (const g of groups.reverse()) {
    out += g.words + "ล้าน".repeat(g.millions);
  }
  return out;
}

/**
 * The rounding the printed figures use (`toLocaleString` with two decimals —
 * see `fmt` on the document pages). NOT `toFixed(2)`: that rounds the exact
 * binary value (1.005 is 1.00499… → "1.00"), while the formatter rounds the
 * shortest decimal ("1.005" → "1.01"). Words rounded the other way were a
 * satang off the number printed right above them on about one amount in six.
 */
const AS_PRINTED = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/**
 * `amount` in Thai words: baht, then satang or "ถ้วน", rounded to the satang
 * exactly as the figure beside it is printed. A negative amount is read with
 * "ลบ" in front; a non-finite (or absurdly large) one gives "".
 */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) >= 1e15) return "";
  const negative = amount < 0;
  const [bahtPart, satangPart] = AS_PRINTED.format(Math.abs(amount)).split(".");
  const baht = Number(bahtPart);
  const satang = Number(satangPart);
  const satangTotal = baht * 100 + satang;
  let words = "";
  if (baht > 0 || satang === 0) words += wholeInWords(baht) + "บาท";
  words += satang === 0 ? "ถ้วน" : wholeInWords(satang) + "สตางค์";
  return (negative && satangTotal > 0 ? "ลบ" : "") + words;
}
