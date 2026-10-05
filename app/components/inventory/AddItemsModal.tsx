"use client";
// "+ เพิ่มของ": pick a group (or create one), say how many, fill what the
// pieces share once, then a serial for each. One request; all or nothing.

import { useMemo, useState } from "react";
import SearchableDropdown from "../SearchableDropdown";
import SuggestField from "../SuggestField";
import DatePicker from "../DatePicker";
import FormattedNumberInput from "../FormattedNumberInput";
import ConfirmDialog from "../ConfirmDialog";
import type { InventoryGroup, InventoryItem, InventoryKind } from "../../lib/types";
import { defaultInventoryStatus, INVENTORY_PRICE_LABEL, MAX_ITEMS_PER_ADD } from "../../lib/inventoryStatus";
import { itemsWithSerial } from "../../lib/inventorySearch";
import { toLocalDateString } from "../../lib/dateFormat";
import { SupplierField, StatusFields, missingStatusField, type SupplierOption, type StatusValue, type SupplierValue } from "./InventoryFields";
import { useInventorySuggestions } from "./InventoryModals";
import { Field, Modal, apiJson, inventoryApi, dateFromString, stringFromDate, inputClass, primaryButton, secondaryButton } from "./inventoryUi";

export default function AddItemsModal({
  kind,
  groups,
  items,
  suppliers,
  presetGroupId,
  onClose,
  onAdded,
}: {
  kind: InventoryKind;
  groups: InventoryGroup[];
  items: InventoryItem[];
  suppliers: SupplierOption[];
  presetGroupId?: string | null;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(presetGroupId || groups.length > 0 ? "existing" : "new");
  const [groupId, setGroupId] = useState(presetGroupId ?? "");
  const [newGroup, setNewGroup] = useState({ name: "", brand: "", model: "", category: "" });
  // The box keeps what is typed (it may be empty mid-edit); the count is read from it.
  const [quantityText, setQuantityText] = useState("1");
  const quantity = Math.max(1, Math.min(MAX_ITEMS_PER_ADD, Math.floor(Number(quantityText)) || 1));
  const [purchaseDate, setPurchaseDate] = useState(toLocalDateString(new Date()));
  const [price, setPrice] = useState(0);
  const [supplier, setSupplier] = useState<SupplierValue>({ supplierId: null, supplierName: "" });
  const [location, setLocation] = useState("");
  const [custodian, setCustodian] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [status, setStatus] = useState<StatusValue>({ status: defaultInventoryStatus(kind), statusParty: "", statusDate: "" });
  const [note, setNote] = useState("");
  // Typed serials are kept past the current count, so lowering it and raising it again loses nothing.
  const [typedSerials, setTypedSerials] = useState<string[]>([]);
  const serials = useMemo(() => Array.from({ length: quantity }, (_, i) => typedSerials[i] ?? ""), [quantity, typedSerials]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDuplicates, setConfirmDuplicates] = useState<string | null>(null);

  const groupOptions = useMemo(
    () =>
      [...groups]
        .sort((a, b) => a.name.localeCompare(b.name, "th"))
        .map((g) => ({
          value: g.id,
          label: g.name,
          subLabel: [g.brand, g.model, g.category].filter(Boolean).join(" · ") || undefined,
        })),
    [groups]
  );
  const suggest = useInventorySuggestions(groups, items);

  /** For each serial box: the reason it may be a duplicate, if any. */
  const serialWarnings = useMemo(
    () =>
      serials.map((s, i) => {
        const key = s.trim().toLocaleLowerCase("th");
        if (!key) return "";
        if (serials.some((o, j) => j < i && o.trim().toLocaleLowerCase("th") === key)) return "ซ้ำกับช่องด้านบน";
        const existing = itemsWithSerial(items, s);
        return existing.length > 0 ? `ซ้ำกับ ${existing.map((e) => e.code).join(", ")}` : "";
      }),
    [serials, items]
  );

  function validate(): string | null {
    if (mode === "existing" && !groupId) return "กรุณาเลือกรายการ";
    if (mode === "new" && !newGroup.name.trim()) return "กรุณาระบุชื่อรายการ";
    if (!purchaseDate) return "กรุณาระบุวันที่ซื้อ";
    return missingStatusField(kind, status);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = {
        ...(mode === "existing" ? { groupId } : { group: newGroup }),
        quantity,
        serials,
        purchaseDate,
        price,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        location,
        custodian,
        warrantyUntil,
        status: status.status,
        statusParty: status.statusParty,
        statusDate: status.statusDate,
        note,
      };
      const result = await apiJson<{ items: InventoryItem[] }>(`${inventoryApi(kind)}/items`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const codes = result.items.map((i) => i.code);
      onAdded(codes.length === 1 ? `เพิ่ม ${codes[0]} แล้ว` : `เพิ่ม ${codes.length} ชิ้นแล้ว (${codes[0]} – ${codes[codes.length - 1]})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const dupes = serials.map((s, i) => (serialWarnings[i] ? `${s.trim()} (${serialWarnings[i]})` : "")).filter(Boolean);
    if (dupes.length > 0) {
      setConfirmDuplicates(`ซีเรียลเหล่านี้อาจซ้ำ:\n${dupes.join("\n")}\n\nบันทึกต่อไหม?`);
      return;
    }
    void save();
  }

  return (
    <>
      <Modal
        title="เพิ่มของ"
        onClose={onClose}
        wide
        error={error}
        footer={
          <>
            <button type="button" className={secondaryButton} onClick={onClose} disabled={saving}>
              ยกเลิก
            </button>
            <button type="button" className={primaryButton} onClick={submit} disabled={saving}>
              {saving ? "กำลังบันทึก…" : `บันทึก ${quantity} ชิ้น`}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex gap-2">
              {(["existing", "new"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={m === "existing" && groups.length === 0}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:opacity-40 ${
                    mode === m ? "border-orange-400 bg-orange-50 text-orange-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {m === "existing" ? "เลือกรายการเดิม" : "สร้างรายการใหม่"}
                </button>
              ))}
            </div>
            {mode === "existing" ? (
              <Field label="รายการ" required>
                <SearchableDropdown options={groupOptions} value={groupId} onChange={setGroupId} placeholder="ค้นหาชื่อ ยี่ห้อ รุ่น…" />
              </Field>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="ชื่อ" required>
                  <input className={inputClass} value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="เช่น เครื่องชั่งดิจิตอล" />
                </Field>
                <Field label="หมวด">
                  <SuggestField value={newGroup.category} onChange={(category) => setNewGroup({ ...newGroup, category })} suggestions={suggest.category} />
                </Field>
                <Field label="ยี่ห้อ">
                  <input className={inputClass} value={newGroup.brand} onChange={(e) => setNewGroup({ ...newGroup, brand: e.target.value })} />
                </Field>
                <Field label="รุ่น">
                  <input className={inputClass} value={newGroup.model} onChange={(e) => setNewGroup({ ...newGroup, model: e.target.value })} />
                </Field>
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="จำนวน (ชิ้น)" required hint={<span className="text-gray-400">ครั้งละไม่เกิน {MAX_ITEMS_PER_ADD} ชิ้น</span>}>
              <input
                type="number"
                min={1}
                max={MAX_ITEMS_PER_ADD}
                inputMode="numeric"
                className={inputClass}
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
                onBlur={() => setQuantityText(String(quantity))}
              />
            </Field>
            <Field label="วันที่ซื้อ" required>
              <DatePicker selected={dateFromString(purchaseDate)} onChange={(d) => setPurchaseDate(stringFromDate(d))} className={inputClass} />
            </Field>
            <Field label={`${INVENTORY_PRICE_LABEL[kind]} (ต่อชิ้น)`} required>
              <FormattedNumberInput value={price} onChange={setPrice} className={inputClass} placeholder="0" />
            </Field>
            <Field label="ผู้ขาย">
              <SupplierField value={supplier} onChange={setSupplier} suppliers={suppliers} typedBefore={suggest.typedSuppliers} />
            </Field>
            <Field label="อยู่ที่ไหน">
              <SuggestField value={location} onChange={setLocation} suggestions={suggest.location} />
            </Field>
            {kind === "asset" && (
              <>
                <Field label="ผู้ดูแล / ผู้ใช้">
                  <SuggestField value={custodian} onChange={setCustodian} suggestions={suggest.custodian} />
                </Field>
                <Field label="วันหมดประกัน">
                  <DatePicker selected={dateFromString(warrantyUntil)} onChange={(d) => setWarrantyUntil(stringFromDate(d))} className={inputClass} isClearable placeholderText="ไม่ระบุ" />
                </Field>
              </>
            )}
          </section>

          <StatusFields kind={kind} value={status} onChange={setStatus} partySuggestions={suggest.party} />

          <Field label="หมายเหตุ">
            <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <section>
            <p className="mb-2 text-sm font-semibold text-gray-700">
              เลขซีเรียล <span className="font-normal text-gray-400">(เว้นว่างได้ กรอกทีหลังได้)</span>
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {serials.map((s, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-right text-xs text-gray-400">{i + 1}.</span>
                    <input
                      className={inputClass}
                      value={s}
                      onChange={(e) =>
                        setTypedSerials((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                      aria-label={`ซีเรียลชิ้นที่ ${i + 1}`}
                    />
                  </div>
                  {serialWarnings[i] && <p className="ml-10 mt-0.5 text-xs text-amber-600">⚠ {serialWarnings[i]}</p>}
                </div>
              ))}
            </div>
          </section>

        </div>
      </Modal>
      {confirmDuplicates && (
        <ConfirmDialog
          title="ซีเรียลอาจซ้ำ"
          message={confirmDuplicates}
          confirmText="บันทึกต่อ"
          loadingText="กำลังบันทึก…"
          onCancel={() => setConfirmDuplicates(null)}
          onConfirm={() => {
            setConfirmDuplicates(null);
            void save();
          }}
        />
      )}
    </>
  );
}
