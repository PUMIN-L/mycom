import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "../db";
import { ApiError } from "../apiHelpers";
import { isValidDateString } from "../dateFormat";
import { commissionKindOf, DEFAULT_COMMISSION_RULES, FIRST_EFFECTIVE_MONTH, rateRulesProblems, type RateRules } from "./commission";
import { commissionCostsFor, commissionMonth } from "./commissionData";
import { getSellerProfile } from "./settings";
import type { CommissionMonthRow, PayoutRateSet, PayoutReport, PayoutReportRow } from "./commissionTypes";

// The commission payout summary's data (ARCHITECTURE.md §8h), for the PDF: the
// LIVE paid-out marks of a range of paid dates with their PO — the amounts as
// they were locked, never worked out again — and, beside them, which changed
// since (as each PO's month stands now), the rate sets they were worked out
// with, the company for the header, and each PO's costs when asked.

/** More marks than one summary should carry: a shorter range is asked for. */
export const PAYOUT_REPORT_LIMIT = 2000;
const MAX_RANGE_DAYS = 366;

const num = (v: unknown) => Number(v) || 0;
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

export async function payoutReport(from: string, to: string, options: { withCosts: boolean; exportedBy: string }): Promise<PayoutReport> {
  if (!isValidDateString(from) || !isValidDateString(to) || from > to) throw new ApiError(400, "ช่วงวันที่ไม่ถูกต้อง");
  if (dayNumber(to) - dayNumber(from) > MAX_RANGE_DAYS) throw new ApiError(400, "ช่วงวันที่ต้องไม่เกิน 1 ปี");

  const [found] = await query<RowDataPacket[]>(
    `SELECT p.id, p.salesOrderId, p.kind, p.profitSatang, p.ladderFromSatang, p.ladderToSatang, p.fordSatang, p.torSatang, p.companySatang,
            p.rateSetId, p.paidDate, p.createdBy, d.customerPoNo, d.buyerName, d.issueDate
       FROM acc_commission_payouts p
       LEFT JOIN acc_documents d ON d.id = p.salesOrderId
      WHERE p.voidedAt IS NULL AND p.paidDate >= ? AND p.paidDate <= ?
      ORDER BY p.paidDate ASC, d.customerPoNo ASC, p.id ASC
      LIMIT ${PAYOUT_REPORT_LIMIT + 1}`,
    [from, to]
  );
  if (found.length > PAYOUT_REPORT_LIMIT) throw new ApiError(400, "รายการมากเกินไป กรุณาเลือกช่วงวันที่ให้สั้นลง");

  const rows: PayoutReportRow[] = found.map((p) => ({
    id: String(p.id),
    salesOrderId: String(p.salesOrderId),
    customerPoNo: String(p.customerPoNo ?? ""),
    buyerName: String(p.buyerName ?? ""),
    issueDate: String(p.issueDate ?? "").slice(0, 10),
    kind: commissionKindOf(p.kind),
    profitSatang: num(p.profitSatang),
    ladderFromSatang: numOrNull(p.ladderFromSatang),
    ladderToSatang: numOrNull(p.ladderToSatang),
    fordSatang: num(p.fordSatang),
    torSatang: num(p.torSatang),
    companySatang: num(p.companySatang),
    rateSetId: p.rateSetId ? String(p.rateSetId) : null,
    paidDate: String(p.paidDate),
    createdBy: String(p.createdBy ?? ""),
    changedSince: false,
  }));

  // As each PO's month stands now (its date as it is now) — each month read once.
  const now = new Map<string, CommissionMonthRow>();
  for (const month of [...new Set(rows.map((r) => r.issueDate.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))]) {
    for (const r of (await commissionMonth(month))?.rows ?? []) now.set(r.id, r);
  }
  for (const r of rows) {
    const current = now.get(r.salesOrderId);
    r.changedSince =
      !current || current.payout?.id !== r.id || current.fordSatang !== r.fordSatang || current.torSatang !== r.torSatang || current.paidButNot !== null;
  }

  const report: PayoutReport = {
    from,
    to,
    rows,
    rateSets: await rateSetsUsed(rows),
    changedSince: rows.filter((r) => r.changedSince).length,
    seller: (await getSellerProfile()).seller,
    exportedBy: options.exportedBy,
    exportedAt: new Date().toISOString(),
  };
  if (options.withCosts) {
    const pos = new Map<string, string>();
    for (const r of rows) if (!pos.has(r.salesOrderId)) pos.set(r.salesOrderId, r.customerPoNo);
    report.costs = await commissionCostsFor([...pos].map(([id, customerPoNo]) => ({ id, customerPoNo })));
  }
  return report;
}

/** The rate sets the marks were worked out with — the owner's table for none saved (`rateSetId` null), a saved one by its id (append-only: still there). */
async function rateSetsUsed(rows: readonly PayoutReportRow[]): Promise<PayoutRateSet[]> {
  const out: PayoutRateSet[] = [];
  if (rows.some((r) => r.rateSetId === null)) out.push({ id: null, effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: DEFAULT_COMMISSION_RULES });
  const ids = [...new Set(rows.map((r) => r.rateSetId).filter((id): id is string => id !== null))];
  if (ids.length > 0) {
    const [stored] = await query<RowDataPacket[]>(
      `SELECT id, effectiveMonth, rulesJson FROM acc_commission_rates WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids
    );
    for (const s of stored) {
      let rules: RateRules | null = null;
      try {
        rules = JSON.parse(String(s.rulesJson)) as RateRules;
      } catch {
        rules = null;
      }
      if (!rules || rateRulesProblems(rules).length > 0) {
        console.error(`[commission] rate set ${String(s.id)} cannot be read — left out of the summary`);
        continue;
      }
      out.push({ id: String(s.id), effectiveMonth: String(s.effectiveMonth), rules });
    }
  }
  return out.sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : a.effectiveMonth > b.effectiveMonth ? 1 : 0));
}
