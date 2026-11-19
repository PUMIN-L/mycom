import "server-only";
import type { RowDataPacket } from "mysql2";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { bangkokDateString, formatDisplayDate } from "../dateFormat";
import { writeAudit } from "./audit";
import { getSellerProfile } from "./settings";
import { formatSatang } from "./money";
import { getAccDocument } from "./documents";
import { recomputePaidSatang } from "./paymentLedger";
import { depositLedgerOf } from "./depositLedger";
import { depositLeftSatang, depositRoomSatang, vatInsideSatang } from "./depositRules";
import { backlogSatang, orderStatusOf } from "./orderRules";
import { firstPaymentProblem, methodLabel, paymentProblems, receiptTitle, serviceBaseSatang, type PaymentInput } from "./paymentRules";
import { assertBankAccountUsable, getPayment, insertPaymentTx, insertReceiptTx, listPayments, type AccPayment, type RecordedPayment } from "./payments";

// Deposits (มัดจำ) received against a customer PO — step 6, ARCHITECTURE.md
// §8g. One `acc_payments` row whose `documentId` is the PO, and its receipt:
// an RE pointing at the PO, ALWAYS a ใบเสร็จรับเงิน/ใบกำกับภาษี (VAT falls
// due on money received before delivery), its VAT taken out of the amount
// paid. The PO's `paidSatang` is the deposits received (the same one-writer
// cache as an invoice's). The delivery invoices deduct them before VAT
// (documents.ts / depositLedger.ts). Voided, or the receipt deleted, as any
// payment — but never while the invoices still lean on it.
//
// Locks: the PO first, then its payments and receipts — the order issuing a
// delivery takes after its invoice (invoice → PO → …), so none can deadlock.

interface Actor {
  userId: string;
  username: string;
}

const num = (v: unknown) => Number(v) || 0;

export interface DepositContext {
  payments: AccPayment[];
  /** The most a new deposit may be, VAT included — the dialog's ceiling. */
  outstandingSatang: number;
  /** The PO's services before VAT — what withholding is worked out on. */
  serviceBaseSatang: number;
  defaultWhtPercent: number;
  /** A deposit's receipt is always the tax invoice. */
  receiptIsTaxInvoice: boolean;
  /** Live deposits, VAT included. */
  receivedSatang: number;
  receivedExVatSatang: number;
  /** Deducted by issued delivery invoices, before VAT. */
  deductedSatang: number;
  /** Still to deduct, before VAT. */
  leftSatang: number;
}

/** What the PO's deposit panel and dialog need. Null when there is no such PO. */
export async function depositContext(salesOrderId: string): Promise<DepositContext | null> {
  const order = await getAccDocument(salesOrderId);
  if (!order || order.docType !== "SO") return null;
  const ledger = await depositLedgerOf(null, salesOrderId, order.vatRate);
  let defaultWhtPercent = 0;
  if (order.companyId) {
    const [rows] = await query<RowDataPacket[]>("SELECT whtPercent FROM companies WHERE id = ? LIMIT 1", [order.companyId]);
    defaultWhtPercent = num(rows[0]?.whtPercent);
  }
  const open = order.status !== "void" && orderStatusOf(order) !== "complete";
  return {
    payments: await listPayments(salesOrderId),
    outstandingSatang: open ? depositRoomSatang({ ...ledger, backlogSatang: backlogSatang(order), vatRate: order.vatRate }) : 0,
    serviceBaseSatang: serviceBaseSatang(order),
    defaultWhtPercent,
    receiptIsTaxInvoice: true,
    receivedSatang: ledger.receivedSatang,
    receivedExVatSatang: ledger.receivedExVatSatang,
    deductedSatang: ledger.deductedSatang,
    leftSatang: depositLeftSatang(ledger),
  };
}

/**
 * Records a deposit received against an open customer PO and issues its
 * receipt/tax invoice, in ONE transaction. Never more than the PO still holds
 * (before VAT, with the deposits not yet deducted) — checked again under the
 * PO's lock.
 */
