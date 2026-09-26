"use client";
import React, { useState, useEffect } from "react";

/**
 * `n` with thousands separators and every decimal it has. toLocaleString on
 * its own keeps only 3, so a stored 1.23456 would show as "1.235" — and
 * merely focusing and leaving the field would then save 1.235.
 */
function formatNumber(n: number): string {
  return n ? n.toLocaleString("th-TH", { maximumFractionDigits: 10 }) : "";
}

function toNumber(value: number | string): number {
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

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
  const [localVal, setLocalVal] = useState(() => formatNumber(toNumber(value)));

  useEffect(() => {
    const parsedProp = toNumber(value);
    if (toNumber(localVal) !== parsedProp) {
      setLocalVal(formatNumber(parsedProp));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Digits and ONE decimal point: a second "." (a slip, or "1.2.3" pasted)
    // is dropped from the text shown as well as from the number — showing
    // "1.2.3" while holding 1.23 left the two to disagree until blur, which
    // then read the text as 1.2.
    let raw = e.target.value.replace(/[^0-9.]/g, "");
    const dot = raw.indexOf(".");
    if (dot !== -1) {
      raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "");
    }
    const [intPart, fracPart] = raw.split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    setLocalVal(fracPart === undefined ? grouped : `${grouped}.${fracPart}`);
    onChange(parseFloat(raw) || 0);
  };

  const handleBlur = () => {
    const parsed = toNumber(localVal);
    setLocalVal(formatNumber(parsed));
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
