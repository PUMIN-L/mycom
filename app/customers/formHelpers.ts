// The add / edit forms of /customers: what each one edits, as plain strings,
// whether anything was changed, what is wrong with it (in Thai, said under
// the field) and whether it looks like something already on the list. Pure —
// the forms render it, the tests pin it.
import { phoneParts } from "../lib/phone";
import { THAI_PROVINCES, provinceName } from "../lib/thaiProvinces";

/** Column sizes the routes cut to (VARCHAR(255) everywhere but the notes). */
export const NAME_MAX = 255;
export const FIELD_MAX = 255;
/** customers.note and companies.note: the routes cut at 2,000. */
export const CUSTOMER_NOTE_MAX = 2000;
export const COMPANY_NOTE_MAX = 2000;
/** salespeople.note: salesStore cuts at 5,000. */
export const SALESPERSON_NOTE_MAX = 5000;

export interface CompanyDraft {
  name: string;
  addressNo: string;
  moo: string;
  soi: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  phone: string;
  note: string;
}

export interface CustomerDraft {
  name: string;
  companyId: string;
  department: string;
  phone: string;
  email: string;
  note: string;
}

export interface SalespersonDraft {
  name: string;
  phone: string;
  email: string;
  note: string;
}

/** A column as the form shows it: a DB NULL (or a number, for a house number
 *  stored as one) is text like any other. */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

type Source = Record<string, unknown> | null | undefined;

const COMPANY_FIELDS = ["name", "addressNo", "moo", "soi", "road", "subDistrict", "district", "province", "postalCode", "phone", "note"] as const;
const CUSTOMER_FIELDS = ["name", "companyId", "department", "phone", "email", "note"] as const;
const SALESPERSON_FIELDS = ["name", "phone", "email", "note"] as const;

function pick<K extends string>(fields: readonly K[], source: Source): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const field of fields) out[field] = text(source?.[field]);
  return out;
}

/**
 * A company as the form opens it. The province is given its official name
 * when it is a known one typed another way ("กทม." → "กรุงเทพมหานคร"): the
 * form picks from a list, and this is what the list calls it. It is part of
 * what the form OPENED with, so opening and closing changes nothing; a save
 * writes the official name.
 */
export function toCompanyDraft(c?: Source): CompanyDraft {
  const draft = pick(COMPANY_FIELDS, c);
  draft.province = provinceName(draft.province);
  return draft;
}
export const toCustomerDraft = (c?: Source): CustomerDraft => pick(CUSTOMER_FIELDS, c);
export const toSalespersonDraft = (s?: Source): SalespersonDraft => pick(SALESPERSON_FIELDS, s);

/** Whether the form holds anything the admin would lose by closing it. */
export function isDraftDirty<T extends object>(original: T, draft: T): boolean {
  return (Object.keys(original) as (keyof T)[]).some((key) => original[key] !== draft[key]);
}

// ── What is wrong with it ────────────────────────────────────────────────────

/** Each field's problem, in the order the form shows the fields — the first
 *  one is where the cursor goes. */
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/** Something@something.something, no spaces — enough to catch a slip. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_WRONG = "รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com";
const tooLong = (label: string, max: number) => `${label}ยาวเกิน ${max.toLocaleString("th-TH")} ตัวอักษร ตัดให้สั้นลงก่อนบันทึก`;

export function companyErrors(d: CompanyDraft): FieldErrors<CompanyDraft> {
  const errors: FieldErrors<CompanyDraft> = {};
  if (!d.name.trim()) errors.name = "กรุณากรอกชื่อบริษัท";
  if (d.note.length > COMPANY_NOTE_MAX) errors.note = tooLong("หมายเหตุ", COMPANY_NOTE_MAX);
  return errors;
}

/**
 * `companies` is the list the form's dropdown picks from. A customer whose
 * company is no longer on it (deleted since) shows as "-- เลือกบริษัท --" in
 * that dropdown; saved as is, they would keep pointing at a company that is
 * not there — so that counts as no company chosen. An empty list (it failed
 * to load) proves nothing and is not held against anyone.
 */
