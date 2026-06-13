"use client";

import { useState, useRef, useEffect } from "react";

// Shared swatch + custom-color picker used by the content editors
// (create-content and showcase edit mode).
const PRESET_COLORS = [
  "#000000", "#4B5563", "#EF4444", "#F97316", "#F59E0B",
  "#10B981", "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#FFFFFF",
];

export default function ColorPickerDropdown({
  color,
  onChange,
}: {
  color: string;
  onChange: (c: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-8 rounded border border-gray-300 shadow-sm flex items-center justify-center cursor-pointer"
        style={{ backgroundColor: color || "#000000" }}
        title="Choose color"
      />
      {isOpen && (
        <div className="absolute top-10 left-0 z-50 p-3 bg-white rounded-xl shadow-xl border border-gray-200 w-48 flex flex-wrap gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange(c);
                setIsOpen(false);
              }}
              className={`w-6 h-6 rounded-full border border-gray-300 shadow-sm transition-transform hover:scale-110 ${color === c ? "ring-2 ring-offset-1 ring-orange-500" : ""}`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-gray-300 shadow-sm transition-transform hover:scale-110" title="Custom Color">
            <input
              type="color"
              value={color || "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
}
