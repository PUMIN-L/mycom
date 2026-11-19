// The rules of an invoice — pure, shared by the editor (said under each field)
// and the API (which refuses the same things, in the same words).
import { addDaysToDateString, isValidDateString } from "../dateFormat";
import { normalizeBranchCode } from "../thaiTaxId";
import { MAX_AMOUNT_SATANG, computeTotals, lineGrossSatang, type DocTotals, type PriceMode } from "./money";

export type LineType = "goods" | "service";

export interface DocLineInput {
  lineType: LineType;
  /** A catalog product's id, or "" for a line typed by hand. */
  productId: string;
  name: string;
  qty: number;
  unit: string;
  unitPriceSatang: number;
  discountSatang: number;
  /** A machine the customer's equipment register should track (serials, warranty). Goods only. */
  isMachine: boolean;
  /** Serial numbers, comma- or line-separated — printed on the delivery note. */
  serials: string;
  /** Warranty from the issue date, in months; null for none. */
  warrantyMonths: number | null;
  /** A delivery invoice's line: the customer-PO line it delivers ("" / absent: not from a PO). */
  sourceLineId?: string;
}

export interface InvoiceInput {
  issueDate: string;
  creditDays: number;
  companyId: string;
  customerId: string;
  salespersonId: string;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  /** "" none · "00000" สำนักงานใหญ่ · five digits a branch. */
  buyerBranch: string;
  priceMode: PriceMode;
  /** Bill-level discount, satang. */
  discountSatang: number;
  /**
   * Whether this invoice is ALSO the tax invoice. Goods: yes — VAT is due on
   * delivery. Services only: no — VAT is due when paid, so the tax invoice is
   * the receipt (ใบเสร็จรับเงิน/ใบกำกับภาษี). A mixed bill may issue it now.
   */
  isTaxInvoice: boolean;
  customerPoNo: string;
  projectName: string;
  note: string;
  lines: DocLineInput[];
  /** The customer PO (SO) this invoice delivers from ("" / absent: none). */
  salesOrderId?: string;
}

export const INVOICE_LIMITS = {
  lines: 100,
  name: 500,
  unit: 30,
  serials: 1000,
  buyerName: 255,
  buyerAddress: 500,
  buyerTaxId: 30,
  customerPoNo: 100,
  projectName: 255,
  note: 1000,
  qtyMax: 1_000_000,
  creditDaysMax: 365,
  warrantyMonthsMax: 120,
  /** Machines one invoice may register — the equipment writer's own cap. */
  machinesMax: 50,
} as const;

const text = (v: unknown, max: number) =>
  (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max);
