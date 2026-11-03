// Grouping, searching, naming and checking for /product-specs. Pure — the page
// renders them, the tests pin them.
import { stripHtml } from "../lib/stripHtml";
import { thCompare } from "../lib/thCompare";

export interface ProductSpec {
  id: string;
  productId: string;
  name: string;
  detail: string;
  createdAt: string;
}

export interface SpecProduct {
  id: string;
  title_th: string;
  title_en: string;
}

/** The API's own limits (it cuts anything longer without a word). */
export const SPEC_NAME_MAX = 255;
export const SPEC_DETAIL_MAX = 5000;

/** A product's name as the quotation shows it: plain text, 🐧 removed. */
export function productName(p: SpecProduct | undefined): string {
  if (!p) return "";
  return stripHtml(p.title_th || p.title_en || "").replace(/🐧/g, "").trim();
}

export interface SpecGroup {
  productId: string;
  /** "" when the product is not in the list (it failed to load, or is gone). */
  productName: string;
  specs: ProductSpec[];
}

export interface SpecFilter {
  query: string;
  productId: string;
}

/**
 * The specs that match the search box and the product picker, grouped by
 * product: products A→Z (a product not in the list last), and within one
 * product its specs by name with numbers as numbers — 5kN, 10kN, 50kN — ties
 * oldest first. The search box reads the product name, the spec's heading and
 * its detail.
 */
export function groupSpecs(
  specs: readonly ProductSpec[],
  products: readonly SpecProduct[],
  { query, productId }: SpecFilter
): SpecGroup[] {
  const names = new Map(products.map((p) => [p.id, productName(p)]));
  const q = query.trim().toLowerCase();
  const groups = new Map<string, SpecGroup>();
  for (const spec of specs) {
    if (productId && spec.productId !== productId) continue;
    const name = names.get(spec.productId) ?? "";
    if (
      q &&
      !name.toLowerCase().includes(q) &&
      !(spec.name || "").toLowerCase().includes(q) &&
      !(spec.detail || "").toLowerCase().includes(q)
    ) {
      continue;
    }
    let group = groups.get(spec.productId);
    if (!group) {
      group = { productId: spec.productId, productName: name, specs: [] };
      groups.set(spec.productId, group);
    }
    group.specs.push(spec);
  }
  for (const group of groups.values()) {
    group.specs.sort((a, b) => thCompare(a.name, b.name) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.productName !== !b.productName) return a.productName ? -1 : 1;
    return thCompare(a.productName, b.productName) || (a.productId < b.productId ? -1 : 1);
  });
}

/** Products with no spec at all, A→Z — narrowed by the search box (on the
 *  product name) like the list. Without a spec, a quotation line for that
 *  product has nothing to fill in from. */
export function productsWithoutSpecs(
  products: readonly SpecProduct[],
  specs: readonly ProductSpec[],
  query: string
): SpecProduct[] {
  const withSpecs = new Set(specs.map((s) => s.productId));
  const q = query.trim().toLowerCase();
  return products
    .filter((p) => !withSpecs.has(p.id) && (!q || productName(p).toLowerCase().includes(q)))
    .sort((a, b) => thCompare(productName(a), productName(b)));
}

const COPY_SUFFIX = / \(สำเนา(?: \d+)?\)$/;

/**
 * The heading for a copy of `name`: "สเปค 5kN (สำเนา)", then "(สำเนา 2)", … —
 * never one already `taken` (the product's other headings). A copy of a copy
 * counts on from the original rather than stacking "(สำเนา) (สำเนา)". Kept
 * within the API's length limit by shortening the original part.
 */
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.trim().replace(COPY_SUFFIX, "");
  const used = new Set(taken.map((t) => t.trim()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (สำเนา)" : ` (สำเนา ${n})`;
    const candidate = base.slice(0, SPEC_NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

export interface SpecDraft {
  productId?: string;
  name?: string;
  detail?: string;
}

/** What is wrong with a draft, field by field — the same rules as the API,
 *  checked before sending so the message can say WHICH field. */
export function specErrors(draft: SpecDraft): Partial<Record<"productId" | "name" | "detail", string>> {
  const errors: Partial<Record<"productId" | "name" | "detail", string>> = {};
  if (!(draft.productId || "").trim()) errors.productId = "กรุณาเลือกสินค้า";
  const name = (draft.name || "").trim();
  if (!name) errors.name = "กรุณากรอกหัวข้อสเปค";
  else if (name.length > SPEC_NAME_MAX) errors.name = `หัวข้อสเปคยาวเกิน ${SPEC_NAME_MAX} ตัวอักษร`;
  const detail = draft.detail || "";
  if (!detail.trim()) errors.detail = "กรุณากรอกรายละเอียด";
  else if (detail.length > SPEC_DETAIL_MAX) errors.detail = `รายละเอียดยาวเกิน ${SPEC_DETAIL_MAX.toLocaleString("th-TH")} ตัวอักษร`;
  return errors;
}

/** Whether the form holds anything the admin would lose by closing it. */
export function isSpecDirty(original: SpecDraft, draft: SpecDraft): boolean {
  return (["productId", "name", "detail"] as const).some((k) => (original[k] || "") !== (draft[k] || ""));
}

/**
 * Whether a detail is longer than `lines` lines in the list, so it is shown
 * cut with a "ดูเพิ่ม". Estimated from its line breaks and an average line
 * width — measuring the DOM would mean a layout pass per row. A detail judged
 * short is never cut, so a wrong guess shows a line too many, never hides one.
 */
export function detailNeedsClamp(detail: string, lines = 3, charsPerLine = 80): boolean {
  let count = 0;
  for (const line of (detail || "").split("\n")) {
    count += Math.max(1, Math.ceil(line.length / charsPerLine));
    if (count > lines) return true;
  }
  return false;
}
