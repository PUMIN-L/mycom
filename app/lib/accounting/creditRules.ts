// Credit notes (ใบลดหนี้, docType CN) — pure, shared by the editor, the paper
// and the API (step 8, ARCHITECTURE.md §8g).
//
// A credit note takes value off an issued invoice: goods taken back, a price
// cut for goods or work not as agreed, a price charged too high. When the
// invoice was the tax invoice, the credit note is a tax document too (it
// lowers output VAT in ITS month — §86/10); a services invoice that is not yet
// the tax invoice gets a plain one, lowering what is owed — and with it the
// VAT its receipts will declare. It lowers the dashboard's sales in its own
// month too (the owner's choice) — the original month stays as it was.
import { isValidDateString } from "../dateFormat";
import { computeTotals, formatSatang, type DocTotals, type PriceMode } from "./money";
import { cleanInvoiceInput, invoiceProblems, type DocLineInput, type InvoiceProblems } from "./invoiceRules";

/** The cases the Revenue Code allows a credit note for (§86/10), as the admin picks them. */
export const CREDIT_REASONS = [
  "รับคืนสินค้า เนื่องจากชำรุดเสียหาย / ไม่ตรงตามตัวอย่างหรือคำพรรณนา",
  "ลดราคาสินค้า เนื่องจากผิดข้อกำหนด / ชำรุด / ขาดจำนวน",
  "ลดราคาค่าบริการ เนื่องจากผิดข้อกำหนด / ไม่ครบถ้วน",
  "คำนวณราคาสินค้า/บริการผิดพลาด สูงกว่าที่เป็นจริง",
] as const;

export interface CreditNoteInput {
  invoiceId: string;
  issueDate: string;
  /** Why — printed on the paper (required). */
  reason: string;
  /** What is taken off: items taken back, or a value cut — at the invoice's price mode and VAT rate. */
  lines: DocLineInput[];
}

export const CREDIT_LIMITS = { reason: 500, voidReason: 300 } as const;

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max);

/** What the browser sent, as the API takes it. A credit note registers no machine. */
export function cleanCreditNoteInput(raw: unknown): CreditNoteInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    invoiceId: text(b.invoiceId, 36),
    issueDate: text(b.issueDate, 10),
    reason: text(b.reason, CREDIT_LIMITS.reason + 1),
    // Nothing of a PO's delivery either: a credit note takes value off, it delivers nothing.
    lines: cleanInvoiceInput({ lines: b.lines }).lines.map((l) => ({ ...l, isMachine: false, serials: "", warrantyMonths: null, sourceLineId: "" })),
  };
}

/** The invoice a credit note is set against, as it stands. */
export interface CreditInvoice {
  issueDate: string;
  isTaxInvoice: boolean;
  priceMode: PriceMode;
  vatRate: number;
  totalSatang: number;
  vatSatang: number;
  vatBaseSatang: number;
  /** What its issued credit notes took off already — VAT included, and before VAT. */
  creditedSatang: number;
  creditedBaseSatang: number;
  paidSatang: number;
}

/** What an invoice still owes, its credit notes taken off. */
export const owedSatang = (inv: { totalSatang: number; creditedSatang?: number; paidSatang: number }) =>
  Math.max(0, inv.totalSatang - (inv.creditedSatang ?? 0) - inv.paidSatang);

/** What the customer paid beyond what the invoice now comes to — to hand back (or keep for the next one). */
export const refundDueSatang = (inv: { totalSatang: number; creditedSatang?: number; paidSatang: number }) =>
  Math.max(0, inv.paidSatang + (inv.creditedSatang ?? 0) - inv.totalSatang);

/** The invoice as its payments see it: its credit notes taken off its total and its VAT. */
export const effectiveInvoice = (inv: { totalSatang: number; vatSatang: number; creditedSatang?: number; creditedVatSatang?: number }) => ({
  totalSatang: inv.totalSatang - (inv.creditedSatang ?? 0),
  vatSatang: inv.vatSatang - (inv.creditedVatSatang ?? 0),
});