const int = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/** "SN-1, SN-2\nSN-3" → ["SN-1", "SN-2", "SN-3"]. */
export function splitSerials(serials: string): string[] {
  return String(serials ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Goods on the bill → the invoice is the tax invoice; services only → the receipt will be. */
export function defaultIsTaxInvoice(lines: readonly Pick<DocLineInput, "lineType">[]): boolean {
  return lines.some((l) => l.lineType === "goods");
}

/** The title the paper prints. */
export function invoiceTitle(doc: { isTaxInvoice: boolean; lines: readonly Pick<DocLineInput, "lineType">[] }): string {
  const hasGoods = doc.lines.some((l) => l.lineType === "goods");
  const parts = [hasGoods ? "ใบส่งสินค้า" : null, "ใบแจ้งหนี้", doc.isTaxInvoice ? "ใบกำกับภาษี" : null].filter(Boolean);
  return parts.join(" / ");
}

export function dueDateOf(issueDate: string, creditDays: number): string | null {
  if (!isValidDateString(issueDate)) return null;
  return addDaysToDateString(issueDate, Math.max(0, Math.round(creditDays || 0)));
}

/** The input as the API takes it — every field coerced and cut to its column. */
export function cleanInvoiceInput(raw: unknown): InvoiceInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, INVOICE_LIMITS.lines + 1) : [];
  const lines: DocLineInput[] = rawLines.map((l) => {
    const line = (l ?? {}) as Record<string, unknown>;
    const lineType: LineType = line.lineType === "service" ? "service" : "goods";
    const warranty = line.warrantyMonths === null || line.warrantyMonths === "" || line.warrantyMonths === undefined ? null : int(line.warrantyMonths, 0);
    return {
      lineType,
      productId: text(line.productId, 255),
      name: text(line.name, INVOICE_LIMITS.name),
      qty: Number(line.qty),
      unit: text(line.unit, INVOICE_LIMITS.unit),
      unitPriceSatang: int(line.unitPriceSatang, -1),
      discountSatang: int(line.discountSatang, 0),
      isMachine: lineType === "goods" && line.isMachine === true,
      serials: lineType === "goods" ? text(line.serials, INVOICE_LIMITS.serials) : "",
      warrantyMonths: lineType === "goods" && line.isMachine === true ? warranty : null,
      sourceLineId: text(line.sourceLineId, 36),
    };
  });
  const branch = normalizeBranchCode(text(body.buyerBranch, 30));
  return {
    issueDate: text(body.issueDate, 10),
    creditDays: int(body.creditDays, 0),
    companyId: text(body.companyId, 255),
    customerId: text(body.customerId, 255),
    salespersonId: text(body.salespersonId, 255),
    buyerName: text(body.buyerName, INVOICE_LIMITS.buyerName),
    buyerAddress: text(body.buyerAddress, INVOICE_LIMITS.buyerAddress),
    buyerTaxId: text(body.buyerTaxId, INVOICE_LIMITS.buyerTaxId).replace(/^(\d)-?(\d{4})-?(\d{5})-?(\d{2})-?(\d)$/, "$1$2$3$4$5"),
    buyerBranch: branch ?? "",
    priceMode: body.priceMode === "inclusive" ? "inclusive" : "exclusive",
    discountSatang: int(body.discountSatang, 0),
    isTaxInvoice: typeof body.isTaxInvoice === "boolean" ? body.isTaxInvoice : defaultIsTaxInvoice(lines),
    customerPoNo: text(body.customerPoNo, INVOICE_LIMITS.customerPoNo),
    projectName: text(body.projectName, INVOICE_LIMITS.projectName),
    note: text(body.note, INVOICE_LIMITS.note),
    lines,
    salesOrderId: text(body.salesOrderId, 36),
  };
}

export interface InvoiceProblems {
  /** Header fields, by name. */
  fields: Partial<Record<keyof InvoiceInput, string>>;
  /** Line problems, by line index then field. */
  lines: Record<number, Partial<Record<keyof DocLineInput, string>>>;
  /** The first problem, for a toast or the API's single `error`. */
  first: string | null;
}

/**
 * What is wrong with a draft — enough to save it. Issuing asks for more
 * (issueProblems). `machinesCap: false` — a customer PO, which registers no
 * machine itself (each delivery invoice does, within the cap).
 */
