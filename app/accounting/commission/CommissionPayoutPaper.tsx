"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { formatDisplayDate, formatDisplayDateTime } from "../../lib/dateFormat";
import { branchLabel, formatTaxId } from "../../lib/thaiTaxId";
import { spaceAddressLabels } from "../../lib/thaiAddressSpacing";
import { formatSatang } from "../../lib/accounting/money";
import { COMMISSION_KIND_LABELS } from "../../lib/accounting/commission";
import { formatWholeBaht } from "../../lib/accounting/commissionRateChange";
import {
  paginatePaper,
  paperUnits,
  payoutPdfFilename,
  payoutRangeLabel,
  payoutSummary,
  rateSetLines,
  type PaperPage,
  type PaperUnit,
  type PayoutSummary,
} from "../../lib/accounting/commissionPayoutPaper";
import type { PayoutReport } from "../../lib/accounting/commissionTypes";
import SellerLogo from "../SellerLogo";

// The commission payout summary on A4 (ARCHITECTURE.md §8h, the owner's
// "สวยแล้วดูง่าย"): the company and the paid range on top, three cards — what
// ฟอร์ด and พี่ต่อ got (from which deals) and both — then the paid POs, the
// totals, the rates used, the notes and where to sign; every page numbered
// with who exported it and when. Navy and light grey only, so it prints well
// in black and white.
//
// The PDF is made in the browser in one click, the quotation's way
// (html2canvas-pro paints each page, jsPDF saves the file — nothing is
// stored): the parts are drawn once off-screen and measured, the pages are
// worked out (paginatePaper: a row never splits, a PO's row stays with its
// costs, the totals + signatures stay together), then each page is painted.

const NAVY = "#0f172a";
const GREY = "#64748b";
const LINE = "#e2e8f0";
const ZEBRA = "#f8fafc";
/** The page's margins, in mm; the footer sits in the bottom one. */
const PAD_X = 12;
const PAD_TOP = 12;
const FOOTER_ZONE = 16;
/** Column widths in mm — 186 (210 less the margins). */
const COLUMNS = [20, 52, 22, 24, 23, 23, 22];
const TABLE: CSSProperties = { width: "100%", tableLayout: "fixed", borderCollapse: "collapse" };
const CELL: CSSProperties = { padding: "1.6mm 1.5mm", verticalAlign: "top" };
const RIGHT: CSSProperties = { ...CELL, textAlign: "right", whiteSpace: "nowrap" };
const PAPER_TEXT = "text-[10.5px] leading-normal";

const PDF_FAILED = "สร้าง PDF ไม่สำเร็จ ลองใหม่อีกครั้ง";

function Cols() {
  return (
    <colgroup>
      {COLUMNS.map((w, i) => (
        <col key={i} style={{ width: `${w}mm` }} />
      ))}
    </colgroup>
  );
}

