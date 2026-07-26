"use client";
import React, { useState, useRef, useEffect } from "react";

export interface MultiSelectDropdownOption {
  value: string;
  label: string;
  subLabel?: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectDropdownOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export default function MultiSelectDropdown({
  options,
  values,
  onChange,
  placeholder = "เลือกข้อมูล...",
  className = "",
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(search.toLowerCase()) ||
      opt.subLabel?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleOption = (optValue: string) => {
    if (values.includes(optValue)) {
      onChange(values.filter((v) => v !== optValue));
    } else {
      onChange([...values, optValue]);
    }
  };

  const selectedOptions = values.map(val => {
    const opt = options.find(o => o.value === val);
    return opt ? opt : { value: val, label: `Unknown (${val})` };
  });

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected Tags */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {selectedOptions.map(opt => (
            <span key={opt.value} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg border border-blue-100 shadow-sm transition-all hover:bg-blue-100 max-w-full">
              <span className="truncate max-w-[200px] sm:max-w-[300px]">{opt.label}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOption(opt.value);
                }}
                className="text-blue-400 hover:text-blue-700 focus:outline-none p-0.5 rounded-full hover:bg-blue-200 transition-colors"
                title="นำออก"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown Toggle */}
      <button
        type="button"
        className={`w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-left text-sm text-gray-700 flex justify-between items-center shadow-sm hover:bg-gray-50 hover:border-gray-400 transition-colors`}
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setSearch(""); // Reset search when opening
        }}
      >
        <span className="truncate font-medium text-gray-500">
          {placeholder}
        </span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          } ml-2 shrink-0`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 flex flex-col left-0 overflow-hidden">
          <div className="p-2 border-b border-gray-100 bg-gray-50/80">
            <div className="relative">
              <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                className="w-full bg-white border border-gray-300 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                placeholder="พิมพ์ค้นหา..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-1.5 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = values.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors flex items-center justify-between mb-1 last:mb-0 ${
                      isSelected
                        ? "bg-blue-50 text-blue-700 font-semibold"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOption(opt.value);
                    }}
                  >
                    <div className="flex flex-col truncate pr-3">
                      <span className="truncate">{opt.label}</span>
                      {opt.subLabel && (
                        <span className={`text-xs mt-0.5 truncate ${isSelected ? "text-blue-600/80" : "text-gray-500"}`}>
                          {opt.subLabel}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center justify-center w-6 h-6">
                      {isSelected ? (
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <div className="w-5 h-5 border-2 border-gray-300 rounded bg-white"></div>
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-500 flex flex-col items-center gap-3">
                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                ไม่พบข้อมูลที่ค้นหา
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
