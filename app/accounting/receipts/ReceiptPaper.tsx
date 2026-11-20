"use client";

import { bahtText } from "../../lib/bahtText";
import { formatDisplayDate } from "../../lib/dateFormat";
import { branchLabel, formatTaxId } from "../../lib/thaiTaxId";
import { formatSatang, satangToBaht } from "../../lib/accounting/money";
import { methodLabel, receiptTitle } from "../../lib/accounting/paymentRules";
import type { SellerProfile } from "../../lib/accounting/types";
import SellerLogo from "../SellerLogo";

export interface ReceiptPaperDocument {
  docNo: string | null;
  status: string;
  isTaxInvoice: boolean;
  issueDate: string;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
  customerPoNo: string;
  projectName: string;
  vatRate: number;
  vatBaseSatang: number;
  vatSatang: number;
  totalSatang: number;
}

export interface ReceiptPaperPayment {
  paidDate: string;
  method: string;
  bankLabel: string;
  amountSatang: number;
  whtPercent: number;
  whtSatang: number;
  note: string;
}

export interface ReceiptPaperInvoice {
  /** "SO": the receipt is for a deposit on a customer PO (step 6). */
  docType?: string;
  docNo: string | null;
  issueDate: string;
  totalSatang: number;
  lines: { name: string; qty: number; unit: string }[];
}

/** A billing note's receipt (step 7): the note it is for, and each invoice it pays with how much of it. */
export interface ReceiptPaperBilling {
  docNo: string | null;
  issueDate: string;
  invoices: { id: string; docNo: string | null; issueDate: string; amountSatang: number }[];
}

/**
 * The receipt on A4 — ใบเสร็จรับเงิน, or ใบเสร็จรับเงิน/ใบกำกับภาษี when it is
 * the tax invoice (services). It pays an invoice, which it names, with that
 * invoice's items as the description (no copy of them is stored). Printing
 * hides everything else on the page, as the invoice does.
 */
