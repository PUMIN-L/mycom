"use client";

// Compact labeled range control used by the content-block editors
// (create-content and showcase in-place editing) — e.g. image width (%) and
// spacing below a block (px). A slider for coarse changes plus −/+ buttons for
// precise step-by-step nudging. Styled to sit alongside the existing block
// controls (เปลี่ยนรูป button, รูปซ้าย/ขวา select).
export default function BlockRangeControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btnCls =
    "w-6 h-6 shrink-0 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold leading-none disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-600">
      <span className="whitespace-nowrap">{label}</span>
      <button
        type="button"
        aria-label="ลดขนาด"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className={btnCls}
      >
        −
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 accent-orange-500 cursor-pointer"
      />
      <button
        type="button"
        aria-label="เพิ่มขนาด"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        className={btnCls}
      >
        +
      </button>
      <span className="w-12 text-right font-semibold text-orange-600 tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );
}
