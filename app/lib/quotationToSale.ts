/**
 * Quotation → sale: every piece of the conversion that can be decided without
 * React, the DOM or a fetch (task 15.1).
 *
 * This module is imported by CLIENT components (`app/dashboard/page.tsx`,
 * `app/quotation/page.tsx`), so it must stay free of `server-only`, `db`, and
 * anything else that would drag the server bundle into the browser. Everything
 * here is data in → new data out: no argument is ever mutated, so React state
 * updates built on top of it stay safely immutable.
 *
 * The rules encoded here are all "warn, don't block" (D12/D13) except the three
 * pre-existing hard requirements collected in `validateLineDrafts`.
 */

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Label pinned next to any field the system filled in from a quotation. The
 * form clears it as soon as the admin edits that field (task 11.7). */
export const AUTOFILL_MARKER = "เติมจากใบเสนอราคา — กรุณาตรวจสอบ";

/** UI-only value the product dropdown uses for "this is not in the catalog".
 * `crmStore.cleanEquipment` / `productGroupKey` collapse it to "" server-side;
 * `buildSalePayload` does the same before the request is ever sent. */
export const CUSTOM_PRODUCT_SENTINEL = "_custom";

/** `POST /api/admin/sales` refuses a bill with more machines than this
 * (mirrors `MAX_EQUIPMENT_ROWS` in the route and in `crmStore`). Checked here
 * so the admin sees a Thai message in the form instead of a 400 from the API. */
export const MAX_EQUIPMENT_ROWS_PER_SALE = 50;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Every list this module takes is optional (a fetch may not have landed yet).
 * `Array.isArray` widens a `readonly T[]` to `any[]`, which would quietly
 * un-type every callback downstream, so optional lists go through here instead.
 */
function asArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Quantities are whole machines: at least 1, never fractional. */
function toQty(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.round(n));
}

function toMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
}

function toCategoryId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// 1. Name matching — customer / company auto-fill (tasks 11.2-11.5)
// ---------------------------------------------------------------------------

/** The shape both `customers` and `companies` already have in the sale form. */
export interface NamedRecord {
  id: string;
  name?: string | null;
}

export type NameMatchStatus = "matched" | "none" | "ambiguous";

export interface NameMatchResult<T extends NamedRecord> {
  /** `matched` only ever means EXACTLY one hit. */
  status: NameMatchStatus;
  /** The single hit, or null for `none`/`ambiguous`. Never the first of many. */
  match: T | null;
  /** Every hit — the form lists these so the admin can disambiguate by hand. */
  matches: T[];
  count: number;
  /** The name that was searched for, trimmed, for the Thai message. */
  query: string;
}

/**
 * Normalized identity for a person/company name: trim + case-fold, nothing
 * else. Deliberately dumb — Thai company names are written many ways
 * ("บจก. เอ", "บริษัท เอ จำกัด") and any cleverness here would silently bind a
 * sale to the wrong legal entity. A near miss must come back as `none` so the
 * admin picks (or creates) the right row themselves.
 */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Three-way match of a free-text quotation name against the list already
 * loaded in the form (tasks 11.2-11.5). 0 hits and 2+ hits are BOTH "leave the
 * field blank and say why" — neither `customers.name` nor `companies.name` is
 * unique, so picking the first of several would be a guess.
 */
export function matchByName<T extends NamedRecord>(
  name: unknown,
  list: readonly T[] | null | undefined
): NameMatchResult<T> {
  const query = String(name ?? "").trim();
  const key = normalizeName(query);
  const rows = asArray(list);
  if (!key || rows.length === 0) {
    return { status: "none", match: null, matches: [], count: 0, query };
  }
  const matches = rows.filter((row) => normalizeName(row?.name) === key);
  if (matches.length === 1) {
    return { status: "matched", match: matches[0], matches, count: 1, query };
  }
  return {
    status: matches.length === 0 ? "none" : "ambiguous",
    match: null,
    matches,
    count: matches.length,
    query,
  };
}

/** Where a resolved customer/company came from. */
export type AutoFillSource = "id" | "name" | "none";

