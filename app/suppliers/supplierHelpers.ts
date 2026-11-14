import type { Supplier } from "../lib/types";
import { thCompare } from "../lib/thCompare";
import { productName } from "../product-specs/specHelpers";
import type { SortState } from "../customers/listHelpers";

/**
 * The column limits supplierStore.ts clips to. The form stops typing at the
 * same length, rather than the save cutting a long address short unseen.
 */
export const SUPPLIER_LIMITS = {
  companyName: 255,
  contactName: 255,
  phone: 255,
  taxId: 255,
  address: 2000,
  note: 5000,
} as const;

export type SupplierField = keyof typeof SUPPLIER_LIMITS;

/** What the add / edit form holds: every field a string, never undefined. */
export type SupplierDraft = Record<SupplierField, string>;

export function toSupplierDraft(s?: Partial<Supplier> | null): SupplierDraft {
  return {
    companyName: s?.companyName ?? "",
    contactName: s?.contactName ?? "",
    phone: s?.phone ?? "",
    taxId: s?.taxId ?? "",
    address: s?.address ?? "",
    note: s?.note ?? "",
  };
}

/** Whether the form holds typing that closing it would throw away. */
export function isSupplierDirty(original: SupplierDraft, draft: SupplierDraft): boolean {
  return (Object.keys(SUPPLIER_LIMITS) as SupplierField[]).some((k) => original[k] !== draft[k]);
}

/** What stops a save, by field — shown under that field. */
export function supplierErrors(draft: SupplierDraft): Partial<Record<SupplierField, string>> {
  const errors: Partial<Record<SupplierField, string>> = {};
  if (!draft.companyName.trim()) errors.companyName = "กรุณากรอกชื่อบริษัท";
  return errors;
}

/**
 * A company name compared loosely: letter case, runs of spaces and the
 * punctuation of "Co., Ltd." against "Co Ltd" do not make two names different.
 */
