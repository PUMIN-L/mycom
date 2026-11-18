"use client";

import { useEffect, useMemo, useState } from "react";
import AccountingFrame from "../AccountingFrame";
import PasswordConfirmDialog from "../PasswordConfirmDialog";
import ConfirmDialog from "../../components/ConfirmDialog";
import SearchableDropdown from "../../components/SearchableDropdown";
import Spinner from "../../components/Spinner";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { HEAD_OFFICE_BRANCH, formatTaxId, normalizeBranchCode } from "../../lib/thaiTaxId";
import {
  bankAccountProblems,
  cleanBankAccount,
  cleanSellerProfile,
  creditDaysProblem,
  sellerProfileProblems,
  vatRateProblem,
  SELLER_LIMITS,
  BANK_LIMITS,
  type BankAccountInput,
} from "../../lib/accounting/sellerProfile";
import type { AccountingSettings, BankAccount, SellerProfile } from "../../lib/accounting/types";

type Draft = Record<keyof SellerProfile, string> & { vatRate: string; creditDays: string };
type FieldKey = keyof Draft;

const LABEL = "block text-sm font-semibold text-gray-700 mb-1.5";
function inputClass(invalid: boolean) {
  return `w-full border rounded-xl px-4 py-2.5 outline-none transition-all focus:ring-2 ${
    invalid ? "bg-red-50 border-red-500 focus:ring-red-500" : "bg-white border-gray-200 focus:ring-sky-500"
  }`;
}

function draftOf(s: AccountingSettings): Draft {
  return {
    ...s.seller,
    taxId: s.seller.taxId,
    branchCode: s.seller.branchCode || HEAD_OFFICE_BRANCH,
    vatRate: String(s.vatRate),
    creditDays: String(s.creditDays),
  };
}

/** What is wrong with the draft, field by field (the same rules the API applies). */
function problemsOf(d: Draft): Partial<Record<FieldKey, string>> {
  const problems: Partial<Record<FieldKey, string>> = { ...sellerProfileProblems(cleanSellerProfile(d)) };
  const vat = vatRateProblem(d.vatRate.trim());
  if (vat) problems.vatRate = vat;
  const credit = creditDaysProblem(d.creditDays.trim());
  if (credit) problems.creditDays = credit;
  return problems;
}

export default function AccountingSettingsPage() {
  return (
    <AccountingFrame tab="settings" title="ตั้งค่าบัญชี">
      <SettingsBody />
    </AccountingFrame>
  );
}

