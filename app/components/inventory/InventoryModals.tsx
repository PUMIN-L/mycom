"use client";
// The smaller dialogs of /assets and /stock: edit a piece, change status (one
// piece or many), move place (many), create / edit a group, merge groups.

import { useMemo, useState } from "react";
import SearchableDropdown from "../SearchableDropdown";
import SuggestField from "../SuggestField";
import DatePicker from "../DatePicker";
import FormattedNumberInput from "../FormattedNumberInput";
import type { InventoryGroup, InventoryItem, InventoryKind } from "../../lib/types";
import { INVENTORY_PRICE_LABEL } from "../../lib/inventoryStatus";
import { suggestionsFrom } from "../../lib/inventorySearch";
import { SupplierField, StatusFields, missingStatusField, type SupplierOption, type StatusValue, type SupplierValue } from "./InventoryFields";
import { Field, Modal, apiJson, inventoryApi, dateFromString, stringFromDate, inputClass, primaryButton, secondaryButton } from "./inventoryUi";

function useSubmit() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<void>) {
    setSaving(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }
  return { saving, error, setError, run };
}

function Footer({ onClose, onSave, saving, label = "บันทึก" }: { onClose: () => void; onSave: () => void; saving: boolean; label?: string }) {
  return (
    <>
      <button type="button" className={secondaryButton} onClick={onClose} disabled={saving}>
        ยกเลิก
      </button>
      <button type="button" className={primaryButton} onClick={onSave} disabled={saving}>
        {saving ? "กำลังบันทึก…" : label}
      </button>
    </>
  );
}


/** Suggestions for the free-text fields, from what the register already holds. */
export function useInventorySuggestions(groups: InventoryGroup[], items: InventoryItem[]) {
  return useMemo(
    () => ({
      category: suggestionsFrom(groups.map((g) => g.category)),
      location: suggestionsFrom(items.map((i) => i.location)),
      custodian: suggestionsFrom(items.map((i) => i.custodian)),
      party: suggestionsFrom(items.map((i) => i.statusParty)),
      typedSuppliers: suggestionsFrom(items.filter((i) => !i.supplierId).map((i) => i.supplierName)),
    }),
    [groups, items]
  );
}

// ── Edit one piece ───────────────────────────────────────────────────────────

