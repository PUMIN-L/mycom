// The commission calculator — pure, so the server (the month view, the
// paid-out marks) and the browser (the rate editor) work it out the same way.
// Money in whole satang, rates in basis points (2700 = 27.00%).
//
// The owner's rules (2026-11-25):
//  • the company always takes 50% of a deal's profit; the other 50% goes to
//    ฟอร์ด and พี่ต่อ by the kind of deal chosen on the PO — a ลูกค้าฟอร์ด deal
//    by a step ladder, a ลูกค้าพี่ต่อ deal flat;
//  • the ladder is the MONTH's running profit — the PO's month — adding up the
//    ลูกค้าฟอร์ด POs in PO-date order, unpaid ones too: a customer paying
//    decides WHEN a commission may be paid, never how much;
//  • each PO takes the slice of the running profit it spans, every slice at its
//    own step's rates ("100,000 แรก × 27% + 200,000 ถัดมา × 32%");
//  • a PO nobody chose for, a loss, or a profit not known yet takes nothing;
//  • a rate set starts on the 1st of a month, so one month is one set.

import { mulDivRound } from "./money";

export type CommissionKind = "ford" | "tor";

/** 100.00% in basis points. */
export const BP_WHOLE = 10_000;
export const MAX_LADDER_STEPS = 10;
/** The month a set "from the very beginning" starts at — before any real one. */
export const FIRST_EFFECTIVE_MONTH = "0000-00";

/** How a PO's choice reads on screen — the deal is that person's customer. */
export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
  ford: "ลูกค้าฟอร์ด",
  tor: "ลูกค้าพี่ต่อ",
};

export interface LadderStep {
  /** Where this step ends on the month's running profit, in satang; null for the last ("เกิน …"). */
  upToSatang: number | null;
  fordBp: number;
  torBp: number;
}

export interface FlatRates {
  fordBp: number;
  torBp: number;
}

export interface RateRules {
  /** ลูกค้าฟอร์ด deals. */
  ladder: LadderStep[];
  /** ลูกค้าพี่ต่อ deals. */
  torFlat: FlatRates;
}

export interface RateSet {
  /** The stored row's id; null for the owner's table nobody has saved over yet. */
  id: string | null;
  /** "YYYY-MM" — it applies to POs dated from the 1st of that month. */
  effectiveMonth: string;
  rules: RateRules;
}

/** The owner's table, as sent (2026-11-25) — what applies until a set is saved. */
export const DEFAULT_COMMISSION_RULES: RateRules = {
  ladder: [
    { upToSatang: 10_000_000, fordBp: 2700, torBp: 2300 },
    { upToSatang: 30_000_000, fordBp: 3200, torBp: 1800 },
    { upToSatang: 50_000_000, fordBp: 3400, torBp: 1600 },
    { upToSatang: null, fordBp: 3700, torBp: 1300 },
  ],
  torFlat: { fordBp: 1500, torBp: 3500 },
};

export interface CommissionSplit {
  fordSatang: number;
  torSatang: number;
  companySatang: number;
}

export interface LadderSlice extends CommissionSplit {
  fromSatang: number;
  toSatang: number;
  fordBp: number;
  torBp: number;
}

/**
 * `amountSatang` shared out: each person's share is their percentage rounded
 * half up — what anyone checking with a calculator gets — and the company
 * keeps the rest, so the three always add up to the amount exactly. พี่ต่อ's
 * share never takes the company below 0 (two shares rounding up on a rate
 * set adding to 100%).
 */
export function splitAmount(amountSatang: number, fordBp: number, torBp: number): CommissionSplit {
  const amount = Math.round(amountSatang);
  if (amount <= 0) return { fordSatang: 0, torSatang: 0, companySatang: 0 };
  const fordSatang = mulDivRound([amount, fordBp], BP_WHOLE);
  const torSatang = Math.min(mulDivRound([amount, torBp], BP_WHOLE), amount - fordSatang);
  return { fordSatang, torSatang, companySatang: amount - fordSatang - torSatang };
}

/**
 * The part of the running profit from `fromSatang` to `toSatang`, cut at the
 * ladder's steps, each slice at its own step's rates. The last step has no
 * ceiling, whatever it says.
 */
export function ladderSlices(fromSatang: number, toSatang: number, ladder: readonly LadderStep[]): LadderSlice[] {
  const out: LadderSlice[] = [];
  if (!(toSatang > fromSatang)) return out;
  let floor = 0;
  for (let i = 0; i < ladder.length; i++) {
    const step = ladder[i];
    const ceiling = i === ladder.length - 1 ? Infinity : (step.upToSatang ?? Infinity);
    const lo = Math.max(fromSatang, floor);
    const hi = Math.min(toSatang, ceiling);
    if (hi > lo) {
      out.push({ fromSatang: lo, toSatang: hi, fordBp: step.fordBp, torBp: step.torBp, ...splitAmount(hi - lo, step.fordBp, step.torBp) });
    }
    if (ceiling >= toSatang) break;
    floor = ceiling;
  }
  return out;
}

export interface CommissionPoInput {
  id: string;
  /** The PO's date, "YYYY-MM-DD" — its place on the ladder. */
  issueDate: string;
  /** When it was recorded — the order between POs of one date. */
  createdAt: string;
  /** Whose customer the deal is, as chosen on the PO; null = not chosen yet. */
  kind: CommissionKind | null;
  /** Its profit known so far, ex VAT; null when nothing is known yet. */
  profitSatang: number | null;
}