export function customerErrors(d: CustomerDraft, companies: readonly { id: string }[] = []): FieldErrors<CustomerDraft> {
  const errors: FieldErrors<CustomerDraft> = {};
  if (!d.name.trim()) errors.name = "กรุณากรอกชื่อลูกค้า";
  if (!d.companyId) errors.companyId = "กรุณาเลือกบริษัท";
  else if (companies.length > 0 && !companies.some((c) => c.id === d.companyId)) {
    errors.companyId = "บริษัทเดิมของลูกค้ารายนี้ไม่อยู่ในรายการแล้ว กรุณาเลือกบริษัท";
  }
  if (d.email.trim() && !EMAIL_SHAPE.test(d.email.trim())) errors.email = EMAIL_WRONG;
  if (d.note.length > CUSTOMER_NOTE_MAX) errors.note = tooLong("บันทึกลูกค้า", CUSTOMER_NOTE_MAX);
  return errors;
}

export function salespersonErrors(d: SalespersonDraft): FieldErrors<SalespersonDraft> {
  const errors: FieldErrors<SalespersonDraft> = {};
  if (!d.name.trim()) errors.name = "กรุณากรอกชื่อพนักงานขาย";
  if (d.email.trim() && !EMAIL_SHAPE.test(d.email.trim())) errors.email = EMAIL_WRONG;
  if (d.note.length > SALESPERSON_NOTE_MAX) errors.note = tooLong("หมายเหตุ", SALESPERSON_NOTE_MAX);
  return errors;
}

// ── Does it look like one already on the list ────────────────────────────────
// Warnings only: two contacts may share a switchboard number, and two
// companies a name. They are for the slip of adding somebody twice.

/** A name as compared: case, spaces and punctuation do not make it another. */
function nameKey(name: string | null | undefined): string {
  return (name || "").toLowerCase().replace(/[\s.,()'"\-–—]+/g, "");
}

/** The dialable numbers of a phone field, as compared ("tel:+66…"). */
function phoneKeys(phone: string | null | undefined): string[] {
  return phoneParts(phone || "").flatMap((part) => (part.href ? [part.href] : []));
}

interface Named {
  id: string;
  name: string;
}

/** Others with the same name (not `selfId`, the one being edited). */
export function sameNameAs<T extends Named>(list: readonly T[], name: string, selfId?: string): T[] {
  const wanted = nameKey(name);
  if (!wanted) return [];
  return list.filter((item) => item.id !== selfId && nameKey(item.name) === wanted);
}

/**
 * Customers this draft may be a second copy of: the same name IN THE SAME
 * COMPANY (a คุณสมชาย at another company is another person), and anyone with
 * one of the same phone numbers.
 */
export function duplicateCustomers<T extends Named & { companyId?: string | null; phone?: string | null }>(
  list: readonly T[],
  draft: Pick<CustomerDraft, "name" | "companyId" | "phone">,
  selfId?: string
): { sameName: T[]; samePhone: T[] } {
  const others = list.filter((c) => c.id !== selfId);
  const name = nameKey(draft.name);
  const phones = new Set(phoneKeys(draft.phone));
  return {
    sameName: name && draft.companyId ? others.filter((c) => c.companyId === draft.companyId && nameKey(c.name) === name) : [],
    samePhone: phones.size ? others.filter((c) => phoneKeys(c.phone).some((p) => phones.has(p))) : [],
  };
}

/** Up to three names, then "และอีก n ราย". */
export function namesOf(list: readonly { name: string }[], max = 3): string {
  const shown = list.slice(0, max).map((item) => item.name).join(", ");
  return list.length > max ? `${shown} และอีก ${(list.length - max).toLocaleString("th-TH")} ราย` : shown;
}

// ── The province list ────────────────────────────────────────────────────────

/**
 * The province dropdown's options: "none", the 77 provinces — and, first,
 * whatever is stored when it is none of them (a typo, a place abroad), so
 * opening the form never silently drops it.
 */
export function provinceOptions(current: string): { value: string; label: string }[] {
  const known = THAI_PROVINCES.includes(current);
  return [
    { value: "", label: "— ไม่ระบุ —" },
    ...(current && !known ? [{ value: current, label: `${current} (ที่พิมพ์ไว้เดิม)` }] : []),
    ...THAI_PROVINCES.map((p) => ({ value: p, label: p })),
  ];
}