export interface AutoFillResult<T extends NamedRecord> extends NameMatchResult<T> {
  source: AutoFillSource;
  /** Value for the dropdown — "" whenever the field must be left blank. */
  selectedId: string;
  /** True when the system filled the field → show `AUTOFILL_MARKER`. */
  autoFilled: boolean;
}

export interface ResolveAutoFillInput<T extends NamedRecord> {
  /** `data.customerId` / `data.companyId` from the quotation, when it has one. */
  id?: string | null;
  /** `data.customerContact` / `data.customerCompany` — always free text. */
  name?: unknown;
  list: readonly T[] | null | undefined;
}

/**
 * The auto-fill decision for one field (task 11.1 first, 11.2-11.5 after):
 * a stored id that still exists wins outright; otherwise fall back to name
 * matching. A stored id pointing at a deleted row is treated as absent rather
 * than as a match, so the form never selects an id it cannot show a name for.
 */
export function resolveAutoFill<T extends NamedRecord>(
  input: ResolveAutoFillInput<T>
): AutoFillResult<T> {
  const list = asArray(input.list);
  const id = String(input.id ?? "").trim();
  if (id) {
    const hit = list.find((row) => String(row?.id ?? "") === id);
    if (hit) {
      return {
        status: "matched",
        match: hit,
        matches: [hit],
        count: 1,
        query: String(input.name ?? "").trim(),
        source: "id",
        selectedId: id,
        autoFilled: true,
      };
    }
  }
  const byName = matchByName(input.name, list);
  return {
    ...byName,
    source: byName.status === "matched" ? "name" : "none",
    selectedId: byName.match ? String(byName.match.id) : "",
    autoFilled: byName.status === "matched",
  };
}

/**
 * Thai explanation for a field the system refused to fill. `label` is the noun
 * used in the sentence ("ลูกค้า" / "บริษัท"). Returns null when the field was
 * filled — there is nothing to explain.
 */
export function describeNameMatch<T extends NamedRecord>(
  result: NameMatchResult<T>,
  label: string
): string | null {
  if (result.status === "matched") return null;
  if (result.status === "ambiguous") {
    return `พบ${label}ชื่อนี้ ${result.count} รายการ กรุณาเลือกเอง`;
  }
  if (!result.query) return null;
  return `ไม่พบ${label}ชื่อ «${result.query}» ในระบบ`;
}

// ---------------------------------------------------------------------------
// 2. Line drafts — quotation items + /sold → editable rows (tasks 12.1-12.6, 13.2)
// ---------------------------------------------------------------------------

/** One line of a quotation, as `GET /api/quotations/[id]` returns it inside
 * `data.items` (`QuoteItem` in `app/quotation/page.tsx`). */
export interface QuotationLine {
  id?: string;
  productId?: string;
  name?: string;
  description?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
}

/** One entry of `GET /api/quotations/[id]/sold` → `items[]`. */
export interface SoldQuotationLine {
  quotationItemId: string;
  soldQty: number;
  salesRecordIds?: string[];
}

/** The catalog rows the form already loaded from `GET /api/products`. Only the
 * two fields the conversion needs are required. */
export interface CatalogProduct {
  id: string;
  categoryId?: number | null;
}

/** One physical machine under a line (task 12.7 — warranty is PER MACHINE). */
export interface MachineDraft {
  serialNumber: string;
  warrantyStartDate: string;
  warrantyEndDate: string;
}

/** One editable product line in the sale form. */
export interface SaleLineDraft {
  /** Stable React key — the quotation line's id, or a positional fallback for
   * an old quotation whose lines were saved without one. */
  key: string;
  /** Source line id, "" when the quotation line has none. Becomes
   * `quotationItemId` (or null) on the payload. */
  quotationItemId: string;
  /** Pre-ticked only when nothing of this line has been sold yet (task 13.2). */
  selected: boolean;
  /** Product name copied from the quotation; editable, always sent. */
  productName: string;
  /** Catalog link. "" = not linked, `_custom` = explicitly "not in catalog". */
  productId: string;
  /** Comes from the linked catalog product ONLY — never guessed (task 12.5). */
  categoryId: number | null;
  /** True when the quotation named a product that no longer exists in the
   * catalog: the link is dropped, the NAME is kept, and the form warns. */
  productMissing: boolean;
  /** Qty as quoted — reference for the "ขายเกินที่เสนอ" warning. */
  quotedQty: number;
  /** How many of this line were already recorded as sold (advisory). */
  soldQty: number;
  /** The editable "จำนวนที่ขายจริง". Defaults to `quotedQty`. */
  qty: number;
  unit: string;
  /** Copied VERBATIM from the quotation — pre-discount, pre-VAT (task 12.3). */
  unitPrice: number;
  /** Product cost of the WHOLE line. Defaults to 0, edited by hand (12.6). */
  costAmount: number;
  /** Exactly `qty` rows, kept in step by `resizeMachines`. */
  machines: MachineDraft[];
}

