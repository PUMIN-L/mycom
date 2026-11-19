// Money of the accounting module — pure, shared by the editor (live totals)
// and the API (which computes again and stores ITS answer; a browser's
// figures are never trusted).
//
// Everything is whole SATANG (integers) end to end: typed text is parsed into
// satang with string arithmetic (no 0.1 + 0.2), and every rounding is one
// Math.round of an integer ratio — half up, at the satang — so each printed
// row is exactly the number the next one was computed from.

export type PriceMode = "exclusive" | "inclusive";

/** ฿1,000,000,000.00 — far above any real line, far below where integers lose precision. */
export const MAX_AMOUNT_SATANG = 100_000_000_000;

/** "1,234.5" → 123450. Null for anything that is not a non-negative amount with at most two decimals. */
export function parseBahtToSatang(text: string | number | null | undefined): number | null {
  const raw = String(text ?? "").replace(/[,\s฿]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const satang = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(satang) ? satang : null;
}

/** 123450 → "1,234.50"; negative with a leading "-". */
export function formatSatang(satang: number): string {
  const sign = satang < 0 ? "-" : "";
  const abs = Math.abs(Math.round(satang));
  const baht = Math.floor(abs / 100);
  return `${sign}${baht.toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** For Excel and the dashboard, which read baht as numbers: 123450 → 1234.5. */
export function satangToBaht(satang: number): number {
  return Math.round(satang) / 100;
}

/** A quantity in hundredths (2 decimal places) — 1.5 → 150. */
export function qtyHundredths(qty: number): number {
  return Math.round(Number(qty) * 100);
}

export interface LineMoney {
  qty: number;
  unitPriceSatang: number;
  discountSatang: number;
}

/** qty × unit price, at the satang. */
export function lineGrossSatang(line: LineMoney): number {
  return Math.round((qtyHundredths(line.qty) * Math.round(line.unitPriceSatang)) / 100);
}

/** What the line comes to after its own discount. */
export function lineAmountSatang(line: LineMoney): number {
  return lineGrossSatang(line) - Math.round(line.discountSatang || 0);
}

export interface DocTotals {
  /** Σ line amounts (incl. VAT when prices include it). */
  subtotalSatang: number;
  /** The bill-level discount. */
  discountSatang: number;
  /** Deposit already invoiced, deducted here (ex VAT) — step 6. */
  depositSatang: number;
  /** The VAT base: what VAT is computed on. */
  vatBaseSatang: number;
  vatSatang: number;
  totalSatang: number;
}

/** A VAT rate as hundredths of a percent: 7 → 700, 7.5 → 750. */
function rateHundredths(vatRate: number): number {
  return Math.round(Number(vatRate) * 100);
}

/**
 * The document's figures. Exclusive prices: VAT is added on the base.
 * Inclusive prices: the amounts already hold VAT, which is taken out of them.
 */
export function computeTotals(input: {
  lines: readonly LineMoney[];
  discountSatang?: number;
  depositSatang?: number;
  priceMode: PriceMode;
  vatRate: number;
}): DocTotals {
  const subtotalSatang = input.lines.reduce((sum, line) => sum + lineAmountSatang(line), 0);
  const discountSatang = Math.round(input.discountSatang || 0);
  const depositSatang = Math.round(input.depositSatang || 0);
  const afterDiscount = subtotalSatang - discountSatang;
  const rate = rateHundredths(input.vatRate);

  if (input.priceMode === "inclusive") {
    // The deposit is ex VAT; on an inclusive bill it comes off with its VAT.
    const gross = afterDiscount - Math.round((depositSatang * (10000 + rate)) / 10000);
    const vatBaseSatang = Math.round((gross * 10000) / (10000 + rate));
    return { subtotalSatang, discountSatang, depositSatang, vatBaseSatang, vatSatang: gross - vatBaseSatang, totalSatang: gross };
  }
  const vatBaseSatang = afterDiscount - depositSatang;
  const vatSatang = Math.round((vatBaseSatang * rate) / 10000);
  return { subtotalSatang, discountSatang, depositSatang, vatBaseSatang, vatSatang, totalSatang: vatBaseSatang + vatSatang };
}

/**
 * The totals with the VAT as printed on a paper issued elsewhere (its own
 * rounding may differ by a satang or two). Exclusive: the base stays, the
 * total follows the VAT. Inclusive: the total (what was charged) stays, the
 * base follows.
 */
export function withVatOverride(totals: DocTotals, vatSatang: number | null, priceMode: PriceMode): DocTotals {
  if (vatSatang === null) return totals;
  if (priceMode === "inclusive") {
    return { ...totals, vatSatang, vatBaseSatang: totals.totalSatang - vatSatang };
  }
  return { ...totals, vatSatang, totalSatang: totals.vatBaseSatang + vatSatang };
}

/**
 * round(a × b × … ÷ divisor), half up, EXACTLY: products of satang pass 2^53
 * on large bills, where a float would round a tax figure the wrong way at a
 * half. Non-negative integers only (each factor is rounded first).
 */
export function mulDivRound(factors: readonly number[], divisor: number): number {
  const n = factors.reduce((p, f) => p * BigInt(Math.round(f)), BigInt(1));
  const d = BigInt(Math.round(divisor));
  const q = n / d;
  return Number((n % d) * BigInt(2) >= d ? q + BigInt(1) : q);
}

/**
 * `total` shared out over `weights` in proportion, in whole satang that add
 * up to `total` exactly (largest remainder). Used to put a bill-level discount
 * — and VAT taken out of inclusive prices — onto each line for the dashboard,
 * whose revenue is per line, ex VAT.
 */
export function allocateProportionally(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const exact = weights.map((w) => (Math.max(0, w) * total) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let rest = total - floors.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) floors[order[k].i] += 1;
  return floors;
}
