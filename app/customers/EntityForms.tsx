"use client";

import { useRef, useState, type ReactNode } from "react";
import SearchableDropdown from "../components/SearchableDropdown";
import { errorMessageOf } from "../lib/apiErrorMessage";
import { thCompare } from "../lib/thCompare";
import { taxIdWarning } from "../lib/thaiTaxId";
import FormModal from "./FormModal";
import type { Company, Salesperson } from "./types";
import type { Customer } from "../lib/types";
import {
  COMPANY_NOTE_MAX,
  CUSTOMER_NOTE_MAX,
  FIELD_MAX,
  NAME_MAX,
  SALESPERSON_NOTE_MAX,
  companyErrors,
  customerErrors,
  duplicateCustomers,
  isDraftDirty,
  namesOf,
  provinceOptions,
  salespersonErrors,
  sameNameAs,
  toCompanyDraft,
  toCustomerDraft,
  toSalespersonDraft,
  type CompanyDraft,
  type CustomerDraft,
  type FieldErrors,
  type SalespersonDraft,
} from "./formHelpers";

const NETWORK_FAILED = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";

const LABEL = "block text-sm font-semibold text-gray-700 mb-1.5";
const ADDRESS_LABEL = "block text-xs font-semibold text-gray-600 mb-2";
const ADDRESS_INPUT =
  "w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all";
/** A field of the form: red once what is in it has been refused. */
function inputClass(invalid = false) {
  return `w-full border rounded-xl px-4 py-2.5 outline-none transition-all focus:bg-white focus:ring-2 ${
    invalid ? "bg-red-50 border-red-500 focus:ring-red-500" : "bg-gray-50 border-gray-200 focus:ring-orange-500"
  }`;
}
/** A dropdown drawn like the fields beside it. */
function dropdownClass(invalid = false, base = "!bg-gray-50") {
  return `h-[46px] rounded-xl px-4 py-2.5 !text-base transition-all outline-none focus:ring-2 ${
    invalid ? "!border-red-500 !bg-red-50 focus:ring-red-500" : `!border-gray-200 ${base} focus:ring-orange-500`
  }`;
}

/** What is wrong with a field, under it — in Thai, where the browser used to
 *  put "Please fill out this field." in a bubble. */
function Problem({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} data-field-error className="mt-1.5 text-sm text-red-600">
      {children}
    </p>
  );
}

/** Not wrong, but worth a look: it may already be on the list. */
function Notice({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="mt-1.5 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
      {children}
    </p>
  );
}

/**
 * A phone field. Free text: "02-123-4567 ต่อ 105", two numbers, "+66 …" —
 * every non-digit used to be deleted as it was typed, so the extension ran
 * into the number ("021234567105") and two numbers became one.
 */
function PhoneInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      id={id}
      type="tel"
      inputMode="tel"
      maxLength={FIELD_MAX}
      className={inputClass()}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A note: a box that grows with what is in it (to 40% of the screen, then it
 * scrolls) and counts against the column's size as you type. Editing a
 * customer used to show their whole call log in a two-line slot.
 */
