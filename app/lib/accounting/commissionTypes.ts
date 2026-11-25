// The commission program's shapes (ARCHITECTURE.md §8h) — pure, no server
// code: the server works them out (commissionData.ts, commissionReport.ts)
// and the browser draws them (the month screen, the Excel, the PDF).

import type { CommissionPoResult, RateRules } from "./commission";
import type { OrderStatus } from "./orderRules";
import type { SellerProfile } from "./types";

export type CommissionStatus = "unassigned" | "not-delivered" | "cost-missing" | "awaiting-payment" | "payable" | "paid";

/** Where a PO stands, as the owner reads it. */
export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  paid: "จ่ายแล้ว",
  payable: "จ่ายได้",
  "awaiting-payment": "รอลูกค้าจ่าย",
  "not-delivered": "ยังส่งของไม่ครบ",
  "cost-missing": "ยังไม่กรอกต้นทุน",
  unassigned: "ยังไม่เลือกค่าคอมของใคร",
};

/** A live paid-out mark: what was LOCKED when it was paid (schema v60). */
export interface PayoutInfo {
  id: string;
  paidDate: string;
  profitSatang: number;
  fordSatang: number;
  torSatang: number;
  companySatang: number;
  createdBy: string;
}

export interface CommissionMonthRow extends CommissionPoResult {
  customerPoNo: string;
  buyerName: string;
  issueDate: string;
  status: string;
  orderStatus: OrderStatus;
  /** Its sales so far, ex VAT (a credit note negative). */
  salesSatang: number;
  /** The costs typed on them, the "ค่าคอมมิชชั่น" rows left out. */
  costSatang: number;
  /** The profit known so far — null when nothing is. */
  profitSatang: number | null;
  /** A delivery with something to charge has no cost typed yet. */
  costMissing: boolean;
  paidInFull: boolean;
  /** What its issued invoices still owe. */
  owedSatang: number;
  commissionStatus: CommissionStatus;
  /** Marked paid — what was locked then; null when it was not. */
  payout: PayoutInfo | null;
  /** Worked out now less what was paid — a change since (0 when not paid). */
  differenceFordSatang: number;
  differenceTorSatang: number;
  /** Paid, but as it stands now it could not be (a refund, a cost taken away…) — why; else null. */
  paidButNot: Exclude<CommissionStatus, "payable" | "paid"> | null;
}

export interface PersonTotals {
  /** Everything worked out for the month, as it stands now. */
  totalSatang: number;
  /** Marked paid — the amounts locked then. */
  paidSatang: number;
  /** On POs that may be paid now. */
  payableSatang: number;
  /** On the others — waiting for the customer, a delivery or a cost. */
  waitingSatang: number;
  /** On the paid ones: as it stands now less what was paid. */
  differenceSatang: number;
}

export interface CommissionTotals {
  ford: PersonTotals;
  tor: PersonTotals;
  companySatang: number;
  /** The profit the month counts (chosen POs, a loss as 0). */
  profitSatang: number;
  /** POs nobody chose yet. */
  unassigned: number;
}

export interface CommissionMonth {
  month: string;
  rateSet: { id: string | null; effectiveMonth: string; rules: RateRules };
  rows: CommissionMonthRow[];
  totals: CommissionTotals;
  /** Invoices of the month not delivered from a PO — no commission, but not lost from sight. */
  invoicesWithoutPo: number;
}

// ── What a PO's profit is made of (decision 12) ──────────────────────────────

export interface CostLine {
  productName: string;
  qty: number;
  costSatang: number;
}

export interface OtherCost {
  costType: string;
  typeLabel: string;
  label: string;
  note: string;
  amountSatang: number;
  /** False for a "ค่าคอมมิชชั่น" row — shown, never deducted. */
  counted: boolean;
}

export interface DeliveryCosts {
  saleId: string;
  saleDate: string;
  invoiceRef: string;
  /** A credit note's sale — negative. */
  credit: boolean;
  salesSatang: number;
  costSatang: number;
  profitSatang: number;
  costMissing: boolean;
  items: CostLine[];
  costs: OtherCost[];
}

export interface PoCosts {
  poId: string;
  customerPoNo: string;
  deliveries: DeliveryCosts[];
  /** What the commission counts — a delivery with no cost yet left out (its sales apart). */
  totals: { salesSatang: number; costSatang: number; profitSatang: number; notCountedSatang: number; waitingCostSalesSatang: number };
}

// ── The payout summary (the PDF) ─────────────────────────────────────────────

/** One live paid-out mark, with its PO — the amounts as they were locked. */
export interface PayoutReportRow {
  /** The mark's id. */
  id: string;
  salesOrderId: string;
  customerPoNo: string;
  buyerName: string;
  /** The PO's date. */
  issueDate: string;
  kind: "ford" | "tor" | null;
  profitSatang: number;
  ladderFromSatang: number | null;
  ladderToSatang: number | null;
  fordSatang: number;
  torSatang: number;
  companySatang: number;
  rateSetId: string | null;
  paidDate: string;
  createdBy: string;
  /** As its month stands now, it is worked out differently (or could not be paid). */
  changedSince: boolean;
}

export interface PayoutRateSet {
  id: string | null;
  effectiveMonth: string;
  rules: RateRules;
}

export interface PayoutReport {
  /** The paid dates, "YYYY-MM-DD", both included. */
  from: string;
  to: string;
  rows: PayoutReportRow[];
  /** The rate sets the marks were worked out with. */
  rateSets: PayoutRateSet[];
  /** How many rows changed since they were paid. */
  changedSince: number;
  seller: SellerProfile;
  exportedBy: string;
  exportedAt: string;
  /** Each PO's costs by its id — only when asked for. */
  costs?: Record<string, PoCosts>;
}