export function invoiceProblems(input: InvoiceInput, vatRate: number, opts: { machinesCap?: boolean } = {}): InvoiceProblems {
  const fields: InvoiceProblems["fields"] = {};
  const lines: InvoiceProblems["lines"] = {};
  if (!isValidDateString(input.issueDate)) fields.issueDate = "กรุณาเลือกวันที่ออกเอกสาร";
  if (input.creditDays < 0 || input.creditDays > INVOICE_LIMITS.creditDaysMax) {
    fields.creditDays = `เครดิตต้องอยู่ระหว่าง 0–${INVOICE_LIMITS.creditDaysMax} วัน`;
  }
  if (!input.buyerName) fields.buyerName = "กรุณาเลือกหรือกรอกชื่อลูกค้า";
  if (input.lines.length === 0) fields.lines = "กรุณาเพิ่มรายการสินค้าหรือบริการอย่างน้อย 1 รายการ";
  if (input.lines.length > INVOICE_LIMITS.lines) fields.lines = `เอกสารหนึ่งใบมีได้ไม่เกิน ${INVOICE_LIMITS.lines} รายการ`;

  input.lines.forEach((line, i) => {
    const p: Partial<Record<keyof DocLineInput, string>> = {};
    if (!line.name) p.name = "กรุณากรอกชื่อรายการ";
    if (!Number.isFinite(line.qty) || line.qty <= 0) p.qty = "จำนวนต้องมากกว่า 0";
    else if (line.qty > INVOICE_LIMITS.qtyMax) p.qty = "จำนวนมากเกินไป";
    else if (Math.abs(Math.round(line.qty * 100) - line.qty * 100) > 1e-6) p.qty = "จำนวนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
    if (line.unitPriceSatang < 0) p.unitPriceSatang = "กรุณากรอกราคาต่อหน่วย";
    else if (line.unitPriceSatang > MAX_AMOUNT_SATANG) p.unitPriceSatang = "ราคาสูงเกินไป";
    if (!p.qty && !p.unitPriceSatang) {
      if (line.discountSatang < 0) p.discountSatang = "ส่วนลดติดลบไม่ได้";
      else if (line.discountSatang > lineGrossSatang(line)) p.discountSatang = "ส่วนลดมากกว่าราคาของรายการ";
    }
    if (line.isMachine) {
      const serialCount = splitSerials(line.serials).length;
      if (Number.isInteger(line.qty) && serialCount > line.qty) p.serials = `ใส่ Serial เกินจำนวน (${serialCount} จาก ${line.qty} เครื่อง)`;
      else if (!Number.isInteger(line.qty)) p.qty = "เครื่องที่ติดตาม Serial ต้องเป็นจำนวนเต็ม";
      if (line.warrantyMonths !== null && (line.warrantyMonths < 0 || line.warrantyMonths > INVOICE_LIMITS.warrantyMonthsMax)) {
        p.warrantyMonths = `ประกันต้องอยู่ระหว่าง 0–${INVOICE_LIMITS.warrantyMonthsMax} เดือน`;
      }
    }
    if (Object.keys(p).length > 0) lines[i] = p;
  });

  const lineProblemsFree = Object.keys(lines).length === 0 && !fields.lines;
  if (lineProblemsFree) {
    if (input.discountSatang < 0) fields.discountSatang = "ส่วนลดติดลบไม่ได้";
    else {
      const totals = computeTotals({ lines: input.lines, discountSatang: 0, priceMode: input.priceMode, vatRate });
      if (input.discountSatang > totals.subtotalSatang) fields.discountSatang = "ส่วนลดท้ายบิลมากกว่ายอดรวม";
    }
  }

  const machines = input.lines.filter((l) => l.isMachine).reduce((s, l) => s + (Number.isInteger(l.qty) ? l.qty : 0), 0);
  if (opts.machinesCap !== false && machines > INVOICE_LIMITS.machinesMax) {
    fields.lines = `ติดตามเครื่องได้ไม่เกิน ${INVOICE_LIMITS.machinesMax} เครื่องต่อเอกสาร (ตอนนี้ ${machines})`;
  }

  const first =
    Object.values(fields).find(Boolean) ??
    Object.values(lines).flatMap((p) => Object.values(p)).find(Boolean) ??
    null;
  return { fields, lines, first };
}

/**
 * What issuing needs beyond a savable draft: something to charge, a contact
 * to register machines under, and — on a tax invoice — the buyer's address.
 */
export function issueProblems(input: InvoiceInput, totals: DocTotals): string[] {
  const problems: string[] = [];
  if (totals.totalSatang <= 0) problems.push("ยอดรวมต้องมากกว่า 0 บาท");
  if (input.isTaxInvoice && !input.buyerAddress) problems.push("ใบกำกับภาษีต้องมีที่อยู่ของลูกค้า");
  if (input.lines.some((l) => l.isMachine) && !input.customerId) {
    problems.push("มีเครื่องที่ต้องลงทะเบียน — กรุณาเลือกผู้ติดต่อของลูกค้าที่จะผูกเครื่องไว้");
  }
  return problems;
}

// ── A document issued elsewhere, recorded here (step 3) ─────────────────────

export interface ExternalFields {
  /** The number as printed on the paper. */
  docNo: string;
  /** Where the paper is kept (no file is uploaded — the owner's choice). */
  externalNote: string;
  /** VAT as printed, when it differs from what the system works out; null = the system's. */
  vatSatangOverride: number | null;
}

export const EXTERNAL_LIMITS = { docNo: 60, externalNote: 255, vatToleranceSatang: 100 } as const;

