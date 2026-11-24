// What the delete dialog on /customers says about the records that still
// point at a customer, a company or a salesperson. Pure — the dialog renders
// it, the tests pin it. The counts come from GET /api/{kind}/[id]/links
// (app/lib/deleteBlockers.ts).

import { thCompare } from "../lib/thCompare";

export type DeleteKind = "customer" | "company" | "salesperson";

/** Each count the links route answers, in the order it is listed, with how
 *  it reads ("เครื่องมือ 2 เครื่อง"). */
const LINES: Record<DeleteKind, readonly { key: string; label: string; unit: string }[]> = {
  customer: [
    { key: "equipments", label: "เครื่องมือ", unit: "เครื่อง" },
    { key: "salesRecords", label: "รายการขาย", unit: "รายการ" },
    { key: "callSchedules", label: "นัดโทรติดตาม", unit: "นัด" },
    { key: "serviceJobs", label: "ใบ Job", unit: "ใบ" },
  ],
  company: [
    { key: "customers", label: "ลูกค้า", unit: "ราย" },
    { key: "serviceJobs", label: "ใบ Job", unit: "ใบ" },
  ],
  salesperson: [{ key: "salesRecords", label: "รายการขาย", unit: "รายการ" }],
};

/** The noun each kind goes by in the dialog's sentences. */
export const KIND_NOUN: Record<DeleteKind, { title: string; refused: string; done: string }> = {
  customer: { title: "ลูกค้า", refused: "ลบลูกค้ารายนี้ไม่ได้", done: "ลบลูกค้าสำเร็จ" },
  company: { title: "บริษัท", refused: "ลบบริษัทนี้ไม่ได้", done: "ลบบริษัทสำเร็จ" },
  salesperson: { title: "พนักงานขาย", refused: "ลบพนักงานขายคนนี้ไม่ได้", done: "ลบพนักงานขายสำเร็จ" },
};

/** What to do about them, under the list. */
export const BLOCKED_HINT: Record<DeleteKind, string> = {
  customer: "ต้องลบหรือย้ายรายการเหล่านี้ไปไว้กับลูกค้ารายอื่นก่อน จึงจะลบลูกค้ารายนี้ได้",
  company: "ต้องย้ายลูกค้าไปบริษัทอื่นหรือลบลูกค้าออกก่อน (และใบ Job ที่อ้างถึงบริษัทนี้) จึงจะลบบริษัทนี้ได้",
  salesperson: "ต้องเปลี่ยนพนักงานขายในรายการขายเหล่านั้นก่อน จึงจะลบพนักงานขายคนนี้ได้",
};

/**
 * One line per kind of record still pointing at it, with how many — empty
 * when nothing does (or the answer is not a set of counts at all: an old
 * build, a proxy page), which the dialog takes as "go ahead and ask".
 */
export function linkLines(kind: DeleteKind, counts: unknown): string[] {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return [];
  const record = counts as Record<string, unknown>;
  return LINES[kind].flatMap(({ key, label, unit }) => {
    const n = Number(record[key]);
    return Number.isFinite(n) && n > 0 ? [`${label} ${Math.floor(n).toLocaleString("th-TH")} ${unit}`] : [];
  });
}

/** How many of the companies a salesperson looks after the notice names. */
const CARETAKER_NAMED = 5;

/**
 * Deleting a salesperson who is เซลล์ผู้ดูแล of companies is not refused —
 * those companies are left with nobody (salesStore.deleteSalesperson). The
 * confirm question says which first, ก→ฮ, five by name and the rest counted.
 * Null when they look after none.
 */
export function caretakerNotice(companyNames: readonly string[]): string | null {
  if (companyNames.length === 0) return null;
  const sorted = [...companyNames].sort(thCompare);
  const named = sorted.slice(0, CARETAKER_NAMED).join(", ");
  const rest = sorted.length - CARETAKER_NAMED;
  const more = rest > 0 ? ` และอีก ${rest.toLocaleString("th-TH")} บริษัท` : "";
  return `ดูแลบริษัทอยู่ ${sorted.length.toLocaleString("th-TH")} บริษัท: ${named}${more} — ลบแล้วบริษัทเหล่านี้จะเป็น เซลล์ผู้ดูแล: ไม่ระบุ`;
}

/** The links route of each kind. */
export function linksUrl(kind: DeleteKind, id: string): string {
  return `${apiBase(kind)}/${encodeURIComponent(id)}/links`;
}

export function deleteUrl(kind: DeleteKind, id: string): string {
  return `${apiBase(kind)}/${encodeURIComponent(id)}`;
}

function apiBase(kind: DeleteKind): string {
  return kind === "customer" ? "/api/customers" : kind === "company" ? "/api/companies" : "/api/salespeople";
}
