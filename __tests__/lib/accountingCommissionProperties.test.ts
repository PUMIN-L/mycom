// @vitest-environment node
/**
 * The commission arithmetic and the payout paper, on many random months — a
 * check apart from the worked examples:
 *  • the calculator against a reference written separately (the ladder walked
 *    as bands, the shares rounded half up by BigInt): every PO's place on the
 *    month's running profit, its three shares adding up to its profit, the
 *    input order not mattering;
 *  • the paper's page breaks: every part once and in order, a page never
 *    overfilled, a PO's row kept with its cost detail whenever the two fit;
 *  • the Excel's รวม rows equal to the month's own sums.
 */
import { describe, it, expect } from "vitest";
import {
  BP_WHOLE,
  DEFAULT_COMMISSION_RULES,
  compareLadderOrder,
  monthCommission,
  type CommissionPoInput,
  type RateRules,
} from "@/app/lib/accounting/commission";
import { paginatePaper } from "@/app/lib/accounting/commissionPayoutPaper";
import { commissionMonthSheets } from "@/app/lib/accounting/commissionExport";
import type { CommissionMonth, CommissionMonthRow } from "@/app/lib/accounting/commissionTypes";

/** A seeded generator — the same "random" months every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/** amount × bp / 10000 rounded half up, exactly. */
const share = (amount: number, bp: number) => {
  const n = BigInt(amount) * BigInt(bp);
  const q = n / BigInt(BP_WHOLE);
  return Number((n % BigInt(BP_WHOLE)) * BigInt(2) >= BigInt(BP_WHOLE) ? q + BigInt(1) : q);
};
/** The reference ladder: every step a band [lo, hi), the part of the span inside it at its rates. */
function referenceShares(from: number, to: number, rules: RateRules) {
  const out = { ford: 0, tor: 0, company: 0 };
  let lo = 0;
  rules.ladder.forEach((step, i) => {
    const hi = i === rules.ladder.length - 1 ? Number.MAX_SAFE_INTEGER : (step.upToSatang as number);
    const amount = Math.max(0, Math.min(to, hi) - Math.max(from, lo));
    if (amount > 0) {
      const ford = share(amount, step.fordBp);
      const tor = Math.min(share(amount, step.torBp), amount - ford);
      out.ford += ford;
      out.tor += tor;
      out.company += amount - ford - tor;
    }
    lo = hi;
  });
  return out;
}
function randomRules(r: () => number): RateRules {
  if (r() < 0.3) return DEFAULT_COMMISSION_RULES;
  const steps = int(r, 1, 6);
  let up = 0;
  const ladder = Array.from({ length: steps }, (_, i) => {
    const fordBp = int(r, 0, BP_WHOLE);
    const torBp = int(r, 0, BP_WHOLE - fordBp);
    if (i === steps - 1) return { upToSatang: null, fordBp, torBp };
    up += int(r, 1, 300_000) * 100;
    return { upToSatang: up, fordBp, torBp };
  });
  const fordBp = int(r, 0, BP_WHOLE);
  return { ladder, torFlat: { fordBp, torBp: int(r, 0, BP_WHOLE - fordBp) } };
}
function randomMonth(r: () => number, count: number): CommissionPoInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    issueDate: `2026-11-${String(int(r, 1, 30)).padStart(2, "0")}`,
    createdAt: `2026-11-01T0${int(r, 0, 9)}:00:00.000Z`,
    kind: pick(r, ["ford", "ford", "tor", null] as const),
    profitSatang: pick(r, [null, -int(r, 1, 50_000_000), 0, int(r, 1, 100_000_000), int(r, 1, 100_000_000), int(r, 1, 3_000)]),
  }));
}