export function normalizeCompanyName(name: string): string {
  return (name || "").toLowerCase().replace(/[\s.,()'"\-–—]+/g, " ").trim();
}

/** Only the digits — "0-1055-56123-45-6" and "0105556123456" are one number. */
export function digitsOf(text: string | null | undefined): string {
  return (text || "").replace(/\D/g, "");
}

/**
 * The OTHER suppliers that already have this name, or this tax ID. Shown as a
 * warning while typing, never a refusal: a head office and its branches are
 * separate suppliers with ONE tax ID.
 */
export function findDuplicateSuppliers(
  list: readonly Supplier[],
  draft: SupplierDraft,
  selfId?: string
): { sameName: Supplier[]; sameTaxId: Supplier[] } {
  const name = normalizeCompanyName(draft.companyName);
  const tax = digitsOf(draft.taxId);
  const others = list.filter((s) => s.id !== selfId);
  return {
    sameName: name ? others.filter((s) => normalizeCompanyName(s.companyName) === name) : [],
    sameTaxId: tax ? others.filter((s) => digitsOf(s.taxId) === tax) : [],
  };
}

/** What a linked product with no title at all is called, so it still counts. */
export const UNNAMED_PRODUCT = "(สินค้าไม่มีชื่อ)";

/**
 * The linked products with their names as plain text — the way a quotation
 * shows them. Every link is listed: one skipped for having no title made the
 * delete warning count fewer products than the list's own column.
 */
export function linkedProductList(s: Pick<Supplier, "linkedProducts">): Array<{ id: string; name: string }> {
  return (s.linkedProducts || []).map((p) => ({ id: p.id, name: productName(p) || UNNAMED_PRODUCT }));
}

export function linkedProductNames(s: Pick<Supplier, "linkedProducts">): string[] {
  return linkedProductList(s).map((p) => p.name);
}

/** How many linked products the delete warning names before "…และอีก n รายการ". */
export const DELETE_LIST_MAX = 5;

/**
 * The delete confirmation: what goes with the supplier. Products lose the link
 * (product_suppliers cascades), while a purchase order keeps its own copy of
 * the supplier and an asset / stock item the name it was saved with.
 */
export function deleteConfirmMessage(s: Supplier): string {
  const lines = [`ลบ "${s.companyName}"? ลบแล้วกู้คืนไม่ได้`];
  const names = linkedProductNames(s);
  if (names.length > 0) {
    lines.push("", `ซัพพลายเออร์นี้ผูกกับสินค้า ${names.length} รายการ หลังลบ สินค้าเหล่านี้จะไม่มีซัพพลายเออร์รายนี้อีก:`);
    for (const name of names.slice(0, DELETE_LIST_MAX)) lines.push(`• ${name}`);
    if (names.length > DELETE_LIST_MAX) lines.push(`…และอีก ${names.length - DELETE_LIST_MAX} รายการ`);
  }
  lines.push("", "ใบสั่งซื้อที่ออกไปแล้ว และทรัพย์สิน/สต็อกที่อ้างถึง ยังแสดงชื่อเดิม");
  return lines.join("\n");
}

// ── The list ──────────────────────────────────────────────────────────────

const lowerSpaced = (text: string | null | undefined) => (text || "").toLowerCase().replace(/\s+/g, " ");

/**
 * Whether a supplier matches the search box: its name, contact, phone, tax ID
 * or the name of a product linked to it ("ZTA" finds who sells the ZTA). Only
 * the name used to be searched, so a contact's name found nothing. Digits
 * typed as a phone or tax ID match however either was written:
 * "081 234" finds "081-234-5678".
 */
export function matchesSupplierSearch(s: Supplier, query: string): boolean {
  const q = lowerSpaced(query).trim();
  if (!q) return true;
  const texts = [s.companyName, s.contactName, s.phone, s.taxId, ...linkedProductNames(s)];
  if (texts.some((t) => lowerSpaced(t).includes(q))) return true;
  const digits = digitsOf(q);
  const onlyNumber = digits.length >= 3 && digits.length === q.replace(/[\s\-+().]/g, "").length;
  return onlyNumber && [s.phone, s.taxId].some((t) => digitsOf(t).includes(digits));
}

export type SupplierSortKey = "name" | "contact" | "products";

/**
 * The list in the order a clicked header asks for; `null` keeps the API's
 * order (newest first). A supplier without a contact sits last either way,
 * and products tie-break on the name.
 */
export function sortSuppliers<T extends Supplier>(list: readonly T[], sort: SortState<SupplierSortKey> | null): T[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => thCompare(a.companyName, b.companyName);
  return [...list].sort((a, b) => {
    if (sort.key === "products") {
      return sign * ((a.linkedProducts?.length ?? 0) - (b.linkedProducts?.length ?? 0)) || byName(a, b);
    }
    if (sort.key === "contact") {
      const ca = (a.contactName || "").trim();
      const cb = (b.contactName || "").trim();
      if (!ca || !cb) return ca ? -1 : cb ? 1 : byName(a, b);
      return sign * thCompare(ca, cb) || byName(a, b);
    }
    return sign * byName(a, b);
  });
}

/** Thai script in the name: a Thai company, which has a Thai tax ID. */
const THAI_SCRIPT = /[฀-๿]/;

/**
 * What a purchase order prints that this supplier lacks. A supplier made
 * before the PO feature has neither. The tax ID is only asked of a supplier
 * with a Thai name — one abroad (YASUDA, COMETECH) has no Thai tax ID, and
 * flagging every one of them would teach the admin to ignore the flag.
 */
export function missingPoFields(s: Pick<Supplier, "companyName" | "address" | "taxId">): Array<"address" | "taxId"> {
  const missing: Array<"address" | "taxId"> = [];
  if (!(s.address || "").trim()) missing.push("address");
  if (!digitsOf(s.taxId) && THAI_SCRIPT.test(s.companyName || "")) missing.push("taxId");
  return missing;
}

/** The wording the other admin pages use for a lapsed session. */
export const SESSION_EXPIRED_MESSAGE = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง";

/**
 * The API's own (Thai) error message, or `fallback` when it sent none. A 401
 * is the session, said in Thai — requireAuth's own text is "Unauthorized".
 */
export async function errorMessageOf(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return SESSION_EXPIRED_MESSAGE;
  try {
    const body = await res.json();
    return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}
