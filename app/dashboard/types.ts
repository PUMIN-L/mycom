import type { SalesRecord } from "../lib/types";

// ── Dashboard shared types ──────────────────────────────────────────────────

export interface OverviewData {
  revenue: number; deals: number; newCustomers: number; quotations: number;
  cost: number; profit: number;
}

export interface DashboardData {
  overview: { currentPeriod: OverviewData; previousPeriod: OverviewData; expiringWarranties: number; periodLabel: string };
  revenueMonthly: ChartPeriod[];
  revenueQuarterly: ChartPeriod[];
  revenueByCategory: TopItem[];
  topProducts: TopItem[];
  topCustomers: TopItem[];
  salespersonLeaderboard: SalespersonStat[];
  insights: Insight[];
}

export interface ChartPeriod {
  period: string; revenue: number; deals: number; cost: number; expense: number; profit: number; margin: number;
}

export interface TopItem {
  id: string; name: string; revenue: number; qty: number; deals: number; percentage: number;
}

export interface SalespersonStat {
  id: string; name: string; revenue: number; deals: number; percentage: number; avgDealSize: number;
}

export interface Insight {
  type: "positive" | "warning" | "opportunity" | "info";
  icon: string;
  title: string;
  description: string;
}

export interface CostItemLocal {
  id?: string;
  costType: string;
  label: string;
  amount: number;
  note: string;
}

export const COST_TYPE_LABELS: Record<string, string> = {
  product_cost: "ต้นทุนสินค้า",
  transport: "ค่ารถ / ค่าเดินทาง",
  shipping: "ค่าขนส่ง",
  service_visit: "ค่าเซอร์วิส / ค่าติดตั้ง",
  repair: "ค่าซ่อม",
  commission: "ค่าคอมมิชชั่น",
  other: "อื่นๆ",
};
export const COST_TYPE_OPTIONS = Object.entries(COST_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export interface Product { id: string; title_th: string; title_en: string; categoryId: number }
export interface Customer { id: string; name: string; companyId: string; companyName?: string }
export interface Company { id: string; name: string }
export interface Salesperson { id: string; name: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

export const fmt = (n: any) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const fmtDec = (n: any) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export interface Change { value: number; label: string; color: string }

/** Green for a move the business wants, red for one it does not. A COST going
 *  up is the bad direction — the ต้นทุน card used to show it as a green ↑. */
function changeOf(value: number, label: string, higherIsBetter: boolean): Change {
  if (value === 0) return { value: 0, label, color: "text-gray-400" };
  const good = value > 0 === higherIsBetter;
  return { value, label, color: good ? "text-emerald-600" : "text-red-500" };
}

/**
 * Relative change from `prev` to `cur`, e.g. "↑12%". Measured against the SIZE
 * of `prev`, so a loss shrinking (−100 → 50) reads as the rise it is; dividing
 * by the negative `prev` itself turned it into "↓150%". "—" when there is
 * nothing to compare with.
 */
export function pctChange(cur: number, prev: number, { higherIsBetter = true } = {}): Change {
  if (prev === 0) return { value: 0, label: "—", color: "text-gray-400" };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct > 0) return changeOf(pct, `↑${pct}%`, higherIsBetter);
  if (pct < 0) return changeOf(pct, `↓${Math.abs(pct)}%`, higherIsBetter);
  return changeOf(0, "→0%", higherIsBetter);
}

/**
 * The change between two PERCENTAGES, in points: a margin of 10% → 12% is
 * "↑2 จุด". As a relative change it read "↑20%", which looks like the margin
 * itself rose by twenty. A side with no rate at all (no sales, no quotations)
 * is null, and gives "—" — 0% there is not a rate to compare with.
 */
export function pointChange(cur: number | null, prev: number | null): Change {
  if (cur === null || prev === null) return { value: 0, label: "—", color: "text-gray-400" };
  const diff = Math.round(cur - prev);
  if (diff > 0) return changeOf(diff, `↑${diff} จุด`, true);
  if (diff < 0) return changeOf(diff, `↓${Math.abs(diff)} จุด`, true);
  return changeOf(0, "→0 จุด", true);
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() || "";
  }
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Only allow Cloudinary image URLs to prevent XSS/SSRF via img src */
export function safeImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "res.cloudinary.com" && parsed.protocol === "https:") return url;
  } catch { /* invalid URL */ }
  return null;
}

export function getTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const emptyForm = () => ({
  saleType: "equipment",
  salespersonId: "",
  customerId: "",
  companyId: "",
  productId: "",
  productName: "",
  categoryId: null as number | null,
  qty: 1,
  unitPrice: 0,
  totalAmount: 0,
  saleDate: getTodayString(),
  quotationRef: "",
  poRef: "",
  deliveryRef: "",
  invoiceRef: "",
  receiptRef: "",
  warrantyStartDate: "",
  warrantyEndDate: "",
  serialNumbers: [] as string[],
  /** The machines this sale ALREADY has, in the same order as `serialNumbers`
   * — a read-only snapshot taken when the record was loaded for editing (empty
   * when creating). Each entry's `id` is sent back on save so the server can
   * re-bind that serial box to the machine it came from, instead of pairing by
   * position; `productName`/`serialNumber` are what the box shows the admin so
   * two blank-serial machines are no longer indistinguishable. */
  loadedEquipments: [] as LoadedEquipment[],
  note: "",
});

/** One existing machine of the sale being edited (see `loadedEquipments`). */
export type LoadedEquipment = {
  id: string;
  serialNumber: string;
  /** The machine's own catalog product. Carried so the form can tell a
   * SINGLE-model bill from a MIXED one: on a mixed bill the server refuses to
   * stamp the sale's one product / one warranty pair over machines of another
   * model, so those edits do nothing and the admin has to be told (see
   * `isMixedModelBill`). */
  productId: string;
  productName: string;
};

/** Mirrors `productGroupKey` in app/lib/crmStore.ts: the UI-only "_custom"
 * sentinel and "no product at all" are the same group, so they must not read as
 * two different models here either. */
const equipmentModelKey = (productId: string): string => {
  const id = String(productId || "").trim();
  return id === "_custom" ? "" : id;
};

/** True when the machines loaded for this sale are NOT all the same model. The
 * sale form can only express ONE product and ONE warranty pair, so on such a
 * bill `runEquipmentSync` deliberately leaves every machine's model and
 * warranty dates alone — changing them here would be a silent no-op. */
export function isMixedModelBill(loaded: LoadedEquipment[]): boolean {
  return new Set(loaded.map((eq) => equipmentModelKey(eq.productId))).size > 1;
}

export type SalesFormData = ReturnType<typeof emptyForm>;
