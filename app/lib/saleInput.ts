// The number fields of a sale line — quantity and money — checked the same way
// when a sale is created (each line, POST /api/admin/sales) and when one is
// edited (PUT /api/admin/sales/[id]). Pure.
//
// salesDashboardStore's cleanInput turns anything it cannot read into a
// plausible number (Number(x) || 0, clamped): "abc" became a ฿0 price, a
// negative became 0, a quantity of "abc" became 1 — saved without a word and
// counted in every revenue report. The create route refused those; the edit
// route passed them straight through. Both use this now.

/** Not sent: undefined, null, or an empty string. Omitted money means 0. */
export function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

const MONEY_FIELDS: Array<[string, string]> = [
  ["unitPrice", "ราคาต่อหน่วย"],
  ["totalAmount", "ยอดรวมรายการ"],
  ["costAmount", "ต้นทุนสินค้า"],
];

/**
 * What is wrong with a line's quantity or money, in Thai, or null. `requireQty`
 * for a new line; an edit may leave the quantity out (it keeps its own).
 */
export function saleNumbersError(fields: Record<string, unknown>, requireQty: boolean): string | null {
  if (requireQty || !isAbsent(fields.qty)) {
    const qty = Number(fields.qty);
    if (!Number.isFinite(qty) || qty < 1) return "จำนวน (qty) ต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป";
  }
  for (const [field, label] of MONEY_FIELDS) {
    if (isAbsent(fields[field])) continue; // omitted → 0
    const n = Number(fields[field]);
    if (!Number.isFinite(n) || n < 0) return `${label} (${field}) ต้องเป็นตัวเลขที่ไม่ติดลบ`;
  }
  return null;
}
