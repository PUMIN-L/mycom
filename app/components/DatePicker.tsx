import React from 'react';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

interface DatePickerProps {
  selected?: Date | null;
  onChange: (date: Date | null) => void;
  className?: string;
  placeholderText?: string;
  isClearable?: boolean;
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
      showYearDropdown
      showMonthDropdown
      dropdownMode="select"
      popperPlacement="bottom-start"
    />
  );
}
