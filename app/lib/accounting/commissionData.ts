import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "../db";
import { COST_TYPE_LABELS } from "../costTypes";
import { monthRange } from "./exportRules";
import { orderStatusOf, type OrderStatus } from "./orderRules";
import { owedSatang } from "./creditRules";
import { signedDecimalToSatang } from "./money";
import { commissionKindOf, monthCommission, rateSetForMonth, type CommissionKind } from "./commission";
import { currentRateSets } from "./commissionRates";
import type {
  CommissionMonth,
  CommissionMonthRow,
  CommissionStatus,
  CommissionTotals,
  DeliveryCosts,
  PayoutInfo,
  PersonTotals,
  PoCosts,
} from "./commissionTypes";

export type {
  CommissionMonth,
  CommissionMonthRow,
  CommissionStatus,
  CommissionTotals,
  CostLine,
  DeliveryCosts,
  OtherCost,
  PayoutInfo,
  PersonTotals,
  PoCosts,
} from "./commissionTypes";

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
// The shapes are in commissionTypes.ts (the browser draws them too).

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

const person = (): PersonTotals => ({ totalSatang: 0, paidSatang: 0, payableSatang: 0, waitingSatang: 0, differenceSatang: 0 });

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

/** Where it stands as it is now — leaving any paid-out mark aside. */
function statusOf(f: PoFacts): Exclude<CommissionStatus, "paid"> {
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
  const payoutOf = new Map<string, PayoutInfo>();
  for (const p of await rows(
    `SELECT id, salesOrderId, profitSatang, fordSatang, torSatang, companySatang, paidDate, createdBy
       FROM acc_commission_payouts WHERE salesOrderId IN (${marks(ids.length)}) AND voidedAt IS NULL`,
    ids
  )) {
    payoutOf.set(String(p.salesOrderId), {
      id: String(p.id),
      paidDate: String(p.paidDate),
      profitSatang: num(p.profitSatang),
      fordSatang: num(p.fordSatang),
      torSatang: num(p.torSatang),
      companySatang: num(p.companySatang),
      createdBy: String(p.createdBy ?? ""),
    });
  }

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
    const now = statusOf(f);
    const payout = payoutOf.get(r.id) ?? null;
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
      commissionStatus: payout ? "paid" : now,
      payout,
      differenceFordSatang: payout ? r.fordSatang - payout.fordSatang : 0,
      differenceTorSatang: payout ? r.torSatang - payout.torSatang : 0,
      paidButNot: payout && now !== "payable" ? now : null,
    };
  });

  for (const row of out) {
    if (!row.kind && !row.payout) {
      totals.unassigned += 1;
      continue;
    }
    totals.companySatang += row.companySatang;
    totals.profitSatang += row.countedSatang;
    for (const [who, amount, locked] of [
      ["ford", row.fordSatang, row.payout?.fordSatang ?? 0],
      ["tor", row.torSatang, row.payout?.torSatang ?? 0],
    ] as const) {
      totals[who].totalSatang += amount;
      if (row.commissionStatus === "paid") {
        totals[who].paidSatang += locked;
        totals[who].differenceSatang += amount - locked;
      } else if (row.commissionStatus === "payable") totals[who].payableSatang += amount;
      else totals[who].waitingSatang += amount;
    }
  }
  return { month, rateSet, rows: out, totals, invoicesWithoutPo };
}

// ── What a PO's profit is made of (decision 12) ──────────────────────────────

const noCosts = () => ({ salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 });

/** The product lines and the other costs of these sales, by sale — two reads whatever the number. */
async function saleDetails(saleIds: string[]): Promise<{ itemsOf: Map<string, RowDataPacket[]>; costsOf: Map<string, RowDataPacket[]> }> {
  if (saleIds.length === 0) return { itemsOf: new Map(), costsOf: new Map() };
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
  return { itemsOf, costsOf };
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
  const sales = await rows(
    "SELECT sr.id, DATE_FORMAT(sr.saleDate, '%Y-%m-%d') AS saleDate, sr.invoiceRef, sr.totalAmount, sr.costAmount FROM sales_records sr WHERE sr.dealId = ? ORDER BY sr.saleDate ASC, sr.createdAt ASC",
    [id]
  );
  const { itemsOf, costsOf } = await saleDetails(sales.map((s) => String(s.id)));
  return poCostsOf(id, String(po.customerPoNo ?? ""), sales, itemsOf, costsOf);
}

/**
 * Many customer POs' costs at once (the month's Excel, the payout PDF) — the
 * same as commissionCosts gives each, in three reads whatever the number. A
 * PO with no sales has no deliveries.
 */
export async function commissionCostsFor(pos: { id: string; customerPoNo: string }[]): Promise<Record<string, PoCosts>> {
  if (pos.length === 0) return {};
  const ids = pos.map((p) => p.id);
  const salesOf = groupBy(
    await rows(
      `SELECT sr.id, sr.dealId, DATE_FORMAT(sr.saleDate, '%Y-%m-%d') AS saleDate, sr.invoiceRef, sr.totalAmount, sr.costAmount FROM sales_records sr WHERE sr.dealId IN (${marks(ids.length)}) ORDER BY sr.saleDate ASC, sr.createdAt ASC`,
      ids
    ),
    "dealId"
  );
  const { itemsOf, costsOf } = await saleDetails([...salesOf.values()].flat().map((s) => String(s.id)));
  const out: Record<string, PoCosts> = {};
  for (const p of pos) out[p.id] = poCostsOf(p.id, p.customerPoNo, salesOf.get(p.id) ?? [], itemsOf, costsOf);
  return out;
}

function poCostsOf(
  poId: string,
  customerPoNo: string,
  sales: RowDataPacket[],
  itemsOf: Map<string, RowDataPacket[]>,
  costsOf: Map<string, RowDataPacket[]>
): PoCosts {
  const totals = noCosts();
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
  return { poId, customerPoNo, deliveries, totals };
}
