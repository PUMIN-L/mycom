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
  period: string; revenue: number; deals: number; cost: number; profit: number; margin: number;
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

export const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const fmtDec = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16"];

export function pctChange(cur: number, prev: number): { value: number; label: string; color: string } {
  if (prev === 0) return { value: 0, label: "—", color: "text-gray-400" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct > 0) return { value: pct, label: `↑${pct}%`, color: "text-emerald-600" };
  if (pct < 0) return { value: pct, label: `↓${Math.abs(pct)}%`, color: "text-red-500" };
  return { value: 0, label: "→0%", color: "text-gray-400" };
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
  note: "",
});

export type SalesFormData = ReturnType<typeof emptyForm>;
