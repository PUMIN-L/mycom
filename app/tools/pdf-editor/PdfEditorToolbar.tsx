"use client";

import { useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown";
import ColorPickerDropdown from "../../components/ColorPickerDropdown";
import FormattedNumberInput from "../../components/FormattedNumberInput";
import type { RGB, TextAlign } from "../../lib/pdfTypes";
import type { PreviewTool } from "./previewTypes";

/**
 * The editor's one control strip: which tool is armed, how new text will look,
 * what happens to the page you are standing on, and undo/redo/download.
 *
 * IT OWNS NO EDITOR STATE. Everything arrives as a prop and leaves as a
 * callback, which is what makes it testable in jsdom without pulling react-pdf
 * (and therefore `DOMMatrix`) anywhere near the test runner.
 *
 * TWO PROJECT RULES ARE LOAD-BEARING HERE:
 *  • Every dropdown is `SearchableDropdown` with `searchable={false}` — font
 *    size, alignment and rotation are short fixed lists, so the search box
 *    would be dead weight, but a native <select> is painted by the OS and opens
 *    as a dark grey popup on a dark-mode machine (AGENTS.md).
 *  • The disabled state is a `<fieldset disabled>` wrapper, because
 *    SearchableDropdown has no `disabled` prop.
 */

/** The armed tool. Re-exported from `previewTypes` rather than redeclared, so
 *  the toolbar and the preview overlay can never drift into two vocabularies. */
export type EditorTool = PreviewTool;

/**
 * How the NEXT piece of text will be drawn. `color` is `RGB` from the shared
 * contract — 0..1 per channel, the range pdf-lib's `rgb()` takes, so the write
 * layer passes it straight through with no second conversion to forget.
 */
export interface TextStyle {
  sizePt: number;
  bold: boolean;
  color: RGB;
  angleDeg: number;
  align: TextAlign;
}

/**
 * The point sizes offered, and the bounds the guide quotes.
 *
 * These live here rather than in `pdfValidate.ts` because they are not an
 * upload guard — nothing is REFUSED for its font size. They are exported so
 * `PdfEditorGuidePanel` can state the range without typing a number of its own:
 * widening the ladder widens the guide with it.
 */
export const FONT_SIZE_OPTIONS_PT = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72,
] as const;

export const MIN_FONT_SIZE_PT = FONT_SIZE_OPTIONS_PT[0];
export const MAX_FONT_SIZE_PT = FONT_SIZE_OPTIONS_PT[FONT_SIZE_OPTIONS_PT.length - 1];

export interface PdfEditorToolbarProps {
  /** No document loaded yet, or an export is running: the whole strip is inert. */
  disabled: boolean;
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  textStyle: TextStyle;
  onTextStyleChange: (next: TextStyle) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 1-based, for the label. 0 when nothing is selected. */
  currentPageNumber: number;
  pageCount: number;
  onRotateCurrentPage: (deltaDeg: 90 | 180 | 270) => void;
  onDeleteCurrentPage: () => void;
  onMergePdf: () => void;
  onDownload: () => void;
  isExporting: boolean;
}

const TOOLS: { id: EditorTool; label: string; icon: string; hint: string }[] = [
  { id: "select", label: "เลือก/ย้าย", icon: "🖱️", hint: "คลิกเพื่อเลือกสิ่งที่วางไว้ แล้วลากย้ายหรือย่อขยาย" },
  { id: "whiteout", label: "ทับขาว", icon: "⬜", hint: "ลากคลุมข้อความเดิมเพื่อปิดทับด้วยสี่เหลี่ยมสีขาวทึบ" },
  { id: "text", label: "ข้อความ", icon: "🔤", hint: "คลิกตรงที่ต้องการแล้วพิมพ์ข้อความใหม่ (ฟอนต์ Sarabun)" },
  { id: "image", label: "รูปภาพ", icon: "🖼️", hint: "วางรูป PNG หรือ JPG ลงบนหน้าเอกสาร" },
  { id: "signature", label: "ลายเซ็น", icon: "✍️", hint: "เซ็นชื่อด้วยเมาส์หรือนิ้ว แล้ววางลงบนเอกสาร" },
];

const FONT_SIZE_OPTIONS = FONT_SIZE_OPTIONS_PT.map((size) => ({
  value: String(size),
  label: `${size} pt`,
}));

const ALIGN_OPTIONS = [
  { value: "left", label: "ชิดซ้าย" },
  { value: "center", label: "กึ่งกลาง" },
  { value: "right", label: "ชิดขวา" },
];

const ROTATE_OPTIONS = [
  { value: "90", label: "หมุน 90° ตามเข็ม" },
  { value: "180", label: "หมุน 180°" },
  { value: "270", label: "หมุน 90° ทวนเข็ม" },
];

