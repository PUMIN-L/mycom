import React, { useState, useRef, useEffect } from 'react';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

interface DatePickerProps {
  selected?: Date | null;
  onChange: (date: Date | null) => void;
  className?: string;
  placeholderText?: string;
  isClearable?: boolean;
}

const months = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

function CustomHeader({ date, changeYear, changeMonth, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled }: any) {
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 40 }, (_, i) => currentYear - 20 + i);

  const monthRef = useRef<HTMLDivElement>(null);
  const yearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (monthRef.current && !monthRef.current.contains(event.target as Node)) {
        setShowMonthDropdown(false);
      }
      if (yearRef.current && !yearRef.current.contains(event.target as Node)) {
        setShowYearDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex items-center justify-between px-2 py-2 bg-white relative">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); decreaseMonth(); }}
        disabled={prevMonthButtonDisabled}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 disabled:opacity-50 transition-colors cursor-pointer"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
      </button>
      
      <div className="flex gap-1.5">
        <div className="relative" ref={monthRef}>
          <button
            type="button"
            onClick={() => { setShowMonthDropdown(!showMonthDropdown); setShowYearDropdown(false); }}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-1 min-w-[90px] justify-between"
          >
            <span>{months[date.getMonth()]}</span>
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showMonthDropdown && (
            <div className="absolute top-full mt-1 left-0 w-32 bg-white border border-gray-100 rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto py-1">
              {months.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { changeMonth(index); setShowMonthDropdown(false); }}
                  className={`w-full text-left px-4 py-2 text-sm ${date.getMonth() === index ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-700 hover:bg-gray-50 font-medium'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
        
        <div className="relative" ref={yearRef}>
          <button
            type="button"
            onClick={() => { setShowYearDropdown(!showYearDropdown); setShowMonthDropdown(false); }}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-1 min-w-[75px] justify-between"
          >
            <span>{date.getFullYear()}</span>
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showYearDropdown && (
            <div className="absolute top-full mt-1 right-0 w-24 bg-white border border-gray-100 rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto py-1 custom-scrollbar">
              {years.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { changeYear(option); setShowYearDropdown(false); }}
                  className={`w-full text-left px-4 py-2 text-sm ${date.getFullYear() === option ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-700 hover:bg-gray-50 font-medium'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => { e.preventDefault(); increaseMonth(); }}
        disabled={nextMonthButtonDisabled}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 disabled:opacity-50 transition-colors cursor-pointer"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

export default function DatePicker({ selected, onChange, className, placeholderText, isClearable }: DatePickerProps) {
  return (
    <ReactDatePicker
      selected={selected}
      onChange={onChange}
      dateFormat="yyyy-MM-dd"
      className={className || "w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"}
      placeholderText={placeholderText || "YYYY-MM-DD"}
      isClearable={isClearable}
      popperPlacement="bottom-start"
      portalId="root-portal"
      renderCustomHeader={CustomHeader}
    />
  );
}