describe("the calculator against a separate reference — random months, random rate tables", () => {
  it("every PO: its place on the month's running profit, its shares, the three adding up — whatever the input order", () => {
    const r = rng(20261125);
    let fordPos = 0;
    for (let month = 0; month < 600; month++) {
      const rules = randomRules(r);
      const pos = randomMonth(r, int(r, 0, 25));
      const out = monthCommission(pos, rules);
      const sorted = [...pos].sort(compareLadderOrder);
      expect(out.map((o) => o.id)).toEqual(sorted.map((p) => p.id));
      expect(monthCommission([...pos].reverse(), rules)).toEqual(out);
      let running = 0;
      out.forEach((o, i) => {
        const p = sorted[i];
        const counted = p.kind && p.profitSatang !== null && p.profitSatang > 0 ? p.profitSatang : 0;
        expect(o.countedSatang).toBe(counted);
        expect(Math.min(o.fordSatang, o.torSatang, o.companySatang)).toBeGreaterThanOrEqual(0);
        expect(o.fordSatang + o.torSatang + o.companySatang).toBe(counted);
        if (p.kind === "ford") {
          expect([o.ladderFromSatang, o.ladderToSatang]).toEqual([running, running + counted]);
          const ref = referenceShares(running, running + counted, rules);
          expect([o.fordSatang, o.torSatang, o.companySatang]).toEqual([ref.ford, ref.tor, ref.company]);
          let at = running;
          for (const s of o.slices) {
            expect(s.fromSatang).toBe(at);
            at = s.toSatang;
          }
          expect(at).toBe(running + counted);
          running += counted;
          fordPos += 1;
        } else if (p.kind === "tor") {
          expect([o.ladderFromSatang, o.ladderToSatang, o.slices]).toEqual([null, null, []]);
          const ford = share(counted, rules.torFlat.fordBp);
          expect([o.fordSatang, o.torSatang]).toEqual([ford, Math.min(share(counted, rules.torFlat.torBp), counted - ford)]);
        } else {
          expect([o.fordSatang, o.torSatang, o.companySatang, o.ladderFromSatang]).toEqual([0, 0, 0, null]);
        }
      });
    }
    expect(fordPos).toBeGreaterThan(2_000);
  });

  it("the month's ลูกค้าฟอร์ด shares come to the owner's table on the whole month's profit — within a satang a slice", () => {
    const r = rng(7);
    for (let k = 0; k < 200; k++) {
      const pos: CommissionPoInput[] = Array.from({ length: int(r, 1, 15) }, (_, i) => ({
        id: `p${i}`,
        issueDate: "2026-11-10",
        createdAt: `2026-11-10T${String(i).padStart(2, "0")}:00:00.000Z`,
        kind: "ford",
        profitSatang: int(r, 1, 30_000_000),
      }));
      const out = monthCommission(pos, DEFAULT_COMMISSION_RULES);
      const whole = referenceShares(0, pos.reduce((s, p) => s + (p.profitSatang ?? 0), 0), DEFAULT_COMMISSION_RULES);
      const slices = out.reduce((s, o) => s + o.slices.length, 0);
      expect(Math.abs(out.reduce((s, o) => s + o.fordSatang, 0) - whole.ford)).toBeLessThanOrEqual(slices);
      expect(Math.abs(out.reduce((s, o) => s + o.torSatang, 0) - whole.tor)).toBeLessThanOrEqual(slices);
    }
  });
});

describe("the paper's page breaks — random papers shaped like real ones", () => {
  /** A PO row, and — with the costs — its deliveries and its total under it (the row kept with them). */
  function randomPaper(r: () => number) {
    const units: { height: number; keepWithNext: boolean }[] = [];
    const withCosts = r() < 0.6;
    for (let po = int(r, 0, 25); po > 0; po--) {
      units.push({ height: int(r, 6, 14), keepWithNext: withCosts });
      if (!withCosts) continue;
      for (let d = int(r, 1, 3); d > 0; d--) units.push({ height: int(r, 4, 70), keepWithNext: false });
      units.push({ height: int(r, 3, 6), keepWithNext: false });
    }
    return units;
  }

  it("every part once and in order; a page never over its room but for one part alone; the tail on the last page; a row kept with its detail when the two fit", () => {
    const r = rng(42);
    for (let k = 0; k < 3000; k++) {
      const units = randomPaper(r);
      const first = int(r, 40, 200);
      const next = first + int(r, 0, 60);
      const tail = int(r, 0, 120);
      const pages = paginatePaper(units, first, next, tail);
      expect(pages.flatMap((p) => p.units)).toEqual(units.map((_, i) => i));
      expect(pages.map((p) => p.tail)).toEqual(pages.map((_, i) => i === pages.length - 1));
      pages.forEach((p, i) => {
        const room = i === 0 ? first : next;
        const used = p.units.reduce((s, u) => s + units[u].height, 0);
        if (p.units.length > 1) expect(used).toBeLessThanOrEqual(room);
        if (p.tail && p.units.length > 0) expect(used + tail).toBeLessThanOrEqual(room);
        const last = p.units[p.units.length - 1];
        if (i < pages.length - 1 && p.units.length > 1 && last !== undefined && units[last].keepWithNext) {
          // Left at the foot only when it and its first detail would not fit a page together.
          expect(units[last].height + units[last + 1].height).toBeGreaterThan(next);
        }
      });
    }
  });
});

