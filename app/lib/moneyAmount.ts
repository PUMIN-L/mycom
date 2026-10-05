/** The largest value a DECIMAL(12,2) money column holds. */
export const MAX_MONEY_AMOUNT = 9_999_999_999.99;

/**
 * To the satang, halves rounded up, without floating-point dust: 1.005 is
 * 100.49999… once multiplied by 100, and would come out as 1.00. Cutting the
 * product to 15 significant digits first removes the dust and is exact across
 * the whole range of a DECIMAL(12,2). (quotationTotals' round2 nudges by a
 * RELATIVE epsilon instead, which at this column's ceiling is a whole satang —
 * 9,999,999,999.99 would round up past it.)
 */
export function toSatang(n: number): number {
  return Math.round(Number((n * 100).toPrecision(15))) / 100;
}

export type ParsedMoney = { ok: true; amount: number } | { ok: false; error: string };

/**
 * A positive money amount from a request body, as the database will store it.
 *
 * Rounded to the satang FIRST, checked after. The other way round, 0.004
 * passed "more than 0" and then reached a DECIMAL(12,2) column as ฿0.00 — a
 * zero-baht payment or cost row — or, for a payment, the store's own check,
 * as a bare 500. Above the column's ceiling is refused too, rather than
 * becoming a database error (payments) or silently clamped (expenses, costs).
 *
 * A number or a plain decimal string only: Number(true) is 1 and Number("")
 * is 0, and neither is an amount anyone typed. Number() also reads "0x10" as
 * 16, "0b101" as 5 and "1e3" as 1000 — so a string must be digits with an
 * optional decimal point ("1500", "1500.00", ".5") before Number() sees it.
 */
const DECIMAL_STRING = /^\s*(?:\d+(?:\.\d*)?|\.\d+)\s*$/;

export function parsePositiveMoney(value: unknown): ParsedMoney {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && DECIMAL_STRING.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
  const amount = toSatang(n);
  if (amount <= 0) return { ok: false, error: "จำนวนเงินต้องอย่างน้อย 0.01 บาท" };
  if (amount > MAX_MONEY_AMOUNT) {
    return { ok: false, error: "จำนวนเงินสูงเกินไป (สูงสุด 9,999,999,999.99 บาท)" };
  }
  return { ok: true, amount };
}

/**
 * A money amount that may be zero (a price: something given free is still
 * worth recording), with the same rules as parsePositiveMoney otherwise — a
 * number or a plain decimal string, to the satang, not past the column.
 */
export function parseNonNegativeMoney(value: unknown): ParsedMoney {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && DECIMAL_STRING.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "จำนวนเงินต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };
  const amount = toSatang(n);
  if (amount > MAX_MONEY_AMOUNT) {
    return { ok: false, error: "จำนวนเงินสูงเกินไป (สูงสุด 9,999,999,999.99 บาท)" };
  }
  return { ok: true, amount };
}
