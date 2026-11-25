// The commission payout summary's paper, worked out before it is drawn
// (ARCHITECTURE.md §8h) — pure, for the browser. The paper itself is
// app/accounting/commission/CommissionPayoutPaper.tsx; this decides what is on
// it and where each page breaks: rows never split, a PO's row stays with its
// cost detail, the totals + notes + signatures stay together on the last page.

import { formatDisplayDate } from "../dateFormat";
import { effectiveMonthLabel, formatPercent, ladderRowViews } from "./commissionRateChange";
import { BP_WHOLE } from "./commission";
import type { DeliveryCosts, PayoutRateSet, PayoutReport, PayoutReportRow, PoCosts } from "./commissionTypes";

export interface PayoutSummary {
  count: number;
  profitSatang: number;
  companySatang: number;
  ford: { totalSatang: number; fromFordSatang: number; fromTorSatang: number };
  tor: { totalSatang: number; fromFordSatang: number; fromTorSatang: number };
  /** ฟอร์ด + พี่ต่อ. */
  bothSatang: number;
}

/** What each person got — from ลูกค้าฟอร์ด deals and from ลูกค้าพี่ต่อ deals — the company's share, the profit. */
export function payoutSummary(rows: readonly PayoutReportRow[]): PayoutSummary {
  const s: PayoutSummary = {
    count: rows.length,
    profitSatang: 0,
    companySatang: 0,
    ford: { totalSatang: 0, fromFordSatang: 0, fromTorSatang: 0 },
    tor: { totalSatang: 0, fromFordSatang: 0, fromTorSatang: 0 },
    bothSatang: 0,
  };
  for (const r of rows) {
    s.profitSatang += r.profitSatang;
    s.companySatang += r.companySatang;
    s.ford.totalSatang += r.fordSatang;
    s.tor.totalSatang += r.torSatang;
    if (r.kind === "tor") {
      s.ford.fromTorSatang += r.fordSatang;
      s.tor.fromTorSatang += r.torSatang;
    } else {
      s.ford.fromFordSatang += r.fordSatang;
      s.tor.fromFordSatang += r.torSatang;
    }
  }
  s.bothSatang = s.ford.totalSatang + s.tor.totalSatang;
  return s;
}

/** Deliveries are numbered; a credit note is not one. */
export function deliveryTitles(deliveries: readonly { credit: boolean }[]): string[] {
  let n = 0;
  return deliveries.map((d) => {
    if (d.credit) return "ใบลดหนี้";
    n += 1;
    return `ส่งของครั้งที่ ${n}`;
  });
}

/** One part of the table — measured and placed whole. */
export type PaperUnit =
  | { kind: "row"; row: PayoutReportRow; index: number; keepWithNext: boolean }
  | { kind: "delivery"; row: PayoutReportRow; delivery: DeliveryCosts; title: string; keepWithNext: false }
  | { kind: "costs-total"; row: PayoutReportRow; costs: PoCosts; keepWithNext: false }
  | { kind: "no-costs"; row: PayoutReportRow; keepWithNext: false };

/**
 * The table's parts in order: a row per paid PO and — when the costs were
 * asked for — under each, a part per delivery and one for its total (or one
 * saying there is none). A row with detail under it is kept with it.
 */
export function paperUnits(report: Pick<PayoutReport, "rows" | "costs">): PaperUnit[] {
  const out: PaperUnit[] = [];
  report.rows.forEach((row, index) => {
    if (!report.costs) {
      out.push({ kind: "row", row, index, keepWithNext: false });
      return;
    }
    out.push({ kind: "row", row, index, keepWithNext: true });
    const costs = report.costs[row.salesOrderId];
    if (!costs || costs.deliveries.length === 0) {
      out.push({ kind: "no-costs", row, keepWithNext: false });
      return;
    }
    const titles = deliveryTitles(costs.deliveries);
    costs.deliveries.forEach((delivery, i) => out.push({ kind: "delivery", row, delivery, title: titles[i], keepWithNext: false }));
    out.push({ kind: "costs-total", row, costs, keepWithNext: false });
  });
  return out;
}

export interface PaperPage {
  /** The parts on it, by their place in the list. */
  units: number[];
  /** The totals, the rates, the notes and the signatures — the last page only. */
  tail: boolean;
}

/**
 * Where each page breaks. `firstCapacity` / `nextCapacity`: the room for the
 * table's parts on the first page (under the summary) and on the others;
 * `tailHeight`: the totals + rates + notes + signatures, kept together. A part
 * never splits; one taller than a page takes a page of its own; a part kept
 * with the next goes over to the next page with it — when the two fit there
 * together (never a page overfilled: what does not fit is cut off the PDF).
 */
export function paginatePaper(units: readonly { height: number; keepWithNext: boolean }[], firstCapacity: number, nextCapacity: number, tailHeight: number): PaperPage[] {
  const pages: PaperPage[] = [{ units: [], tail: false }];
  let page = pages[0];
  let capacity = firstCapacity;
  let used = 0;
  units.forEach((unit, i) => {
    if (used + unit.height > capacity && page.units.length > 0) {
      const carried: number[] = [];
      let carriedHeight = 0;
      while (page.units.length > 1) {
        const last = page.units[page.units.length - 1];
        if (!units[last].keepWithNext || carriedHeight + units[last].height + unit.height > nextCapacity) break;
        carried.unshift(page.units.pop()!);
        carriedHeight += units[last].height;
      }
      page = { units: carried, tail: false };
      pages.push(page);
      capacity = nextCapacity;
      used = carriedHeight;
    }
    page.units.push(i);
    used += unit.height;
  });
  if (used + tailHeight > capacity && page.units.length > 0) {
    page = { units: [], tail: false };
    pages.push(page);
  }
  page.tail = true;
  return pages;
}

/** A rate set as the owner's table writes it — for the "อัตราที่ใช้คิด" box. */
export function rateSetLines(set: PayoutRateSet): { title: string; ladder: string[]; tor: string } {
  const shares = (fordBp: number, torBp: number) => `ฟอร์ด ${formatPercent(fordBp)} · พี่ต่อ ${formatPercent(torBp)} · บริษัท ${formatPercent(BP_WHOLE - fordBp - torBp)}`;
  return {
    title: effectiveMonthLabel(set.effectiveMonth),
    ladder: ladderRowViews(set.rules.ladder).map((r) => `${r.label}: ${shares(r.fordBp, r.torBp)}`),
    tor: shares(set.rules.torFlat.fordBp, set.rules.torFlat.torBp),
  };
}

/** "1 Nov 2026 – 30 Nov 2026"; one day alone. */
export function payoutRangeLabel(from: string, to: string): string {
  return from === to ? formatDisplayDate(from) : `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
}

export const payoutPdfFilename = (from: string, to: string) => `commission-payout_${from}_${to}.pdf`;
