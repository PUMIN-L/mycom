"use client";
// Form controls shared by the add / edit / bulk dialogs of /assets and /stock.

import { useMemo, useState } from "react";
import SearchableDropdown, { type SearchableDropdownOption } from "../SearchableDropdown";
import SuggestField from "../SuggestField";
import DatePicker from "../DatePicker";
import type { InventoryKind } from "../../lib/types";
import { inventoryStatuses, inventoryStatus } from "../../lib/inventoryStatus";
import { Field, dateFromString, stringFromDate, inputClass } from "./inventoryUi";

export interface SupplierOption {
  id: string;
  companyName: string;
}

export interface SupplierValue {
  supplierId: string | null;
  supplierName: string;
}

/**
 * The seller: picked from the Suppliers list OR typed, in one field. A picked
 * supplier is stored with its id (its name then follows renames there); a
 * typed one is just text, and is suggested again next time.
 */
export function SupplierField({
  value,
  onChange,
  suppliers,
  typedBefore,
}: {
  value: SupplierValue;
  onChange: (value: SupplierValue) => void;
  suppliers: SupplierOption[];
  /** Names typed on earlier pieces (not in the Suppliers list). */
  typedBefore: string[];
}) {
  const [search, setSearch] = useState("");

  const current = value.supplierId && suppliers.some((s) => s.id === value.supplierId)
    ? `s:${value.supplierId}`
    : value.supplierName
      ? `t:${value.supplierName}`
      : "";

  const options = useMemo(() => {
    const typed = search.trim();
    const q = typed.toLocaleLowerCase("th");
    const hit = (s: string) => !q || s.toLocaleLowerCase("th").includes(q);
    const out: SearchableDropdownOption[] = [];
    const seen = new Set<string>();
    const add = (v: string, label: string, subLabel?: string) => {
      if (seen.has(v)) return;
      seen.add(v);
      out.push({ value: v, label, subLabel });
    };
    if (typed) add(`t:${typed}`, `ใช้ “${typed}”`, "พิมพ์เอง — ไม่ต้องเพิ่มใน Suppliers");
    for (const s of suppliers) if (hit(s.companyName)) add(`s:${s.id}`, s.companyName, "จากรายชื่อ Suppliers");
    const supplierNames = new Set(suppliers.map((s) => s.companyName.toLocaleLowerCase("th")));
    for (const name of typedBefore) {
      if (supplierNames.has(name.toLocaleLowerCase("th"))) continue;
      if (hit(name)) add(`t:${name}`, name, "เคยพิมพ์ไว้");
    }
    if (current && !seen.has(current)) add(current, value.supplierName || current.slice(2));
    if (current && !typed) out.push({ value: "", label: "— ไม่ระบุผู้ขาย —" });
    return out;
  }, [search, suppliers, typedBefore, current, value.supplierName]);

  return (
    <SearchableDropdown
      options={options}
      value={current}
      onChange={(v) => {
        setSearch("");
        if (v.startsWith("s:")) {
          const s = suppliers.find((x) => x.id === v.slice(2));
          onChange({ supplierId: v.slice(2), supplierName: s?.companyName ?? "" });
        } else if (v.startsWith("t:")) {
          onChange({ supplierId: null, supplierName: v.slice(2) });
        } else {
          onChange({ supplierId: null, supplierName: "" });
        }
      }}
      onSearchChange={setSearch}
      filterOptions={false}
      placeholder="เลือกจาก Suppliers หรือพิมพ์เอง…"
    />
  );
}

export interface StatusValue {
  status: string;
  statusParty: string;
  statusDate: string;
}

/**
 * A status and the extra fields it asks for (borrower + return date, repair
 * shop, reserved for, sold to + date, disposal date). Changing the status
 * clears the extra fields — the old status's detail never carries over.
 */
export function StatusFields({
  kind,
  value,
  onChange,
  partySuggestions,
}: {
  kind: InventoryKind;
  value: StatusValue;
  onChange: (value: StatusValue) => void;
  partySuggestions: string[];
}) {
  const def = inventoryStatus(kind, value.status);
  const options = inventoryStatuses(kind).map((s) => ({ value: s.key, label: s.label }));
  return (
    <div className="space-y-3">
      <Field label="สถานะ" required>
        <SearchableDropdown
          options={options}
          value={value.status}
          searchable={false}
          onChange={(status) =>
            onChange(status === value.status ? value : { status, statusParty: "", statusDate: "" })
          }
          placeholder="เลือกสถานะ"
        />
      </Field>
      {(def?.party || def?.date) && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-orange-100 bg-orange-50/40 p-3 sm:grid-cols-2">
          {def?.party && (
            <Field label={def.party.label} required={def.party.required}>
              <SuggestField
                value={value.statusParty}
                onChange={(statusParty) => onChange({ ...value, statusParty })}
                suggestions={partySuggestions}
              />
            </Field>
          )}
          {def?.date && (
            <Field label={def.date.label} required={def.date.required}>
              <DatePicker
                selected={dateFromString(value.statusDate)}
                onChange={(d) => onChange({ ...value, statusDate: stringFromDate(d) })}
                className={inputClass}
                placeholderText="เลือกวันที่"
                isClearable={!def.date.required}
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

/** What a status asks for that is still empty — checked before sending, so
 *  the dialog can point at it instead of waiting for the server. */
export function missingStatusField(kind: InventoryKind, value: StatusValue): string | null {
  const def = inventoryStatus(kind, value.status);
  if (!def) return "กรุณาเลือกสถานะ";
  if (def.party?.required && !value.statusParty.trim()) return `กรุณาระบุ${def.party.label}`;
  if (def.date?.required && !value.statusDate) return `กรุณาระบุ${def.date.label}`;
  return null;
}
