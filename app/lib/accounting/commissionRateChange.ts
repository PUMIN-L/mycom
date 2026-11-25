// Changing the commission rate table (ARCHITECTURE.md §8h) — pure, shared by
// the server (what it saves, what the emails say) and the rate editor.
//
// A set applies to POs dated from the 1st of the month it starts — the owner's
// rule, so a month is one set; the first set starts "from the beginning" and is
// edited, never removed. A change is a SAVE of one month's set (an edit, or a
// new set) or the REMOVAL of a later one.

import type { EmailCell } from "../emailHtml";
import { monthLabel, monthRange } from "./exportRules";
import {
  BP_WHOLE,
  FIRST_EFFECTIVE_MONTH,
  rateRulesProblems,
  rateSetForMonth,
  type FlatRates,
  type LadderStep,
  type RateRules,
  type RateSet,
} from "./commission";

export type RateChange = { kind: "save"; effectiveMonth: string; rules: RateRules } | { kind: "remove"; effectiveMonth: string };

/** "0000-00" (from the beginning), or a real "YYYY-MM". */
export function isEffectiveMonth(value: unknown): value is string {
  return value === FIRST_EFFECTIVE_MONTH || (typeof value === "string" && monthRange(value) !== null);
}

/** "ตั้งแต่เริ่มต้น" / "ตั้งแต่เดือนเมษายน 2572". */
export function effectiveMonthLabel(month: string): string {
  return month === FIRST_EFFECTIVE_MONTH ? "ตั้งแต่เริ่มต้น" : `ตั้งแต่เดือน${monthLabel(month)}`;
}

/** 2700 → "27%", 2750 → "27.5%", 1234 → "12.34%". */
export function formatPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/** What was typed as a percentage → basis points; null unless 0–100 with at most 2 decimals. */
export function percentTextToBp(text: string): number | null {
  const raw = String(text ?? "").trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const bp = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return bp <= BP_WHOLE ? bp : null;
}

/** Whole baht with separators: 10_000_000 satang → "100,000". */
export const formatWholeBaht = (satang: number) => (Math.round(satang) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface LadderRowView {
  label: string;
  fordBp: number;
  torBp: number;
  companyBp: number;
}

/** The steps as the owner's table writes them: "0 – 100,000", "100,001 – 300,000", …, "เกิน 500,000". */
export function ladderRowViews(ladder: readonly LadderStep[]): LadderRowView[] {
  return ladder.map((step, i) => {
    const prev = i > 0 ? ladder[i - 1].upToSatang : null;
    const last = i === ladder.length - 1;
    let label: string;
    if (last) label = prev === null ? "กำไรทุกยอด" : `เกิน ${formatWholeBaht(prev)}`;
    else label = `${prev === null ? "0" : formatWholeBaht(prev + 100)} – ${formatWholeBaht(step.upToSatang ?? 0)}`;
    return { label, fordBp: step.fordBp, torBp: step.torBp, companyBp: BP_WHOLE - step.fordBp - step.torBp };
  });
}

const pick = (o: Record<string, unknown>): Partial<LadderStep> => ({
  upToSatang: o.upToSatang as number | null,
  fordBp: o.fordBp as number,
  torBp: o.torBp as number,
});

/** The change the browser sent, reduced to its fields — null when it is not one. Its figures are judged by rateChangeProblems. */
export function cleanRateChange(body: unknown): RateChange | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.effectiveMonth !== "string") return null;
  if (b.kind === "remove") return { kind: "remove", effectiveMonth: b.effectiveMonth };
  if (b.kind !== "save" || !b.rules || typeof b.rules !== "object") return null;
  const rules = b.rules as Record<string, unknown>;
  if (!Array.isArray(rules.ladder) || !rules.torFlat || typeof rules.torFlat !== "object") return null;
  if (rules.ladder.some((s) => !s || typeof s !== "object")) return null;
  const flat = rules.torFlat as Record<string, unknown>;
  return {
    kind: "save",
    effectiveMonth: b.effectiveMonth,
    rules: {
      ladder: rules.ladder.map((s) => pick(s as Record<string, unknown>) as LadderStep),
      torFlat: { fordBp: flat.fordBp as number, torBp: flat.torBp as number },
    },
  };
}

/** The same figures? */
export function sameRules(a: RateRules, b: RateRules): boolean {
  const norm = (r: RateRules) =>
    JSON.stringify({ ladder: r.ladder.map((s) => [s.upToSatang, s.fordBp, s.torBp]), torFlat: [r.torFlat.fordBp, r.torFlat.torBp] });
  return norm(a) === norm(b);
}

export const NOTHING_CHANGED = "ตารางนี้เหมือนเดิม ไม่มีอะไรเปลี่ยน";

