import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "../db";
import { COST_TYPE_LABELS } from "../costTypes";
import { monthRange } from "./exportRules";
import { orderStatusOf, type OrderStatus } from "./orderRules";
import { owedSatang } from "./creditRules";
import { signedDecimalToSatang } from "./money";
import { commissionKindOf, monthCommission, rateSetForMonth, type CommissionKind, type CommissionPoResult, type RateRules } from "./commission";
import { currentRateSets } from "./commissionRates";

// The commission month, read from the real tables (ARCHITECTURE.md §8h).
//
// The month is the PO's month. A PO cancelled before anything went is left
// out; one cancelled after a delivery counts for what it delivered. A PO's
// profit is its sales — every delivery, a credit note's negative — less the
// costs typed on them EXCEPT "ค่าคอมมิชชั่น" rows (or the commission would
// lower itself); a sale with something to charge and no cost typed is not
// known yet and is left out until it is. The ladder runs over the month with
// the month's rate set, unpaid POs too; a PO may be PAID once it is chosen,
// delivered in full, paid in full and every cost is typed.
//
// Every joined column carries its table: companies has a salespersonId too.

export type CommissionStatus = "unassigned" | "not-delivered" | "cost-missing" | "awaiting-payment" | "payable";

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
}

export interface PersonTotals {
  totalSatang: number;
  /** On POs that may be paid now. */
  payableSatang: number;
  /** On the others — waiting for the customer, a delivery or a cost. */
  waitingSatang: number;
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

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
const num = (v: unknown) => Number(v) || 0;

async function rows(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [result] = await query<RowDataPacket[]>(sql, params);
  return result;
}

function groupBy(list: RowDataPacket[], key: string): Map<string, RowDataPacket[]> {
  const out = new Map<string, RowDataPacket[]>();
  for (const r of list) {
    const k = String(r[key]);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(r);
  }
  return out;
}

const person = (): PersonTotals => ({ totalSatang: 0, payableSatang: 0, waitingSatang: 0 });

interface PoFacts {
  id: string;
  customerPoNo: string;
  buyerName: string;
  issueDate: string;
  createdAt: string;
  status: string;
  kind: CommissionKind | null;
  orderStatus: OrderStatus;
  complete: boolean;
  saleCount: number;
  salesSatang: number;
  costSatang: number;
  profitSatang: number | null;
  costMissing: boolean;
  paidInFull: boolean;
  owedSatang: number;
}

function statusOf(f: PoFacts): CommissionStatus {
  if (!f.kind) return "unassigned";
  if (!f.complete) return "not-delivered";
  if (f.costMissing || f.saleCount === 0) return "cost-missing";
  if (!f.paidInFull) return "awaiting-payment";
  return "payable";
}

/** The month ("YYYY-MM") by PO date — null for anything that is not a month. */
export async function commissionMonth(month: string): Promise<CommissionMonth | null> {
  const range = monthRange(month);
  if (!range) return null;
  const set = rateSetForMonth(await currentRateSets(), month);
  const rateSet = { id: set.id, effectiveMonth: set.effectiveMonth, rules: set.rules };
  const poRows = await rows(
    "SELECT id, customerPoNo, buyerName, issueDate, createdAt, status, commissionOf FROM acc_documents WHERE docType = 'SO' AND issueDate >= ? AND issueDate < ? ORDER BY issueDate ASC, createdAt ASC LIMIT 2000",
    [range.from, range.to]
  );
  const [count] = await rows(
    "SELECT COUNT(*) AS n FROM acc_documents WHERE docType = 'INV' AND status = 'issued' AND salesOrderId IS NULL AND issueDate >= ? AND issueDate < ?",
    [range.from, range.to]
  );
  const invoicesWithoutPo = num(count?.n);
  const totals: CommissionTotals = { ford: person(), tor: person(), companySatang: 0, profitSatang: 0, unassigned: 0 };
  if (poRows.length === 0) return { month, rateSet, rows: [], totals, invoicesWithoutPo };

  const ids = poRows.map((r) => String(r.id));
  const linesOf = groupBy(await rows(`SELECT documentId, qty, deliveredQty FROM acc_document_lines WHERE documentId IN (${marks(ids.length)})`, ids), "documentId");
  const invoicesOf = groupBy(
    await rows(
      `SELECT salesOrderId, totalSatang, paidSatang, creditedSatang FROM acc_documents WHERE docType = 'INV' AND status = 'issued' AND salesOrderId IN (${marks(ids.length)})`,
      ids
    ),
    "salesOrderId"
  );
  const salesOf = groupBy(
    await rows(
      `SELECT sr.id, sr.dealId, sr.totalAmount, sr.costAmount, COALESCE(c.commissionCost, 0) AS commissionCost
         FROM sales_records sr
         LEFT JOIN (SELECT salesRecordId, SUM(amount) AS commissionCost FROM sale_cost_items WHERE costType = 'commission' GROUP BY salesRecordId) c
           ON c.salesRecordId = sr.id
        WHERE sr.dealId IN (${marks(ids.length)})`,
      ids
    ),
    "dealId"
  );

  const facts: PoFacts[] = [];
  for (const r of poRows) {
    const id = String(r.id);
    const status = String(r.status);
    const lines = (linesOf.get(id) ?? []).map((l) => ({ qty: num(l.qty), deliveredQty: num(l.deliveredQty) }));
    const delivered = lines.some((l) => l.deliveredQty > 0);
    // Cancelled before anything went: not part of the month.
    if (status === "void" && !delivered) continue;
    const orderStatus = orderStatusOf({ status, lines });
    const complete = orderStatus === "complete" || (status === "void" && delivered);
    const invoices = (invoicesOf.get(id) ?? []).map((i) =>
      owedSatang({ totalSatang: num(i.totalSatang), creditedSatang: num(i.creditedSatang), paidSatang: num(i.paidSatang) })
    );
    const sales = salesOf.get(id) ?? [];
    let salesSatang = 0;
    let costSatang = 0;
    let known: number | null = null;
    let costMissing = false;
    for (const s of sales) {
      const total = signedDecimalToSatang(s.totalAmount);
      const cost = signedDecimalToSatang(s.costAmount) - signedDecimalToSatang(s.commissionCost);
      salesSatang += total;
      costSatang += cost;
      if (total > 0 && cost <= 0) {
        costMissing = true;
        continue;
      }
      known = (known ?? 0) + total - cost;
    }
    facts.push({
      id,
      customerPoNo: String(r.customerPoNo ?? ""),
      buyerName: String(r.buyerName ?? ""),
      issueDate: String(r.issueDate).slice(0, 10),
      createdAt: String(r.createdAt ?? ""),
      status,
      kind: commissionKindOf(r.commissionOf),
      orderStatus,
      complete,
      saleCount: sales.length,
      salesSatang,
      costSatang,
      profitSatang: known,
      costMissing,
      paidInFull: complete && invoices.length > 0 && invoices.every((owed) => owed <= 0),
      owedSatang: invoices.reduce((s, owed) => s + Math.max(0, owed), 0),
    });
  }

  const factOf = new Map(facts.map((f) => [f.id, f]));
  const results = monthCommission(
    facts.map((f) => ({ id: f.id, issueDate: f.issueDate, createdAt: f.createdAt, kind: f.kind, profitSatang: f.profitSatang })),
    rateSet.rules
  );
  const out: CommissionMonthRow[] = results.map((r) => {
    const f = factOf.get(r.id)!;
    return {
      ...r,
      customerPoNo: f.customerPoNo,
      buyerName: f.buyerName,
      issueDate: f.issueDate,
      status: f.status,
      orderStatus: f.orderStatus,
      salesSatang: f.salesSatang,
      costSatang: f.costSatang,
      profitSatang: f.profitSatang,
      costMissing: f.costMissing,
      paidInFull: f.paidInFull,
      owedSatang: f.owedSatang,
      commissionStatus: statusOf(f),
    };
  });

  for (const row of out) {
    if (!row.kind) {
      totals.unassigned += 1;
      continue;
    }
    totals.companySatang += row.companySatang;
    totals.profitSatang += row.countedSatang;
    const payable = row.commissionStatus === "payable";
    for (const [who, amount] of [["ford", row.fordSatang], ["tor", row.torSatang]] as const) {
      totals[who].totalSatang += amount;
      if (payable) totals[who].payableSatang += amount;
      else totals[who].waitingSatang += amount;
    }
  }
  return { month, rateSet, rows: out, totals, invoicesWithoutPo };
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

/**
 * A customer PO's costs by delivery: each product's cost on its lines, the
 * other costs typed on the sale by kind — read the way the dashboard counts
 * them (the old "product_cost" rows left out: their money is on the lines).
 * Null for anything but a customer PO.
 */
export async function commissionCosts(id: string): Promise<PoCosts | null> {
  const [po] = await rows("SELECT id, docType, customerPoNo FROM acc_documents WHERE id = ? LIMIT 1", [id]);
  if (!po || po.docType !== "SO") return null;
  const totals = { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 };
  const sales = await rows(
    "SELECT sr.id, DATE_FORMAT(sr.saleDate, '%Y-%m-%d') AS saleDate, sr.invoiceRef, sr.totalAmount, sr.costAmount FROM sales_records sr WHERE sr.dealId = ? ORDER BY sr.saleDate ASC, sr.createdAt ASC",
    [id]
  );
  if (sales.length === 0) return { poId: id, customerPoNo: String(po.customerPoNo ?? ""), deliveries: [], totals };
  const saleIds = sales.map((s) => String(s.id));
  const itemsOf = groupBy(
    await rows(`SELECT salesRecordId, productName, qty, costAmount FROM sales_record_items WHERE salesRecordId IN (${marks(saleIds.length)}) ORDER BY sortOrder ASC`, saleIds),
    "salesRecordId"
  );
  const costsOf = groupBy(
    await rows(
      `SELECT salesRecordId, costType, label, note, amount FROM sale_cost_items WHERE salesRecordId IN (${marks(saleIds.length)}) AND costType <> 'product_cost' ORDER BY createdAt ASC`,
      saleIds
    ),
    "salesRecordId"
  );
  const deliveries: DeliveryCosts[] = sales.map((s) => {
    const saleId = String(s.id);
    const total = signedDecimalToSatang(s.totalAmount);
    const items = (itemsOf.get(saleId) ?? []).map((i) => ({ productName: String(i.productName ?? ""), qty: num(i.qty), costSatang: signedDecimalToSatang(i.costAmount) }));
    const costs = (costsOf.get(saleId) ?? []).map((c) => {
      const costType = String(c.costType ?? "other");
      return {
        costType,
        typeLabel: COST_TYPE_LABELS[costType] ?? COST_TYPE_LABELS.other,
        label: String(c.label ?? ""),
        note: String(c.note ?? ""),
        amountSatang: signedDecimalToSatang(c.amount),
        counted: costType !== "commission",
      };
    });
    const cost = items.reduce((sum, i) => sum + i.costSatang, 0) + costs.reduce((sum, c) => sum + (c.counted ? c.amountSatang : 0), 0);
    const costMissing = total > 0 && cost <= 0;
    totals.notCountedSatang += costs.reduce((sum, c) => sum + (c.counted ? 0 : c.amountSatang), 0);
    if (costMissing) totals.waitingCostSalesSatang += total;
    else {
      totals.salesSatang += total;
      totals.costSatang += cost;
      totals.profitSatang += total - cost;
    }
    return {
      saleId,
      saleDate: String(s.saleDate ?? ""),
      invoiceRef: String(s.invoiceRef ?? ""),
      credit: total < 0,
      salesSatang: total,
      costSatang: cost,
      profitSatang: total - cost,
      costMissing,
      items,
      costs,
    };
  });
  return { poId: id, customerPoNo: String(po.customerPoNo ?? ""), deliveries, totals };
}