function TableHead() {
  const th: CSSProperties = { ...CELL, color: "#ffffff", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" };
  const thRight: CSSProperties = { ...th, textAlign: "right" };
  return (
    <thead data-paper-thead="">
      <tr style={{ background: NAVY }}>
        <th style={th}>วันที่จ่าย</th>
        <th style={th}>PO / ลูกค้า</th>
        <th style={th}>ประเภท</th>
        <th style={thRight}>กำไร</th>
        <th style={thRight}>ฟอร์ด</th>
        <th style={thRight}>พี่ต่อ</th>
        <th style={thRight}>บริษัท</th>
      </tr>
    </thead>
  );
}

function FirstHeader({ report, summary }: { report: PayoutReport; summary: PayoutSummary }) {
  const { seller } = report;
  return (
    <div data-paper-first-header="" style={{ paddingBottom: "3mm" }}>
      <div className="flex justify-between items-start gap-4" style={{ borderBottom: `2px solid ${NAVY}`, paddingBottom: "3mm" }}>
        <div className="flex items-start gap-3 min-w-0">
          <SellerLogo />
          <div className="min-w-0">
            <p className="text-[13px] font-bold">{seller.name || "—"}</p>
            {seller.address && <p className="text-[9px] whitespace-pre-line" style={{ color: GREY }}>{spaceAddressLabels(seller.address)}</p>}
            {seller.taxId && (
              <p className="text-[9px] tabular-nums" style={{ color: GREY }}>
                เลขประจำตัวผู้เสียภาษี {formatTaxId(seller.taxId)}
                {seller.branchCode && <> · {branchLabel(seller.branchCode)}</>}
              </p>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[18px] font-bold" style={{ color: NAVY }}>สรุปการจ่ายค่าคอมมิชชั่น</p>
          <p className="text-[11px] font-semibold">{`วันที่จ่าย ${payoutRangeLabel(report.from, report.to)}`}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3" style={{ marginTop: "3.5mm" }}>
        <SummaryCard label="ฟอร์ดได้รับ" amount={summary.ford.totalSatang} note={`จากลูกค้าฟอร์ด ${formatSatang(summary.ford.fromFordSatang)} · จากลูกค้าพี่ต่อ ${formatSatang(summary.ford.fromTorSatang)}`} />
        <SummaryCard label="พี่ต่อได้รับ" amount={summary.tor.totalSatang} note={`จากลูกค้าฟอร์ด ${formatSatang(summary.tor.fromFordSatang)} · จากลูกค้าพี่ต่อ ${formatSatang(summary.tor.fromTorSatang)}`} />
        <SummaryCard label="รวมจ่าย" amount={summary.bothSatang} note="ฟอร์ด + พี่ต่อ" strong />
      </div>
      <p className="text-[10px] tabular-nums" style={{ marginTop: "2.5mm", color: "#334155" }}>
        {`จ่าย ${summary.count} PO · กำไรรวม ${formatSatang(summary.profitSatang)} · ส่วนของบริษัท ${formatSatang(summary.companySatang)}`}
      </p>
    </div>
  );
}

function SummaryCard({ label, amount, note, strong = false }: { label: string; amount: number; note: string; strong?: boolean }) {
  return (
    <div style={{ border: `${strong ? 2 : 1}px solid ${strong ? NAVY : "#cbd5e1"}`, borderRadius: "2mm", padding: "2.5mm 3mm" }}>
      <p className="text-[10px] font-semibold" style={{ color: GREY }}>{label}</p>
      <p className="text-[17px] font-bold tabular-nums" style={{ color: NAVY }}>{formatSatang(amount)}</p>
      <p className="text-[8.5px] tabular-nums" style={{ color: GREY }}>{note}</p>
    </div>
  );
}

function NextHeader({ report }: { report: PayoutReport }) {
  // The gap under it is padding, not margin: a measured height leaves a margin out.
  return (
    <div data-paper-next-header="" style={{ paddingBottom: "2.5mm" }}>
      <div className="flex justify-between items-end gap-4" style={{ borderBottom: `1px solid #cbd5e1`, paddingBottom: "2mm" }}>
        <p className="text-[11px] font-bold">{report.seller.name || "—"}</p>
        <p className="text-[11px] font-bold" style={{ color: NAVY }}>
          สรุปการจ่ายค่าคอมมิชชั่น (ต่อ) <span className="font-normal" style={{ color: GREY }}>{`· วันที่จ่าย ${payoutRangeLabel(report.from, report.to)}`}</span>
        </p>
      </div>
    </div>
  );
}

function KindTag({ kind }: { kind: "ford" | "tor" | null }) {
  return (
    <span className="inline-block text-[9px] font-semibold whitespace-nowrap" style={{ border: `1px solid #94a3b8`, borderRadius: "1mm", padding: "0.2mm 1.2mm" }}>
      {kind ? COMMISSION_KIND_LABELS[kind] : "—"}
    </span>
  );
}

/** One part of the table — a paid PO, or a piece of its cost detail. */
function UnitRow({ unit }: { unit: PaperUnit }) {
  if (unit.kind === "row") {
    const r = unit.row;
    const ladder = r.kind === "ford" && r.ladderFromSatang !== null && r.ladderToSatang !== null && r.ladderToSatang > r.ladderFromSatang;
    return (
      <tr data-paper-unit="" style={{ background: unit.index % 2 === 1 ? ZEBRA : "#ffffff", borderTop: `1px solid ${LINE}` }}>
        <td style={{ ...CELL, whiteSpace: "nowrap" }}>{formatDisplayDate(r.paidDate)}</td>
        <td style={CELL}>
          <p className="font-semibold">
            {r.customerPoNo}
            {r.changedSince && <span style={{ color: GREY }}> *</span>}
          </p>
          <p>{r.buyerName}</p>
          <p className="text-[8.5px]" style={{ color: GREY }}>
            {`PO วันที่ ${formatDisplayDate(r.issueDate)}`}
            {ladder && ` · กำไรสะสม ${formatWholeBaht(r.ladderFromSatang!)} – ${formatWholeBaht(r.ladderToSatang!)}`}
          </p>
        </td>
        <td style={CELL}>
          <KindTag kind={r.kind} />
        </td>
        <td style={RIGHT}>{formatSatang(r.profitSatang)}</td>
        <td style={{ ...RIGHT, fontWeight: 600 }}>{formatSatang(r.fordSatang)}</td>
        <td style={{ ...RIGHT, fontWeight: 600 }}>{formatSatang(r.torSatang)}</td>
        <td style={{ ...RIGHT, color: GREY }}>{formatSatang(r.companySatang)}</td>
      </tr>
    );
  }
  const detail: CSSProperties = { padding: "0.6mm 1.5mm 1.2mm 22mm", fontSize: "9px", color: "#334155" };
  if (unit.kind === "no-costs") {
    return (
      <tr data-paper-unit="">
        <td colSpan={COLUMNS.length} style={{ ...detail, color: GREY }}>ไม่มีข้อมูลต้นทุน</td>
      </tr>
    );
  }
  if (unit.kind === "costs-total") {
    const t = unit.costs.totals;
    return (
      <tr data-paper-unit="">
        <td colSpan={COLUMNS.length} style={{ ...detail, paddingBottom: "2mm" }}>
          <p className="font-semibold tabular-nums">{`ยอดขาย ${formatSatang(t.salesSatang)} − ต้นทุน ${formatSatang(t.costSatang)} = กำไร ${formatSatang(t.profitSatang)}`}</p>
          {t.waitingCostSalesSatang > 0 && <p style={{ color: GREY }}>{`ยังไม่นับยอดขาย ${formatSatang(t.waitingCostSalesSatang)} ของครั้งที่ยังไม่กรอกต้นทุน`}</p>}
        </td>
      </tr>
    );
  }
  const d = unit.delivery;
  const line = (key: string, text: string, amount: number, muted = false) => (
    <p key={key} className="flex justify-between gap-4 tabular-nums" style={{ maxWidth: "150mm", color: muted ? "#94a3b8" : undefined }}>
      <span>{text}</span>
      <span>{formatSatang(amount)}</span>
    </p>
  );
  return (
    <tr data-paper-unit="">
      <td colSpan={COLUMNS.length} style={detail}>
        <p className="font-semibold tabular-nums">{`${unit.title} · ${d.invoiceRef || "—"} · ${formatDisplayDate(d.saleDate)} · ยอดขาย ${formatSatang(d.salesSatang)}`}</p>
        {d.costMissing && <p style={{ color: GREY }}>ยังไม่กรอกต้นทุน — ครั้งนี้ยังไม่นับ</p>}
        {d.items.map((i, k) => line(`i${k}`, `ต้นทุนสินค้า: ${i.productName} × ${i.qty}`, i.costSatang))}
        {d.costs.map((c, k) =>
          line(`c${k}`, `${c.typeLabel}${c.label ? `: ${c.label}` : ""}${c.note ? ` (${c.note})` : ""}${c.counted ? "" : " — ไม่นำมาหัก"}`, c.amountSatang, !c.counted)
        )}
      </td>
    </tr>
  );
}

/** The totals, the rates used, the notes, where to sign — kept together on the last page. */
function Tail({ report, summary }: { report: PayoutReport; summary: PayoutSummary }) {
  const total: CSSProperties = { ...RIGHT, fontWeight: 700 };
  return (
    <div data-paper-tail="" style={{ paddingTop: "1mm" }}>
      <table style={TABLE}>
        <Cols />
        <tbody>
          <tr style={{ borderTop: `2px solid ${NAVY}`, borderBottom: `1px solid ${LINE}` }}>
            <td colSpan={3} style={{ ...CELL, fontWeight: 700 }}>{`รวม ${summary.count} รายการ`}</td>
            <td style={total}>{formatSatang(summary.profitSatang)}</td>
            <td style={total}>{formatSatang(summary.ford.totalSatang)}</td>
            <td style={total}>{formatSatang(summary.tor.totalSatang)}</td>
            <td style={{ ...total, color: GREY }}>{formatSatang(summary.companySatang)}</td>
          </tr>
        </tbody>
      </table>

      {report.rateSets.length > 0 && (
        <div className="text-[9px]" style={{ marginTop: "4mm", border: `1px solid ${LINE}`, borderRadius: "2mm", padding: "2.5mm 3mm", color: "#334155" }}>
          <p className="text-[10px] font-semibold" style={{ color: NAVY }}>อัตราที่ใช้คิด</p>
          {report.rateSets.map((set) => {
            const l = rateSetLines(set);
            return (
              <div key={set.id ?? "first"} style={{ marginTop: "1.2mm" }}>
                <p className="font-semibold">{`ตารางอัตรา ${l.title}`}</p>
                <p>ลูกค้าฟอร์ด — ขั้นบันไดตามกำไรสะสมของเดือน (ตามวันที่ PO):</p>
                {l.ladder.map((text) => (
                  <p key={text} style={{ paddingLeft: "3mm" }}>{text}</p>
                ))}
                <p>{`ลูกค้าพี่ต่อ: ${l.tor}`}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[8.5px] space-y-0.5" style={{ marginTop: "3mm", color: GREY }}>
        <p>ยอดค่าคอมคือยอดที่ล็อกไว้ตอนกดบันทึกจ่าย · กำไร = ยอดขายไม่รวม VAT หักต้นทุน (ค่าคอมมิชชั่นที่ลงเป็นต้นทุนไม่นำมาหัก) · เป็นยอดก่อนหักภาษีใดๆ</p>
        {report.changedSince > 0 && <p>{`* มี ${report.changedSince} รายการที่ข้อมูลเปลี่ยนหลังบันทึกจ่าย (ยอดหรือสถานะ) — ดูส่วนต่างได้ที่หน้าสรุปรายเดือน`}</p>}
        {report.costs && <p>รายละเอียดต้นทุนเป็นข้อมูล ณ วันที่ส่งออก อาจต่างจากตอนบันทึกจ่าย</p>}
      </div>

      <div className="grid grid-cols-3 gap-6 text-center text-[10px]" style={{ marginTop: "12mm", color: "#334155" }}>
        {["ผู้จ่าย", "ผู้รับ (ฟอร์ด)", "ผู้รับ (พี่ต่อ)"].map((role) => (
          <div key={role}>
            <div style={{ borderBottom: "1px dotted #94a3b8", height: "10mm" }} />
            <p style={{ marginTop: "1mm" }}>{role}</p>
            <p className="text-[8.5px]">วันที่ ......../......../........</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer({ report, page, pages }: { report: PayoutReport; page: number; pages: number }) {
  return (
    <div className="flex justify-between gap-4 text-[8.5px]" style={{ position: "absolute", left: `${PAD_X}mm`, right: `${PAD_X}mm`, bottom: "7mm", color: GREY, borderTop: `1px solid ${LINE}`, paddingTop: "1.5mm" }}>
      <span>{`สรุปการจ่ายค่าคอมมิชชั่น · วันที่จ่าย ${payoutRangeLabel(report.from, report.to)}`}</span>
      <span>{`หน้า ${page}/${pages} · ส่งออกโดย ${report.exportedBy} · ${formatDisplayDateTime(report.exportedAt)}`}</span>
    </div>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <table style={TABLE}>
      <Cols />
      <TableHead />
      <tbody>{children}</tbody>
    </table>
  );
}

/** The pages as they go into the PDF — each A4, painted one by one. */
export function PayoutPaperPages({ report, units, pages }: { report: PayoutReport; units: PaperUnit[]; pages: PaperPage[] }) {
  const summary = payoutSummary(report.rows);
  return (
    <>
      {pages.map((p, i) => (
        <div
          key={i}
          data-paper-page=""
          data-testid={`paper-page-${i + 1}`}
          className={PAPER_TEXT}
          style={{ width: "210mm", height: "297mm", padding: `${PAD_TOP}mm ${PAD_X}mm 0`, boxSizing: "border-box", position: "relative", overflow: "hidden", background: "#ffffff", color: NAVY }}
        >
          {i === 0 ? <FirstHeader report={report} summary={summary} /> : <NextHeader report={report} />}
          <Table>
            {p.units.map((k) => (
              <UnitRow key={k} unit={units[k]} />
            ))}
          </Table>
          {p.tail && <Tail report={report} summary={summary} />}
          <Footer report={report} page={i + 1} pages={pages.length} />
        </div>
      ))}
    </>
  );
}

/** Every part drawn once, at the paper's width, to be measured. */
function PaperMeasure({ report, units, ref }: { report: PayoutReport; units: PaperUnit[]; ref: Ref<HTMLDivElement> }) {
  const summary = payoutSummary(report.rows);
  return (
    <div ref={ref} className={PAPER_TEXT} style={{ width: "210mm", padding: `0 ${PAD_X}mm`, boxSizing: "border-box", background: "#ffffff", color: NAVY }}>
      <FirstHeader report={report} summary={summary} />
      <NextHeader report={report} />
      <Table>
        {units.map((u, k) => (
          <UnitRow key={k} unit={u} />
        ))}
      </Table>
      <Tail report={report} summary={summary} />
    </div>
  );
}

/** Fonts loaded, the logo decoded, one turn of the browser — what is measured or painted is what shows. */
async function whenDrawn(root: HTMLElement): Promise<void> {
  const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
  if (fonts?.ready) await fonts.ready;
  const images = Array.from(root.querySelectorAll("img")).filter((img) => typeof img.decode === "function");
  await Promise.all(images.map((img) => Promise.race([img.decode().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5000))])));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function measurePages(root: HTMLElement, units: PaperUnit[]): PaperPage[] {
  const height = (selector: string) => root.querySelector(selector)?.getBoundingClientRect().height ?? 0;
  const mm = root.getBoundingClientRect().width / 210;
  const room = (297 - PAD_TOP - FOOTER_ZONE) * mm - height("[data-paper-thead]") - 2 * mm;
  const heights = Array.from(root.querySelectorAll("tr[data-paper-unit]")).map((el) => el.getBoundingClientRect().height);
  return paginatePaper(
    units.map((u, i) => ({ height: heights[i] ?? 0, keepWithNext: u.keepWithNext })),
    room - height("[data-paper-first-header]"),
    room - height("[data-paper-next-header]"),
    height("[data-paper-tail]")
  );
}

/**
 * Makes the PDF and saves it — mounted for one export, off-screen (in <body>,
 * so nothing on the page clips it). `onFinish` says the file's name, or what
 * went wrong.
 */
export function PayoutPdfMaker({ report, onFinish }: { report: PayoutReport; onFinish: (result: { file: string } | { error: string }) => void }) {
  const units = useMemo(() => paperUnits(report), [report]);
  const measureRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PaperPage[] | null>(null);
  const finish = useRef(onFinish);
  useEffect(() => {
    finish.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    let live = true;
    (async () => {
      const root = measureRef.current;
      if (!root) return;
      await whenDrawn(root);
      if (live) setPages(measurePages(root, units));
    })().catch(() => {
      if (live) finish.current({ error: PDF_FAILED });
    });
    return () => {
      live = false;
    };
  }, [units]);

  useEffect(() => {
    if (!pages) return;
    let live = true;
    (async () => {
      const root = pagesRef.current;
      if (!root) return;
      await whenDrawn(root);
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const sheets = Array.from(root.querySelectorAll<HTMLElement>("[data-paper-page]"));
      for (let i = 0; i < sheets.length; i++) {
        const canvas = await html2canvas(sheets[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
        if (!live) return;
        if (i > 0) doc.addPage();
        doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
      }
      const file = payoutPdfFilename(report.from, report.to);
      doc.save(file);
      finish.current({ file });
    })().catch(() => {
      if (live) finish.current({ error: PDF_FAILED });
    });
    return () => {
      live = false;
    };
  }, [pages, report]);

  return createPortal(
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: 0, pointerEvents: "none" }}>
      {pages ? (
        <div ref={pagesRef}>
          <PayoutPaperPages report={report} units={units} pages={pages} />
        </div>
      ) : (
        <PaperMeasure ref={measureRef} report={report} units={units} />
      )}
    </div>,
    document.body
  );
}
