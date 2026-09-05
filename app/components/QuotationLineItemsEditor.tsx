"use client";

/**
 * QuotationLineItemsEditor — the multi-select line editor of the sale form
 * (tasks 12.1-12.11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS COMPONENT IS
 * ─────────────────────────────────────────────────────────────────────────────
 * A quotation may quote 3 units of A and 1 of B; the customer may buy 2 of A
 * today and come back for the rest next month. So every quotation line becomes
 * a tickable row with its own sold quantity, unit price, product link, cost —
 * and, expanded underneath it, ONE ROW PER MACHINE carrying that machine's own
 * serial number and warranty dates (a mixed bill is the normal case, not the
 * exception).
 *
 * It is a CONTROLLED component: it owns no line state at all. `lines` in,
 * `onLinesChange` out, and every transformation goes through the pure helpers
 * in `app/lib/quotationToSale.ts` (`setLineQty`, `applyProductSelection`,
 * `copyWarrantyToAllMachines`, `buildSalePayload`, …). Nothing here duplicates
 * that logic — if a rule feels missing, it belongs in that module, next to its
 * tests, not in this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO DECIDES WHAT (the split with the parent)
 * ─────────────────────────────────────────────────────────────────────────────
 * The parent (the sale form) owns: the quotation fetch, the confirm dialogs,
 * the serial-check request and the save button. This component owns: the
 * rendering, the per-field edits, and TELLING THE PARENT what it found.
 *
 * Everything in Phase 2 is warn-and-allow-with-confirmation, so this component
 * BLOCKS NOTHING. It reports upward through `onReport` and lets the parent
 * decide; the only hard rules it surfaces are the pre-existing ones collected
 * by `validateLineDrafts` (at least one line, whole positive qty, a serial on
 * every machine, the per-bill machine cap).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 * lines                    The drafts, straight from `buildLineDrafts(...)`.
 *                          Render order === `รายการที่ N` numbering === the
 *                          `lineIndex` in every location this component
 *                          reports, so a warning always points at a card the
 *                          admin can see.
 * onLinesChange(next)      Called with a NEW array on every edit. The helpers
 *                          never mutate, so `setLines(next)` is safe.
 * products                 The catalog (`GET /api/products`). Drives the
 *                          "สินค้าในระบบ" dropdown and, through
 *                          `applyProductSelection`, the categoryId. A product
 *                          that no longer exists in this list still renders,
 *                          via a synthetic option (the trick from
 *                          `app/customers/EquipmentTab.tsx`), so a stale link
 *                          is visible instead of silently blank.
 * warrantyTerms            `data.warrantyTerms` of the quotation. Shown beside
 *                          the warranty inputs as a READ-ONLY reference
 *                          (task 12.9) — never saved onto the sale, never used
 *                          to compute an end date. Falsy → the box disappears.
 * quotationRef             docNo of the source quotation, for the header only.
 * submitAttempted          Flip to true when the admin presses save. Turns the
 *                          "serial ยังว่าง" hints from amber advice into red
 *                          errors on the exact inputs. Purely cosmetic.
 * disabled                 Disables every control (use while saving).
 * onRequestSelectSoldLine  Called INSTEAD of ticking when the admin ticks a
 *                          line that was already sold (task 13.3). The parent
 *                          shows its confirm dialog and, on confirm, ticks the
 *                          line itself. Omit the prop and the tick happens
 *                          immediately — this component never blocks it.
 * onReport(report)         Fired after every change with the full picture:
 *                          blocking errors, missing serials, in-form duplicate
 *                          serials, over-quoted lines, re-sold lines, the bill
 *                          summary and the serial list for
 *                          `GET /api/admin/equipments/serial-check`. The parent
 *                          keeps the latest report and consults it on save.
 *                          Duplicates are a WARNING here and must stay one.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef } from "react";
import SearchableDropdown from "./SearchableDropdown";
import type { SearchableDropdownOption } from "./SearchableDropdown";
import { stripHtml } from "../lib/stripHtml";
import {
  CUSTOM_PRODUCT_SENTINEL,
  applyProductSelection,
  collectSerials,
  copyWarrantyToAllMachines,
  findDuplicateSerialsInForm,
  findMissingSerials,
  findOverQuotedLines,
  findResoldLines,
  normalizeSerial,
  setLineQty,
  summarizeBill,
  validateLineDrafts,
} from "../lib/quotationToSale";
import type {
  BillSummary,
  CatalogProduct,
  DuplicateSerialGroup,
  MachineDraft,
  SaleLineDraft,
  SerialLocation,
} from "../lib/quotationToSale";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The catalog rows this editor renders. Structurally satisfied by `Product`
 * in `app/dashboard/types.ts` — the titles are only ever used as labels. */