/** Our own numbers' shape — an outside number must not look like one, or the two series could collide. */
const INTERNAL_NUMBER = /^(INV|RE|BN|CN)\d{10}$/;

export function cleanExternalFields(raw: unknown): ExternalFields {
  const body = (raw ?? {}) as Record<string, unknown>;
  const override = body.vatSatangOverride;
  return {
    docNo: text(body.docNo, EXTERNAL_LIMITS.docNo + 1),
    externalNote: text(body.externalNote, EXTERNAL_LIMITS.externalNote + 1),
    vatSatangOverride: override === null || override === undefined || override === "" ? null : int(override, -1),
  };
}

/** What is wrong with the outside-document fields, by field; `computedVatSatang` is the system's VAT for the same lines. */
export function externalProblems(fields: ExternalFields, computedVatSatang: number): Partial<Record<keyof ExternalFields, string>> {
  const problems: Partial<Record<keyof ExternalFields, string>> = {};
  if (!fields.docNo) problems.docNo = "กรุณากรอกเลขที่ตามที่พิมพ์บนเอกสารจริง";
  else if (fields.docNo.length > EXTERNAL_LIMITS.docNo) problems.docNo = `เลขที่ยาวเกิน ${EXTERNAL_LIMITS.docNo} ตัวอักษร`;
  else if (INTERNAL_NUMBER.test(fields.docNo)) {
    problems.docNo = "เลขนี้มีรูปแบบเดียวกับเลขที่ระบบออกเอง (เช่น INV2026110001) — เอกสารจากที่อื่นต้องใช้เลขคนละรูปแบบ ไม่อย่างนั้นเลขจะชนกัน";
  }
  if (!fields.externalNote) problems.externalNote = "กรุณาบอกว่าเก็บต้นฉบับไว้ที่ไหน เช่น แฟ้มใบกำกับ 2569 ตู้ 2";
  else if (fields.externalNote.length > EXTERNAL_LIMITS.externalNote) problems.externalNote = `ยาวเกิน ${EXTERNAL_LIMITS.externalNote} ตัวอักษร`;
  if (fields.vatSatangOverride !== null) {
    if (fields.vatSatangOverride < 0) problems.vatSatangOverride = "กรุณากรอก VAT เป็นตัวเลข";
    else if (Math.abs(fields.vatSatangOverride - computedVatSatang) > EXTERNAL_LIMITS.vatToleranceSatang) {
      problems.vatSatangOverride = "VAT ต่างจากที่คำนวณได้เกิน 1 บาท — ตรวจตัวเลขกับเอกสารจริงอีกครั้ง";
    }
  }
  return problems;
}

// ── How a document shows in a list ──────────────────────────────────────────

export type DisplayStatus = "draft" | "awaiting" | "overdue" | "partial" | "paid" | "void";

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  draft: "ร่าง",
  awaiting: "รอเก็บเงิน",
  overdue: "เกินกำหนด",
  partial: "ชำระบางส่วน",
  paid: "เก็บเงินแล้ว",
  void: "ยกเลิก",
};

/** Badge and dot colours — orange "waiting" and green "done", as on the owner's sample. */
export const STATUS_STYLES: Record<DisplayStatus, { badge: string; dot: string }> = {
  draft: { badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  awaiting: { badge: "bg-orange-50 text-orange-600", dot: "bg-orange-400" },
  overdue: { badge: "bg-red-50 text-red-600", dot: "bg-red-500" },
  partial: { badge: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  paid: { badge: "bg-green-50 text-green-700", dot: "bg-green-500" },
  void: { badge: "bg-gray-100 text-gray-400 line-through", dot: "bg-gray-300" },
};

export function displayStatusOf(
  doc: { status: string; totalSatang: number; paidSatang: number; dueDate: string | null },
  today: string
): DisplayStatus {
  if (doc.status === "draft") return "draft";
  if (doc.status === "void") return "void";
  if (doc.paidSatang >= doc.totalSatang && doc.totalSatang > 0) return "paid";
  if (doc.paidSatang > 0) return "partial";
  if (doc.dueDate && doc.dueDate < today) return "overdue";
  return "awaiting";
}
