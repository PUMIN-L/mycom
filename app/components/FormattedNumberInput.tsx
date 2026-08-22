"use client";
import React, { useState, useEffect } from "react";

export default function FormattedNumberInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: number | string;
  onChange: (val: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [localVal, setLocalVal] = useState(value ? value.toLocaleString("th-TH") : "");

  useEffect(() => {
    const stringVal = value ? value.toLocaleString("th-TH") : "";
    const parsedLocal = parseFloat(localVal.replace(/,/g, "")) || 0;
    const parsedProp = typeof value === "number" ? value : parseFloat(value as string) || 0;
    if (parsedLocal !== parsedProp) {
      setLocalVal(stringVal);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^0-9.]/g, "");
    const parts = raw.split(".");
    if (parts.length > 2) {
      raw = parts[0] + "." + parts.slice(1).join("");
    }
    let formatted = raw;
    if (parts[0]) {
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      formatted = parts.join(".");
    }
    setLocalVal(formatted);
    const parsed = parseFloat(raw.replace(/,/g, "")) || 0;
    onChange(parsed);
  };

  const handleBlur = () => {
    const parsed = parseFloat(localVal.replace(/,/g, "")) || 0;
    setLocalVal(parsed ? parsed.toLocaleString("th-TH", { maximumFractionDigits: 10 }) : "");
    onChange(parsed);
  };

  return (
    <input
      type="text"
      value={localVal}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
    />
  );
}
