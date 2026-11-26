// Editing one delivery's costs on the commission screen (ARCHITECTURE.md §8h) —
// pure, the same in the browser and on the server: what an edit is, what is
// wrong with one (in Thai), and the one line the PO's history keeps of it.
//
// An edit is one delivery (one dashboard sale): each product line's cost set
// to an absolute amount, the other costs (ค่ารถ, ค่าขนส่ง…) added / changed /
// removed — and the delivery's cost as the sale stored it when the editor
// opened, so a change made meanwhile (the dashboard, another tab) is refused
// rather than overwritten. Money in satang.

import { COST_TYPE_LABELS } from "../costTypes";
import { formatSatang } from "./money";

/** The kinds an "other" cost may be — ต้นทุนสินค้า is not one: it lives on the product lines. */
export const EDITABLE_COST_TYPES = ["transport", "shipping", "service_visit", "repair", "commission", "other"] as const;
export type EditableCostType = (typeof EDITABLE_COST_TYPES)[number];

export const COST_EDIT_LIMITS = { label: 255, note: 1000, rows: 50, lines: 200 } as const;

/** The most a cost column holds (DECIMAL(12,2) — 9,999,999,999.99 baht), in satang. */
export const MAX_COST_SATANG = 999_999_999_999;

export const NOTHING_TO_SAVE = "ไม่มีอะไรเปลี่ยน";
const DUPLICATE = "มีรายการเดียวกันซ้ำ — กรุณาโหลดใหม่แล้วแก้อีกครั้ง";
const TOO_MUCH = "จำนวนเงินสูงเกินไป (สูงสุด 9,999,999,999.99 บาท)";

export interface CostRowInput {
  costType: string;
  label: string;
  note: string;
  amountSatang: number;
}

export interface CostEditInput {
  /** The delivery — the dashboard sale. */
  saleId: string;
  /** The delivery's cost as the sale stored it when the editor opened. */
  expectedCostSatang: number;
  /** Product lines whose cost changes — absolute. */
  lines: { id: string; costSatang: number }[];
  add: CostRowInput[];
  update: (CostRowInput & { id: string })[];
  remove: string[];
}

export const isEditableCostType = (value: unknown): value is EditableCostType =>
  typeof value === "string" && (EDITABLE_COST_TYPES as readonly string[]).includes(value);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : null);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function rowOf(raw: unknown): CostRowInput | null {
  if (!isRecord(raw)) return null;
  const costType = str(raw.costType);
  const label = raw.label === undefined ? "" : str(raw.label);
  const note = raw.note === undefined ? "" : str(raw.note);
  if (costType === null || label === null || note === null || typeof raw.amountSatang !== "number") return null;
  return { costType, label, note, amountSatang: raw.amountSatang };
}

/** What the browser sent, reduced to its fields — null when it is not an edit at all. Its figures are judged by costEditProblems. */
export function cleanCostEdit(body: unknown): CostEditInput | null {
  if (!isRecord(body)) return null;
  const saleId = str(body.saleId);
  if (!saleId || typeof body.expectedCostSatang !== "number") return null;
  const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : null);
  const lines = list(body.lines);
  const add = list(body.add);
  const update = list(body.update);
  const remove = list(body.remove);
  if (!lines || !add || !update || !remove) return null;

  const out: CostEditInput = { saleId, expectedCostSatang: body.expectedCostSatang, lines: [], add: [], update: [], remove: [] };
  for (const l of lines) {
    if (!isRecord(l) || typeof l.id !== "string" || !l.id || typeof l.costSatang !== "number") return null;
    out.lines.push({ id: l.id, costSatang: l.costSatang });
  }
  for (const a of add) {
    const row = rowOf(a);
    if (!row) return null;
    out.add.push(row);
  }
  for (const u of update) {
    const row = rowOf(u);
    if (!row || !isRecord(u) || typeof u.id !== "string" || !u.id) return null;
    out.update.push({ id: u.id, ...row });
  }
  for (const id of remove) {
    if (typeof id !== "string" || !id) return null;
    out.remove.push(id);
  }
  return out;
}

/** "ค่าขนส่ง (Kerry)" — how a cost row is named, here and in the history (a long detail cut short). */
export function costRowName(row: { costType: string; label: string }): string {
  const kind = COST_TYPE_LABELS[row.costType] ?? COST_TYPE_LABELS.other;
  const label = row.label.length > 40 ? `${row.label.slice(0, 40)}…` : row.label;
  return label ? `${kind} (${label})` : kind;
}