function NoteField({
  id,
  label,
  value,
  onChange,
  max,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  error?: string;
  placeholder: string;
}) {
  const over = value.length > max;
  const nearlyFull = value.length >= max * 0.9;
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={over || undefined}
        aria-describedby={`${id}-count`}
        // Grows with the text: `height:auto` first lets it shrink again
        // after a deletion. The class caps it and lets it scroll past that.
        ref={(el) => {
          if (!el) return;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight + 2}px`;
        }}
        className={`${inputClass(over)} resize-none max-h-[40vh] overflow-y-auto`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      ></textarea>
      <p
        id={`${id}-count`}
        data-testid={`${id}-count`}
        className={`mt-1 text-xs tabular-nums ${over ? "text-red-600 font-semibold" : nearlyFull ? "text-amber-600 font-semibold" : "text-gray-400"}`}
      >
        {value.length.toLocaleString("th-TH")} / {max.toLocaleString("th-TH")}
        {error && <span data-field-error> — {error}</span>}
      </p>
    </div>
  );
}

/**
 * POST (new) or PUT (edit), with a lock: `saving` disables the button, and
 * the ref stops a second submit that arrives before React has re-rendered —
 * a double click used to create the same record twice. A refusal is kept as
 * `error`, and cleared when the next save starts.
 */
function useSave() {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (url: string, method: "POST" | "PUT", payload: unknown, fallback: string): Promise<{ body: unknown } | null> => {
    if (savingRef.current) return null;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let failed: string | null = null;
    let body: unknown = null;
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) failed = await errorMessageOf(res, fallback);
      else body = await res.json().catch(() => null);
    } catch {
      failed = NETWORK_FAILED;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (failed) {
      // Shown in the form, which stays open with what was typed.
      setError(failed);
      return null;
    }
    return { body };
  };
  return { saving, savingRef, error, run };
}

/** The id a POST answered with (`{ id }`, or the created row). */
function idFrom(body: unknown): string {
  return body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string"
    ? (body as { id: string }).id
    : "";
}

/** The cursor on the first field that is wrong — in the order given. */
function focusFirstProblem<T>(prefix: string, order: readonly (keyof T)[], errors: FieldErrors<T>): boolean {
  const first = order.find((field) => errors[field]);
  if (!first) return false;
  document.getElementById(`${prefix}-${String(first)}`)?.focus();
  return true;
}

// ── Company ──────────────────────────────────────────────────────────────────

const COMPANY_ORDER = ["name", "taxId", "branchCode", "note"] as const;

/** The usual withholding rates — what a customer deducts when it pays. */
const WHT_OPTIONS = [
  { value: "", label: "ไม่หักประจำ" },
  { value: "1", label: "1% (ค่าขนส่ง)" },
  { value: "2", label: "2% (ค่าโฆษณา)" },
  { value: "3", label: "3% (ค่าบริการ / จ้างทำของ)" },
  { value: "5", label: "5% (ค่าเช่า)" },
];

/** The branch picker's three states, read from the draft (formHelpers.branchDraftOf). */
/** The เซลล์ผู้ดูแล picker: nobody first, then everyone ก→ฮ — and the saved
 *  one kept, named as unknown, when the list does not have them (it failed
 *  to load), so opening the form is not an edit. */
function caretakerOptions(salespeople: readonly Salesperson[], current: string) {
  const options = [
    { value: "", label: "— ไม่ระบุ —" },
    ...[...salespeople].sort((a, b) => thCompare(a.name, b.name)).map((s) => ({ value: s.id, label: s.name })),
  ];
  if (current && !salespeople.some((s) => s.id === current)) options.push({ value: current, label: "(ไม่พบในรายชื่อพนักงานขาย)" });
  return options;
}

function branchModeOf(branchCode: string): "" | "head" | "branch" {
  if (!branchCode.trim()) return "";
  return branchCode === "สำนักงานใหญ่" ? "head" : "branch";
}

export function CompanyForm({
  company,
  companies,
  salespeople,
  onClose,
  onSaved,
}: {
  /** The company to edit; none (or no id) adds one, starting from what is given. */
  company: Partial<Company> | null;
  /** Every company, to say when the name is already one of them. */
  companies: readonly Company[];
  /** Who can be its เซลล์ผู้ดูแล. */
  salespeople: readonly Salesperson[];
  onClose: () => void;
  onSaved: (saved: Company, isNew: boolean) => void;
}) {
  const editId = company?.id;
  const [original] = useState<CompanyDraft>(() => toCompanyDraft(company as Record<string, unknown> | null));
  const [draft, setDraft] = useState<CompanyDraft>(original);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { saving, savingRef, error, run } = useSave();
  const set = (patch: Partial<CompanyDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const errors = companyErrors(draft);
  const nameProblem = submitAttempted ? errors.name : undefined;
  const branchProblem = submitAttempted ? errors.branchCode : undefined;
  const taxIdNote = taxIdWarning(draft.taxId);
  const branchMode = branchModeOf(draft.branchCode);
  const branchNo = branchMode === "branch" ? draft.branchCode.replace(/^สาขา\s*/, "") : "";
  const whtOptions = WHT_OPTIONS.some((o) => o.value === draft.whtPercent)
    ? WHT_OPTIONS
    : [...WHT_OPTIONS, { value: draft.whtPercent, label: `${draft.whtPercent}%` }];
  const sameName = sameNameAs(companies, draft.name, editId);
  const salespersonOptions = caretakerOptions(salespeople, draft.salespersonId);

  const save = async () => {
    if (savingRef.current) return;
    setSubmitAttempted(true);
    if (focusFirstProblem<CompanyDraft>("company", COMPANY_ORDER, errors)) return;
    const payload: CompanyDraft = { ...draft, name: draft.name.trim(), phone: draft.phone.trim() };
    const result = await run(
      editId ? `/api/companies/${encodeURIComponent(editId)}` : "/api/companies",
      editId ? "PUT" : "POST",
      payload,
      editId ? "บันทึกข้อมูลบริษัทไม่สำเร็จ" : "เพิ่มบริษัทไม่สำเร็จ"
    );
    if (result) onSaved({ ...payload, id: editId || idFrom(result.body) }, !editId);
  };

  const addressField = (field: keyof CompanyDraft, label: string) => (
    <div>
      <label htmlFor={`company-${field}`} className={ADDRESS_LABEL}>{label}</label>
      <input
        id={`company-${field}`}
        type="text"
        maxLength={FIELD_MAX}
        className={ADDRESS_INPUT}
        value={draft[field]}
        onChange={(e) => set({ [field]: e.target.value })}
      />
    </div>
  );

  return (
    <FormModal
      formId="company-form"
      title={editId ? "แก้ไขข้อมูลบริษัท" : "เพิ่มบริษัทใหม่"}
      subject={editId ? original.name : undefined}
      maxWidthClass="max-w-3xl"
      dirty={isDraftDirty(original, draft)}
      saving={saving}
      error={error}
      onSubmit={save}
      onClose={onClose}
    >
      <div className="space-y-6">
        <div>
          <label htmlFor="company-name" className={LABEL}>ชื่อบริษัท <span className="text-red-500">*</span></label>
          <input
            id="company-name"
            type="text"
            maxLength={NAME_MAX}
            aria-required="true"
            aria-invalid={!!nameProblem || undefined}
            aria-describedby={nameProblem ? "company-name-error" : undefined}
            className={inputClass(!!nameProblem)}
            placeholder="บริษัท เอบีซี จำกัด"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          {nameProblem && <Problem id="company-name-error">{nameProblem}</Problem>}
          {sameName.length > 0 && (
            <Notice testId="duplicate-company">
              มีบริษัทชื่อนี้อยู่แล้ว: {namesOf(sameName)} — ถ้าเป็นคนละบริษัท (เช่น คนละสาขา) บันทึกต่อได้
            </Notice>
          )}
        </div>

        <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100 space-y-4">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">ข้อมูลที่อยู่</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addressField("addressNo", "เลขที่/อาคาร")}
            {addressField("moo", "หมู่")}
            {addressField("soi", "ซอย")}
            {addressField("road", "ถนน")}
            {addressField("subDistrict", "ตำบล/แขวง")}
            {addressField("district", "อำเภอ/เขต")}
            <div>
              <label htmlFor="company-province" className={ADDRESS_LABEL}>จังหวัด</label>
              {/* Picked from the 77, not typed: "กรุงเทพฯ", "กทม." and
                  "กรุงเทพมหานคร" used to be three provinces to a search. */}
              <SearchableDropdown
                id="company-province"
                value={draft.province}
                onChange={(province) => set({ province })}
                placeholder="— ไม่ระบุ —"
                options={provinceOptions(draft.province)}
                buttonClassName={dropdownClass(false, "!bg-white")}
              />
            </div>
            <div>
              <label htmlFor="company-postalCode" className={ADDRESS_LABEL}>รหัสไปรษณีย์</label>
              <input
                id="company-postalCode"
                type="text"
                inputMode="numeric"
                maxLength={FIELD_MAX}
                className={`${ADDRESS_INPUT} tabular-nums`}
                value={draft.postalCode}
                onChange={(e) => set({ postalCode: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="company-phone" className={LABEL}>เบอร์โทรศัพท์</label>
          <PhoneInput id="company-phone" value={draft.phone} onChange={(phone) => set({ phone })} placeholder="เช่น 02-123-4567 ต่อ 105" />
        </div>

        <div>
          <label htmlFor="company-salespersonId" className={LABEL}>เซลล์ผู้ดูแล</label>
          {/* Optional, one per company (v57). The list is the พนักงานขาย tab's. */}
          <SearchableDropdown
            id="company-salespersonId"
            value={draft.salespersonId}
            onChange={(salespersonId) => set({ salespersonId })}
            options={salespersonOptions}
            buttonClassName={dropdownClass()}
          />
        </div>

        {/* What a tax invoice prints for this buyer, and what it usually
            withholds when it pays — the accounting module fills both in. */}
        <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100 space-y-4" data-testid="company-tax">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">ข้อมูลภาษี (สำหรับใบกำกับภาษี)</h3>
          <div>
            <label htmlFor="company-taxId" className={ADDRESS_LABEL}>เลขประจำตัวผู้เสียภาษี</label>
            <input
              id="company-taxId"
              type="text"
              inputMode="numeric"
              maxLength={30}
              aria-describedby={taxIdNote ? "company-taxId-note" : undefined}
              className={`${ADDRESS_INPUT} tabular-nums`}
              placeholder="13 หลัก เช่น 0105512345678"
              value={draft.taxId}
              onChange={(e) => set({ taxId: e.target.value })}
            />
            {taxIdNote && (
              <p id="company-taxId-note" className="mt-1.5 text-sm text-amber-700">{taxIdNote}</p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-branchMode" className={ADDRESS_LABEL}>สำนักงานใหญ่ / สาขา</label>
              <SearchableDropdown
                id="company-branchMode"
                value={branchMode}
                onChange={(mode) => set({ branchCode: mode === "head" ? "สำนักงานใหญ่" : mode === "branch" ? "สาขา " : "" })}
                options={[
                  { value: "", label: "ไม่ระบุ" },
                  { value: "head", label: "สำนักงานใหญ่" },
                  { value: "branch", label: "สาขา (ระบุเลขสาขา)" },
                ]}
                searchable={false}
                buttonClassName={dropdownClass(false, "!bg-white")}
              />
            </div>
            {branchMode === "branch" && (
              <div>
                <label htmlFor="company-branchCode" className={ADDRESS_LABEL}>เลขสาขา</label>
                <input
                  id="company-branchCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  aria-invalid={!!branchProblem || undefined}
                  aria-describedby={branchProblem ? "company-branchCode-error" : undefined}
                  className={branchProblem ? inputClass(true) : `${ADDRESS_INPUT} tabular-nums`}
                  placeholder="เช่น 00001"
                  value={branchNo}
                  onChange={(e) => set({ branchCode: `สาขา ${e.target.value.replace(/\D/g, "")}` })}
                />
                {branchProblem && <Problem id="company-branchCode-error">{branchProblem}</Problem>}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="company-whtPercent" className={ADDRESS_LABEL}>หัก ณ ที่จ่ายประจำ (ตอนลูกค้าจ่ายเงิน)</label>
            <SearchableDropdown
              id="company-whtPercent"
              value={draft.whtPercent}
              onChange={(whtPercent) => set({ whtPercent })}
              options={whtOptions}
              searchable={false}
              buttonClassName={dropdownClass(false, "!bg-white")}
            />
          </div>
        </div>

        <NoteField
          id="company-note"
          label="หมายเหตุ"
          value={draft.note}
          onChange={(note) => set({ note })}
          max={COMPANY_NOTE_MAX}
          error={errors.note}
          placeholder="ข้อมูลเพิ่มเติม..."
        />
      </div>
    </FormModal>
  );
}

// ── Customer ─────────────────────────────────────────────────────────────────

const CUSTOMER_ORDER = ["name", "companyId", "email", "note"] as const;

export function CustomerForm({
  customer,
  companies,
  customers,
  salespeople,
  onClose,
  onSaved,
  onCompanyCreated,
}: {
  /** The customer to edit (a full row — its note is sent back whole), or
   *  `{ companyId }` / nothing to add one. */
  customer: Partial<Customer> | null;
  companies: readonly Company[];
  /** Every customer, to say when this looks like one of them. */
  customers: readonly Customer[];
  /** For the company form it can open: who can be the new company's เซลล์ผู้ดูแล. */
  salespeople: readonly Salesperson[];
  onClose: () => void;
  onSaved: (saved: CustomerDraft & { id: string }, isNew: boolean) => void;
  /** A company was added from inside this form: the host puts it on its list. */
  onCompanyCreated: (company: Company) => void;
}) {
  const editId = customer?.id;
  const [original] = useState<CustomerDraft>(() => toCustomerDraft(customer as Record<string, unknown> | null));
  const [draft, setDraft] = useState<CustomerDraft>(original);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { saving, savingRef, error, run } = useSave();
  const set = (patch: Partial<CustomerDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // The company is not on the list yet: it is added from here, on top of this
  // form — which used to mean closing the form (and losing it), adding the
  // company on its own tab, and starting again.
  // Holds the name the new company's form opens with (null: not adding one).
  const [newCompanyName, setNewCompanyName] = useState<string | null>(null);
  // What was last typed into the company list's search — the likely name.
  const companySearchRef = useRef("");

  const errors = customerErrors(draft, companies);
  const problem = (field: keyof CustomerDraft) => (submitAttempted ? errors[field] : undefined);
  const duplicates = duplicateCustomers(customers, draft, editId);

  const save = async () => {
    if (savingRef.current) return;
    setSubmitAttempted(true);
    if (focusFirstProblem<CustomerDraft>("customer", CUSTOMER_ORDER, errors)) return;
    // Every field, the note included: PUT reads a missing note as an empty
    // one and would erase the call log.
    const payload: CustomerDraft = { ...draft, name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim() };
    const result = await run(
      editId ? `/api/customers/${encodeURIComponent(editId)}` : "/api/customers",
      editId ? "PUT" : "POST",
      payload,
      editId ? "บันทึกข้อมูลลูกค้าไม่สำเร็จ" : "เพิ่มลูกค้าไม่สำเร็จ"
    );
    if (result) onSaved({ ...payload, id: editId || idFrom(result.body) }, !editId);
  };

  return (
    <>
      <FormModal
        formId="customer-form"
        title={editId ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้าใหม่"}
        subject={editId ? original.name : undefined}
        dirty={isDraftDirty(original, draft)}
        saving={saving}
        error={error}
        onSubmit={save}
        onClose={onClose}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label htmlFor="customer-name" className={LABEL}>ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
            <input
              id="customer-name"
              type="text"
              maxLength={NAME_MAX}
              aria-required="true"
              aria-invalid={!!problem("name") || undefined}
              aria-describedby={problem("name") ? "customer-name-error" : undefined}
              className={inputClass(!!problem("name"))}
              placeholder="สมหญิง ใจดี"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            {problem("name") && <Problem id="customer-name-error">{problem("name")}</Problem>}
            {duplicates.sameName.length > 0 && (
              <Notice testId="duplicate-customer">มีลูกค้าชื่อนี้ในบริษัทนี้อยู่แล้ว — ถ้าเป็นคนละคน บันทึกต่อได้</Notice>
            )}
          </div>
          <div>
            <label htmlFor="customer-companyId" className={LABEL}>สังกัดบริษัท <span className="text-red-500">*</span></label>
            {/* Every dropdown in this project is SearchableDropdown — a native
                <select> opens as a dark grey OS popup on a dark-mode machine.
                The list of companies is long, so it keeps its search box. */}
            <SearchableDropdown
              id="customer-companyId"
              value={draft.companyId}
              onChange={(companyId) => {
                set({ companyId });
                companySearchRef.current = "";
              }}
              onSearchChange={(search) => {
                if (search.trim()) companySearchRef.current = search.trim();
              }}
              placeholder="-- เลือกบริษัท --"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              describedBy={problem("companyId") ? "customer-companyId-error" : undefined}
              buttonClassName={dropdownClass(!!problem("companyId"))}
            />
            {problem("companyId") && <Problem id="customer-companyId-error">{problem("companyId")}</Problem>}
            <button
              type="button"
              onClick={() => setNewCompanyName(companySearchRef.current)}
              className="mt-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
            >
              + เพิ่มบริษัทใหม่
            </button>
          </div>
          <div>
            <label htmlFor="customer-department" className={LABEL}>แผนก</label>
            <input
              id="customer-department"
              type="text"
              maxLength={FIELD_MAX}
              className={inputClass()}
              placeholder="เช่น บัญชี, การตลาด"
              value={draft.department}
              onChange={(e) => set({ department: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="customer-phone" className={LABEL}>เบอร์โทรศัพท์</label>
            <PhoneInput id="customer-phone" value={draft.phone} onChange={(phone) => set({ phone })} placeholder="เช่น 081-234-5678" />
            {duplicates.samePhone.length > 0 && (
              <Notice testId="duplicate-phone">เบอร์นี้ตรงกับของ {namesOf(duplicates.samePhone)}</Notice>
            )}
          </div>
          <div>
            <label htmlFor="customer-email" className={LABEL}>อีเมล</label>
            <input
              id="customer-email"
              type="email"
              maxLength={FIELD_MAX}
              aria-invalid={!!problem("email") || undefined}
              aria-describedby={problem("email") ? "customer-email-error" : undefined}
              className={inputClass(!!problem("email"))}
              placeholder="example@email.com"
              value={draft.email}
              onChange={(e) => set({ email: e.target.value })}
            />
            {problem("email") && <Problem id="customer-email-error">{problem("email")}</Problem>}
          </div>
          <div className="md:col-span-2">
            <NoteField
              id="customer-note"
              label="บันทึกลูกค้า"
              value={draft.note}
              onChange={(note) => set({ note })}
              max={CUSTOMER_NOTE_MAX}
              error={errors.note}
              placeholder="บันทึกลูกค้า..."
            />
          </div>
        </div>
      </FormModal>

      {newCompanyName !== null && (
        <CompanyForm
          company={{ name: newCompanyName }}
          companies={companies}
          salespeople={salespeople}
          onClose={() => setNewCompanyName(null)}
          onSaved={(saved) => {
            setNewCompanyName(null);
            onCompanyCreated(saved);
            // Picked for this customer at once — that is what it was added for.
            if (saved.id) set({ companyId: saved.id });
          }}
        />
      )}
    </>
  );
}

// ── Salesperson ──────────────────────────────────────────────────────────────

const SALESPERSON_ORDER = ["name", "email", "note"] as const;

export function SalespersonForm({
  salesperson,
  salespeople,
  onClose,
  onSaved,
}: {
  salesperson: Partial<Salesperson> | null;
  /** Every salesperson, to say when the name is already one of them. */
  salespeople: readonly Salesperson[];
  onClose: () => void;
  onSaved: (saved: Salesperson, isNew: boolean) => void;
}) {
  const editId = salesperson?.id;
  const [original] = useState<SalespersonDraft>(() => toSalespersonDraft(salesperson as Record<string, unknown> | null));
  const [draft, setDraft] = useState<SalespersonDraft>(original);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { saving, savingRef, error, run } = useSave();
  const set = (patch: Partial<SalespersonDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const errors = salespersonErrors(draft);
  const problem = (field: keyof SalespersonDraft) => (submitAttempted ? errors[field] : undefined);
  const sameName = sameNameAs(salespeople, draft.name, editId);

  const save = async () => {
    if (savingRef.current) return;
    setSubmitAttempted(true);
    if (focusFirstProblem<SalespersonDraft>("salesperson", SALESPERSON_ORDER, errors)) return;
    const payload: SalespersonDraft = { ...draft, name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim() };
    const result = await run(
      editId ? `/api/salespeople/${encodeURIComponent(editId)}` : "/api/salespeople",
      editId ? "PUT" : "POST",
      payload,
      editId ? "บันทึกข้อมูลพนักงานขายไม่สำเร็จ" : "เพิ่มพนักงานขายไม่สำเร็จ"
    );
    if (result) onSaved({ ...payload, id: editId || idFrom(result.body) }, !editId);
  };

  return (
    <FormModal
      formId="salesperson-form"
      title={editId ? "แก้ไขข้อมูลพนักงานขาย" : "เพิ่มพนักงานขายใหม่"}
      subject={editId ? original.name : undefined}
      dirty={isDraftDirty(original, draft)}
      saving={saving}
      error={error}
      onSubmit={save}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label htmlFor="salesperson-name" className={LABEL}>ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
          <input
            id="salesperson-name"
            type="text"
            maxLength={NAME_MAX}
            aria-required="true"
            aria-invalid={!!problem("name") || undefined}
            aria-describedby={problem("name") ? "salesperson-name-error" : undefined}
            className={inputClass(!!problem("name"))}
            placeholder="สมชาย ยอดขาย"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          {problem("name") && <Problem id="salesperson-name-error">{problem("name")}</Problem>}
          {sameName.length > 0 && <Notice testId="duplicate-salesperson">มีพนักงานขายชื่อนี้อยู่แล้ว</Notice>}
        </div>
        <div>
          <label htmlFor="salesperson-phone" className={LABEL}>เบอร์โทรศัพท์</label>
          <PhoneInput id="salesperson-phone" value={draft.phone} onChange={(phone) => set({ phone })} placeholder="เช่น 081-234-5678" />
        </div>
        <div>
          <label htmlFor="salesperson-email" className={LABEL}>อีเมล</label>
          <input
            id="salesperson-email"
            type="email"
            maxLength={FIELD_MAX}
            aria-invalid={!!problem("email") || undefined}
            aria-describedby={problem("email") ? "salesperson-email-error" : undefined}
            className={inputClass(!!problem("email"))}
            placeholder="example@email.com"
            value={draft.email}
            onChange={(e) => set({ email: e.target.value })}
          />
          {problem("email") && <Problem id="salesperson-email-error">{problem("email")}</Problem>}
        </div>
        <div className="md:col-span-2">
          <NoteField
            id="salesperson-note"
            label="หมายเหตุ"
            value={draft.note}
            onChange={(note) => set({ note })}
            max={SALESPERSON_NOTE_MAX}
            error={errors.note}
            placeholder="ข้อมูลเพิ่มเติม..."
          />
        </div>
      </div>
    </FormModal>
  );
}
