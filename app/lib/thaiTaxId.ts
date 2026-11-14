/**
 * A Thai tax ID (เลขประจำตัวผู้เสียภาษีอากร): 13 digits, the last a check digit
 * over the first twelve — weights 13 down to 2, then (11 − sum mod 11) mod 10,
 * the same rule as the national ID card. A company's ID (0-1055-xxxxx-xx-x)
 * follows it too.
 *
 * Checked to WARN, never to refuse: a supplier abroad has its own kind of
 * number, and a typo is better pointed out than blocked.
 */
export type TaxIdCheck =
  | { status: "empty" }
  | { status: "ok" }
  /** Something other than digits, spaces and dashes. */
  | { status: "format" }
  | { status: "length"; digits: number }
  | { status: "checksum" };

export function checkThaiTaxId(raw: string | null | undefined): TaxIdCheck {
  // Spaces and dashes only — "-" typed for "none" — is no number at all.
  const digits = (raw || "").replace(/[\s-]/g, "");
  if (!digits) return { status: "empty" };
  if (!/^\d+$/.test(digits)) return { status: "format" };
  if (digits.length !== 13) return { status: "length", digits: digits.length };
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]) ? { status: "ok" } : { status: "checksum" };
}

/** What to tell the admin about `raw`, or null when there is nothing to say. */
export function taxIdWarning(raw: string | null | undefined): string | null {
  const check = checkThaiTaxId(raw);
  switch (check.status) {
    case "format":
      return "เลขผู้เสียภาษีของไทยมีแต่ตัวเลข 13 หลัก — ถ้าเป็นเลขของต่างประเทศ ปล่อยไว้ได้";
    case "length":
      return `เลขผู้เสียภาษีของไทยมี 13 หลัก (ตอนนี้ ${check.digits} หลัก) — ถ้าเป็นเลขของต่างประเทศ ปล่อยไว้ได้`;
    case "checksum":
      return "เลขนี้อาจพิมพ์ผิด: หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ ลองเทียบกับเอกสารอีกครั้ง";
    default:
      return null;
  }
}
