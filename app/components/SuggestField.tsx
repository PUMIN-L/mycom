"use client";
import { useMemo, useState } from "react";
import SearchableDropdown, { type SearchableDropdownOption } from "./SearchableDropdown";

/**
 * A free-text value with "what was typed before" suggestions — a place, a
 * category, a borrower. Built on SearchableDropdown, because the project rule
 * is never a native <select> or <datalist> (the operating system paints
 * those: a dark grey popup on a dark-mode machine).
 *
 * Open it and type: what you typed is the first option ("ใช้ “…”"), then the
 * suggestions containing it. A filled field also offers "ล้างค่า".
 */
export default function SuggestField({
  value,
  onChange,
  suggestions,
  placeholder = "พิมพ์หรือเลือก…",
  className = "",
  buttonClassName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const [search, setSearch] = useState("");

  const options = useMemo(() => {
    const typed = search.trim();
    const q = typed.toLocaleLowerCase("th");
    const out: SearchableDropdownOption[] = [];
    const seen = new Set<string>();
    const add = (v: string, label: string, subLabel?: string) => {
      if (seen.has(v)) return;
      seen.add(v);
      out.push({ value: v, label, subLabel });
    };
    if (typed) add(typed, `ใช้ “${typed}”`, "ตามที่พิมพ์");
    for (const s of suggestions) {
      if (out.length >= 50) break;
      if (!q || s.toLocaleLowerCase("th").includes(q)) add(s, s);
    }
    // The current value must be an option, or the button shows the placeholder.
    if (value) add(value, value);
    if (value && !typed) out.push({ value: CLEAR, label: "— ล้างค่า —" });
    return out;
  }, [search, suggestions, value]);

  return (
    <SearchableDropdown
      options={options}
      value={value}
      onChange={(v) => {
        setSearch("");
        onChange(v === CLEAR ? "" : v);
      }}
      onSearchChange={setSearch}
      filterOptions={false}
      placeholder={placeholder}
      className={className}
      buttonClassName={buttonClassName}
    />
  );
}

/** Not a value anyone can type (it carries a control character). */
const CLEAR = "\u0000clear";