const isAmount = (n: number, min: number) => Number.isInteger(n) && n >= min;

/** What is wrong with an edit, in Thai — nothing when it can be saved. */
export function costEditProblems(edit: CostEditInput): string[] {
  const problems: string[] = [];
  const add = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  if (edit.lines.length === 0 && edit.add.length === 0 && edit.update.length === 0 && edit.remove.length === 0) return [NOTHING_TO_SAVE];
  if (edit.lines.length > COST_EDIT_LIMITS.lines || edit.add.length + edit.update.length > COST_EDIT_LIMITS.rows) {
    return [`ค่าใช้จ่ายมากเกินไป — ได้ไม่เกิน ${COST_EDIT_LIMITS.rows} รายการต่อครั้ง`];
  }

  const lineIds = edit.lines.map((l) => l.id);
  const rowIds = [...edit.update.map((u) => u.id), ...edit.remove];
  if (new Set(lineIds).size !== lineIds.length || new Set(rowIds).size !== rowIds.length) add(DUPLICATE);

  for (const l of edit.lines) {
    if (!isAmount(l.costSatang, 0)) add("ต้นทุนสินค้า: ต้องเป็นจำนวนเงินตั้งแต่ 0 บาทขึ้นไป");
    else if (l.costSatang > MAX_COST_SATANG) add(`ต้นทุนสินค้า: ${TOO_MUCH}`);
  }
  for (const row of [...edit.add, ...edit.update]) {
    if (!isEditableCostType(row.costType)) {
      add("กรุณาเลือกประเภทของค่าใช้จ่ายทุกรายการ");
      continue;
    }
    const name = costRowName(row);
    if (!isAmount(row.amountSatang, 1)) add(`${name}: จำนวนเงินต้องมากกว่า 0 — ถ้าไม่ใช้รายการนี้ ให้กดลบ`);
    else if (row.amountSatang > MAX_COST_SATANG) add(`${name}: ${TOO_MUCH}`);
    if (row.label.length > COST_EDIT_LIMITS.label) add(`${name}: รายละเอียดยาวเกิน ${COST_EDIT_LIMITS.label} ตัวอักษร`);
    if (row.note.length > COST_EDIT_LIMITS.note) add(`${name}: หมายเหตุยาวเกิน ${COST_EDIT_LIMITS.note.toLocaleString("en-US")} ตัวอักษร`);
  }
  return problems;
}

type RowFigure = { costType: string; label: string; amountSatang: number };

export interface CostEditChanges {
  invoiceRef: string;
  lines: { productName: string; beforeSatang: number; afterSatang: number }[];
  added: RowFigure[];
  updated: { before: RowFigure; after: RowFigure }[];
  removed: RowFigure[];
  totalBeforeSatang: number;
  totalAfterSatang: number;
}

/** The one line the PO's history keeps: each change before → after, and the delivery's cost before → after. */
export function costEditDetail(c: CostEditChanges): string {
  const parts = [`แก้ต้นทุน ${c.invoiceRef || "(การส่งของที่ไม่มีเลขที่)"}`];
  for (const l of c.lines) parts.push(`ต้นทุนสินค้า ${l.productName} ${formatSatang(l.beforeSatang)} → ${formatSatang(l.afterSatang)}`);
  for (const r of c.added) parts.push(`เพิ่ม ${costRowName(r)} ${formatSatang(r.amountSatang)}`);
  for (const { before, after } of c.updated) {
    const was = costRowName(before);
    const now = costRowName(after);
    if (was === now && before.amountSatang === after.amountSatang) parts.push(`แก้หมายเหตุ ${now}`);
    else if (was === now) parts.push(`แก้ ${now} ${formatSatang(before.amountSatang)} → ${formatSatang(after.amountSatang)}`);
    else parts.push(`แก้ ${was} ${formatSatang(before.amountSatang)} → ${now} ${formatSatang(after.amountSatang)}`);
  }
  for (const r of c.removed) parts.push(`ลบ ${costRowName(r)} ${formatSatang(r.amountSatang)}`);
  parts.push(`ต้นทุนรวม ${formatSatang(c.totalBeforeSatang)} → ${formatSatang(c.totalAfterSatang)}`);
  return parts.join(" · ");
}
