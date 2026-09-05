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
 * serial number, warranty TYPE and warranty dates (a mixed bill is the normal
 * case, not the exception). The warranty type is the one field of that row that
 * is OPTIONAL: it is absent from `validateLineDrafts`, has no red state, and an
 * unset one saves exactly like a filled one.
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
 * decide; the only hard rules it surfaces are the REQUIRED FIELDS collected by
 * `validateLineDrafts` (at least one line, whole positive qty, a serial on
 * every machine, a product cost on every ticked line, the per-bill machine
 * cap).
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
 *                          errors on the exact inputs, and paints red the
 *                          ต้นทุนสินค้า box of every line `findMissingCosts`
 *                          flagged (report 6). Purely cosmetic — the block
 *                          itself is `report.errors`, which the parent owns.
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
import DatePicker from "./DatePicker";
import FormattedNumberInput from "./FormattedNumberInput";
import { stripHtml } from "../lib/stripHtml";
import { toLocalDateString } from "../lib/dateFormat";
import {
  CUSTOM_PRODUCT_SENTINEL,
  WARRANTY_TYPE_OPTIONS,
  WARRANTY_TYPE_OTHER,
  applyProductSelection,
  collectSerials,
  copyWarrantyToAllMachines,
  findDuplicateSerialsInForm,
  findMissingCosts,
  findMissingSerials,
  findOverQuotedLines,
  findResoldLines,
  normalizeSerial,
  setLineQty,
  setMachineWarrantyType,
  setMachineWarrantyTypeText,
  summarizeBill,
  validateLineDrafts,
  warrantyTypeCustomText,
  warrantyTypeSelectValue,
} from "../lib/quotationToSale";
import type {
  BillSummary,
  CatalogProduct,
  DuplicateSerialGroup,
  MachineDraft,
  MissingCostLocation,
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
  /** Ticked lines whose ต้นทุนสินค้า is still 0/blank (report 6). A BLOCKER —
   * `validateLineDrafts` already spells each one out inside `errors`; this list
   * is the located form of the same rule, so the parent can name the line. */
  missingCosts: MissingCostLocation[];
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

/** The serial box sits shoulder-to-shoulder with two `DatePicker`s, which style
 * their own input; these mirror that default (px-4 py-2.5, rounded-xl, gray-50)
 * so the three controls of a machine row line up instead of stair-stepping.
 * Colour and background live in the variants only — same discipline as
 * `inputBase` — so `inputDanger`/`inputWarn` never fight a base utility. */
const machineInputBase =
  "w-full px-4 py-2.5 border rounded-xl text-sm outline-none transition-all focus:ring-2 disabled:bg-gray-100 disabled:text-gray-400";
const machineInputNeutral =
  "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500";

/**
 * `"YYYY-MM-DD"` → the `Date | null` `DatePicker` wants (report 4). Parsed at
 * LOCAL midnight (`T00:00:00`, the shape `isValidDateString` checks), which is
 * exactly what `toLocalDateString` turns back into the same string — so a date
 * that is merely displayed and re-saved can never drift a day. An empty or
 * malformed value becomes `null`, i.e. the picker's own "ไม่ระบุ" state.
 */
function parseDateValue(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
      missingCosts: findMissingCosts(rows),
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

  /** Report 6 — the indexes of the ticked lines `findMissingCosts` flagged, so
   * the ต้นทุนสินค้า input of exactly those lines can be painted red. The rule
   * itself lives in `quotationToSale.ts`; this only consumes its answer. */
  const missingCostLines = useMemo(
    () => new Set(report.missingCosts.map((m) => m.lineIndex)),
    [report.missingCosts]
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

  /** Run ONE machine of ONE line through a pure transform. The ประกัน helpers
   * (`setMachineWarrantyType`, `setMachineWarrantyTypeText`) are whole-draft
   * functions — their whole point is that the three warranty-type states live
   * in a single string — so they plug straight in here instead of being
   * unpicked into a field patch. */
  const transformMachine = useCallback(
    (
      index: number,
      machineIndex: number,
      transform: (machine: MachineDraft) => MachineDraft
    ) => {
      updateLine(index, (line) => ({
        ...line,
        machines: line.machines.map((m, i) => (i === machineIndex ? transform(m) : m)),
      }));
    },
    [updateLine]
  );

  /** The field-patch shorthand, for the serial and the two dates. */
  const updateMachine = useCallback(
    (index: number, machineIndex: number, patch: Partial<MachineDraft>) => {
      transformMachine(index, machineIndex, (m) => ({ ...m, ...patch }));
    },
    [transformMachine]
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

  /** `FormattedNumberInput` (report 2) does the thousands separators and the
   * parsing, and hands back a plain number — so this only has to guard against
   * a non-finite value ever reaching a draft. */
  const handleMoneyChange = useCallback(
    (index: number, field: "unitPrice" | "costAmount", value: number) => {
      updateLine(index, (line) => ({
        ...line,
        [field]: Number.isFinite(value) ? value : line[field],
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
        // Report 6, the visible half. Same timing as the blank-serial hint just
        // below: advice until save is pressed, red on the input afterwards.
        const missingCostFlagged = submitAttempted && missingCostLines.has(index);

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

                  {/* Report 2 — money fields use FormattedNumberInput so 20000
                      reads as 20,000 while it is being typed. It takes neither
                      an `id` nor a `disabled` prop, so the label WRAPS it (the
                      implicit association) and a `fieldset` carries the
                      disabled state down to it while saving. */}
                  <fieldset className="min-w-0" disabled={disabled}>
                    <label className="block">
                      <span className={labelCls}>
                        ราคาต่อหน่วย (฿) <span className="text-red-500">*</span>
                      </span>
                      <FormattedNumberInput
                        value={Number.isFinite(line.unitPrice) ? line.unitPrice : 0}
                        onChange={(value) => handleMoneyChange(index, "unitPrice", value)}
                        placeholder="0"
                        className={`${inputBase} text-right font-medium ${
                          line.unitPrice < 0 ? inputDanger : inputNeutral
                        }`}
                      />
                    </label>
                    <p className="text-[11px] text-gray-400 mt-1">คัดลอกจากใบเสนอราคา แก้ได้</p>
                  </fieldset>

                  <fieldset className="min-w-0" disabled={disabled}>
                    <label className="block">
                      <span className={labelCls}>
                        ต้นทุนสินค้า (฿) <span className="text-red-500">*</span>
                      </span>
                      <FormattedNumberInput
                        value={Number.isFinite(line.costAmount) ? line.costAmount : 0}
                        onChange={(value) => handleMoneyChange(index, "costAmount", value)}
                        placeholder="0"
                        className={`${inputBase} text-right font-medium ${
                          // Report 6 — red on the exact input the validator
                          // flagged, once the admin has actually pressed save
                          // (the field is born at 0, so painting it before then
                          // would greet every fresh form in red).
                          missingCostFlagged || line.costAmount < 0 ? inputDanger : inputNeutral
                        }`}
                      />
                    </label>
                    {missingCostFlagged ? (
                      <p className="text-[11px] text-red-600 mt-1 font-semibold">
                        กรุณาระบุต้นทุนสินค้า — บันทึกไม่ได้จนกว่าจะกรอก
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-400 mt-1">ต้นทุนรวมของทั้งบรรทัด (บังคับ)</p>
                    )}
                  </fieldset>

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
                        {/* The helper copies the TYPE along with the two dates
                            (one intent: "these machines share a warranty"), so
                            the label has to say so — an admin who reads only
                            "วันประกัน" would not expect ประเภทประกัน to move. */}
                        คัดลอกประกัน (ประเภท + วันที่) ไปทุกเครื่อง
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

                  {/* Report 3 + 4 — every field of the row carries its own
                      visible label, and the two warranty fields are the shared
                      `DatePicker` (month + year dropdowns, clearable) rather
                      than the browser's dd/mm/yyyy widget.

                      LAYOUT (owner's ประกันแต่ละเครื่อง request): the row used
                      to be three 4-wide columns of a 12-column grid. A FOURTH
                      control could not join that line — this editor lives in a
                      `max-w-2xl` modal (`app/dashboard/page.tsx` ~1345), so the
                      machine row is only ~560px wide no matter how big the
                      screen is, and 4-across would mean ~130px per control:
                      narrower than the word «ประกันจากซื้อ service contact» and
                      narrower than a date picker.

                      So the grid is now 2×2 instead of 1×4 — serial + ประเภท
                      on the first line, the two dates on the second — which
                      gives every control ~270px, MORE than the ~185px the three
                      old columns had. Below `sm` it still stacks to a single
                      column exactly as before, and `gap-y` goes 2→3 because
                      there are now two visual rows to separate. The อื่นๆ
                      free-text box renders INSIDE the ประเภท cell rather than as
                      a fifth grid item, so it stays visually owned by the
                      dropdown it belongs to and never reflows the dates
                      (`items-start` keeps the sibling cells from stretching). */}
                  <div className="space-y-3">
                    {line.machines.map((machine, machineIndex) => {
                      const blank = !machine.serialNumber.trim();
                      const duplicated =
                        !blank && duplicateKeys.has(normalizeSerial(machine.serialNumber));
                      const serialId = `${uid}-serial-${line.key}-${machineIndex}`;
                      const warrantyTypeId = `${uid}-wtype-${line.key}-${machineIndex}`;
                      const warrantyTextId = `${uid}-wtext-${line.key}-${machineIndex}`;
                      const at = `รายการที่ ${index + 1} เครื่องที่ ${machineIndex + 1}`;
                      // Which of the three options is showing, and what belongs
                      // in the free-text box. Both come from the logic layer:
                      // a legacy/hand-typed value (or text typed under อื่นๆ)
                      // lands on อื่นๆ with the box open and its text intact.
                      const warrantySelect = warrantyTypeSelectValue(machine.warrantyType);
                      const warrantyCustom = warrantySelect === WARRANTY_TYPE_OTHER;
                      return (
                        <div
                          key={machineIndex}
                          className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3 items-start border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                        >
                          <div className="min-w-0">
                            <label className={labelCls} htmlFor={serialId}>
                              <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md mr-1.5">
                                #{machineIndex + 1}
                              </span>
                              Serial Number <span className="text-red-500">*</span>
                            </label>
                            <input
                              id={serialId}
                              type="text"
                              disabled={disabled}
                              value={machine.serialNumber}
                              onChange={(e) =>
                                updateMachine(index, machineIndex, {
                                  serialNumber: e.target.value,
                                })
                              }
                              placeholder="Serial Number *"
                              aria-label={`Serial Number ${at}`}
                              className={`${machineInputBase} ${
                                blank && submitAttempted
                                  ? inputDanger
                                  : duplicated
                                    ? inputWarn
                                    : machineInputNeutral
                              }`}
                            />
                          </div>

                          {/* ── ประเภทประกัน (owner's request) ──────────────
                              OPTIONAL, always: no `required`, no red variant,
                              and `validateLineDrafts` deliberately ignores it,
                              so an unset ประกัน can never block a save.

                              WHY A NATIVE <select> AND NOT `SearchableDropdown`:
                              the repo's dropdown portals its panel to
                              <body> precisely so a scrolling modal cannot clip
                              it, and a native <select> earns the same immunity
                              for free — the browser paints its popup outside the
                              document entirely. With that tie broken, the native
                              control wins the rest outright for THREE SHORT,
                              FIXED options: no search box to hide
                              (`SearchableDropdown` renders one by default, dead
                              weight over three items), a real `disabled`
                              attribute — which `SearchableDropdown` has no prop
                              for — so it greys out with its neighbours while
                              saving, real `htmlFor`/`id` labelling, keyboard
                              type-ahead, and the OS wheel picker on the phone
                              this row has to stay readable on. */}
                          <div className="min-w-0">
                            <label className={labelCls} htmlFor={warrantyTypeId}>
                              ประเภทประกัน{" "}
                              <span className="font-normal text-gray-400">(ไม่บังคับ)</span>
                              <span className="sr-only"> {at}</span>
                            </label>
                            <div className="relative">
                              <select
                                id={warrantyTypeId}
                                disabled={disabled}
                                value={warrantySelect}
                                onChange={(e) =>
                                  // The whole three-state string is the helper's
                                  // business — including "อื่นๆ picked, nothing
                                  // typed yet", which is NOT the same as unset.
                                  transformMachine(index, machineIndex, (m) =>
                                    setMachineWarrantyType(m, e.target.value)
                                  )
                                }
                                className={`${machineInputBase} ${machineInputNeutral} appearance-none pr-9 ${
                                  warrantySelect ? "text-gray-800" : "text-gray-400"
                                }`}
                              >
                                {/* "ไม่ระบุ" mirrors the two DatePickers' own
                                    placeholder — the same "left blank on
                                    purpose" state, worded the same way. */}
                                <option value="">ไม่ระบุ</option>
                                {/* The three options come from the single
                                    exported constant, never re-typed here. */}
                                {WARRANTY_TYPE_OPTIONS.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                    className="text-gray-800"
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <svg
                                aria-hidden="true"
                                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </div>

                            {/* อื่นๆ → the admin writes their own ประกัน, and
                                THAT text is what reaches
                                `customer_equipments.warrantyType` verbatim. The
                                word "อื่นๆ" itself never does:
                                `resolveWarrantyTypeForApi` collapses the
                                still-empty box back to "". */}
                            {warrantyCustom && (
                              <div className="mt-2">
                                <label className={labelCls} htmlFor={warrantyTextId}>
                                  ระบุประกันเอง
                                  <span className="sr-only"> {at}</span>
                                </label>
                                <input
                                  id={warrantyTextId}
                                  type="text"
                                  disabled={disabled}
                                  value={warrantyTypeCustomText(machine.warrantyType)}
                                  onChange={(e) =>
                                    transformMachine(index, machineIndex, (m) =>
                                      setMachineWarrantyTypeText(m, e.target.value)
                                    )
                                  }
                                  placeholder="เช่น ประกันเครื่อง 1 ปีตอนขาย"
                                  className={`${machineInputBase} ${machineInputNeutral}`}
                                />
                              </div>
                            )}
                          </div>

                          {/* `DatePicker` takes neither `id`, `aria-label` nor
                              `disabled`: the label WRAPS it (implicit
                              association, with the machine coordinates hidden
                              inside for screen readers) and a `fieldset`
                              carries the disabled state down while saving.
                              `relative z-50` is the equipment modal's own guard
                              (its calendar is portalled to #root-portal, so it
                              is never clipped by a scrolling modal). */}
                          <fieldset className="min-w-0 relative z-50" disabled={disabled}>
                            <label className="block">
                              <span className={labelCls}>
                                วันเริ่มประกัน<span className="sr-only"> {at}</span>
                              </span>
                              <DatePicker
                                selected={parseDateValue(machine.warrantyStartDate)}
                                onChange={(date) =>
                                  updateMachine(index, machineIndex, {
                                    warrantyStartDate: date ? toLocalDateString(date) : "",
                                  })
                                }
                                placeholderText="ไม่ระบุ"
                                isClearable
                              />
                            </label>
                          </fieldset>
                          <fieldset className="min-w-0 relative z-50" disabled={disabled}>
                            <label className="block">
                              <span className={labelCls}>
                                วันหมดประกัน<span className="sr-only"> {at}</span>
                              </span>
                              <DatePicker
                                selected={parseDateValue(machine.warrantyEndDate)}
                                onChange={(date) =>
                                  updateMachine(index, machineIndex, {
                                    warrantyEndDate: date ? toLocalDateString(date) : "",
                                  })
                                }
                                placeholderText="ไม่ระบุ"
                                isClearable
                              />
                            </label>
                          </fieldset>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Serial Number บังคับกรอกทุกเครื่อง ส่วนประเภทประกันและวันประกันไม่บังคับ
                    เว้นว่างไว้ก่อนได้ — แต่ละเครื่องกำหนดคนละแบบ คนละวันได้
                    และจะถูกบันทึกไปที่ «อุปกรณ์ที่ขาย» ของเครื่องนั้น
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