export interface BuildLineDraftsInput {
  items: readonly QuotationLine[] | null | undefined;
  /** `items` from `GET /api/quotations/[id]/sold`. Omit → nothing sold yet. */
  sold?: readonly SoldQuotationLine[] | null;
  /** The catalog. Omit and no line gets a `categoryId` — a category is never
   * guessed from a name, and a link is never validated against a list we
   * were not given. */
  products?: readonly CatalogProduct[] | null;
}

export function blankMachine(): MachineDraft {
  return { serialNumber: "", warrantyStartDate: "", warrantyEndDate: "" };
}

/** Map `quotationItemId → soldQty`, tolerating a malformed/empty `/sold` body
 * (the endpoint is advisory and must never break the form). */
function soldQtyByItem(
  sold: readonly SoldQuotationLine[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(sold)) return map;
  for (const row of sold) {
    const id = String(row?.quotationItemId ?? "").trim();
    if (!id) continue;
    const qty = toFiniteNumber(row?.soldQty, 0);
    map.set(id, (map.get(id) || 0) + Math.max(0, qty));
  }
  return map;
}

/**
 * Resolve the catalog link of one quotation line. Three distinct outcomes:
 *   • no catalog given  → trust the quotation's id, but claim no category
 *   • id found          → link it and take ITS category
 *   • id not found      → drop the link, keep the name, flag `productMissing`
 */
function resolveCatalogLink(
  rawProductId: unknown,
  products: readonly CatalogProduct[] | null | undefined
): { productId: string; categoryId: number | null; productMissing: boolean } {
  const productId = String(rawProductId ?? "").trim();
  if (!productId || productId === CUSTOM_PRODUCT_SENTINEL) {
    return { productId: "", categoryId: null, productMissing: false };
  }
  if (!Array.isArray(products)) {
    return { productId, categoryId: null, productMissing: false };
  }
  const hit = products.find((p) => String(p?.id ?? "") === productId);
  if (!hit) return { productId: "", categoryId: null, productMissing: true };
  return {
    productId,
    categoryId: toCategoryId(hit.categoryId),
    productMissing: false,
  };
}

/**
 * Quotation items (+ what has already been sold) → the editable rows the form
 * renders. Pre-ticks ONLY lines with nothing sold yet (task 13.2); the admin
 * can tick a sold line afterwards and confirm past the warning.
 */