export interface CatalogProductOption extends CatalogProduct {
  title_th?: string | null;
  title_en?: string | null;
}

/** Everything the parent needs to decide what to do on save. Recomputed from
 * the drafts on every change; never cached across renders. */
export interface LineEditorReport {
  /** Hard blockers only (`validateLineDrafts`) — Thai, ready to display. */
  errors: string[];
  /** Machines with no serial yet, located to the exact line + machine. */
  missingSerials: SerialLocation[];
  /** Serials colliding WITHIN this form (task 13.5). A warning, not a block. */
  duplicateSerials: DuplicateSerialGroup[];
  /** Ticked lines selling more than the quotation offered (task 12.2). */
  overQuotedLines: SaleLineDraft[];
  /** Ticked lines that already have a recorded sale (task 13.3). */
  resoldLines: SaleLineDraft[];
  /** The same reduction the on-screen summary shows (task 12.10). */
  summary: BillSummary;
  /** Non-empty serials of the ticked lines, for the serial-check request. */
  serials: string[];
  /** `errors.length === 0`. The parent still owns the save decision. */
  canSave: boolean;
}

export interface QuotationLineItemsEditorProps {
  lines: readonly SaleLineDraft[];
  onLinesChange: (next: SaleLineDraft[]) => void;
  products?: readonly CatalogProductOption[] | null;
  warrantyTerms?: string | null;
  quotationRef?: string | null;
  submitAttempted?: boolean;
  disabled?: boolean;
  onRequestSelectSoldLine?: (index: number, line: SaleLineDraft) => void;
  onReport?: (report: LineEditorReport) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Local formatting helpers (kept local so this component never imports the
// dashboard's page-level module)
// ---------------------------------------------------------------------------

const fmtBaht = (n: number): string =>
  Number(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtInt = (n: number): string => Number(n || 0).toLocaleString("th-TH");

/** How many precise locations to spell out before collapsing into a count —
 * a 50-machine bill must not bury the summary under 50 bullet points. */
const MAX_LISTED_LOCATIONS = 6;

const inputBase =
  "w-full px-3 py-2 border rounded-lg text-sm outline-none transition-all focus:ring-2 disabled:bg-gray-100 disabled:text-gray-400";
const inputNeutral = "border-gray-200 bg-white focus:ring-indigo-200 focus:border-indigo-400";
const inputDanger =
  "border-red-500 bg-red-50 focus:ring-red-200 focus:border-red-500 error-border";
const inputWarn = "border-amber-400 bg-amber-50 focus:ring-amber-200 focus:border-amber-400";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

/** `รายการที่ 3 (ชื่อสินค้า) เครื่องที่ 2` — the one phrasing every warning in
 * this component uses, so the admin reads the same coordinates everywhere. */
function describeLocation(where: SerialLocation): string {
  const at = `รายการที่ ${where.lineIndex + 1}`;
  const named = where.productName ? `${at} (${where.productName})` : at;
  return `${named} เครื่องที่ ${where.machineIndex + 1}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuotationLineItemsEditor({
  lines,
  onLinesChange,
  products,
  warrantyTerms,
  quotationRef,
  submitAttempted = false,
  disabled = false,
  onRequestSelectSoldLine,
  onReport,
  className = "",
}: QuotationLineItemsEditorProps) {
  const uid = useId();
  // The annotation is load-bearing: `Array.isArray` on a `readonly T[]` narrows
  // to `any[]` (same trap `quotationToSale.ts` calls out), which would quietly
  // turn every `.map()` callback below into `any`.
  const rows = useMemo<readonly SaleLineDraft[]>(
    () => (Array.isArray(lines) ? lines : []),
    [lines]
  );

  // ── Derived state ────────────────────────────────────────────────────────
  // Every warning on screen and every warning handed to the parent comes from
  // this one memo, so the two can never disagree.
  const report = useMemo<LineEditorReport>(() => {
    const errors = validateLineDrafts(rows);
    return {
      errors,
      missingSerials: findMissingSerials(rows),
      duplicateSerials: findDuplicateSerialsInForm(rows),
      overQuotedLines: findOverQuotedLines(rows),
      resoldLines: findResoldLines(rows),
      summary: summarizeBill(rows),
      serials: collectSerials(rows),
      canSave: errors.length === 0,
    };
  }, [rows]);

  const onReportRef = useRef(onReport);
  useEffect(() => {
    onReportRef.current = onReport;
  }, [onReport]);
  // Declared after the ref sync above, so it always calls the current callback.
  useEffect(() => {
    onReportRef.current?.(report);
  }, [report]);

  /** Normalized serials that appear more than once in this form — used to tint
   * the offending inputs amber (never red: a duplicate is confirmable). */
  const duplicateKeys = useMemo(
    () => new Set(report.duplicateSerials.map((g) => g.normalized)),
    [report.duplicateSerials]
  );

  // ── Edit plumbing ────────────────────────────────────────────────────────
  // One funnel: take the line at `index`, run it through a pure transform,
  // hand a brand-new array upward. No in-place mutation anywhere.
  const updateLine = useCallback(
    (index: number, transform: (line: SaleLineDraft) => SaleLineDraft) => {
      onLinesChange(rows.map((line, i) => (i === index ? transform(line) : line)));
    },
    [rows, onLinesChange]
  );

  const updateMachine = useCallback(
    (index: number, machineIndex: number, patch: Partial<MachineDraft>) => {
      updateLine(index, (line) => ({
        ...line,
        machines: line.machines.map((m, i) => (i === machineIndex ? { ...m, ...patch } : m)),
      }));
    },
    [updateLine]
  );

  const toggleLine = useCallback(
    (index: number) => {
      const line = rows[index];
      if (!line) return;
      // Ticking a line that was already sold is legitimate (the customer came
      // back for the remaining machine) but the parent has to confirm it first.
      if (!line.selected && line.soldQty > 0 && onRequestSelectSoldLine) {
        onRequestSelectSoldLine(index, line);
        return;
      }
      updateLine(index, (l) => ({ ...l, selected: !l.selected }));
    },
    [rows, updateLine, onRequestSelectSoldLine]
  );

  const handleQtyChange = useCallback(
    (index: number, raw: string) => {
      const parsed = raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
      updateLine(index, (line) =>
        // Below 1 is an invalid, transient state (the field is mid-retype, or
        // the admin really did type 0 — `validateLineDrafts` says so in Thai).
        // Resizing to 0 machines there would delete serials that have already
        // been typed, so the machine rows are left alone until the quantity is
        // valid again.
        parsed >= 1 ? setLineQty(line, parsed) : { ...line, qty: parsed }
      );
    },
    [updateLine]
  );

  const handleMoneyChange = useCallback(
    (index: number, field: "unitPrice" | "costAmount", raw: string) => {
      const cleaned = raw.replace(/,/g, "").trim();
      const parsed = cleaned === "" ? 0 : Number(cleaned);
      updateLine(index, (line) => ({
        ...line,
        [field]: Number.isFinite(parsed) ? parsed : line[field],
      }));
    },
    [updateLine]
  );

  // ── Product dropdown options ─────────────────────────────────────────────
  const baseProductOptions = useMemo<SearchableDropdownOption[]>(() => {
    const list = Array.isArray(products) ? products : [];
    return [
      { value: CUSTOM_PRODUCT_SENTINEL, label: "ไม่ผูกสินค้าในระบบ (ใช้ชื่อที่พิมพ์เอง)" },
      ...list.map((p) => ({
        value: String(p.id),
        label: stripHtml(String(p.title_th ?? "")) || String(p.id),
        subLabel: stripHtml(String(p.title_en ?? "")) || undefined,
      })),
    ];
  }, [products]);

  /**
   * A line may point at a product that is no longer in the catalog (deleted, or
   * simply not loaded yet). SearchableDropdown shows its placeholder for a
   * value it has no option for, which would read as "ไม่ได้ผูกสินค้า" and hide
   * the stale link entirely. Prepending a synthetic option keeps it visible and
   * labelled — same trick as `app/customers/EquipmentTab.tsx` (~line 279).
   */
  const optionsForLine = useCallback(
    (line: SaleLineDraft): SearchableDropdownOption[] => {
      const id = line.productId;
      if (!id || id === CUSTOM_PRODUCT_SENTINEL) return baseProductOptions;
      if (baseProductOptions.some((o) => o.value === id)) return baseProductOptions;
      return [
        {
          value: id,
          label: stripHtml(line.productName) || "(สินค้าเดิมจากใบเสนอราคา)",
          subLabel: "ไม่พบในรายการสินค้าปัจจุบัน",
        },
        ...baseProductOptions,
      ];
    },
    [baseProductOptions]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const { summary } = report;
  const grossProfit = summary.totalAmount - summary.costAmount;
  const terms = String(warrantyTerms ?? "").trim();
  const missingCount = report.missingSerials.length;

  if (rows.length === 0) {
    return (
      <div
        className={`p-5 bg-gray-50 border border-dashed border-gray-200 rounded-2xl text-sm text-gray-500 ${className}`}
      >
        ใบเสนอราคานี้ไม่มีรายการสินค้า — กรอกรายละเอียดการขายด้านล่างเองได้ตามปกติ
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-gray-800">
            รายการสินค้าจากใบเสนอราคา
            {quotationRef ? <span className="text-gray-400 font-medium"> · {quotationRef}</span> : null}
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            ติ๊กเฉพาะรายการที่ลูกค้าซื้อจริง แล้วกรอก serial ให้ครบทุกเครื่อง
          </p>
        </div>
        <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
          เลือกแล้ว {fmtInt(summary.lineCount)}/{fmtInt(rows.length)} รายการ
        </span>
      </div>

      {/* ── Line cards ─────────────────────────────────────────────────── */}
      {rows.map((line, index) => {
        const alreadySold = line.soldQty > 0;
        const overQuoted = line.selected && line.qty > line.quotedQty;
        const lineTotal = Math.max(0, line.qty) * (Number(line.unitPrice) || 0);
        const linkedToCatalog = !!line.productId && line.productId !== CUSTOM_PRODUCT_SENTINEL;

        return (
          <div
            key={line.key}
            className={`rounded-2xl border transition-all ${
              line.selected
                ? "border-indigo-200 bg-indigo-50/30 shadow-sm"
                : "border-gray-200 bg-white"
            }`}
          >
            {/* Checkbox row — task 12.1: name, quoted qty, unit price */}
            <label className="flex items-start gap-3 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={line.selected}
                disabled={disabled}
                onChange={() => toggleLine(index)}
                className="mt-0.5 w-4 h-4 shrink-0 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-gray-400">#{index + 1}</span>
                  <span className="text-sm font-semibold text-gray-800 wrap-break-word">
                    {line.productName || "(ไม่ระบุชื่อสินค้า)"}
                  </span>
                  {alreadySold && (
                    <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      ขายแล้ว {fmtInt(line.soldQty)}
                    </span>
                  )}
                  {line.productMissing && (
                    <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                      สินค้าถูกลบจาก catalog
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ในใบเสนอราคา: {fmtInt(line.quotedQty)} {line.unit || "หน่วย"} · ราคา/หน่วย ฿
                  {fmtBaht(line.unitPrice)}
                </div>
                {alreadySold && !line.selected && (
                  <div className="text-xs text-amber-700 mt-1">
                    รายการนี้เคยบันทึกขายไปแล้ว จึงไม่ถูกติ๊กให้อัตโนมัติ — ติ๊กเองได้ถ้าลูกค้ามาซื้อเครื่องที่เหลือ
                  </div>
                )}
              </div>
            </label>

            {/* Expanded editor — only for a ticked line */}
            {line.selected && (
              <div className="px-4 pb-4 space-y-4 border-t border-indigo-100 pt-4">
                {/* Qty / price / cost / line total */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className={labelCls} htmlFor={`${uid}-qty-${line.key}`}>
                      จำนวนที่ขายจริง <span className="text-red-500">*</span>
                    </label>
                    <input
                      id={`${uid}-qty-${line.key}`}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      disabled={disabled}
                      value={line.qty > 0 ? String(line.qty) : ""}
                      onChange={(e) => handleQtyChange(index, e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="1"
                      className={`${inputBase} ${
                        line.qty < 1 ? inputDanger : overQuoted ? inputWarn : inputNeutral
                      }`}
                    />
                    {line.qty < 1 ? (
                      <p className="text-[11px] text-red-600 mt-1">
                        จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป
                      </p>
                    ) : overQuoted ? (
                      // Task 12.2 — warn, never block.
                      <p className="text-[11px] text-amber-700 mt-1">
                        มากกว่าจำนวนในใบเสนอราคา ({fmtInt(line.quotedQty)}) — บันทึกได้ แต่โปรดตรวจสอบ
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label className={labelCls} htmlFor={`${uid}-price-${line.key}`}>
                      ราคาต่อหน่วย (฿) <span className="text-red-500">*</span>
                    </label>
                    <input
                      id={`${uid}-price-${line.key}`}
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      disabled={disabled}
                      value={Number.isFinite(line.unitPrice) ? String(line.unitPrice) : ""}
                      onChange={(e) => handleMoneyChange(index, "unitPrice", e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className={`${inputBase} text-right font-medium ${
                        line.unitPrice < 0 ? inputDanger : inputNeutral
                      }`}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">คัดลอกจากใบเสนอราคา แก้ได้</p>
                  </div>

                  <div>
                    <label className={labelCls} htmlFor={`${uid}-cost-${line.key}`}>
                      ต้นทุนสินค้า (฿)
                    </label>
                    <input
                      id={`${uid}-cost-${line.key}`}
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      disabled={disabled}
                      value={Number.isFinite(line.costAmount) ? String(line.costAmount) : ""}
                      onChange={(e) => handleMoneyChange(index, "costAmount", e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className={`${inputBase} text-right font-medium ${
                        line.costAmount < 0 ? inputDanger : inputNeutral
                      }`}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">ต้นทุนรวมของทั้งบรรทัด</p>
                  </div>

                  <div>
                    <span className={labelCls}>ยอดรวมบรรทัด (฿)</span>
                    <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-right font-bold text-gray-800 bg-gray-50">
                      {fmtBaht(lineTotal)}
                    </div>
                  </div>
                </div>

                {/* Task 12.3 — the quote-level discount is never prorated. */}
                <p className="text-[11px] text-gray-500 -mt-1">
                  ราคาต่อหน่วยถูกคัดลอกจากใบเสนอราคาตรงตัว (ก่อนหักส่วนลดและก่อน VAT) —
                  ระบบไม่เฉลี่ยส่วนลดระดับใบให้อัตโนมัติ ถ้าดีลจริงลดราคา กรุณาแก้ตัวเลขเอง
                </p>

                {/* Task 12.4 / 12.5 — catalog link, and the category that follows it */}
                <div>
                  <label className={labelCls}>สินค้าในระบบ</label>
                  <SearchableDropdown
                    options={optionsForLine(line)}
                    value={line.productId}
                    onChange={(value) =>
                      updateLine(index, (l) => applyProductSelection(l, value, products))
                    }
                    placeholder="เลือกสินค้าในระบบ..."
                    buttonClassName={`py-2 ${
                      line.productMissing ? "border-red-300 bg-red-50" : "border-gray-200"
                    }`}
                  />
                  {line.productMissing ? (
                    <p className="text-[11px] text-red-600 mt-1">
                      สินค้าที่ใบเสนอราคาอ้างอิงถูกลบออกจาก catalog แล้ว ระบบจึงไม่ผูก id เดิมให้ —
                      ชื่อสินค้ายังใช้ได้ กรุณาเลือกสินค้าใหม่ หรือปล่อยไม่ผูกก็บันทึกได้
                    </p>
                  ) : linkedToCatalog ? (
                    <p className="text-[11px] text-gray-500 mt-1">
                      {line.categoryId
                        ? "หมวดหมู่ถูกดึงจากสินค้าที่ผูกโดยอัตโนมัติ"
                        : "สินค้าที่ผูกยังไม่มีหมวดหมู่ในระบบ — รายการนี้จะถูกนับเป็น «ไม่ระบุหมวด»"}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-500 mt-1">
                      ไม่ผูกสินค้าในระบบ รายการนี้จะถูกนับเป็น «ไม่ระบุสินค้า» /
                      «ไม่ระบุหมวด» ในรายงานสินค้าขายดีและรายได้ตามหมวดหมู่ (ยังบันทึกได้)
                    </p>
                  )}
                </div>

                {/* Tasks 12.7-12.9 — one row per machine */}
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-gray-700">
                      ข้อมูลรายเครื่อง ({fmtInt(line.machines.length)} เครื่อง)
                    </span>
                    {line.machines.length > 1 && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          updateLine(index, (l) => ({
                            ...l,
                            machines: copyWarrantyToAllMachines(l.machines),
                          }))
                        }
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                      >
                        คัดลอกวันประกันไปทุกเครื่อง
                      </button>
                    )}
                  </div>

                  {/* Task 12.9 — read-only reference, never saved on the sale */}
                  {terms && (
                    <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                      <div className="text-[11px] font-bold text-amber-800">
                        เงื่อนไขประกันจากใบเสนอราคา (อ้างอิงเท่านั้น)
                      </div>
                      <div className="text-xs text-amber-900 whitespace-pre-wrap wrap-break-word mt-0.5">
                        {terms}
                      </div>
                      <div className="text-[11px] text-amber-700 mt-1">
                        ข้อความนี้ไม่ถูกบันทึกลงข้อมูลเครื่อง และระบบไม่คำนวณวันหมดประกันให้อัตโนมัติ
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {line.machines.map((machine, machineIndex) => {
                      const blank = !machine.serialNumber.trim();
                      const duplicated =
                        !blank && duplicateKeys.has(normalizeSerial(machine.serialNumber));
                      return (
                        <div
                          key={machineIndex}
                          className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                        >
                          <div className="sm:col-span-5 flex items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-md shrink-0">
                              #{machineIndex + 1}
                            </span>
                            <input
                              type="text"
                              disabled={disabled}
                              value={machine.serialNumber}
                              onChange={(e) =>
                                updateMachine(index, machineIndex, {
                                  serialNumber: e.target.value,
                                })
                              }
                              placeholder="Serial Number *"
                              aria-label={`Serial Number รายการที่ ${index + 1} เครื่องที่ ${machineIndex + 1}`}
                              className={`${inputBase} ${
                                blank && submitAttempted
                                  ? inputDanger
                                  : duplicated
                                    ? inputWarn
                                    : inputNeutral
                              }`}
                            />
                          </div>
                          {/* Native date inputs: the warranty pair repeats per
                              machine, and a popup calendar × N rows inside a
                              scrollable modal is exactly the clipping problem
                              SearchableDropdown had to portal around. These
                              also hand back the yyyy-mm-dd the payload wants. */}
                          <div className="sm:col-span-3">
                            <input
                              type="date"
                              disabled={disabled}
                              value={machine.warrantyStartDate}
                              onChange={(e) =>
                                updateMachine(index, machineIndex, {
                                  warrantyStartDate: e.target.value,
                                })
                              }
                              aria-label={`วันเริ่มประกัน เครื่องที่ ${machineIndex + 1}`}
                              className={`${inputBase} ${inputNeutral}`}
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <input
                              type="date"
                              disabled={disabled}
                              value={machine.warrantyEndDate}
                              onChange={(e) =>
                                updateMachine(index, machineIndex, {
                                  warrantyEndDate: e.target.value,
                                })
                              }
                              aria-label={`วันหมดประกัน เครื่องที่ ${machineIndex + 1}`}
                              className={`${inputBase} ${inputNeutral}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    ช่องซ้ายคือ Serial Number (บังคับ) ตามด้วยวันเริ่มประกันและวันหมดประกันของเครื่องนั้น —
                    แต่ละเครื่องกำหนดคนละวันได้
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Task 12.11: exactly which line and which machine is still blank ── */}
      {missingCount > 0 && (
        <div
          className={`rounded-xl border px-4 py-3 ${
            submitAttempted
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <div className="text-xs font-bold">
            ยังไม่ได้กรอก Serial Number {fmtInt(missingCount)} เครื่อง
            {submitAttempted ? " — บันทึกไม่ได้จนกว่าจะกรอกครบ" : " (ต้องกรอกครบก่อนบันทึก)"}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs list-disc list-inside">
            {report.missingSerials.slice(0, MAX_LISTED_LOCATIONS).map((where) => (
              <li key={`${where.lineIndex}-${where.machineIndex}`}>{describeLocation(where)}</li>
            ))}
            {missingCount > MAX_LISTED_LOCATIONS && (
              <li>และอีก {fmtInt(missingCount - MAX_LISTED_LOCATIONS)} เครื่อง</li>
            )}
          </ul>
        </div>
      )}

      {/* ── In-form duplicate serials: reported upward, never blocking here ── */}
      {report.duplicateSerials.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          <div className="text-xs font-bold">
            มี Serial Number ซ้ำกันภายในฟอร์มนี้ {fmtInt(report.duplicateSerials.length)} หมายเลข
          </div>
          <ul className="mt-1 space-y-0.5 text-xs list-disc list-inside">
            {report.duplicateSerials.map((group) => (
              <li key={group.normalized}>
                «{group.serialNumber}» ซ้ำที่{" "}
                {group.occurrences.map((where) => describeLocation(where)).join(" และ ")}
              </li>
            ))}
          </ul>
          <div className="text-[11px] mt-1">
            ระบบยังบันทึกให้ได้เมื่อยืนยัน — ตรวจสอบก่อนว่าไม่ได้พิมพ์ซ้ำโดยไม่ตั้งใจ
          </div>
        </div>
      )}

      {/* ── Other blocking errors (qty/price/cost/machine cap) ─────────────── */}
      {submitAttempted && report.errors.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          <div className="text-xs font-bold">แก้ไขรายการต่อไปนี้ก่อนบันทึก</div>
          <ul className="mt-1 space-y-0.5 text-xs list-disc list-inside">
            {report.errors.slice(0, MAX_LISTED_LOCATIONS + 4).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Task 12.10: the running bill summary ───────────────────────────── */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
        <div className="text-xs font-bold text-indigo-900 mb-2">สรุปยอดบิลนี้</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div>
            <div className="text-[11px] text-gray-500">รายการที่เลือก</div>
            <div className="font-bold text-gray-800">{fmtInt(summary.lineCount)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500">จำนวนเครื่องรวม</div>
            <div className="font-bold text-gray-800">{fmtInt(summary.machineCount)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500">ยอดขายรวม (฿)</div>
            <div className="font-bold text-gray-900">{fmtBaht(summary.totalAmount)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500">ต้นทุนสินค้ารวม (฿)</div>
            <div className="font-bold text-gray-900">{fmtBaht(summary.costAmount)}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500">กำไรขั้นต้น (฿)</div>
            <div className={`font-bold ${grossProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {fmtBaht(grossProfit)}
            </div>
          </div>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          ยอดนี้คิดจากราคาต่อหน่วย × จำนวนที่ขายจริงของทุกรายการที่ติ๊กไว้ (ก่อน VAT)
          และยังไม่รวมค่าใช้จ่ายอื่นของใบขาย
        </div>
      </div>
    </div>
  );
}