export async function recordDeposit(salesOrderId: string, input: PaymentInput, actor: Actor): Promise<RecordedPayment> {
  const order = await getAccDocument(salesOrderId);
  if (!order || order.docType !== "SO") throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");
  if (order.status === "void") throw new ApiError(409, "PO นี้ถูกยกเลิกแล้ว — รับมัดจำไม่ได้");
  if (orderStatusOf(order) === "complete") throw new ApiError(409, "PO นี้ส่งของครบแล้ว — รับเงินที่ใบแจ้งหนี้แทน");
  if (input.externalReceiptNo) throw new ApiError(400, "มัดจำต้องออกใบเสร็จรับเงิน/ใบกำกับภาษีจากระบบ");
  const before = await depositLedgerOf(null, salesOrderId, order.vatRate);
  const room = depositRoomSatang({ ...before, backlogSatang: backlogSatang(order), vatRate: order.vatRate });
  const problem = firstPaymentProblem(paymentProblems(input, { outstandingSatang: room, today: bangkokDateString(new Date()), deposit: true }));
  if (problem) throw new ApiError(400, problem);
  await assertBankAccountUsable(input.bankAccountId);
  const { versionId } = await getSellerProfile();
  if (!versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนใบเสร็จ — ไปที่ ตั้งค่าบัญชี ก่อน");

  const done = await withTransaction(async (conn) => {
    const [so] = await conn.query<RowDataPacket[]>("SELECT status, vatRate, vatBaseSatang FROM acc_documents WHERE id = ? FOR UPDATE", [salesOrderId]);
    if (!so[0] || so[0].status !== "issued") throw new ApiError(409, "PO นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่");
    const vatRate = num(so[0].vatRate);
    // What it still holds, from its lines as they are now (locking reads).
    const [lines] = await conn.query<RowDataPacket[]>("SELECT qty, deliveredQty, amountSatang FROM acc_document_lines WHERE documentId = ? FOR UPDATE", [salesOrderId]);
    const held = backlogSatang({
      status: "issued",
      vatBaseSatang: num(so[0].vatBaseSatang),
      lines: lines.map((l) => ({ qty: num(l.qty), deliveredQty: num(l.deliveredQty), amountSatang: num(l.amountSatang) })),
    });
    const ledger = await depositLedgerOf(conn, salesOrderId, vatRate);
    const ceiling = depositRoomSatang({ ...ledger, backlogSatang: held, vatRate });
    if (input.amountSatang > ceiling) {
      throw new ApiError(409, ceiling > 0 ? `มัดจำเกินมูลค่าที่ยังไม่ได้ส่ง — รับได้อีกไม่เกิน ${formatSatang(ceiling)} บาท` : "PO นี้ไม่มีมูลค่าที่ยังไม่ได้ส่งให้รับมัดจำแล้ว");
    }
    const now = new Date().toISOString();
    const vat = vatInsideSatang(input.amountSatang, vatRate);
    const receipt = await insertReceiptTx(conn, {
      pays: order,
      relatedDocId: salesOrderId,
      paidDate: input.paidDate,
      amountSatang: input.amountSatang,
      vatSatang: vat,
      isTaxInvoice: true,
      versionId,
      actor,
      now,
    });
    const title = receiptTitle(true);
    await writeAudit(conn, {
      ...actor,
      action: "doc.issue",
      documentId: receipt.id,
      docNo: receipt.docNo,
      detail: `ออก${title} (มัดจำ) · ${order.buyerName} · ${formatSatang(input.amountSatang)} บาท · PO ${order.customerPoNo}`,
    });
    const paymentId = await insertPaymentTx(conn, { documentId: salesOrderId, receiptId: receipt.id, input, actor, now, vatSatang: vat });
    const paid = await recomputePaidSatang(conn, salesOrderId);
    const parts = [
      `รับเงินมัดจำ ${formatSatang(input.amountSatang)} บาท (${methodLabel(input.method)} ${formatDisplayDate(input.paidDate)})`,
      input.whtSatang > 0 ? `หัก ณ ที่จ่าย ${input.whtPercent}% ${formatSatang(input.whtSatang)}` : null,
      input.feeSatang > 0 ? `ค่าธรรมเนียม ${formatSatang(input.feeSatang)}` : null,
      `ใบเสร็จ ${receipt.docNo}`,
    ].filter(Boolean);
    await writeAudit(conn, { ...actor, action: "payment.create", documentId: salesOrderId, docNo: order.customerPoNo, detail: parts.join(" · ") });
    return { paymentId, receipt: { ...receipt, title }, paid };
  });

  return { payment: (await getPayment(done.paymentId))!, receipt: done.receipt, paidSatang: done.paid };
}