/** What is wrong with a change against the sets in force, in Thai — nothing when it can be saved. */
export function rateChangeProblems(change: RateChange, sets: readonly RateSet[]): string[] {
  if (!isEffectiveMonth(change.effectiveMonth)) return ["เดือนที่เริ่มใช้ไม่ถูกต้อง"];
  if (change.kind === "remove") {
    if (change.effectiveMonth === FIRST_EFFECTIVE_MONTH) return ["ลบตารางชุดแรกไม่ได้ — แก้ตัวเลขแทน"];
    if (!sets.some((s) => s.effectiveMonth === change.effectiveMonth)) return ["ไม่พบตารางชุดนี้"];
    return [];
  }
  const problems = rateRulesProblems(change.rules);
  if (problems.length > 0) return problems;
  // What would apply to that month anyway: the same figures add nothing.
  if (sameRules(rateSetForMonth(sets, change.effectiveMonth).rules, change.rules)) return [NOTHING_CHANGED];
  return [];
}

/** The sets after the change, in month order (a new set has no id yet). */
export function applyRateChange(sets: readonly RateSet[], change: RateChange): RateSet[] {
  const others = sets.filter((s) => s.effectiveMonth !== change.effectiveMonth);
  const next =
    change.kind === "save"
      ? [...others, { id: sets.find((s) => s.effectiveMonth === change.effectiveMonth)?.id ?? null, effectiveMonth: change.effectiveMonth, rules: change.rules }]
      : others;
  return next.sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : a.effectiveMonth > b.effectiveMonth ? 1 : 0));
}

export interface RateTable {
  title: string;
  head: string[];
  rows: EmailCell[][];
  alignRight: number[];
}

const HEAD = ["ช่วงกำไรสะสมของเดือน (บาท)", "ฟอร์ด", "พี่ต่อ", "บริษัท"];
const FLAT_LABEL = "ดีลลูกค้าพี่ต่อ";
const companyBp = (r: FlatRates) => BP_WHOLE - r.fordBp - r.torBp;

/** A cell for a rate: "before → after", highlighted, when it changed. */
function rateCell(before: number | undefined, after: number): EmailCell {
  if (before === undefined) return { text: formatPercent(after), highlight: true };
  if (before !== after) return { text: `${formatPercent(before)} → ${formatPercent(after)}`, highlight: true };
  return formatPercent(after);
}

function plainRows(rules: RateRules): EmailCell[][] {
  return [
    ...ladderRowViews(rules.ladder).map((r) => [r.label, formatPercent(r.fordBp), formatPercent(r.torBp), formatPercent(r.companyBp)]),
    [FLAT_LABEL, formatPercent(rules.torFlat.fordBp), formatPercent(rules.torFlat.torBp), formatPercent(companyBp(rules.torFlat))],
  ];
}

/** A set as a table — for the email that lists every set in force. */
export function rateSetTable(set: RateSet): RateTable {
  return { title: effectiveMonthLabel(set.effectiveMonth), head: HEAD, rows: plainRows(set.rules), alignRight: [1, 2, 3] };
}

/**
 * The change as a table, before → after, what changed standing out. A save is
 * set against what applied to that month before it (an earlier set, or the
 * owner's table); a removal shows the set that goes, as it was.
 */
export function rateChangeTable(change: RateChange, sets: readonly RateSet[]): RateTable {
  const label = effectiveMonthLabel(change.effectiveMonth);
  if (change.kind === "remove") {
    const gone = sets.find((s) => s.effectiveMonth === change.effectiveMonth);
    return { title: `${label} — ลบชุดนี้`, head: HEAD, rows: gone ? plainRows(gone.rules) : [], alignRight: [1, 2, 3] };
  }
  const isNew = change.effectiveMonth !== FIRST_EFFECTIVE_MONTH && !sets.some((s) => s.effectiveMonth === change.effectiveMonth);
  const before = rateSetForMonth(sets, change.effectiveMonth).rules;
  const beforeRows = ladderRowViews(before.ladder);
  const afterRows = ladderRowViews(change.rules.ladder);
  const rows: EmailCell[][] = afterRows.map((a, i) => {
    const b = beforeRows[i];
    const labelCell: EmailCell = !b ? { text: a.label, highlight: true } : b.label !== a.label ? { text: `${a.label} (เดิม ${b.label})`, highlight: true } : a.label;
    return [labelCell, rateCell(b?.fordBp, a.fordBp), rateCell(b?.torBp, a.torBp), rateCell(b?.companyBp, a.companyBp)];
  });
  for (const b of beforeRows.slice(afterRows.length)) {
    rows.push([
      { text: `${b.label} — ลบขั้นนี้`, highlight: true },
      { text: `${formatPercent(b.fordBp)} → —`, highlight: true },
      { text: `${formatPercent(b.torBp)} → —`, highlight: true },
      { text: `${formatPercent(b.companyBp)} → —`, highlight: true },
    ]);
  }
  rows.push([
    FLAT_LABEL,
    rateCell(before.torFlat.fordBp, change.rules.torFlat.fordBp),
    rateCell(before.torFlat.torBp, change.rules.torFlat.torBp),
    rateCell(companyBp(before.torFlat), companyBp(change.rules.torFlat)),
  ]);
  return { title: `${label} — ${isNew ? "เพิ่มชุดใหม่" : "แก้ชุดนี้"}`, head: HEAD, rows, alignRight: [1, 2, 3] };
}