function SettingsBody() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<AccountingSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<Partial<Record<FieldKey, string>>>({});
  const [askPassword, setAskPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Bumped by ลองใหม่. "loading" is set by whoever bumps it (and is the first
  // state), never synchronously inside the effect.
  const [loadKey, setLoadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/settings", { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดการตั้งค่าบัญชีไม่สำเร็จ");
          if (cancelled) return;
          setLoadError(message);
          setStatus("error");
          return;
        }
        const body: AccountingSettings = await res.json();
        if (cancelled) return;
        setSettings(body);
        setDraft(draftOf(body));
        setStatus("ok");
      } catch {
        if (cancelled) return;
        setLoadError("โหลดการตั้งค่าบัญชีไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  const original = useMemo(() => (settings ? draftOf(settings) : null), [settings]);
  const dirty = !!draft && !!original && (Object.keys(original) as FieldKey[]).some((k) => original[k] !== draft[k]);

  // A refresh or a closed tab with changes still unsaved asks first.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (status === "error" || !draft || !settings) {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">{loadError}</p>
        <button type="button" onClick={() => { setStatus("loading"); setLoadKey((n) => n + 1); }} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">
          ลองใหม่
        </button>
      </div>
    );
  }

  const local = problemsOf(draft);
  const problem = (field: FieldKey) => (submitAttempted ? local[field] ?? serverProblems[field] : serverProblems[field]);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setServerProblems({});
    setNotice(null);
  };

  const branchMode = draft.branchCode === HEAD_OFFICE_BRANCH ? "head" : "branch";

  const requestSave = () => {
    setSubmitAttempted(true);
    const first = (Object.keys(local) as FieldKey[])[0];
    if (first) {
      document.getElementById(`acc-${first}`)?.focus();
      return;
    }
    setAskPassword(true);
  };

  const save = async (password: string): Promise<string | null> => {
    const res = await fetch("/api/accounting/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seller: cleanSellerProfile(draft),
        vatRate: Number(draft.vatRate),
        creditDays: Number(draft.creditDays),
        password,
      }),
    });
    if (res.ok) {
      const body: AccountingSettings = await res.json();
      setSettings(body);
      setDraft(draftOf(body));
      setSubmitAttempted(false);
      setNotice("บันทึกการตั้งค่าแล้ว");
      return null;
    }
    if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      if (body?.fields) setServerProblems(body.fields);
      setAskPassword(false);
      return null; // the field shows it
    }
    return errorMessageOf(res, "บันทึกการตั้งค่าบัญชีไม่สำเร็จ");
  };

  const field = (key: keyof SellerProfile, label: string, opts: { required?: boolean; max?: number; placeholder?: string; inputMode?: "numeric" | "email" } = {}) => (
    <div>
      <label htmlFor={`acc-${key}`} className={LABEL}>
        {label} {opts.required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={`acc-${key}`}
        type="text"
        inputMode={opts.inputMode}
        maxLength={opts.max}
        aria-invalid={!!problem(key) || undefined}
        aria-describedby={problem(key) ? `acc-${key}-error` : undefined}
        className={inputClass(!!problem(key))}
        placeholder={opts.placeholder}
        value={draft[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)}
      />
      {problem(key) && <p id={`acc-${key}-error`} className="mt-1.5 text-sm text-red-600">{problem(key)}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {!settings.sellerVersionId && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร — กรอกให้ครบแล้วกดบันทึกก่อนเริ่มออกใบแจ้งหนี้
          (ที่อยู่และเบอร์โทรด้านล่างดึงมาจากข้อมูลบนเว็บไซต์ ตรวจให้ตรงกับที่จดทะเบียน)
        </p>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4" aria-labelledby="acc-seller-title">
        <h2 id="acc-seller-title" className="text-lg font-bold text-gray-900">ข้อมูลบริษัท (พิมพ์บนใบแจ้งหนี้/ใบกำกับภาษี)</h2>
        {field("name", "ชื่อบริษัทตามที่จดทะเบียน", { required: true, max: SELLER_LIMITS.name, placeholder: "บริษัท … จำกัด" })}
        <div>
          <label htmlFor="acc-address" className={LABEL}>
            ที่อยู่ตามที่จดทะเบียน <span className="text-red-500">*</span>
          </label>
          <textarea
            id="acc-address"
            rows={3}
            maxLength={SELLER_LIMITS.address}
            aria-invalid={!!problem("address") || undefined}
            aria-describedby={problem("address") ? "acc-address-error" : undefined}
            className={`${inputClass(!!problem("address"))} resize-none`}
            value={draft.address}
            onChange={(e) => set({ address: e.target.value })}
          />
          {problem("address") && <p id="acc-address-error" className="mt-1.5 text-sm text-red-600">{problem("address")}</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("taxId", "เลขประจำตัวผู้เสียภาษี (13 หลัก)", { required: true, max: 17, inputMode: "numeric", placeholder: "0105512345678" })}
          <div>
            <label htmlFor="acc-branchMode" className={LABEL}>สำนักงานใหญ่ / สาขา</label>
            <div className="flex gap-2">
              <SearchableDropdown
                id="acc-branchMode"
                value={branchMode}
                onChange={(mode) => set({ branchCode: mode === "head" ? HEAD_OFFICE_BRANCH : "" })}
                options={[
                  { value: "head", label: "สำนักงานใหญ่" },
                  { value: "branch", label: "สาขา" },
                ]}
                searchable={false}
                className="w-40 shrink-0"
                buttonClassName="h-[46px] rounded-xl !border-gray-200"
              />
              {branchMode === "branch" && (
                <input
                  id="acc-branchCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  aria-label="เลขสาขา"
                  aria-invalid={!!problem("branchCode") || undefined}
                  className={inputClass(!!problem("branchCode"))}
                  placeholder="เลขสาขา เช่น 00001"
                  value={draft.branchCode}
                  onChange={(e) => set({ branchCode: e.target.value.replace(/\D/g, "") })}
                  onBlur={() => {
                    const code = normalizeBranchCode(draft.branchCode);
                    if (code && code !== HEAD_OFFICE_BRANCH) set({ branchCode: code });
                  }}
                />
              )}
            </div>
            {problem("branchCode") && <p className="mt-1.5 text-sm text-red-600">{problem("branchCode")}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("phone", "เบอร์โทร (พิมพ์บนเอกสาร)", { max: SELLER_LIMITS.phone })}
          {field("email", "อีเมล (พิมพ์บนเอกสาร)", { max: SELLER_LIMITS.email, inputMode: "email" })}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4" aria-labelledby="acc-tax-title">
        <h2 id="acc-tax-title" className="text-lg font-bold text-gray-900">ภาษีและเครดิต</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="acc-vatRate" className={LABEL}>ภาษีมูลค่าเพิ่ม (%)</label>
            <input
              id="acc-vatRate"
              type="text"
              inputMode="decimal"
              aria-invalid={!!problem("vatRate") || undefined}
              className={inputClass(!!problem("vatRate"))}
              value={draft.vatRate}
              onChange={(e) => set({ vatRate: e.target.value })}
            />
            {problem("vatRate") && <p className="mt-1.5 text-sm text-red-600">{problem("vatRate")}</p>}
          </div>
          <div>
            <label htmlFor="acc-creditDays" className={LABEL}>เครดิตเริ่มต้นของใบแจ้งหนี้ (วัน)</label>
            <input
              id="acc-creditDays"
              type="text"
              inputMode="numeric"
              aria-invalid={!!problem("creditDays") || undefined}
              className={inputClass(!!problem("creditDays"))}
              value={draft.creditDays}
              onChange={(e) => set({ creditDays: e.target.value })}
            />
            {problem("creditDays") && <p className="mt-1.5 text-sm text-red-600">{problem("creditDays")}</p>}
            <p className="mt-1 text-xs text-gray-500">ใช้คำนวณวันครบกำหนดอัตโนมัติ แก้ได้ในแต่ละใบ</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {notice && <p role="status" className="text-sm font-semibold text-green-700 mr-auto">{notice}</p>}
        {dirty && (
          <button type="button" onClick={() => { setDraft(original); setSubmitAttempted(false); setServerProblems({}); }}
            className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50">
            ยกเลิกการแก้ไข
          </button>
        )}
        <button type="button" onClick={requestSave} disabled={!dirty && !!settings.sellerVersionId}
          className="px-6 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed">
          บันทึกการตั้งค่า
        </button>
      </div>

      <BankAccounts accounts={settings.bankAccounts} onChanged={(bankAccounts) => setSettings((s) => (s ? { ...s, bankAccounts } : s))} />

      {askPassword && (
        <PasswordConfirmDialog
          title="ยืนยันการบันทึกข้อมูลบริษัท"
          confirmText="บันทึก"
          onSubmit={save}
          onCancel={() => setAskPassword(false)}
          onDone={() => setAskPassword(false)}
        >
          <p>ข้อมูลนี้จะพิมพ์บนใบแจ้งหนี้และใบกำกับภาษีที่ออกหลังจากนี้ (ใบเก่ายังพิมพ์ข้อมูลเดิม)</p>
          {draft.taxId && <p className="tabular-nums">เลขผู้เสียภาษี {formatTaxId(draft.taxId)}</p>}
        </PasswordConfirmDialog>
      )}
    </div>
  );
}

// ── Bank accounts ────────────────────────────────────────────────────────────

const EMPTY_BANK: BankAccountInput = { bankName: "", accountNo: "", accountName: "" };

function BankAccounts({ accounts, onChanged }: { accounts: BankAccount[]; onChanged: (accounts: BankAccount[]) => void }) {
  const [editing, setEditing] = useState<{ id: string | null; draft: BankAccountInput } | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BankAccount | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = async () => {
    const res = await fetch("/api/accounting/bank-accounts", { cache: "no-store" });
    if (res.ok) onChanged(await res.json());
  };

  const problems = editing ? bankAccountProblems(cleanBankAccount(editing.draft)) : {};

  const save = async () => {
    if (!editing || busy) return;
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const target = editing.id;
      const current = accounts.find((a) => a.id === target);
      const res = await fetch(target ? `/api/accounting/bank-accounts/${encodeURIComponent(target)}` : "/api/accounting/bank-accounts", {
        method: target ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cleanBankAccount(editing.draft), isActive: current ? current.isActive : true }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "บันทึกบัญชีธนาคารไม่สำเร็จ"));
        return;
      }
      setEditing(null);
      setAttempted(false);
      await reload();
    } catch {
      setError("บันทึกบัญชีธนาคารไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (account: BankAccount) => {
    const res = await fetch(`/api/accounting/bank-accounts/${encodeURIComponent(account.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName: account.bankName, accountNo: account.accountNo, accountName: account.accountName, isActive: !account.isActive }),
    });
    if (res.ok) await reload();
    else setMessage(await errorMessageOf(res, "เปลี่ยนสถานะบัญชีไม่สำเร็จ"));
  };

  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    const res = await fetch(`/api/accounting/bank-accounts/${encodeURIComponent(target.id)}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage(await errorMessageOf(res, "ลบบัญชีธนาคารไม่สำเร็จ"));
      return;
    }
    const body = await res.json().catch(() => ({}));
    setMessage(body?.outcome === "deactivated" ? `ปิดใช้บัญชี ${target.bankName} แทนการลบ เพราะมีรายการรับเงินอ้างถึงบัญชีนี้` : null);
    await reload();
  };

  const bankField = (key: keyof BankAccountInput, label: string, max: number, placeholder: string) => {
    const problem = attempted ? problems[key] : undefined;
    return (
      <div>
        <label htmlFor={`bank-${key}`} className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
        <input
          id={`bank-${key}`}
          type="text"
          maxLength={max}
          inputMode={key === "accountNo" ? "numeric" : undefined}
          aria-invalid={!!problem || undefined}
          className={inputClass(!!problem)}
          placeholder={placeholder}
          value={editing?.draft[key] ?? ""}
          onChange={(e) => setEditing((ed) => (ed ? { ...ed, draft: { ...ed.draft, [key]: e.target.value } } : ed))}
        />
        {problem && <p className="mt-1 text-sm text-red-600">{problem}</p>}
      </div>
    );
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4" aria-labelledby="acc-bank-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="acc-bank-title" className="text-lg font-bold text-gray-900">บัญชีธนาคารที่รับเงิน</h2>
        {!editing && (
          <button type="button" onClick={() => { setEditing({ id: null, draft: EMPTY_BANK }); setAttempted(false); setError(null); }}
            className="px-4 py-2 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50">
            + เพิ่มบัญชี
          </button>
        )}
      </div>
      {message && <p role="status" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">{message}</p>}

      {accounts.length === 0 && !editing && <p className="text-sm text-gray-500">ยังไม่มีบัญชีธนาคาร — เพิ่มไว้เพื่อเลือกตอนบันทึกรับเงิน</p>}
      <ul className="divide-y divide-gray-100">
        {accounts.map((a) => (
          <li key={a.id} className={`py-3 flex flex-wrap items-center gap-3 ${a.isActive ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">{a.bankName} <span className="tabular-nums">{a.accountNo}</span></p>
              <p className="text-sm text-gray-500">{a.accountName || "—"}{a.isActive ? "" : " · ปิดใช้"}</p>
            </div>
            <button type="button" onClick={() => { setEditing({ id: a.id, draft: { bankName: a.bankName, accountNo: a.accountNo, accountName: a.accountName } }); setAttempted(false); setError(null); }}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">แก้ไข</button>
            <button type="button" onClick={() => void toggleActive(a)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
              {a.isActive ? "ปิดใช้" : "เปิดใช้"}
            </button>
            <button type="button" onClick={() => setRemoving(a)} className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50">ลบ</button>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {bankField("bankName", "ธนาคาร", BANK_LIMITS.bankName, "เช่น กสิกรไทย")}
            {bankField("accountNo", "เลขที่บัญชี", BANK_LIMITS.accountNo, "xxx-x-xxxxx-x")}
            {bankField("accountName", "ชื่อบัญชี", BANK_LIMITS.accountName, "ชื่อบริษัท")}
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(null); setError(null); }} disabled={busy}
              className="px-4 py-2 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">ยกเลิก</button>
            <button type="button" onClick={() => void save()} disabled={busy}
              className="px-4 py-2 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60">
              {busy ? "กำลังบันทึก…" : "บันทึกบัญชี"}
            </button>
          </div>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="ลบบัญชีธนาคาร"
          message={`ลบบัญชี ${removing.bankName} ${removing.accountNo}? ถ้ามีรายการรับเงินอ้างถึงบัญชีนี้แล้ว ระบบจะปิดใช้แทนการลบ`}
          confirmText="ลบ"
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