/** A credit note's figures: its lines at the invoice's price mode and VAT rate. */
export const creditTotals = (input: Pick<CreditNoteInput, "lines">, invoice: Pick<CreditInvoice, "priceMode" | "vatRate">): DocTotals =>
  computeTotals({ lines: input.lines, priceMode: invoice.priceMode, vatRate: invoice.vatRate });

/**
 * What the paper prints (§86/10): the value as on the original tax invoice
 * (less what earlier credit notes took), the correct value, the difference —
 * all before VAT.
 */
export function creditValues(invoice: Pick<CreditInvoice, "vatBaseSatang" | "creditedBaseSatang">, differenceSatang: number) {
  const originalSatang = invoice.vatBaseSatang - invoice.creditedBaseSatang;
  return { originalSatang, correctSatang: originalSatang - differenceSatang, differenceSatang };
}

export type CreditProblems = {
  fields: Partial<Record<"issueDate" | "reason" | "lines" | "total", string>>;
  lines: InvoiceProblems["lines"];
  first: string | null;
};

/** What is wrong with a credit note against `invoice` — in Thai, by field and line. */
export function creditNoteProblems(input: CreditNoteInput, invoice: CreditInvoice): CreditProblems {
  const fields: CreditProblems["fields"] = {};
  if (!isValidDateString(input.issueDate)) fields.issueDate = "กรุณาเลือกวันที่ใบลดหนี้";
  else if (input.issueDate < invoice.issueDate) fields.issueDate = "วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบแจ้งหนี้";
  if (!input.reason) fields.reason = "กรุณาระบุเหตุที่ลดหนี้";
  else if (input.reason.length > CREDIT_LIMITS.reason) fields.reason = `เหตุผลยาวเกิน ${CREDIT_LIMITS.reason} ตัวอักษร`;
  // The lines follow an invoice's own rules (a name, a quantity, a price).
  const asInvoice = invoiceProblems(
    {
      issueDate: invoice.issueDate, creditDays: 0, companyId: "", customerId: "", salespersonId: "", buyerName: "-", buyerAddress: "", buyerTaxId: "",
      buyerBranch: "", priceMode: invoice.priceMode, discountSatang: 0, isTaxInvoice: false, customerPoNo: "", projectName: "", note: "", lines: input.lines,
    },
    invoice.vatRate
  );
  if (asInvoice.fields.lines) fields.lines = asInvoice.fields.lines.replace("สินค้าหรือบริการ", "ที่ลดหนี้");
  if (Object.keys(asInvoice.lines).length === 0 && !fields.lines) {
    const total = creditTotals(input, invoice).totalSatang;
    const left = invoice.totalSatang - invoice.creditedSatang;
    const owed = owedSatang(invoice);
    if (total <= 0) fields.total = "ยอดลดหนี้ต้องมากกว่า 0 บาท";
    else if (total > left) fields.total = `ลดหนี้เกินมูลค่าที่เหลือของใบแจ้งหนี้ — เหลือ ${formatSatang(left)} บาท`;
    // Not the tax invoice: what was received went out on receipts that ARE tax invoices — only what is still owed can come off here.
    else if (!invoice.isTaxInvoice && total > owed) {
      fields.total = `ใบแจ้งหนี้นี้ไม่ใช่ใบกำกับภาษี — ลดได้ไม่เกินยอดที่ยังค้าง ${formatSatang(owed)} บาท`;
    }
  }
  const first =
    (["issueDate", "reason", "lines"] as const).map((k) => fields[k]).find(Boolean) ??
    Object.values(asInvoice.lines).flatMap((p) => Object.values(p)).find(Boolean) ??
    fields.total ??
    null;
  return { fields, lines: asInvoice.lines, first };
}

/** Goods taken back (the first case): the dashboard's quantities sold go down too — a price cut leaves them. */
export const creditReturnsGoods = (reason: string) => reason.startsWith("รับคืนสินค้า");

/** The line under the paper's title "ใบลดหนี้" — whether it is a tax document. */
export const creditNoteKind = (isTaxInvoice: boolean) =>
  isTaxInvoice ? "เอกสารทางภาษี ตามมาตรา 86/10 แห่งประมวลรัษฎากร" : "ไม่ใช่เอกสารทางภาษี — ลดยอดที่ยังค้างชำระ";