export function buildLineDrafts(input: BuildLineDraftsInput): SaleLineDraft[] {
  const items = asArray(input.items);
  const sold = soldQtyByItem(input.sold);
  return items.map((raw, index) => {
    const line = raw || {};
    const quotationItemId = String(line.id ?? "").trim();
    const quotedQty = toQty(line.qty, 1);
    const soldQty = quotationItemId ? sold.get(quotationItemId) || 0 : 0;
    const link = resolveCatalogLink(line.productId, input.products);
    return {
      key: quotationItemId || `line-${index}`,
      quotationItemId,
      selected: soldQty === 0,
      productName: String(line.name ?? "").trim(),
      productId: link.productId,
      categoryId: link.categoryId,
      productMissing: link.productMissing,
      quotedQty,
      soldQty,
      qty: quotedQty,
      unit: String(line.unit ?? "").trim(),
      unitPrice: toMoney(line.unitPrice),
      costAmount: 0,
      machines: Array.from({ length: quotedQty }, blankMachine),
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Machine rows follow the quantity (tasks 12.7, 12.8)
// ---------------------------------------------------------------------------

/**
 * Grow/shrink to exactly `target` rows: append blanks, or drop the TRAILING
 * ones. Rows already typed keep their position and their contents either way —
 * regenerating the list would wipe serials the admin has just entered (spec:
 * "แก้จำนวนขึ้นหลังกรอก serial ไปแล้ว").
 */
function padMachines(
  current: readonly MachineDraft[],
  target: number
): MachineDraft[] {
  if (target <= current.length) return current.slice(0, target);
  return [
    ...current,
    ...Array.from({ length: target - current.length }, blankMachine),
  ];
}

/**
 * Keep a line's machine rows in step with its sold quantity.
 *
 * The row count is clamped at the per-bill cap so a fat-fingered qty cannot
 * render thousands of serial inputs. That clamp is a UI guard only — a bill
 * genuinely over the cap is caught (in Thai) by `validateLineDrafts`, and
 * `buildSalePayload` still emits one machine per unit so the payload's
 * `equipments.length === sum(qty)` invariant always holds.
 */
export function resizeMachines(
  machines: readonly MachineDraft[] | null | undefined,
  qty: unknown
): MachineDraft[] {
  const current = asArray(machines);
  const n = Number(qty);
  if (!Number.isFinite(n)) return current.slice();
  return padMachines(
    current,
    Math.max(0, Math.min(MAX_EQUIPMENT_ROWS_PER_SALE, Math.round(n)))
  );
}

/** Set a line's quantity and resize its machines in one step. */
export function setLineQty(line: SaleLineDraft, qty: unknown): SaleLineDraft {
  const n = Number(qty);
  const next = Number.isFinite(n) ? Math.max(0, Math.round(n)) : line.qty;
  return { ...line, qty: next, machines: resizeMachines(line.machines, next) };
}

/**
 * Task 12.8 — copy the FIRST machine's warranty dates onto every other machine
 * of the line. Serials are per-machine and are never touched.
 */
export function copyWarrantyToAllMachines(
  machines: readonly MachineDraft[] | null | undefined
): MachineDraft[] {
  const current = asArray(machines);
  if (current.length === 0) return [];
  const first = current[0];
  return current.map((m) => ({
    ...m,
    warrantyStartDate: first.warrantyStartDate,
    warrantyEndDate: first.warrantyEndDate,
  }));
}

/**
 * Task 12.4/12.5 — the admin picks a catalog product for a line. The category
 * follows the product and ONLY the product: choosing `_custom` (or clearing
 * the selection) leaves `categoryId` null rather than keeping a stale one.
 */
export function applyProductSelection(
  line: SaleLineDraft,
  productId: unknown,
  products: readonly CatalogProduct[] | null | undefined
): SaleLineDraft {
  const id = String(productId ?? "").trim();
  if (!id || id === CUSTOM_PRODUCT_SENTINEL) {
    return {
      ...line,
      productId: id === CUSTOM_PRODUCT_SENTINEL ? CUSTOM_PRODUCT_SENTINEL : "",
      categoryId: null,
      productMissing: false,
    };
  }
  const hit = Array.isArray(products)
    ? products.find((p) => String(p?.id ?? "") === id)
    : undefined;
  return {
    ...line,
    productId: id,
    categoryId: hit ? toCategoryId(hit.categoryId) : null,
    productMissing: false,
  };
}

// ---------------------------------------------------------------------------
// 4. Payload — drafts → what POST /api/admin/sales accepts (task 15.3)
// ---------------------------------------------------------------------------

/** One entry of the route's `items[]` (a `Partial<SaleLineItem>`). */
export interface SalePayloadItem {
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  costAmount: number;
  quotationItemId: string | null;
  sortOrder: number;
}

/** One entry of the route's `equipments[]` (an `EquipmentRowInput`). */
export interface SalePayloadEquipment {
  serialNumber: string;
  productId: string;
  productName: string;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  quotationNumber?: string;
}

export interface SalePayloadParts {
  items: SalePayloadItem[];
  equipments: SalePayloadEquipment[];
  /** Sale-level rollups, from the SAME reduction the form summary shows, so
   * the number on screen and the number in the request can never disagree. */
  totalAmount: number;
  qty: number;
  costAmount: number;
}

export interface BuildSalePayloadOptions {
  /** docNo of the source quotation — stamped on every machine row (task 4.5).
   * A hand-typed reference works exactly the same way. */
  quotationRef?: string;
}

/** `_custom` is a UI-only sentinel; the API and the DB only know "" (12.4). */
export function resolveProductIdForApi(productId: unknown): string {
  const id = String(productId ?? "").trim();
  return id === CUSTOM_PRODUCT_SENTINEL ? "" : id;
}

/** Empty date inputs must land as NULL, not as "" (the columns are DATE). */
function toDateOrNull(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

/** The lines the admin actually ticked, in display order. */
export function selectedLines(
  lines: readonly SaleLineDraft[] | null | undefined
): SaleLineDraft[] {
  return asArray(lines).filter((l) => l && l.selected);
}

/**
 * Selected drafts → the exact `items[]` + `equipments[]` the sale route
 * accepts, plus the sale-level rollups.
 *
 * The equipment list is flattened from each line's machines, so its length is
 * the sum of the selected quantities by construction: the machine rows are the
 * only source of serials and warranty dates, and every machine carries its own
 * line's product identity (a mixed-model bill must not stamp one model's name
 * on another's machine).
 */
export function buildSalePayload(
  lines: readonly SaleLineDraft[] | null | undefined,
  options: BuildSalePayloadOptions = {}
): SalePayloadParts {
  const chosen = selectedLines(lines);
  const quotationNumber = String(options.quotationRef ?? "").trim();

  const items: SalePayloadItem[] = [];
  const equipments: SalePayloadEquipment[] = [];
  let totalAmount = 0;
  let qty = 0;
  let costAmount = 0;

  chosen.forEach((line, index) => {
    const lineQty = toQty(line.qty, 1);
    const unitPrice = toMoney(line.unitPrice);
    const lineTotal = round2(lineQty * unitPrice);
    const lineCost = toMoney(line.costAmount);
    const productId = resolveProductIdForApi(line.productId);
    const productName = String(line.productName ?? "").trim();

    items.push({
      productId,
      productName,
      categoryId: productId ? toCategoryId(line.categoryId) : null,
      qty: lineQty,
      unitPrice,
      totalAmount: lineTotal,
      costAmount: lineCost,
      quotationItemId: String(line.quotationItemId ?? "").trim() || null,
      sortOrder: index,
    });

    totalAmount = round2(totalAmount + lineTotal);
    qty += lineQty;
    costAmount = round2(costAmount + lineCost);

    // Always exactly `lineQty` machines, even if the draft's machine array
    // drifted out of step (defensive: the row count is the contract). Not
    // `resizeMachines` — its UI clamp would silently drop machines off an
    // over-cap bill instead of letting `validateLineDrafts` refuse it.
    const machines = padMachines(asArray(line.machines), lineQty);
    for (const m of machines) {
      equipments.push({
        serialNumber: String(m?.serialNumber ?? "").trim(),
        productId,
        productName,
        warrantyStartDate: toDateOrNull(m?.warrantyStartDate),
        warrantyEndDate: toDateOrNull(m?.warrantyEndDate),
        ...(quotationNumber ? { quotationNumber } : {}),
      });
    }
  });

  return { items, equipments, totalAmount, qty, costAmount };
}

// ---------------------------------------------------------------------------
// 5. Serials (tasks 13.5, 12.11)
// ---------------------------------------------------------------------------

/**
 * Serial identity. Character-for-character the rule
 * `app/lib/crmStore.ts:normalizeSerial` uses (`trim().toLowerCase()`) and that
 * `findEquipmentsBySerial` mirrors in SQL as `LOWER(TRIM(serialNumber))`. If
 * this ever diverges, the form and the server disagree about what "duplicate"
 * means and the warning fires on the wrong rows.
 */
export function normalizeSerial(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Where one serial sits in the form — enough to point the admin at it. */
export interface SerialLocation {
  lineIndex: number;
  machineIndex: number;
  quotationItemId: string;
  productName: string;
  /** The serial as typed (untrimmed values are reported trimmed). */
  serialNumber: string;
}

export interface DuplicateSerialGroup {
  /** The normalized key the rows collided on. */
  normalized: string;
  /** The first spelling that was typed — what the warning shows. */
  serialNumber: string;
  occurrences: SerialLocation[];
}

/** Every non-empty serial in the ticked lines, in form order (for
 * `GET /api/admin/equipments/serial-check?serials=`). */
export function collectSerials(
  lines: readonly SaleLineDraft[] | null | undefined
): string[] {
  const out: string[] = [];
  for (const line of selectedLines(lines)) {
    for (const m of asArray(line.machines)) {
      const serial = String(m?.serialNumber ?? "").trim();
      if (serial) out.push(serial);
    }
  }
  return out;
}

/**
 * Task 13.5 — serials that collide WITHIN this one form, across every line and
 * machine. Returned as DATA for a confirmable warning: two machines may legally
 * share a typed serial once the admin confirms, so this never throws and the
 * caller must never treat a non-empty result as a save-blocker.
 */
export function findDuplicateSerialsInForm(
  lines: readonly SaleLineDraft[] | null | undefined
): DuplicateSerialGroup[] {
  const groups = new Map<string, DuplicateSerialGroup>();
  asArray(lines).forEach((line, lineIndex) => {
    if (!line || !line.selected) return;
    asArray(line.machines).forEach((m, machineIndex) => {
      const serialNumber = String(m?.serialNumber ?? "").trim();
      const normalized = normalizeSerial(serialNumber);
      if (!normalized) return; // blank serials are a separate, blocking rule
      const where: SerialLocation = {
        lineIndex,
        machineIndex,
        quotationItemId: String(line.quotationItemId ?? ""),
        productName: String(line.productName ?? ""),
        serialNumber,
      };
      const group = groups.get(normalized);
      if (group) group.occurrences.push(where);
      else groups.set(normalized, { normalized, serialNumber, occurrences: [where] });
    });
  });
  return Array.from(groups.values()).filter((g) => g.occurrences.length > 1);
}

/** Task 12.11 — machines still missing a serial, so the form can point at the
 * exact line and machine. This one IS a blocker (the pre-existing rule). */
export function findMissingSerials(
  lines: readonly SaleLineDraft[] | null | undefined
): SerialLocation[] {
  const out: SerialLocation[] = [];
  asArray(lines).forEach((line, lineIndex) => {
    if (!line || !line.selected) return;
    asArray(line.machines).forEach((m, machineIndex) => {
      if (String(m?.serialNumber ?? "").trim()) return;
      out.push({
        lineIndex,
        machineIndex,
        quotationItemId: String(line.quotationItemId ?? ""),
        productName: String(line.productName ?? ""),
        serialNumber: "",
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 6. Bill summary + warnings (tasks 12.10, 12.2, 13.1, 13.3)
// ---------------------------------------------------------------------------

export interface BillSummary {
  lineCount: number;
  qty: number;
  totalAmount: number;
  costAmount: number;
  machineCount: number;
}

/**
 * Task 12.10 — the totals shown above the save button. Derived from the same
 * reduction as `buildSalePayload`, so what the admin reads is what gets posted.
 */
export function summarizeBill(
  lines: readonly SaleLineDraft[] | null | undefined
): BillSummary {
  const parts = buildSalePayload(lines);
  return {
    lineCount: parts.items.length,
    qty: parts.qty,
    totalAmount: parts.totalAmount,
    costAmount: parts.costAmount,
    machineCount: parts.equipments.length,
  };
}

export interface SoldSummary {
  /** X of "X/Y" — lines of this quotation with at least one recorded sale. */
  soldLines: number;
  /** Y — the quotation's own line count. */
  totalLines: number;
  /** Banner text, or null when nothing has been sold (nothing to warn about). */
  message: string | null;
}

/** Task 13.1 — the "ใบนี้บันทึกขายไปแล้ว X/Y รายการ" banner. */
export function summarizeSoldLines(
  lines: readonly SaleLineDraft[] | null | undefined
): SoldSummary {
  const all = asArray(lines);
  const soldLines = all.filter((l) => l && l.soldQty > 0).length;
  return {
    soldLines,
    totalLines: all.length,
    message:
      soldLines > 0
        ? `ใบนี้บันทึกขายไปแล้ว ${soldLines}/${all.length} รายการ`
        : null,
  };
}

/** Task 13.3 — ticked lines that were already sold. Confirm, then allow. */
export function findResoldLines(
  lines: readonly SaleLineDraft[] | null | undefined
): SaleLineDraft[] {
  return selectedLines(lines).filter((l) => l.soldQty > 0);
}

/** Task 12.2 — ticked lines selling MORE than the quotation offered. Warn, do
 * not block. */
export function findOverQuotedLines(
  lines: readonly SaleLineDraft[] | null | undefined
): SaleLineDraft[] {
  return selectedLines(lines).filter((l) => l.qty > l.quotedQty);
}

/**
 * The only hard blockers in this flow — all three pre-date it (at least one
 * line, a whole positive quantity, a serial on every machine) plus the API's
 * own per-bill machine cap, surfaced here in Thai instead of as a 400.
 * Everything else (already sold, over-quoted, duplicate serial) is a
 * confirmable warning and must NOT appear in this list.
 */
export function validateLineDrafts(
  lines: readonly SaleLineDraft[] | null | undefined
): string[] {
  const errors: string[] = [];
  const chosen = selectedLines(lines);
  if (chosen.length === 0) {
    errors.push("กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ");
    return errors;
  }
  chosen.forEach((line, index) => {
    const at = `รายการที่ ${index + 1}`;
    const label = line.productName ? `${at} (${line.productName})` : at;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1) {
      errors.push(`${label}: จำนวนที่ขายจริงต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
    }
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.push(`${label}: ราคาต่อหน่วยต้องเป็นตัวเลขที่ไม่ติดลบ`);
    }
    const cost = Number(line.costAmount);
    if (!Number.isFinite(cost) || cost < 0) {
      errors.push(`${label}: ต้นทุนสินค้าต้องเป็นตัวเลขที่ไม่ติดลบ`);
    }
  });
  for (const miss of findMissingSerials(lines)) {
    const at = `รายการที่ ${miss.lineIndex + 1}`;
    const label = miss.productName ? `${at} (${miss.productName})` : at;
    errors.push(`${label} เครื่องที่ ${miss.machineIndex + 1}: กรุณาระบุ Serial Number`);
  }
  const machineCount = summarizeBill(lines).machineCount;
  if (machineCount > MAX_EQUIPMENT_ROWS_PER_SALE) {
    errors.push(
      `บันทึกอุปกรณ์ได้สูงสุด ${MAX_EQUIPMENT_ROWS_PER_SALE} เครื่องต่อใบขาย 1 ใบ (ขณะนี้ ${machineCount} เครื่อง)`
    );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 7. Quotation builder: keep / clear the customer & company id (tasks 14.2-14.3)
// ---------------------------------------------------------------------------

/** A name shown on the document plus the system row it points at ("" = none). */
export interface PartyLink {
  name: string;
  id: string;
}

/**
 * Task 14.2 — picking from the "เลือกลูกค้า/บริษัทจากระบบ" dropdown stores the
 * id ALONGSIDE the name (today the builder copies the name and throws the id
 * away), so the sale form can map straight back to the real row instead of
 * guessing by name.
 */
export function selectPartyFromSystem(
  option: NamedRecord | null | undefined
): PartyLink {
  if (!option) return { name: "", id: "" };
  return { name: String(option.name ?? ""), id: String(option.id ?? "") };
}

/**
 * Task 14.3 — the name was typed over by hand. The stored id is CLEARED unless
 * the text still names the same thing, so a saved quotation can never carry an
 * id that disagrees with the name printed on the document. Re-typing the same
 * name (or only its whitespace/case) keeps the link — that is not a different
 * customer.
 */
export function applyTypedPartyName(
  current: PartyLink | null | undefined,
  typedName: unknown
): PartyLink {
  const name = String(typedName ?? "");
  const previous = current || { name: "", id: "" };
  const sameName =
    !!previous.id && normalizeName(name) === normalizeName(previous.name);
  return { name, id: sameName ? previous.id : "" };
}
