"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

// The panel previously always opened downward with a fixed max-height,
// regardless of how close the trigger sat to the bottom of its scroll
// container (e.g. a modal) — it would spill past that boundary instead of
// shrinking to fit or flipping upward. These bound how tall the panel is
// allowed to get, and how little space below counts as "not enough".
const MAX_PANEL_HEIGHT = 288; // matches the previous fixed max-h-72
const MIN_USABLE_HEIGHT = 150;
const VIEWPORT_MARGIN = 8;

export interface SearchableDropdownOption {
  value: string;
  label: string;
  subLabel?: string;
  disabled?: boolean;
}

interface SearchableDropdownProps {
  options: SearchableDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  searchable?: boolean;
}

export default function SearchableDropdown({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className = "",
  buttonClassName = "",
  searchable = true,
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<{ direction: "down" | "up"; maxHeight: number }>({
    direction: "down",
    maxHeight: MAX_PANEL_HEIGHT,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Measures space around the trigger and picks a direction/height that
  // keeps the panel inside the viewport (and whatever scroll container it's
  // in, e.g. a modal) instead of spilling past the bottom edge.
  const recalcPanelPosition = useCallback(() => {
    const el = dropdownRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;

    if (spaceBelow < MIN_USABLE_HEIGHT && spaceAbove > spaceBelow) {
      setPanel({ direction: "up", maxHeight: Math.min(MAX_PANEL_HEIGHT, Math.max(spaceAbove, 100)) });
    } else {
      setPanel({ direction: "down", maxHeight: Math.min(MAX_PANEL_HEIGHT, Math.max(spaceBelow, 100)) });
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Re-measure on resize, and on scroll anywhere (capture phase catches a
  // scrollable modal body too, not just the window) while the panel is open.
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", recalcPanelPosition);
    window.addEventListener("scroll", recalcPanelPosition, true);
    return () => {
      window.removeEventListener("resize", recalcPanelPosition);
      window.removeEventListener("scroll", recalcPanelPosition, true);
    };
  }, [isOpen, recalcPanelPosition]);

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(search.toLowerCase()) ||
      opt.subLabel?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className={`w-full bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-left text-sm text-gray-700 flex justify-between items-center shadow-sm hover:bg-gray-50 transition ${buttonClassName}`}
        onClick={() => {
          // Measure before the panel first renders (same event handler, so
          // React batches this with the isOpen update) — avoids a flash of
          // the wrong direction/height on open.
          if (!isOpen) recalcPanelPosition();
          setIsOpen(!isOpen);
          setSearch("");
        }}
      >
        <span className="truncate font-medium">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          } ml-2 shrink-0`}
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
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 w-[300px] sm:w-full bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col left-0 ${
            panel.direction === "up" ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ maxHeight: panel.maxHeight }}
        >
          {searchable && (
            <div className="p-2 border-b border-gray-100 bg-gray-50/50 rounded-t-xl shrink-0">
              <div className="relative">
                <svg className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-shadow"
                  placeholder="ค้นหา..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="overflow-y-auto flex-1 p-1.5 min-h-[50px] custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition flex flex-col ${
                    opt.disabled ? "opacity-50 cursor-not-allowed bg-gray-50" :
                    selectedOption?.value === opt.value
                      ? "bg-orange-50 text-orange-700"
                      : "hover:bg-gray-50 text-gray-700"
                  }`}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  <span className="font-semibold">{opt.label}</span>
                  {opt.subLabel && (
                    <span className={`text-xs mt-0.5 ${opt.disabled ? "text-gray-400" : selectedOption?.value === opt.value ? "text-orange-600/80" : "text-gray-500"}`}>
                      {opt.subLabel}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                ไม่พบข้อมูลที่ค้นหา
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
