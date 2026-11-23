"use client";

import { bahtText } from "../../lib/bahtText";
import { formatDisplayDate } from "../../lib/dateFormat";
import { branchLabel, formatTaxId } from "../../lib/thaiTaxId";
import { formatSatang, satangToBaht } from "../../lib/accounting/money";
import type { SellerProfile } from "../../lib/accounting/types";
import SellerLogo from "../SellerLogo";
import { PAPER_PRINT_CSS } from "../paperPrint";
import { spaceAddressLabels } from "../../lib/thaiAddressSpacing";

export interface BillingPaperDocument {
  docNo: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
  totalSatang: number;
  note: string;
}

export interface BillingPaperInvoice {
  id: string;
  docNo: string | null;
  issueDate: string;
  dueDate: string | null;
  /** What it owed when billed. */
  billedSatang: number;
}

/**
 * The billing note (ใบวางบิล) on A4: the invoices the customer is to pay,
 * each with what it owed when billed, the total in figures and in words, the
 * date agreed to pay, and where both sides sign. Printing hides everything
 * else on the page, as the invoice does — no PDF is stored.
 */
export default function BillingNotePaper({
  doc,
  invoices,
  seller,
  copyLabel,
}: {
  doc: BillingPaperDocument;
  invoices: BillingPaperInvoice[];
  seller: SellerProfile;
  copyLabel: string | null;
}) {
  const voided = doc.status === "void";
  return (
    <div
      data-print-root=""
      className="relative bg-white text-gray-900 border border-gray-200 shadow-sm mx-auto w-full max-w-[210mm] p-6 sm:p-10 text-[13px] leading-relaxed"
    >
      <style>{PAPER_PRINT_CSS}</style>
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
            <p className="whitespace-pre-line text-gray-700">{spaceAddressLabels(seller.address)}</p>
            <p className="text-gray-700 tabular-nums">
              เลขประจำตัวผู้เสียภาษี {formatTaxId(seller.taxId) || "—"}
              {seller.branchCode && <> · {branchLabel(seller.branchCode)}</>}
            </p>
            {(seller.phone || seller.email) && <p className="text-gray-700">{[seller.phone && `โทร ${seller.phone}`, seller.email].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-lg font-bold">ใบวางบิล</p>
          {copyLabel && <p className="font-semibold text-gray-600">({copyLabel})</p>}
        </div>
      </div>

      <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 py-4 border-b border-gray-300">
        <div className="min-w-0">
          <p className="text-gray-500">ลูกค้า</p>
          <p className="font-semibold">{doc.buyerName || "—"}</p>
          {doc.buyerAddress && <p className="whitespace-pre-line text-gray-700">{spaceAddressLabels(doc.buyerAddress)}</p>}
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
          {doc.dueDate && (
            <>
              <dt className="text-gray-500">นัดชำระ</dt>
              <dd className="font-semibold">{formatDisplayDate(doc.dueDate)}</dd>
            </>
          )}
        </dl>
      </div>

      <table className="relative w-full mt-4 tabular-nums" data-testid="billing-paper-invoices">
        <thead>
          <tr className="border-b border-gray-300 text-gray-600">
            <th className="py-2 pr-2 text-left font-semibold w-10">ลำดับ</th>
            <th className="py-2 pr-2 text-left font-semibold">เลขที่ใบแจ้งหนี้</th>
            <th className="py-2 pr-2 text-left font-semibold">วันที่</th>
            <th className="py-2 pr-2 text-left font-semibold">ครบกำหนด</th>
            <th className="py-2 text-right font-semibold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv, i) => (
            <tr key={inv.id} className="border-b border-gray-100">
              <td className="py-2 pr-2">{i + 1}</td>
              <td className="py-2 pr-2">{inv.docNo}</td>
              <td className="py-2 pr-2">{formatDisplayDate(inv.issueDate)}</td>
              <td className="py-2 pr-2">{inv.dueDate ? formatDisplayDate(inv.dueDate) : "—"}</td>
              <td className="py-2 text-right">{formatSatang(inv.billedSatang)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-3 pr-2 text-right font-bold">รวม {invoices.length} ใบ</td>
            <td className="pt-3 text-right font-bold border-t border-gray-300">{formatSatang(doc.totalSatang)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="relative text-right font-semibold mt-1">({bahtText(satangToBaht(doc.totalSatang))})</p>
      {doc.note && <p className="relative mt-3 whitespace-pre-line text-gray-700">หมายเหตุ: {doc.note}</p>}

      <div className="relative grid grid-cols-3 gap-6 mt-14 text-center text-gray-600">
        {["ผู้วางบิล", "ผู้รับวางบิล", "วันที่นัดชำระ / นัดรับเช็ค"].map((role) => (
          <div key={role}>
            <div className="border-b border-dotted border-gray-400 h-10" />
            <p className="mt-1">{role}</p>
            <p className="text-xs">วันที่ ......../......../........</p>
          </div>
        ))}
      </div>
    </div>
  );
}