export interface CommissionPoResult extends CommissionSplit {
  id: string;
  kind: CommissionKind | null;
  /** What it counts for: its profit when it has a kind and the profit is above 0, else 0. */
  countedSatang: number;
  /** A ลูกค้าฟอร์ด PO's place on the month's running profit; null for the others. */
  ladderFromSatang: number | null;
  ladderToSatang: number | null;
  /** The ladder slices it took (ลูกค้าฟอร์ด POs only). */
  slices: LadderSlice[];
}

/** The ladder's order: PO date, then the one recorded first, then by id. */
export function compareLadderOrder(
  a: Pick<CommissionPoInput, "issueDate" | "createdAt" | "id">,
  b: Pick<CommissionPoInput, "issueDate" | "createdAt" | "id">
): number {
  if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

const NOTHING: CommissionSplit = { fordSatang: 0, torSatang: 0, companySatang: 0 };

/**
 * One month's POs (all of them dated in that month) worked out with that
 * month's rules — returned in the ladder's order.
 */
export function monthCommission(pos: readonly CommissionPoInput[], rules: RateRules): CommissionPoResult[] {
  let running = 0;
  return [...pos].sort(compareLadderOrder).map((p) => {
    const counted = p.kind && p.profitSatang !== null && p.profitSatang > 0 ? Math.round(p.profitSatang) : 0;
    if (p.kind === "ford") {
      const from = running;
      running += counted;
      const slices = ladderSlices(from, running, rules.ladder);
      const total = slices.reduce(
        (s, x) => ({ fordSatang: s.fordSatang + x.fordSatang, torSatang: s.torSatang + x.torSatang, companySatang: s.companySatang + x.companySatang }),
        NOTHING
      );
      return { id: p.id, kind: p.kind, countedSatang: counted, ladderFromSatang: from, ladderToSatang: running, slices, ...total };
    }
    if (p.kind === "tor") {
      return {
        id: p.id,
        kind: p.kind,
        countedSatang: counted,
        ladderFromSatang: null,
        ladderToSatang: null,
        slices: [],
        ...splitAmount(counted, rules.torFlat.fordBp, rules.torFlat.torBp),
      };
    }
    return { id: p.id, kind: null, countedSatang: 0, ladderFromSatang: null, ladderToSatang: null, slices: [], ...NOTHING };
  });
}

/**
 * The set that applies to POs of `month` ("YYYY-MM"): the latest one started
 * by then — the owner's table when none was saved, or none started yet. Give
 * one set per month (the newest saved of each).
 */
export function rateSetForMonth(sets: readonly RateSet[], month: string): RateSet {
  let best: RateSet | null = null;
  for (const set of sets) {
    if (set.effectiveMonth <= month && (!best || set.effectiveMonth > best.effectiveMonth)) best = set;
  }
  return best ?? { id: null, effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: DEFAULT_COMMISSION_RULES };
}

const bpOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= BP_WHOLE;

function ratesProblems(where: string, rates: Partial<FlatRates> | null | undefined): string[] {
  const out: string[] = [];
  const fordOk = bpOk(rates?.fordBp);
  const torOk = bpOk(rates?.torBp);
  if (!fordOk) out.push(`${where}: % ของฟอร์ดต้องอยู่ระหว่าง 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)`);
  if (!torOk) out.push(`${where}: % ของพี่ต่อต้องอยู่ระหว่าง 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)`);
  if (fordOk && torOk && rates!.fordBp! + rates!.torBp! > BP_WHOLE) out.push(`${where}: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%`);
  return out;
}

/**
 * What is wrong with a rate table, in Thai, step by step — nothing when it can
 * be saved. At least one step and at most MAX_LADDER_STEPS; every step but the
 * last ends higher than the one before; the last has no ceiling; each
 * percentage 0–100 with at most 2 decimals; ฟอร์ด + พี่ต่อ not over 100%.
 */
export function rateRulesProblems(rules: unknown): string[] {
  if (!rules || typeof rules !== "object") return ["ตารางอัตราไม่ถูกต้อง"];
  const r = rules as Partial<RateRules>;
  if (!Array.isArray(r.ladder) || !r.torFlat || typeof r.torFlat !== "object") return ["ตารางอัตราไม่ถูกต้อง"];
  const ladder = r.ladder as unknown[];
  const problems: string[] = [];
  if (ladder.length === 0) problems.push("ต้องมีอย่างน้อย 1 ขั้น");
  if (ladder.length > MAX_LADDER_STEPS) problems.push(`ได้ไม่เกิน ${MAX_LADDER_STEPS} ขั้น`);
  let previous = 0;
  ladder.forEach((raw, i) => {
    const where = `ขั้นที่ ${i + 1}`;
    if (!raw || typeof raw !== "object") {
      problems.push(`${where}: ข้อมูลไม่ถูกต้อง`);
      return;
    }
    const step = raw as Partial<LadderStep>;
    if (i === ladder.length - 1) {
      if (step.upToSatang !== null) problems.push('ขั้นสุดท้ายต้องเป็น "เกิน …" (ไม่มีเพดาน)');
    } else if (typeof step.upToSatang !== "number" || !Number.isSafeInteger(step.upToSatang) || step.upToSatang <= 0) {
      problems.push(`${where}: ต้องระบุกำไรสูงสุดของขั้น`);
    } else {
      if (i > 0 && step.upToSatang <= previous) problems.push(`${where}: ต้องมากกว่าขั้นที่ ${i}`);
      previous = Math.max(previous, step.upToSatang);
    }
    problems.push(...ratesProblems(where, step));
  });
  problems.push(...ratesProblems("ดีลลูกค้าพี่ต่อ", r.torFlat));
  return problems;
}