export function ItemEditModal({
  kind,
  item,
  groups,
  items,
  suppliers,
  onClose,
  onSaved,
}: {
  kind: InventoryKind;
  item: InventoryItem;
  groups: InventoryGroup[];
  items: InventoryItem[];
  suppliers: SupplierOption[];
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const suggest = useInventorySuggestions(groups, items);
  const [groupId, setGroupId] = useState(item.groupId);
  const [serialNumber, setSerialNumber] = useState(item.serialNumber);
  const [purchaseDate, setPurchaseDate] = useState(item.purchaseDate);
  const [price, setPrice] = useState(item.price);
  const [supplier, setSupplier] = useState<SupplierValue>({ supplierId: item.supplierId, supplierName: item.supplierName });
  const [location, setLocation] = useState(item.location);
  const [custodian, setCustodian] = useState(item.custodian);
  const [warrantyUntil, setWarrantyUntil] = useState(item.warrantyUntil ?? "");
  const [status, setStatus] = useState<StatusValue>({ status: item.status, statusParty: item.statusParty, statusDate: item.statusDate ?? "" });
  const [note, setNote] = useState(item.note);
  const { saving, error, setError, run } = useSubmit();

  const groupOptions = useMemo(
    () =>
      [...groups]
        .sort((a, b) => a.name.localeCompare(b.name, "th"))
        .map((g) => ({ value: g.id, label: g.name, subLabel: [g.brand, g.model].filter(Boolean).join(" · ") || undefined })),
    [groups]
  );

  function save() {
    if (!purchaseDate) return setError("กรุณาระบุวันที่ซื้อ");
    const missing = missingStatusField(kind, status);
    if (missing) return setError(missing);
    void run(async () => {
      const updated = await apiJson<InventoryItem>(`${inventoryApi(kind)}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          groupId,
          serialNumber,
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
        }),
      });
      onSaved(updated);
    });
  }

  return (
    <Modal error={error} title={`แก้ไข ${item.code}`} onClose={onClose} wide footer={<Footer onClose={onClose} onSave={save} saving={saving} />}>
      <div className="space-y-4">
        <Field label="รายการ" hint={<span className="text-gray-400">เปลี่ยนเพื่อย้ายชิ้นนี้ไปอยู่รายการอื่น</span>}>
          <SearchableDropdown options={groupOptions} value={groupId} onChange={setGroupId} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="เลขซีเรียล">
            <input className={inputClass} value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          </Field>
          <Field label="วันที่ซื้อ" required>
            <DatePicker selected={dateFromString(purchaseDate)} onChange={(d) => setPurchaseDate(stringFromDate(d))} className={inputClass} />
          </Field>
          <Field label={INVENTORY_PRICE_LABEL[kind]} required>
            <FormattedNumberInput value={price} onChange={setPrice} className={inputClass} />
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
        </div>
        <StatusFields kind={kind} value={status} onChange={setStatus} partySuggestions={suggest.party} />
        <Field label="หมายเหตุ">
          <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Status (one piece, or many) ──────────────────────────────────────────────

export function StatusChangeModal({
  kind,
  title,
  initial,
  partySuggestions,
  onClose,
  onSubmit,
}: {
  kind: InventoryKind;
  title: string;
  initial: StatusValue;
  partySuggestions: string[];
  onClose: () => void;
  onSubmit: (value: StatusValue) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const { saving, error, setError, run } = useSubmit();
  function save() {
    const missing = missingStatusField(kind, value);
    if (missing) return setError(missing);
    void run(() => onSubmit(value));
  }
  return (
    <Modal error={error} title={title} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} saving={saving} />}>
      <StatusFields kind={kind} value={value} onChange={setValue} partySuggestions={partySuggestions} />
    </Modal>
  );
}

// ── Place (many) ─────────────────────────────────────────────────────────────

export function LocationChangeModal({
  title,
  suggestions,
  onClose,
  onSubmit,
}: {
  title: string;
  suggestions: string[];
  onClose: () => void;
  onSubmit: (location: string) => Promise<void>;
}) {
  const [location, setLocation] = useState("");
  const { saving, error, run } = useSubmit();
  return (
    <Modal error={error} title={title} onClose={onClose} footer={<Footer onClose={onClose} onSave={() => void run(() => onSubmit(location))} saving={saving} label="ย้าย" />}>
      <Field label="ย้ายไปที่" hint={<span className="text-gray-400">เว้นว่าง = ไม่ระบุที่เก็บ</span>}>
        <SuggestField value={location} onChange={setLocation} suggestions={suggestions} />
      </Field>
    </Modal>
  );
}

// ── Group: create / edit ─────────────────────────────────────────────────────

export function GroupModal({
  kind,
  group,
  categorySuggestions,
  onClose,
  onSaved,
}: {
  kind: InventoryKind;
  /** Absent: create a new group. */
  group?: InventoryGroup;
  categorySuggestions: string[];
  onClose: () => void;
  onSaved: (group: InventoryGroup) => void;
}) {
  const [form, setForm] = useState({
    name: group?.name ?? "",
    brand: group?.brand ?? "",
    model: group?.model ?? "",
    category: group?.category ?? "",
    note: group?.note ?? "",
  });
  const { saving, error, setError, run } = useSubmit();
  function save() {
    if (!form.name.trim()) return setError("กรุณาระบุชื่อรายการ");
    void run(async () => {
      const saved = await apiJson<InventoryGroup>(
        group ? `${inventoryApi(kind)}/groups/${group.id}` : `${inventoryApi(kind)}/groups`,
        { method: group ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      onSaved(saved);
    });
  }
  return (
    <Modal error={error} title={group ? "แก้ไขรายการ" : "สร้างรายการ"} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} saving={saving} />}>
      <div className="space-y-3">
        <Field label="ชื่อ" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="ยี่ห้อ">
            <input className={inputClass} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </Field>
          <Field label="รุ่น">
            <input className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
        </div>
        <Field label="หมวด">
          <SuggestField value={form.category} onChange={(category) => setForm({ ...form, category })} suggestions={categorySuggestions} />
        </Field>
        <Field label="หมายเหตุ">
          <textarea className={inputClass} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        {group && <p className="text-xs text-gray-400">แก้ที่นี่ครั้งเดียว มีผลกับทุกชิ้นในรายการนี้</p>}
      </div>
    </Modal>
  );
}

// ── Group: merge into another ────────────────────────────────────────────────

export function MergeGroupModal({
  kind,
  from,
  groups,
  itemCount,
  onClose,
  onMerged,
}: {
  kind: InventoryKind;
  from: InventoryGroup;
  groups: InventoryGroup[];
  itemCount: number;
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const [intoId, setIntoId] = useState("");
  const { saving, error, setError, run } = useSubmit();
  const options = groups
    .filter((g) => g.id !== from.id)
    .sort((a, b) => a.name.localeCompare(b.name, "th"))
    .map((g) => ({ value: g.id, label: g.name, subLabel: [g.brand, g.model].filter(Boolean).join(" · ") || undefined }));
  function save() {
    if (!intoId) return setError("กรุณาเลือกรายการที่จะรวมเข้าไป");
    void run(async () => {
      const result = await apiJson<{ moved: number; group: InventoryGroup }>(`${inventoryApi(kind)}/groups/${from.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ intoId }),
      });
      onMerged(`ย้าย ${result.moved} ชิ้นไปที่ "${result.group.name}" และลบรายการ "${from.name}" แล้ว`);
    });
  }
  return (
    <Modal error={error} title={`รวมรายการ "${from.name}"`} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} saving={saving} label="รวมรายการ" />}>
      <p className="mb-3 text-sm text-gray-600">
        ย้ายทั้ง {itemCount} ชิ้นของรายการนี้ไปอยู่รายการที่เลือก แล้วลบรายการนี้ทิ้ง — ใช้กับรุ่นเดียวกันที่สร้างไว้ซ้ำ
      </p>
      <Field label="รวมเข้ากับ" required>
        <SearchableDropdown options={options} value={intoId} onChange={setIntoId} placeholder="เลือกรายการ" />
      </Field>
    </Modal>
  );
}
