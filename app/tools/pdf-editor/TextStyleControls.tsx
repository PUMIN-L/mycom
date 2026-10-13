"use client";

import SearchableDropdown from "../../components/SearchableDropdown";
import ColorPickerDropdown from "../../components/ColorPickerDropdown";
import FormattedNumberInput from "../../components/FormattedNumberInput";
import type { RGB, TextAlign } from "../../lib/pdfTypes";

/**
 * How a piece of text is drawn: size, bold, italic, colour, alignment, angle.
 *
 * ONE set of controls, used in two places that must never drift apart: the
 * toolbar (how the NEXT text will look) and the text dialog (how THIS text
 * looks — a new one, or one being edited). Owns no state: everything arrives
 * as `style` and leaves through `onChange`.
 *
 * Every dropdown is SearchableDropdown with `searchable={false}` — a native
 * <select> opens as a dark grey OS popup on a dark-mode machine (AGENTS.md).
 * Its panel portals to <body>, so it opens above the dialog too.
 */

/**
 * `color` is `RGB` from the shared contract — 0..1 per channel, the range
 * pdf-lib's `rgb()` takes, so the write layer passes it straight through.
 */
export interface TextStyle {
  sizePt: number;
  bold: boolean;
  italic: boolean;
  color: RGB;
  angleDeg: number;
  align: TextAlign;
}

/**
 * The point sizes offered, and the bounds the guide quotes. Not an upload
 * guard — nothing is REFUSED for its font size — and exported so the guide
 * states the range without typing a number of its own.
 */
export const FONT_SIZE_OPTIONS_PT = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72,
] as const;

export const MIN_FONT_SIZE_PT = FONT_SIZE_OPTIONS_PT[0];
export const MAX_FONT_SIZE_PT = FONT_SIZE_OPTIONS_PT[FONT_SIZE_OPTIONS_PT.length - 1];

/** The ladder, plus the current size when it is not on it — a size read off
 *  existing text (13.5 pt) — so the dropdown shows it instead of a blank. */
function sizeOptions(current: number) {
  const sizes: number[] = [...FONT_SIZE_OPTIONS_PT];
  if (Number.isFinite(current) && current > 0 && !sizes.includes(current)) {
    sizes.push(current);
    sizes.sort((a, b) => a - b);
  }
  return sizes.map((size) => ({ value: String(size), label: `${size} pt` }));
}

const ALIGN_OPTIONS = [
  { value: "left", label: "ชิดซ้าย" },
  { value: "center", label: "กึ่งกลาง" },
  { value: "right", label: "ชิดขวา" },
];

/** `{r,g,b}` in 0..1 ⇄ the `#rrggbb` that ColorPickerDropdown speaks. */
export function colorToHex({ r, g, b }: RGB): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function hexToColor(hex: string): RGB {
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

/** The CSS colour of a style, for anything that previews it. */
export function cssColor({ r, g, b }: RGB): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function ToggleButton({
  pressed,
  onClick,
  title,
  className,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className={`w-10 py-2 rounded-xl border text-sm transition-all ${className} ${
        pressed
          ? "bg-gray-900 border-gray-900 text-white"
          : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export default function TextStyleControls({
  style,
  onChange,
}: {
  style: TextStyle;
  onChange: (next: TextStyle) => void;
}) {
  const label = "block text-xs font-bold text-gray-400 uppercase tracking-wide mb-1";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-28">
        <span className={label}>ขนาดตัวอักษร</span>
        <SearchableDropdown
          options={sizeOptions(style.sizePt)}
          value={String(style.sizePt)}
          onChange={(value) => onChange({ ...style, sizePt: Number(value) || style.sizePt })}
          searchable={false}
          placeholder="ขนาด"
        />
      </div>

      <div>
        <span className={label}>รูปแบบ</span>
        <div className="flex gap-1.5">
          <ToggleButton
            pressed={style.bold}
            onClick={() => onChange({ ...style, bold: !style.bold })}
            title="ตัวหนา (สลับระหว่างฟอนต์ Sarabun ปกติกับตัวหนา)"
            className="font-bold"
          >
            B
          </ToggleButton>
          <ToggleButton
            pressed={style.italic}
            onClick={() => onChange({ ...style, italic: !style.italic })}
            title="ตัวเอียง"
            className="italic font-serif"
          >
            I
          </ToggleButton>
        </div>
      </div>

      <div>
        <span className={label}>สีตัวอักษร</span>
        <ColorPickerDropdown
          color={colorToHex(style.color)}
          onChange={(hex) => onChange({ ...style, color: hexToColor(hex) })}
        />
      </div>

      <div className="w-32">
        <span className={label}>จัดวาง</span>
        <SearchableDropdown
          options={ALIGN_OPTIONS}
          value={style.align}
          onChange={(value) => onChange({ ...style, align: value as TextAlign })}
          searchable={false}
          placeholder="จัดวาง"
        />
      </div>

      <div className="w-28">
        <span className={label}>มุม (องศา)</span>
        <FormattedNumberInput
          value={style.angleDeg}
          onChange={(angleDeg) => onChange({ ...style, angleDeg })}
          placeholder="0"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
        />
      </div>
    </div>
  );
}