/** `{r,g,b}` in 0..1 ⇄ the `#rrggbb` that ColorPickerDropdown speaks. */
function colorToHex({ r, g, b }: RGB): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hexToColor(hex: string): RGB {
  const cleaned = hex.replace("#", "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
  tone = "plain",
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  tone?: "plain" | "danger" | "primary";
}) {
  const tones = {
    plain: "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300",
    danger: "bg-white border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300",
    primary:
      "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 shadow-sm shadow-emerald-200",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-3 py-2 rounded-xl border font-semibold text-sm transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export default function PdfEditorToolbar({
  disabled,
  tool,
  onToolChange,
  textStyle,
  onTextStyleChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  currentPageNumber,
  pageCount,
  onRotateCurrentPage,
  onDeleteCurrentPage,
  onMergePdf,
  onDownload,
  isExporting,
}: PdfEditorToolbarProps) {
  // The rotation dropdown is an ACTION, not a stored value: it fires and then
  // snaps back to empty so the label always reads as an instruction rather than
  // claiming the page currently sits at 90°.
  const [rotateChoice, setRotateChoice] = useState("");
  const hasPage = currentPageNumber > 0;

  return (
    <fieldset
      disabled={disabled}
      className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 sm:p-4 space-y-3 disabled:opacity-60"
      aria-label="แถบเครื่องมือแก้ไข PDF"
    >
      {/* ── row 1: the armed tool ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wide pr-1">
          เครื่องมือ
        </span>
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onToolChange(entry.id)}
            title={entry.hint}
            aria-pressed={tool === entry.id}
            className={`px-3 py-2 rounded-xl border font-semibold text-sm transition-all whitespace-nowrap flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
              tool === entry.id
                ? "bg-violet-600 border-violet-600 text-white shadow-sm shadow-violet-200"
                : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
            }`}
          >
            <span aria-hidden="true">{entry.icon}</span>
            {entry.label}
          </button>
        ))}
      </div>

      {/* ── row 2: how new text will look ─────────────────────────────── */}
      {tool === "text" && (
        <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
          <div className="w-28">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">
              ขนาดตัวอักษร
            </label>
            <SearchableDropdown
              options={FONT_SIZE_OPTIONS}
              value={String(textStyle.sizePt)}
              onChange={(value) =>
                onTextStyleChange({ ...textStyle, sizePt: Number(value) || textStyle.sizePt })
              }
              searchable={false}
              placeholder="ขนาด"
            />
          </div>

          <div>
            <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">
              ตัวหนา
            </span>
            <button
              type="button"
              onClick={() => onTextStyleChange({ ...textStyle, bold: !textStyle.bold })}
              aria-pressed={textStyle.bold}
              title="สลับระหว่างฟอนต์ Sarabun ปกติกับตัวหนา"
              className={`px-4 py-2 rounded-xl border font-bold text-sm transition-all ${
                textStyle.bold
                  ? "bg-gray-900 border-gray-900 text-white"
                  : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              B
            </button>
          </div>

          <div>
            <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">
              สีตัวอักษร
            </span>
            <ColorPickerDropdown
              color={colorToHex(textStyle.color)}
              onChange={(hex) => onTextStyleChange({ ...textStyle, color: hexToColor(hex) })}
            />
          </div>

          <div className="w-32">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">
              จัดวาง
            </label>
            <SearchableDropdown
              options={ALIGN_OPTIONS}
              value={textStyle.align}
              onChange={(value) =>
                onTextStyleChange({ ...textStyle, align: value as TextStyle["align"] })
              }
              searchable={false}
              placeholder="จัดวาง"
            />
          </div>

          <div className="w-28">
            <label
              className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1"
              htmlFor="pdf-editor-text-angle"
            >
              เอียง (องศา)
            </label>
            <FormattedNumberInput
              value={textStyle.angleDeg}
              onChange={(angleDeg) => onTextStyleChange({ ...textStyle, angleDeg })}
              placeholder="0"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>
        </div>
      )}

      {/* ── row 3: this page, this document ───────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
        <div className="w-52">
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">
            {hasPage ? `หน้า ${currentPageNumber} จาก ${pageCount} หน้า` : "ยังไม่ได้เลือกหน้า"}
          </label>
          <SearchableDropdown
            options={ROTATE_OPTIONS}
            value={rotateChoice}
            onChange={(value) => {
              setRotateChoice("");
              if (!hasPage) return;
              onRotateCurrentPage(Number(value) as 90 | 180 | 270);
            }}
            searchable={false}
            placeholder="หมุนหน้านี้..."
          />
        </div>

        <ToolbarButton
          onClick={onDeleteCurrentPage}
          disabled={!hasPage || pageCount <= 1}
          title={
            pageCount <= 1
              ? "ลบไม่ได้ เพราะเอกสารต้องเหลืออย่างน้อย 1 หน้า"
              : "ลบหน้าที่กำลังเลือกอยู่ออกจากเอกสาร"
          }
          tone="danger"
        >
          🗑️ ลบหน้านี้
        </ToolbarButton>

        <ToolbarButton onClick={onMergePdf} title="นำไฟล์ PDF อีกไฟล์มาต่อท้ายเอกสารนี้">
          ➕ รวมไฟล์ PDF
        </ToolbarButton>

        <div className="flex items-center gap-2 sm:ml-auto">
          <ToolbarButton onClick={onUndo} disabled={!canUndo} title="ย้อนกลับหนึ่งขั้น">
            ↩️ ย้อนกลับ
          </ToolbarButton>
          <ToolbarButton onClick={onRedo} disabled={!canRedo} title="ทำซ้ำสิ่งที่เพิ่งย้อนกลับไป">
            ↪️ ทำซ้ำ
          </ToolbarButton>
          <ToolbarButton
            onClick={onDownload}
            disabled={isExporting || pageCount === 0}
            title="สร้างไฟล์ PDF ใหม่จากสิ่งที่แก้ไว้ แล้วดาวน์โหลด"
            tone="primary"
          >
            {isExporting ? "⏳ กำลังสร้างไฟล์..." : "⬇️ ดาวน์โหลด PDF"}
          </ToolbarButton>
        </div>
      </div>
    </fieldset>
  );
}