describe("the Excel's รวม rows equal the month's sums", () => {
  it("random months, some POs paid with a difference since", () => {
    const r = rng(99);
    const baht = (s: number) => Math.round(s) / 100;
    for (let k = 0; k < 150; k++) {
      const pos = randomMonth(r, int(r, 1, 20));
      const rows: CommissionMonthRow[] = monthCommission(pos, DEFAULT_COMMISSION_RULES).map((x) => {
        const p = pos.find((q) => q.id === x.id)!;
        const paid = x.kind !== null && r() < 0.3;
        return {
          ...x,
          customerPoNo: x.id,
          buyerName: "",
          issueDate: p.issueDate,
          status: "issued",
          orderStatus: "complete",
          salesSatang: 0,
          costSatang: 0,
          profitSatang: p.profitSatang,
          costMissing: false,
          paidInFull: true,
          owedSatang: 0,
          commissionStatus: paid ? "paid" : x.kind ? "payable" : "unassigned",
          payout: paid
            ? { id: `pay-${x.id}`, paidDate: "2026-11-20", profitSatang: x.countedSatang, fordSatang: x.fordSatang - 7, torSatang: x.torSatang + 7, companySatang: x.companySatang, createdBy: "a" }
            : null,
          differenceFordSatang: paid ? 7 : 0,
          differenceTorSatang: paid ? -7 : 0,
          paidButNot: null,
        };
      });
      const sum = (f: (x: CommissionMonthRow) => number) => rows.reduce((s, x) => s + f(x), 0);
      const person = { totalSatang: 0, paidSatang: 0, payableSatang: 0, waitingSatang: 0, differenceSatang: 0 };
      const month: CommissionMonth = {
        month: "2026-11",
        rateSet: { id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES },
        rows,
        totals: { ford: person, tor: person, companySatang: 0, profitSatang: 0, unassigned: 0 },
        invoicesWithoutPo: 0,
      };
      const [summary, ladder] = commissionMonthSheets(month, null);
      const total = summary.rows[summary.rows.length - 1];
      expect(total["ฟอร์ด"]).toBeCloseTo(baht(sum((x) => x.fordSatang)), 6);
      expect(total["พี่ต่อ"]).toBeCloseTo(baht(sum((x) => x.torSatang)), 6);
      expect(total["บริษัท"]).toBeCloseTo(baht(sum((x) => x.companySatang)), 6);
      expect(total["ฟอร์ดที่จ่าย"]).toBeCloseTo(baht(sum((x) => x.payout?.fordSatang ?? 0)), 6);
      expect(total["ส่วนต่างพี่ต่อ"]).toBeCloseTo(baht(sum((x) => (x.payout ? -7 : 0))), 6);
      if (ladder.rows.length > 0) {
        const lt = ladder.rows[ladder.rows.length - 1];
        expect(lt["ฟอร์ด"]).toBeCloseTo(baht(sum((x) => x.fordSatang)), 6);
        expect(lt["พี่ต่อ"]).toBeCloseTo(baht(sum((x) => x.torSatang)), 6);
        expect(lt["บริษัท"]).toBeCloseTo(baht(sum((x) => x.companySatang)), 6);
        expect(lt["กำไรในช่วงนี้"]).toBeCloseTo(baht(sum((x) => x.countedSatang)), 6);
      }
    }
  });
});
