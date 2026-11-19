// The monthly workbook for the accountant (step 9, ARCHITECTURE.md §8g) —
// pure, so every figure is tested without a database. One workbook per
// month: the sales-tax report (รายงานภาษีขาย), the register of every document,
// the money received, the withholding and its 50 ทวิ, receivables and the
// deposits not yet deducted, both as at the month's end. Money is written as
// NUMBERS in baht (summed in satang first, so totals are exact) — the
// accountant adds them up in Excel; nothing here is stored.
import type { ExcelSheet } from "../xlsxExport";
import { formatDisplayDate } from "../dateFormat";
import { branchLabel, formatTaxId } from "../thaiTaxId";
import { formatSatang } from "./money";
import { AGEING_BUCKETS, groupReceivables, methodLabel, type ReceivableInvoice } from "./paymentRules";
import type { SellerProfile } from "./types";

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** "2026-11" → its days: [from, to) and the last one. Null for anything else. */
export function monthRange(month: string): { from: string; to: string; last: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12 || year < 2000 || year > 2200) return null;
  const next = mon === 12 ? `${year + 1}-01` : `${m[1]}-${String(mon + 1).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${next}-01`, last: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}` };
}

/** "2026-11" → "พฤศจิกายน 2569" — the tax month as the Revenue Department writes it. */
export function monthLabel(month: string): string {
  const range = monthRange(month);
  if (!range) return month;
  const [y, m] = month.split("-").map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** Satang → baht, a number with two decimals for a cell to add up. */
export const bahtOf = (satang: number) => Math.round(satang) / 100;

/** The printed name of a document. */
export function docTypeLabel(docType: string, isTaxInvoice: boolean): string {
  if (docType === "INV") return isTaxInvoice ? "ใบแจ้งหนี้/ใบกำกับภาษี" : "ใบแจ้งหนี้";
  if (docType === "RE") return isTaxInvoice ? "ใบเสร็จรับเงิน/ใบกำกับภาษี" : "ใบเสร็จรับเงิน";
  if (docType === "BN") return "ใบวางบิล";
  if (docType === "CN") return "ใบลดหนี้";
  return docType;
}

const branchText = (code: string) => branchLabel(code) || "";

// ── ภาษีขาย ─────────────────────────────────────────────────────────────────

/** A tax document of ours dated in the month (INV / RE / CN that is a tax document), voided ones too. */
export interface SalesTaxDoc {
  docType: string;
  docNo: string | null;
  status: string;
  source: string;
  issueDate: string;
  buyerName: string;
  buyerTaxId: string;
  buyerBranch: string;
  vatBaseSatang: number;
  vatSatang: number;
  totalSatang: number;
  /** What it refers to: a credit note's invoice; a receipt's invoice, billing note or PO. */
  relatedNo: string | null;
  /** That document's type — SO: a deposit's receipt. */
  relatedType?: string | null;
  voidReason: string | null;
}

/** A tax invoice issued ELSEWHERE for money received in the month (a services receipt from a hand-written book). */
export interface ExternalTaxReceipt {
  paidDate: string;
  receiptNo: string;
  buyerName: string;
  buyerTaxId: string;
  buyerBranch: string;
  amountSatang: number;
  vatSatang: number;
  /** The invoices it paid. */
  invoiceNos: string[];
}

export const SALES_TAX_MONEY = ["มูลค่าสินค้าหรือบริการ", "ภาษีมูลค่าเพิ่ม", "จำนวนเงินรวม"];

/**
 * The sales-tax report: every tax document dated in the month, in date and
 * number order. A voided one stays on it, its figures 0, marked ยกเลิก (the
 * running numbers stay complete); a credit note takes its figures OFF
 * (negative); a tax invoice issued elsewhere says so. A total row last.
 */
export function salesTaxRows(docs: readonly SalesTaxDoc[], external: readonly ExternalTaxReceipt[]): Record<string, unknown>[] {
  type Entry = { date: string; no: string; label: string; buyer: string; taxId: string; branch: string; base: number; vat: number; total: number; note: string };
  const entries: Entry[] = docs.map((d) => {
    const voided = d.status === "void";
    const sign = d.docType === "CN" ? -1 : 1;
    const notes = [
      voided ? `ยกเลิก${d.voidReason ? ` — ${d.voidReason}` : ""}` : null,
      d.docType === "CN" && d.relatedNo ? `ลดหนี้ของ ${d.relatedNo}` : null,
      d.docType === "RE" && d.relatedNo ? `${d.relatedType === "SO" ? "รับมัดจำ" : "รับชำระ"} ${d.relatedNo}` : null,
      d.source === "external" ? "ออกจากที่อื่น" : null,
    ].filter(Boolean);
    return {
      date: d.issueDate,
      no: d.docNo ?? "",
      label: docTypeLabel(d.docType, true),
      buyer: d.buyerName,
      taxId: formatTaxId(d.buyerTaxId),
      branch: branchText(d.buyerBranch),
      base: voided ? 0 : sign * d.vatBaseSatang,
      vat: voided ? 0 : sign * d.vatSatang,
      total: voided ? 0 : sign * d.totalSatang,
      note: notes.join(" · "),
    };
  });
  for (const r of external) {
    entries.push({
      date: r.paidDate,
      no: r.receiptNo,
      label: docTypeLabel("RE", true),
      buyer: r.buyerName,
      taxId: formatTaxId(r.buyerTaxId),
      branch: branchText(r.buyerBranch),
      base: r.amountSatang - r.vatSatang,
      vat: r.vatSatang,
      total: r.amountSatang,
      note: [`ออกจากที่อื่น`, r.invoiceNos.length > 0 ? `รับชำระ ${r.invoiceNos.join(", ")}` : null].filter(Boolean).join(" · "),
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
  const rows: Record<string, unknown>[] = entries.map((e, i) => ({
    "ลำดับ": i + 1,
    "วันที่": formatDisplayDate(e.date),
    "เลขที่ใบกำกับภาษี": e.no,
    "ประเภทเอกสาร": e.label,
    "ชื่อผู้ซื้อ": e.buyer,
    "เลขประจำตัวผู้เสียภาษี": e.taxId,
    "สถานประกอบการ": e.branch,
    "มูลค่าสินค้าหรือบริการ": bahtOf(e.base),
    "ภาษีมูลค่าเพิ่ม": bahtOf(e.vat),
    "จำนวนเงินรวม": bahtOf(e.total),
    "หมายเหตุ": e.note,
  }));
  if (rows.length > 0) {
    rows.push({
      "ลำดับ": "",
      "วันที่": "",
      "เลขที่ใบกำกับภาษี": "",
      "ประเภทเอกสาร": "",
      "ชื่อผู้ซื้อ": "รวม",
      "เลขประจำตัวผู้เสียภาษี": "",
      "สถานประกอบการ": "",
      "มูลค่าสินค้าหรือบริการ": bahtOf(entries.reduce((s, e) => s + e.base, 0)),
      "ภาษีมูลค่าเพิ่ม": bahtOf(entries.reduce((s, e) => s + e.vat, 0)),
      "จำนวนเงินรวม": bahtOf(entries.reduce((s, e) => s + e.total, 0)),
      "หมายเหตุ": "",
    });
  }
  return rows;
}

// ── ทะเบียนเอกสาร ───────────────────────────────────────────────────────────

/** Every document of ours dated in the month (not a draft), voided ones and those issued elsewhere too. */
export interface RegisterDoc extends SalesTaxDoc {
  isTaxInvoice: boolean;
  externalNote: string;
}

export const REGISTER_MONEY = ["มูลค่าก่อน VAT", "VAT", "รวม"];

/** The register: each document as issued — a credit note's figures negative, a voided one marked with its reason. */
export function registerRows(docs: readonly RegisterDoc[]): Record<string, unknown>[] {
  const order: Record<string, number> = { INV: 0, RE: 1, CN: 2, BN: 3 };
  return [...docs]
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || (order[a.docType] ?? 9) - (order[b.docType] ?? 9) || String(a.docNo).localeCompare(String(b.docNo)))
    .map((d) => {
      const sign = d.docType === "CN" ? -1 : 1;
      const billing = d.docType === "BN";
      return {
        "วันที่": formatDisplayDate(d.issueDate),
        "ประเภทเอกสาร": docTypeLabel(d.docType, d.isTaxInvoice),
        "เลขที่": d.docNo ?? "",
        "สถานะ": d.status === "void" ? "ยกเลิก" : "ออกแล้ว",
        "ที่มา": d.source === "external" ? `ออกจากที่อื่น${d.externalNote ? ` (เก็บที่: ${d.externalNote})` : ""}` : "ออกจากระบบ",
        "ลูกค้า": d.buyerName,
        "เลขประจำตัวผู้เสียภาษี": formatTaxId(d.buyerTaxId),
        "อ้างถึง": d.relatedNo ?? "",
        // A billing note gathers invoices — it has a total, not a VAT of its own.
        "มูลค่าก่อน VAT": billing ? "" : bahtOf(sign * d.vatBaseSatang),
        "VAT": billing ? "" : bahtOf(sign * d.vatSatang),
        "รวม": bahtOf(sign * d.totalSatang),
        "หมายเหตุ": d.status === "void" ? `ยกเลิก: ${d.voidReason ?? ""}`.trim() : "",
      };
    });
}

// ── รับชำระ ──────────────────────────────────────────────────────────────────

/** A payment dated in the month — voided ones too. */
export interface PaymentEntry {
  paidDate: string;
  /** INV, SO (a deposit) — and a billing note's number when it came through one. */
  docType: string;
  docNo: string | null;
  billingNo: string | null;
  buyerName: string;
  buyerTaxId: string;
  method: string;
  bankLabel: string;
  amountSatang: number;
  whtPercent: number;
  whtSatang: number;
  feeSatang: number;
  receiptNo: string | null;
  externalReceiptNo: string;
  cert50Received: boolean;
  cert50Note: string;
  note: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export const PAYMENT_MONEY = ["ยอดรับ", "ภาษีหัก ณ ที่จ่าย", "ค่าธรรมเนียม", "เงินเข้าจริง"];

const paymentKind = (p: PaymentEntry) => (p.amountSatang < 0 ? "คืนเงินลูกค้า" : p.docType === "SO" ? "รับมัดจำ" : "รับชำระ");
const receiptText = (p: PaymentEntry) => p.receiptNo ?? (p.externalReceiptNo ? `${p.externalReceiptNo} (ออกจากที่อื่น)` : "");

/**
 * Money received in the month, by date. A voided one stays listed with its
 * figures 0 — the reason and what it was in the status — so the columns add
 * up to what really came in; a refund is money out (negative).
 */
export function paymentRows(payments: readonly PaymentEntry[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = payments.map((p) => {
    const voided = Boolean(p.voidedAt);
    const z = (v: number) => (voided ? 0 : bahtOf(v));
    return {
      "วันที่รับ": formatDisplayDate(p.paidDate),
      "รายการ": paymentKind(p),
      "เอกสาร": p.docNo ?? "",
      "ใบวางบิล": p.billingNo ?? "",
      "ลูกค้า": p.buyerName,
      "วิธีรับ": methodLabel(p.method),
      "บัญชี": p.bankLabel,
      "ยอดรับ": z(p.amountSatang),
      "หัก ณ ที่จ่าย (%)": p.whtPercent,
      "ภาษีหัก ณ ที่จ่าย": z(p.whtSatang),
      "ค่าธรรมเนียม": z(p.feeSatang),
      "เงินเข้าจริง": z(p.amountSatang - p.whtSatang - p.feeSatang),
      "ใบเสร็จ": receiptText(p),
      "สถานะ": voided ? `ยกเลิก (เดิม ${formatSatang(p.amountSatang)} บาท)${p.voidReason ? ` — ${p.voidReason}` : ""}` : "ปกติ",
      "หมายเหตุ": p.note,
    };
  });
  if (rows.length > 0) {
    const live = payments.filter((p) => !p.voidedAt);
    const sum = (f: (p: PaymentEntry) => number) => bahtOf(live.reduce((s, p) => s + f(p), 0));
    rows.push({
      "วันที่รับ": "",
      "รายการ": "",
      "เอกสาร": "",
      "ใบวางบิล": "",
      "ลูกค้า": "รวม",
      "วิธีรับ": "",
      "บัญชี": "",
      "ยอดรับ": sum((p) => p.amountSatang),
      "หัก ณ ที่จ่าย (%)": "",
      "ภาษีหัก ณ ที่จ่าย": sum((p) => p.whtSatang),
      "ค่าธรรมเนียม": sum((p) => p.feeSatang),
      "เงินเข้าจริง": sum((p) => p.amountSatang - p.whtSatang - p.feeSatang),
      "ใบเสร็จ": "",
      "สถานะ": "",
      "หมายเหตุ": "",
    });
  }
  return rows;
}

export const WHT_MONEY = ["ยอดรับ", "ภาษีที่ถูกหัก"];

/** The withholding in the month (live payments only) and whether its 50 ทวิ came in. */
export function withholdingRows(payments: readonly PaymentEntry[]): Record<string, unknown>[] {
  const withheld = payments.filter((p) => !p.voidedAt && p.whtSatang > 0);
  const rows: Record<string, unknown>[] = withheld.map((p) => ({
    "วันที่รับ": formatDisplayDate(p.paidDate),
    "ลูกค้า (ผู้หักภาษี)": p.buyerName,
    "เลขประจำตัวผู้เสียภาษี": formatTaxId(p.buyerTaxId),
    "เอกสาร": p.billingNo ? `${p.billingNo} (${p.docNo ?? ""})` : p.docNo ?? "",
    "ใบเสร็จ": receiptText(p),
    "ยอดรับ": bahtOf(p.amountSatang),
    "อัตรา (%)": p.whtPercent,
    "ภาษีที่ถูกหัก": bahtOf(p.whtSatang),
    "50 ทวิ": p.cert50Received ? "ได้รับแล้ว" : "ยังไม่ได้รับ",
    "เก็บ 50 ทวิ ไว้ที่": p.cert50Note,
  }));
  if (rows.length > 0) {
    rows.push({
      "วันที่รับ": "",
      "ลูกค้า (ผู้หักภาษี)": "รวม",
      "เลขประจำตัวผู้เสียภาษี": "",
      "เอกสาร": "",
      "ใบเสร็จ": "",
      "ยอดรับ": bahtOf(withheld.reduce((s, p) => s + p.amountSatang, 0)),
      "อัตรา (%)": "",
      "ภาษีที่ถูกหัก": bahtOf(withheld.reduce((s, p) => s + p.whtSatang, 0)),
      "50 ทวิ": `ยังไม่ได้รับ ${withheld.filter((p) => !p.cert50Received).length} รายการ`,
      "เก็บ 50 ทวิ ไว้ที่": "",
    });
  }
  return rows;
}

// ── ลูกหนี้คงค้าง ณ สิ้นเดือน ──────────────────────────────────────────────

/** An issued invoice as it stood at the month's end: its total, what credit notes and payments took off by then. */
export interface ReceivableAsAt extends Omit<ReceivableInvoice, "totalSatang" | "paidSatang"> {
  totalSatang: number;
  creditedSatang: number;
  paidSatang: number;
}

export const RECEIVABLE_MONEY = ["ยอดตามใบแจ้งหนี้", "ลดหนี้", "รับชำระแล้ว", "คงค้าง"];

/** What was owed at `asAt` (the month's last day), by customer, most late first, aged as on that day. */
export function receivableRows(invoices: readonly ReceivableAsAt[], asAt: string): Record<string, unknown>[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const { groups, totals } = groupReceivables(
    invoices.map((i) => ({ ...i, totalSatang: i.totalSatang - i.creditedSatang, paidSatang: i.paidSatang })),
    asAt
  );
  const label = new Map(AGEING_BUCKETS.map((b) => [b.key, b.label]));
  const rows: Record<string, unknown>[] = groups.flatMap((g) =>
    g.invoices.map((inv) => {
      const original = byId.get(inv.id)!;
      return {
        "ลูกค้า": g.name,
        "เลขที่ใบแจ้งหนี้": inv.docNo ?? "",
        "วันที่": formatDisplayDate(inv.issueDate),
        "ครบกำหนด": inv.dueDate ? formatDisplayDate(inv.dueDate) : "",
        "ยอดตามใบแจ้งหนี้": bahtOf(original.totalSatang),
        "ลดหนี้": bahtOf(original.creditedSatang),
        "รับชำระแล้ว": bahtOf(original.paidSatang),
        "คงค้าง": bahtOf(inv.outstandingSatang),
        "เกินกำหนด (วัน)": inv.daysOverdue,
        "อายุหนี้": label.get(inv.bucket) ?? "",
      };
    })
  );
  if (rows.length > 0) {
    rows.push({
      "ลูกค้า": "รวม",
      "เลขที่ใบแจ้งหนี้": "",
      "วันที่": "",
      "ครบกำหนด": "",
      "ยอดตามใบแจ้งหนี้": "",
      "ลดหนี้": "",
      "รับชำระแล้ว": "",
      "คงค้าง": bahtOf(totals.all),
      "เกินกำหนด (วัน)": "",
      "อายุหนี้": AGEING_BUCKETS.filter((b) => totals[b.key] > 0)
        .map((b) => `${b.label} ${formatSatang(totals[b.key])}`)
        .join(" · "),
    });
  }
  return rows;
}

// ── มัดจำคงเหลือ ณ สิ้นเดือน ───────────────────────────────────────────────

/** A customer PO's deposits at the month's end: received (with VAT, and before it) and deducted by its invoices. */
export interface DepositAsAt {
  customerPoNo: string;
  buyerName: string;
  receivedSatang: number;
  receivedExVatSatang: number;
  deductedSatang: number;
}

export const DEPOSIT_MONEY = ["รับมัดจำ (รวม VAT)", "มัดจำก่อน VAT", "หักในใบแจ้งหนี้แล้ว (ก่อน VAT)", "คงเหลือ (ก่อน VAT)"];

/** The deposits still held — received and not yet deducted on a delivery invoice. */
export function depositRows(orders: readonly DepositAsAt[]): Record<string, unknown>[] {
  const held = orders
    .map((o) => ({ ...o, leftSatang: o.receivedExVatSatang - o.deductedSatang }))
    .filter((o) => o.leftSatang > 0)
    .sort((a, b) => a.buyerName.localeCompare(b.buyerName, "th") || a.customerPoNo.localeCompare(b.customerPoNo));
  const rows: Record<string, unknown>[] = held.map((o) => ({
    "PO ลูกค้า": o.customerPoNo,
    "ลูกค้า": o.buyerName,
    "รับมัดจำ (รวม VAT)": bahtOf(o.receivedSatang),
    "มัดจำก่อน VAT": bahtOf(o.receivedExVatSatang),
    "หักในใบแจ้งหนี้แล้ว (ก่อน VAT)": bahtOf(o.deductedSatang),
    "คงเหลือ (ก่อน VAT)": bahtOf(o.leftSatang),
  }));
  if (rows.length > 0) {
    rows.push({
      "PO ลูกค้า": "",
      "ลูกค้า": "รวม",
      "รับมัดจำ (รวม VAT)": bahtOf(held.reduce((s, o) => s + o.receivedSatang, 0)),
      "มัดจำก่อน VAT": bahtOf(held.reduce((s, o) => s + o.receivedExVatSatang, 0)),
      "หักในใบแจ้งหนี้แล้ว (ก่อน VAT)": bahtOf(held.reduce((s, o) => s + o.deductedSatang, 0)),
      "คงเหลือ (ก่อน VAT)": bahtOf(held.reduce((s, o) => s + o.leftSatang, 0)),
    });
  }
  return rows;
}

// ── The workbook ─────────────────────────────────────────────────────────────

export interface WorkbookData {
  month: string;
  seller: SellerProfile;
  salesTax: SalesTaxDoc[];
  externalReceipts: ExternalTaxReceipt[];
  register: RegisterDoc[];
  payments: PaymentEntry[];
  receivables: ReceivableAsAt[];
  deposits: DepositAsAt[];
}

/** The six sheets, in the order the accountant reads them; the file named by the month. */
export function accountantWorkbook(data: WorkbookData): { filename: string; sheets: ExcelSheet[] } {
  const range = monthRange(data.month);
  if (!range) throw new Error(`เดือนไม่ถูกต้อง: ${data.month}`);
  const label = monthLabel(data.month);
  const company = [
    `ชื่อผู้ประกอบการ: ${data.seller.name || "—"}`,
    `เลขประจำตัวผู้เสียภาษีอากร: ${formatTaxId(data.seller.taxId) || "—"}${data.seller.branchCode ? ` · ${branchLabel(data.seller.branchCode)}` : ""}`,
  ];
  const asAt = formatDisplayDate(range.last);
  return {
    filename: `accounting-${data.month}.xlsx`,
    sheets: [
      { name: "ภาษีขาย", title: ["รายงานภาษีขาย", `เดือนภาษี ${label}`, ...company], rows: salesTaxRows(data.salesTax, data.externalReceipts), moneyColumns: SALES_TAX_MONEY, autoSizeColumns: true },
      { name: "ทะเบียนเอกสาร", title: [`ทะเบียนเอกสาร เดือน ${label}`, company[0]], rows: registerRows(data.register), moneyColumns: REGISTER_MONEY, autoSizeColumns: true },
      { name: "รับชำระ", title: [`รับชำระเงิน เดือน ${label}`, company[0]], rows: paymentRows(data.payments), moneyColumns: PAYMENT_MONEY, autoSizeColumns: true },
      { name: "หัก ณ ที่จ่าย", title: [`ภาษีเงินได้ถูกหัก ณ ที่จ่าย เดือน ${label}`, company[0]], rows: withholdingRows(data.payments), moneyColumns: WHT_MONEY, autoSizeColumns: true },
      { name: "ลูกหนี้คงค้าง", title: [`ลูกหนี้คงค้าง ณ วันที่ ${asAt}`, company[0]], rows: receivableRows(data.receivables, range.last), moneyColumns: RECEIVABLE_MONEY, autoSizeColumns: true },
      { name: "มัดจำคงเหลือ", title: [`เงินมัดจำรับล่วงหน้าคงเหลือ ณ วันที่ ${asAt}`, company[0]], rows: depositRows(data.deposits), moneyColumns: DEPOSIT_MONEY, autoSizeColumns: true },
    ],
  };
}