export default function ReceiptPaper({
  doc,
  seller,
  payment,
  invoice,
  copyLabel,
  billing = null,
}: {
  doc: ReceiptPaperDocument;
  seller: SellerProfile;
  payment: ReceiptPaperPayment | null;
  invoice: ReceiptPaperInvoice | null;
  copyLabel: string | null;
  billing?: ReceiptPaperBilling | null;
}) {
  const voided = doc.status === "void";
  const deposit = invoice?.docType === "SO";
  const partial = invoice !== null && !deposit && doc.totalSatang < invoice.totalSatang;
  return (
    <div
      data-print-root=""
      className="relative bg-white text-gray-900 border border-gray-200 shadow-sm mx-auto w-full max-w-[210mm] p-6 sm:p-10 text-[13px] leading-relaxed"
    >
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body * { visibility: hidden !important; }
          [data-print-root], [data-print-root] * { visibility: visible !important; }
          [data-print-root] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: none !important; box-shadow: none !important; padding: 0 !important; }
        }
      `}</style>
      {voided && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="text-[90px] font-black text-red-200/80 -rotate-12 select-none">ยกเลิก</span>
        </div>
      )}

      <div className="relative flex flex-col sm:flex-row justify-between gap-4 border-b border-gray-300 pb-4">
        <div className="min-w-0 flex items-start gap-3">
          <SellerLogo />
          <div className="min-w-0">
            <p className="text-base font-bold">{seller.name || "— ยังไม่ได้ตั้งชื่อบริษัท —"}</p>
            <p className="whitespace-pre-line text-gray-700">{seller.address}</p>
            <p className="text-gray-700 tabular-nums">
              เลขประจำตัวผู้เสียภาษี {formatTaxId(seller.taxId) || "—"}
              {seller.branchCode && <> · {branchLabel(seller.branchCode)}</>}
            </p>
            {(seller.phone || seller.email) && (
              <p className="text-gray-700">{[seller.phone && `โทร ${seller.phone}`, seller.email].filter(Boolean).join(" · ")}</p>
            )}
          </div>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-lg font-bold">{receiptTitle(doc.isTaxInvoice)}</p>
          {copyLabel && <p className="font-semibold text-gray-600">({copyLabel})</p>}
        </div>
      </div>

      <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 py-4 border-b border-gray-300">
        <div className="min-w-0">
          <p className="text-gray-500">ได้รับเงินจาก</p>
          <p className="font-semibold">{doc.buyerName || "—"}</p>
          {doc.buyerAddress && <p className="whitespace-pre-line text-gray-700">{doc.buyerAddress}</p>}
          {(doc.buyerTaxId || doc.buyerBranch) && (
            <p className="text-gray-700 tabular-nums">
              {doc.buyerTaxId && <>เลขประจำตัวผู้เสียภาษี {formatTaxId(doc.buyerTaxId)}</>}
              {doc.buyerTaxId && doc.buyerBranch && " · "}
              {branchLabel(doc.buyerBranch)}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums self-start">
          <dt className="text-gray-500">เลขที่</dt>
          <dd className="font-semibold">{doc.docNo}</dd>
          <dt className="text-gray-500">วันที่</dt>
          <dd>{formatDisplayDate(doc.issueDate)}</dd>
          {invoice?.docNo && (
            <>
              <dt className="text-gray-500">อ้างอิงใบแจ้งหนี้</dt>
              <dd>{invoice.docNo}</dd>
            </>
          )}
          {doc.customerPoNo && (
            <>
              <dt className="text-gray-500">PO ลูกค้า</dt>
              <dd>{doc.customerPoNo}</dd>
            </>
          )}
          {doc.projectName && (
            <>
              <dt className="text-gray-500">โปรเจค</dt>
              <dd>{doc.projectName}</dd>
            </>
          )}
        </dl>
      </div>

      <table className="relative w-full mt-4 tabular-nums">
        <thead>
          <tr className="border-b border-gray-300 text-gray-600">
            <th className="py-2 pr-2 text-left font-semibold w-10">ลำดับ</th>
            <th className="py-2 pr-2 text-left font-semibold">รายการ</th>
            <th className="py-2 text-right font-semibold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {billing ? (
            billing.invoices.map((inv, i) => (
              <tr key={inv.id} className="border-b border-gray-100 align-top" data-testid="receipt-billed-invoice">
                <td className="py-2 pr-2">{i + 1}</td>
                <td className="py-2 pr-2">
                  ชำระใบแจ้งหนี้ เลขที่ {inv.docNo} ลงวันที่ {formatDisplayDate(inv.issueDate)}
                  {i === 0 && <span className="block text-xs text-gray-600">ตามใบวางบิล เลขที่ {billing.docNo} ลงวันที่ {formatDisplayDate(billing.issueDate)}</span>}
                </td>
                <td className="py-2 text-right">{formatSatang(inv.amountSatang)}</td>
              </tr>
            ))
          ) : (
          <tr className="border-b border-gray-100 align-top">
            <td className="py-2 pr-2">1</td>
            <td className="py-2 pr-2">
              {invoice ? (
                <>
                  {deposit ? (
                    <>
                      รับเงินมัดจำ ตาม PO ลูกค้า เลขที่ {doc.customerPoNo} ลงวันที่ {formatDisplayDate(invoice.issueDate)}
                      <span className="text-gray-600"> (มูลค่า PO {formatSatang(invoice.totalSatang)} บาท)</span>
                    </>
                  ) : (
                    <>ชำระตามใบแจ้งหนี้ เลขที่ {invoice.docNo} ลงวันที่ {formatDisplayDate(invoice.issueDate)}</>
                  )}
                  {partial && <span className="text-gray-600"> (ชำระบางส่วน จากยอด {formatSatang(invoice.totalSatang)} บาท)</span>}
                  {invoice.lines.length > 0 && (
                    <ul className="text-xs text-gray-600 mt-1 space-y-0.5">
                      {invoice.lines.map((l, i) => (
                        <li key={i}>
                          • {l.name} {l.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} {l.unit}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                "รับชำระเงิน"
              )}
            </td>
            <td className="py-2 text-right">{formatSatang(doc.totalSatang)}</td>
          </tr>
          )}
        </tbody>
      </table>

      <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 mt-4">
        <div className="min-w-0 space-y-1" data-testid="receipt-payment">
          {payment && (
            <>
              <p>
                <span className="text-gray-500">ชำระโดย</span> {methodLabel(payment.method)}
                {payment.bankLabel && <> เข้าบัญชี {payment.bankLabel}</>} · วันที่ {formatDisplayDate(payment.paidDate)}
              </p>
              {payment.whtSatang > 0 && (
                <p className="tabular-nums">
                  <span className="text-gray-500">ภาษีหัก ณ ที่จ่าย {payment.whtPercent}%</span> {formatSatang(payment.whtSatang)} บาท ·{" "}
                  <span className="text-gray-500">ยอดชำระสุทธิ</span> {formatSatang(payment.amountSatang - payment.whtSatang)} บาท
                </p>
              )}
              {payment.note && <p className="text-gray-600">{payment.note}</p>}
            </>
          )}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 tabular-nums self-start min-w-[16rem]">
          {doc.isTaxInvoice && (
            <>
              <dt>มูลค่าก่อนภาษีมูลค่าเพิ่ม</dt>
              <dd className="text-right">{formatSatang(doc.vatBaseSatang)}</dd>
              <dt>ภาษีมูลค่าเพิ่ม {doc.vatRate}%</dt>
              <dd className="text-right">{formatSatang(doc.vatSatang)}</dd>
            </>
          )}
          <dt className="font-bold border-t border-gray-300 pt-1">จำนวนเงินรวมทั้งสิ้น</dt>
          <dd className="font-bold text-right border-t border-gray-300 pt-1">{formatSatang(doc.totalSatang)}</dd>
        </dl>
      </div>
      <p className="relative text-right font-semibold mt-1">({bahtText(satangToBaht(doc.totalSatang))})</p>

      <div className="relative grid grid-cols-2 gap-10 mt-14 text-center text-gray-600">
        {["ผู้รับเงิน", "ผู้มีอำนาจลงนาม"].map((role) => (
          <div key={role}>
            <div className="border-b border-gray-400 h-10" />
            <p className="mt-1">{role}</p>
            <p className="text-xs">วันที่ ____/____/______</p>
          </div>
        ))}
      </div>
    </div>
  );
}
