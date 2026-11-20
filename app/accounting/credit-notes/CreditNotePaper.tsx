"use client";

import { bahtText } from "../../lib/bahtText";
import { formatDisplayDate } from "../../lib/dateFormat";
import { branchLabel, formatTaxId } from "../../lib/thaiTaxId";
import { formatSatang, lineGrossSatang, satangToBaht } from "../../lib/accounting/money";
import { creditNoteKind } from "../../lib/accounting/creditRules";
import type { DocLineInput } from "../../lib/accounting/invoiceRules";
import type { SellerProfile } from "../../lib/accounting/types";
import SellerLogo from "../SellerLogo";

/** What the credit-note paper prints — an issued one, or one being written. */
export interface CreditPaperDocument {
  docNo: string | null;
  status: string;
  isTaxInvoice: boolean;
  issueDate: string;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
  priceMode: "exclusive" | "inclusive";
  vatRate: number;
  /** The value it was set against: the invoice's, before VAT, less earlier credit notes. */
  refValueSatang: number;
  vatBaseSatang: number;
  vatSatang: number;
  totalSatang: number;
  /** Why — printed as เหตุที่ลดหนี้. */
  note: string;
  lines: (DocLineInput & { amountSatang?: number })[];
}

/**
 * The credit note (ใบลดหนี้) on A4 with what §86/10 asks of it: the word
 * ใบลดหนี้, both parties, its number and date, the original invoice's number,
 * date and value, the correct value, the difference and the VAT on it, and
 * why. Printing hides everything else on the page — no PDF is stored.
 */
export default function CreditNotePaper({
  doc,
  invoice,
  seller,
  copyLabel,
  draft = false,
}: {
  doc: CreditPaperDocument;
  invoice: { docNo: string | null; issueDate: string; isTaxInvoice: boolean };
  seller: SellerProfile;
  copyLabel: string | null;
  /** Being written: "ร่าง" across it, and not printable. */
  draft?: boolean;
}) {
  const voided = doc.status === "void";
  const difference = doc.vatBaseSatang;
  const correct = doc.refValueSatang - difference;
  return (
    <div
      data-print-root={draft ? undefined : ""}
      className="relative bg-white text-gray-900 border border-gray-200 shadow-sm mx-auto w-full max-w-[210mm] p-6 sm:p-10 text-[13px] leading-relaxed"
    >
      {!draft && (
        <style>{`
          @media print {
            @page { size: A4; margin: 10mm; }
            body * { visibility: hidden !important; }
            [data-print-root], [data-print-root] * { visibility: visible !important; }
            [data-print-root] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: none !important; box-shadow: none !important; padding: 0 !important; }
          }
        `}</style>
      )}
      {(voided || draft) && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className={`text-[90px] font-black -rotate-12 select-none ${voided ? "text-red-200/80" : "text-gray-200/70"}`}>{voided ? "ยกเลิก" : "ร่าง"}</span>
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
            {(seller.phone || seller.email) && <p className="text-gray-700">{[seller.phone && `โทร ${seller.phone}`, seller.email].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-lg font-bold">ใบลดหนี้</p>
          <p className="text-xs text-gray-600">{creditNoteKind(doc.isTaxInvoice)}</p>
          {copyLabel && <p className="font-semibold text-gray-600">({copyLabel})</p>}
        </div>
      </div>

      <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 py-4 border-b border-gray-300">
        <div className="min-w-0">
          <p className="text-gray-500">ลูกค้า</p>
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
          <dd className="font-semibold">{doc.docNo ?? "(ได้เลขตอนออกเอกสาร)"}</dd>
          <dt className="text-gray-500">วันที่</dt>
          <dd>{formatDisplayDate(doc.issueDate)}</dd>
          <dt className="text-gray-500">{invoice.isTaxInvoice ? "อ้างถึงใบกำกับภาษี" : "อ้างถึงใบแจ้งหนี้"}</dt>
          <dd className="font-semibold">{invoice.docNo}</dd>
          <dt className="text-gray-500">ลงวันที่</dt>
          <dd>{formatDisplayDate(invoice.issueDate)}</dd>
        </dl>
      </div>

      <table className="relative w-full mt-4 tabular-nums" data-testid="credit-paper-lines">
        <thead>
          <tr className="border-b border-gray-300 text-gray-600">
            <th className="py-2 pr-2 text-left font-semibold w-10">ลำดับ</th>
            <th className="py-2 pr-2 text-left font-semibold">รายการที่ลดหนี้</th>
            <th className="py-2 pr-2 text-right font-semibold">จำนวน</th>
            <th className="py-2 pr-2 text-left font-semibold">หน่วย</th>
            <th className="py-2 pr-2 text-right font-semibold">ราคา/หน่วย</th>
            <th className="py-2 text-right font-semibold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line, i) => (
            <tr key={i} className="border-b border-gray-100 align-top">
              <td className="py-2 pr-2">{i + 1}</td>
              <td className="py-2 pr-2">{line.name}</td>
              <td className="py-2 pr-2 text-right">{line.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              <td className="py-2 pr-2">{line.unit}</td>
              <td className="py-2 pr-2 text-right">{formatSatang(line.unitPriceSatang)}</td>
              <td className="py-2 text-right">{formatSatang(lineGrossSatang(line) - line.discountSatang)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 mt-4">
        <div className="min-w-0">
          <p className="text-gray-500">เหตุที่ลดหนี้</p>
          <p className="whitespace-pre-line font-semibold" data-testid="credit-paper-reason">{doc.note || "—"}</p>
          {doc.priceMode === "inclusive" && <p className="text-gray-500 mt-2">ราคาในรายการรวมภาษีมูลค่าเพิ่มแล้ว</p>}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 tabular-nums self-start min-w-[17rem]" data-testid="credit-paper-values">
          <dt>มูลค่าตาม{invoice.isTaxInvoice ? "ใบกำกับภาษี" : "ใบแจ้งหนี้"}เดิม</dt>
          <dd className="text-right">{formatSatang(doc.refValueSatang)}</dd>
          <dt>มูลค่าที่ถูกต้อง</dt>
          <dd className="text-right">{formatSatang(correct)}</dd>
          <dt>ผลต่าง</dt>
          <dd className="text-right">{formatSatang(difference)}</dd>
          <dt>ภาษีมูลค่าเพิ่ม {doc.vatRate}%</dt>
          <dd className="text-right">{formatSatang(doc.vatSatang)}</dd>
          <dt className="font-bold border-t border-gray-300 pt-1">รวมลดหนี้ทั้งสิ้น</dt>
          <dd className="font-bold text-right border-t border-gray-300 pt-1">{formatSatang(doc.totalSatang)}</dd>
        </dl>
      </div>
      <p className="relative text-right font-semibold mt-1">({bahtText(satangToBaht(doc.totalSatang))})</p>

      <div className="relative grid grid-cols-2 gap-6 mt-14 text-center text-gray-600">
        {["ผู้รับใบลดหนี้", "ผู้มีอำนาจลงนาม"].map((role) => (
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
