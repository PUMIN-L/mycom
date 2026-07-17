"use client";

// Compact labeled range slider used by the content-block editors
// (create-content and showcase in-place editing) — e.g. image width (%) and
// spacing below a block (px). Styled to sit alongside the existing block
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
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-600">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-orange-500 cursor-pointer"
      />
      <span className="w-12 text-right font-semibold text-orange-600 tabular-nums">
        {value}
        {unit}
      </span>
    </label>
  );
}
