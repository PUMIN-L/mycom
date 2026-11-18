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

// ── As a tax invoice prints it (the accounting module) ──────────────────────
// OUR company's ID must be a valid one — it is on every tax invoice we issue —
// so the accounting settings refuse anything else; a CUSTOMER's is only warned
// about, like a supplier's above (a buyer abroad, or a person, may have none).

/** "00000": the head office (สำนักงานใหญ่). Any other five digits are a branch. */
export const HEAD_OFFICE_BRANCH = "00000";

/** Digits only: "0-1055-12345-67-8" and "0105512345678" are the same ID. */
export function normalizeTaxId(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\s-]/g, "");
}

export function isValidThaiTaxId(raw: string | null | undefined): boolean {
  return checkThaiTaxId(raw).status === "ok";
}

/** "0105512345678" → "0-1055-12345-67-8", grouped as the card prints it. Anything else as typed. */
export function formatTaxId(raw: string | null | undefined): string {
  const id = normalizeTaxId(raw);
  if (!/^\d{13}$/.test(id)) return String(raw ?? "").trim();
  return `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;
}

/**
 * A branch as stored: five digits, or "" for none given. "สำนักงานใหญ่" (or
 * 0) is the head office; "1", "สาขา 1", "สาขาที่ 00001" are branch 00001.
 * null when it cannot be read as a branch at all.
 */
export function normalizeBranchCode(raw: string | number | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (/สำนักงานใหญ่|head\s*office/i.test(text)) return HEAD_OFFICE_BRANCH;
  const digits = text.replace(/^(สาขาที่|สาขา|branch)\s*/i, "");
  if (!/^\d{1,5}$/.test(digits)) return null;
  return digits.padStart(5, "0");
}

/** How a tax invoice prints the branch: "สำนักงานใหญ่" or "สาขาที่ 00001" ("" for none). */
export function branchLabel(code: string | null | undefined): string {
  const normalized = normalizeBranchCode(code ?? "");
  if (!normalized) return "";
  return normalized === HEAD_OFFICE_BRANCH ? "สำนักงานใหญ่" : `สาขาที่ ${normalized}`;
}
