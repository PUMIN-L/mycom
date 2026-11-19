"use client";

import { bahtText } from "../../lib/bahtText";
import { formatDisplayDate } from "../../lib/dateFormat";
import { branchLabel, formatTaxId } from "../../lib/thaiTaxId";
import { formatSatang, lineGrossSatang, satangToBaht } from "../../lib/accounting/money";
import { invoiceTitle, splitSerials, type DocLineInput } from "../../lib/accounting/invoiceRules";
import type { SellerProfile } from "../../lib/accounting/types";

/** What the paper prints — an issued document, or a draft being edited. */
export interface PaperDocument {
  docNo: string | null;
  isTaxInvoice: boolean;
  issueDate: string;
  dueDate: string | null;
  creditDays: number;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
  customerPoNo: string;
  projectName: string;
  note: string;
  priceMode: "exclusive" | "inclusive";
  vatRate: number;
  subtotalSatang: number;
  discountSatang: number;
  /** A delivery's share of the PO's deposit, before VAT (its VAT was on the deposit's receipt). */
  depositSatang?: number;
  vatBaseSatang: number;
  vatSatang: number;
  totalSatang: number;
  lines: (DocLineInput & { amountSatang: number })[];
}

/**
 * The invoice on A4, as the customer receives it. Printing (`printable`)
 * hides everything else on the page, so the browser's "Save as PDF" gives a
 * clean document — no stored PDF anywhere.
 */
export default function InvoicePaper({
  doc,
  seller,
  copyLabel,
  draft = false,
  printable = false,
  voided = false,
}: {
  doc: PaperDocument;
  seller: SellerProfile;
  /** "ต้นฉบับ" or "สำเนา"; null prints neither. */
  copyLabel: string | null;
  /** A draft prints "ร่าง" across it — it is not a document yet. */
  draft?: boolean;
  printable?: boolean;
  /** Voided (step 8): "ยกเลิก" across it — printed so, never as a live document. */
  voided?: boolean;
}) {
  const title = invoiceTitle(doc);
  return (
    <div
      data-print-root={printable ? "" : undefined}
      className="relative bg-white text-gray-900 border border-gray-200 shadow-sm mx-auto w-full max-w-[210mm] p-6 sm:p-10 text-[13px] leading-relaxed"
    >
      {printable && (
        <style>{`
          @media print {
            @page { size: A4; margin: 10mm; }
            body * { visibility: hidden !important; }
            [data-print-root], [data-print-root] * { visibility: visible !important; }
            [data-print-root] { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: none !important; box-shadow: none !important; padding: 0 !important; }
          }
        `}</style>
      )}
      {draft && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="text-[90px] font-black text-gray-200/70 -rotate-12 select-none">ร่าง</span>
        </div>
      )}
      {voided && (
        <div aria-hidden="true" data-testid="invoice-void-mark" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="text-[90px] font-black text-red-200/80 -rotate-12 select-none">ยกเลิก</span>
        </div>
      )}

      <div className="relative flex flex-col sm:flex-row justify-between gap-4 border-b border-gray-300 pb-4">
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
        <div className="sm:text-right shrink-0">
          <p className="text-lg font-bold">{title}</p>
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
          {doc.dueDate && (
            <>
              <dt className="text-gray-500">ครบกำหนด</dt>
              <dd>
                {formatDisplayDate(doc.dueDate)}
                {doc.creditDays > 0 && <span className="text-gray-500"> (เครดิต {doc.creditDays} วัน)</span>}
              </dd>
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
            <th className="py-2 pr-2 text-right font-semibold">จำนวน</th>
            <th className="py-2 pr-2 text-left font-semibold">หน่วย</th>
            <th className="py-2 pr-2 text-right font-semibold">ราคา/หน่วย</th>
            <th className="py-2 pr-2 text-right font-semibold">ส่วนลด</th>
            <th className="py-2 text-right font-semibold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line, i) => {
            const serials = line.isMachine ? splitSerials(line.serials) : [];
            return (
              <tr key={i} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-2">{i + 1}</td>
                <td className="py-2 pr-2">
                  {line.name}
                  {serials.length > 0 && <div className="text-xs text-gray-600">S/N: {serials.join(", ")}</div>}
                </td>
                <td className="py-2 pr-2 text-right">{line.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="py-2 pr-2">{line.unit}</td>
                <td className="py-2 pr-2 text-right">{formatSatang(line.unitPriceSatang)}</td>
                <td className="py-2 pr-2 text-right">{line.discountSatang > 0 ? formatSatang(line.discountSatang) : "—"}</td>
                <td className="py-2 text-right">{formatSatang(lineGrossSatang(line) - line.discountSatang)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 mt-4">
        <div className="min-w-0">
          {doc.note && (
            <>
              <p className="text-gray-500">หมายเหตุ</p>
              <p className="whitespace-pre-line">{doc.note}</p>
            </>
          )}
          {doc.priceMode === "inclusive" && <p className="text-gray-500 mt-2">ราคาสินค้า/บริการรวมภาษีมูลค่าเพิ่มแล้ว</p>}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 tabular-nums self-start min-w-[16rem]">
          <dt>รวมเป็นเงิน</dt>
          <dd className="text-right">{formatSatang(doc.subtotalSatang)}</dd>
          {doc.discountSatang > 0 && (
            <>
              <dt>หักส่วนลด</dt>
              <dd className="text-right">{formatSatang(doc.discountSatang)}</dd>
            </>
          )}
          {(doc.depositSatang ?? 0) > 0 && (
            <>
              {/* With prices that include VAT, the deposit comes off with its VAT — so the rows add up. */}
              <dt>หักเงินมัดจำ{doc.priceMode === "inclusive" && " (รวม VAT)"}</dt>
              <dd className="text-right">
                {formatSatang(
                  doc.priceMode === "inclusive"
                    ? Math.round(((doc.depositSatang ?? 0) * (10000 + Math.round(doc.vatRate * 100))) / 10000)
                    : doc.depositSatang ?? 0
                )}
              </dd>
            </>
          )}
          <dt>มูลค่าก่อนภาษีมูลค่าเพิ่ม</dt>
          <dd className="text-right">{formatSatang(doc.vatBaseSatang)}</dd>
          <dt>ภาษีมูลค่าเพิ่ม {doc.vatRate}%</dt>
          <dd className="text-right">{formatSatang(doc.vatSatang)}</dd>
          <dt className="font-bold border-t border-gray-300 pt-1">จำนวนเงินรวมทั้งสิ้น</dt>
          <dd className="font-bold text-right border-t border-gray-300 pt-1">{formatSatang(doc.totalSatang)}</dd>
        </dl>
      </div>
      <p className="relative text-right font-semibold mt-1">({bahtText(satangToBaht(doc.totalSatang))})</p>

      <div className="relative grid grid-cols-3 gap-6 mt-14 text-center text-gray-600">
        {["ผู้รับสินค้า / บริการ", "ผู้ส่งสินค้า", "ผู้มีอำนาจลงนาม"].map((role) => (
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
