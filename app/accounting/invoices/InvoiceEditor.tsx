"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DatePicker from "../../components/DatePicker";
import SearchableDropdown from "../../components/SearchableDropdown";
import Spinner from "../../components/Spinner";
import { useModalEscape } from "../../components/useModalEscape";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, toLocalDateString } from "../../lib/dateFormat";
import { normalizeBranchCode, taxIdWarning } from "../../lib/thaiTaxId";
import { companyAddressText } from "../../customers/companyAddress";
import { branchDraftOf } from "../../customers/formHelpers";
import { computeTotals, formatSatang, lineGrossSatang, parseBahtToSatang, withVatOverride, type PriceMode } from "../../lib/accounting/money";
import {
  EXTERNAL_LIMITS,
  INVOICE_LIMITS,
  defaultIsTaxInvoice,
  dueDateOf,
  externalProblems,
  invoiceProblems,
  invoiceTitle,
  issueProblems,
  type DocLineInput,
  type ExternalFields,
  type InvoiceInput,
  type LineType,
} from "../../lib/accounting/invoiceRules";
import type { SellerProfile } from "../../lib/accounting/types";
import type { AccountingLookups, LookupCompany } from "../useAccountingLookups";
import InvoicePaper from "./InvoicePaper";

/** A document as the API answers it — what the editor opens and gets back. */
export interface EditorDocument extends InvoiceInput {
  id: string;
  updatedAt: string;
  status: string;
  docNo: string | null;
}

interface LineDraft {
  key: string;
  lineType: LineType;
  productId: string;
  name: string;
  qty: string;
  unit: string;
  unitPrice: string;
  discount: string;
  isMachine: boolean;
  serials: string;
  warrantyMonths: string;
}

interface Draft {
  issueDate: string;
  creditDays: string;
  companyId: string;
  customerId: string;
  salespersonId: string;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  /** "" · "สำนักงานใหญ่" · "สาขา 00001" (customers/formHelpers.branchDraftOf). */
  buyerBranch: string;
  priceMode: PriceMode;
  discount: string;
  isTaxInvoice: boolean;
  /** Still following the goods/services rule — until the admin ticks the box himself. */
  taxInvoiceAuto: boolean;
  customerPoNo: string;
  projectName: string;
  note: string;
  lines: LineDraft[];
  /** Outside documents only: the number as printed, where the paper is kept, the VAT as printed ("" = the system's). */
  docNo: string;
  externalNote: string;
  vatOverride: string;
}

let keySeq = 0;
const newKey = () => `line-${++keySeq}`;
const moneyText = (satang: number) => (satang ? formatSatang(satang) : "");

const emptyLine = (): LineDraft => ({
  key: newKey(),
  lineType: "goods",
  productId: "",
  name: "",
  qty: "1",
  unit: "",
  unitPrice: "",
  discount: "",
  isMachine: false,
  serials: "",
  warrantyMonths: "",
});

function draftOf(doc: EditorDocument | null, creditDays: number): Draft {
  if (!doc) {
    return {
      issueDate: bangkokDateString(new Date()),
      creditDays: String(creditDays),
      companyId: "",
      customerId: "",
      salespersonId: "",
      buyerName: "",
      buyerAddress: "",
      buyerTaxId: "",
      buyerBranch: "",
      priceMode: "exclusive",
      discount: "",
      isTaxInvoice: true,
      taxInvoiceAuto: true,
      customerPoNo: "",
      projectName: "",
      note: "",
      lines: [emptyLine()],
      docNo: "",
      externalNote: "",
      vatOverride: "",
    };
  }
  return {
    issueDate: doc.issueDate,
    creditDays: String(doc.creditDays),
    companyId: doc.companyId,
    customerId: doc.customerId,
    salespersonId: doc.salespersonId,
    buyerName: doc.buyerName,
    buyerAddress: doc.buyerAddress,
    buyerTaxId: doc.buyerTaxId,
    buyerBranch: branchDraftOf(doc.buyerBranch),
    priceMode: doc.priceMode,
    discount: moneyText(doc.discountSatang),
    isTaxInvoice: doc.isTaxInvoice,
    taxInvoiceAuto: doc.isTaxInvoice === defaultIsTaxInvoice(doc.lines),
    customerPoNo: doc.customerPoNo,
    projectName: doc.projectName,
    note: doc.note,
    lines: doc.lines.map((l) => ({
      key: newKey(),
      lineType: l.lineType,
      productId: l.productId,
      name: l.name,
      qty: String(l.qty),
      unit: l.unit,
      unitPrice: formatSatang(l.unitPriceSatang),
      discount: moneyText(l.discountSatang),
      isMachine: l.isMachine,
      serials: l.serials,
      warrantyMonths: l.warrantyMonths === null ? "" : String(l.warrantyMonths),
    })),
    docNo: "",
    externalNote: "",
    vatOverride: "",
  };
}

/** The draft as the API takes it. Text that is not a number is sent as an impossible one (−1 / NaN) so the rules name it. */
function inputOf(d: Draft): InvoiceInput {
  const money = (text: string, emptyIs: number) => (text.trim() === "" ? emptyIs : parseBahtToSatang(text) ?? -1);
  return {
    issueDate: d.issueDate,
    creditDays: d.creditDays.trim() === "" ? 0 : Number.isInteger(Number(d.creditDays)) ? Number(d.creditDays) : -1,
    companyId: d.companyId,
    customerId: d.customerId,
    salespersonId: d.salespersonId,
    buyerName: d.buyerName.trim(),
    buyerAddress: d.buyerAddress.trim(),
    buyerTaxId: d.buyerTaxId.trim(),
    buyerBranch: normalizeBranchCode(d.buyerBranch) ?? "",
    priceMode: d.priceMode,
    discountSatang: money(d.discount, 0),
    isTaxInvoice: d.isTaxInvoice,
    customerPoNo: d.customerPoNo.trim(),
    projectName: d.projectName.trim(),
    note: d.note.trim(),
    lines: d.lines.map((l) => ({
      lineType: l.lineType,
      productId: l.productId,
      name: l.name.trim(),
      qty: l.qty.trim() === "" ? NaN : Number(l.qty.replace(/,/g, "")),
      unit: l.unit.trim(),
      unitPriceSatang: money(l.unitPrice, -1),
      discountSatang: money(l.discount, 0),
      isMachine: l.lineType === "goods" && l.isMachine,
      serials: l.lineType === "goods" && l.isMachine ? l.serials : "",
      warrantyMonths: l.lineType === "goods" && l.isMachine && l.warrantyMonths.trim() !== "" ? Number(l.warrantyMonths) : null,
    })),
  };
}

/** Lines with whatever is valid in them, for live totals while typing. */
const forTotals = (lines: DocLineInput[]) =>
  lines.map((l) => ({
    qty: Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 0,
    unitPriceSatang: Math.max(0, l.unitPriceSatang),
    discountSatang: Math.max(0, l.discountSatang),
  }));

const LABEL = "block text-sm font-semibold text-gray-700 mb-1";
function inputClass(invalid?: boolean) {
  return `w-full border rounded-xl px-3 py-2 outline-none transition-all focus:ring-2 ${
    invalid ? "bg-red-50 border-red-500 focus:ring-red-500" : "bg-white border-gray-200 focus:ring-sky-500"
  }`;
}
function Problem({ id, children }: { id: string; children: string | undefined }) {
  if (!children) return null;
  return (
    <p id={id} data-field-error className="mt-1 text-sm text-red-600">
      {children}
    </p>
  );
}

export default function InvoiceEditor({
  initial,
  vatRate,
  defaultCreditDays,
  seller,
  lookups,
  onSaved,
  onIssued,
  onDeleteDraft,
  mode = "internal",
  noteSuggestions = [],
}: {
  initial: EditorDocument | null;
  vatRate: number;
  defaultCreditDays: number;
  /** Our company as it would print; null until set up (issuing is then refused). */
  seller: SellerProfile | null;
  lookups: AccountingLookups;
  onSaved: (doc: EditorDocument) => void;
  onIssued: (doc: EditorDocument) => void;
  onDeleteDraft?: () => void;
  /** "external": recording an invoice issued elsewhere — its own number, where the paper is kept, saved as issued at once. */
  mode?: "internal" | "external";
  /** Where outside papers were kept lately (external mode). */
  noteSuggestions?: string[];
}) {
  const external = mode === "external";
  const [opened] = useState<Draft>(() => draftOf(initial, defaultCreditDays));
  const [draft, setDraft] = useState<Draft>(opened);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(opened));
  const [current, setCurrent] = useState<EditorDocument | null>(initial);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<"save" | "issue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ docNo: string | null; doc: EditorDocument } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const dirty = JSON.stringify(draft) !== savedSnapshot;
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const input = useMemo(() => inputOf(draft), [draft]);
  const computedTotals = useMemo(
    () => computeTotals({ lines: forTotals(input.lines), discountSatang: Math.max(0, input.discountSatang), priceMode: input.priceMode, vatRate }),
    [input, vatRate]
  );
  /** Outside documents: the number, the storage note and the VAT as printed. */
  const externalFields: ExternalFields = useMemo(
    () => ({
      docNo: draft.docNo.trim(),
      externalNote: draft.externalNote.trim(),
      vatSatangOverride: draft.vatOverride.trim() === "" ? null : parseBahtToSatang(draft.vatOverride) ?? -1,
    }),
    [draft.docNo, draft.externalNote, draft.vatOverride]
  );
  const externalIssues = external ? externalProblems(externalFields, computedTotals.vatSatang) : {};
  const totals =
    external && externalFields.vatSatangOverride !== null && externalFields.vatSatangOverride >= 0
      ? withVatOverride(computedTotals, externalFields.vatSatangOverride, input.priceMode)
      : computedTotals;
  // A branch typed as something that is not one would otherwise be dropped
  // without a word on its way to the API (inputOf sends ""), so it is a
  // problem of its own, said under the field.
  const problems = useMemo(() => {
    const p = invoiceProblems(input, vatRate);
    if (draft.buyerBranch.trim() && normalizeBranchCode(draft.buyerBranch) === null) {
      const branch = "สาขาต้องเป็น สำนักงานใหญ่ หรือเลขสาขา 5 หลัก เช่น 00001";
      return { ...p, fields: { ...p.fields, buyerBranch: branch }, first: p.first ?? branch };
    }
    return p;
  }, [input, vatRate, draft.buyerBranch]);
  const firstExternal = Object.values(externalIssues).find(Boolean) ?? null;
  const shown = attempted ? problems : { fields: {}, lines: {}, first: null };
  const shownExternal = attempted ? externalIssues : {};
  const dueDate = dueDateOf(input.issueDate, Math.max(0, input.creditDays));

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (next.taxInvoiceAuto) next.isTaxInvoice = defaultIsTaxInvoice(next.lines);
      return next;
    });
    setError(null);
  };
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const contacts = lookups.customers.filter((c) => c.companyId === draft.companyId);
  const pickCompany = (id: string) => {
    const company = lookups.companies.find((c) => c.id === id) as LookupCompany | undefined;
    if (!company) {
      set({ companyId: "", customerId: "" });
      return;
    }
    set({
      companyId: id,
      customerId: "",
      buyerName: company.name,
      buyerAddress: companyAddressText(company as Parameters<typeof companyAddressText>[0]),
      buyerTaxId: company.taxId ?? "",
      buyerBranch: branchDraftOf(company.branchCode ?? ""),
    });
  };

  const pickProduct = (key: string, productId: string) => {
    const product = lookups.products.find((p) => p.id === productId);
    const line = draft.lines.find((l) => l.key === key)!;
    const previous = lookups.products.find((p) => p.id === line.productId);
    setLine(key, {
      productId,
      name: !line.name || (previous && line.name === previous.title) ? product?.title ?? line.name : line.name,
      lineType: "goods",
      unit: line.unit || "เครื่อง",
      isMachine: productId ? true : line.isMachine,
    });
  };

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => errorRef.current?.scrollIntoView?.({ block: "nearest" }), 0);
  };

  /** Saves the draft (new or over itself); the saved document, or null when it did not land. */
  const save = async (): Promise<EditorDocument | null> => {
    setAttempted(true);
    if (problems.first) {
      setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
      return null;
    }
    const res = await fetch(current ? `/api/accounting/documents/${encodeURIComponent(current.id)}` : "/api/accounting/documents", {
      method: current ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current ? { ...input, expectedUpdatedAt: current.updatedAt } : input),
    });
    if (!res.ok) {
      showError(await errorMessageOf(res, "บันทึกร่างไม่สำเร็จ"));
      return null;
    }
    const doc: EditorDocument = await res.json();
    setCurrent(doc);
    setSavedSnapshot(JSON.stringify(draft));
    return doc;
  };

  const onSaveClick = async () => {
    if (busy) return;
    setBusy("save");
    try {
      const doc = await save();
      if (doc) onSaved(doc);
    } catch {
      showError("บันทึกร่างไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(null);
    }
  };

  /** External mode: records the outside invoice — issued at once, never a draft. */
  const onRecordClick = async () => {
    if (busy) return;
    setAttempted(true);
    if (problems.first || firstExternal) {
      setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
      return;
    }
    if (totals.totalSatang <= 0) return showError("ยอดรวมต้องมากกว่า 0 บาท");
    if (input.lines.some((l) => l.isMachine) && !input.customerId) {
      return showError("มีเครื่องที่ต้องลงทะเบียน — กรุณาเลือกผู้ติดต่อของลูกค้าที่จะผูกเครื่องไว้");
    }
    setBusy("issue");
    try {
      const res = await fetch("/api/accounting/documents/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, ...externalFields }),
      });
      if (!res.ok) {
        showError(await errorMessageOf(res, "บันทึกเอกสารไม่สำเร็จ"));
        return;
      }
      const doc: EditorDocument = await res.json();
      setSavedSnapshot(JSON.stringify(draft)); // nothing left unsaved
      onIssued(doc);
    } catch {
      showError("บันทึกเอกสารไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(null);
    }
  };

  const issueIssues = issueProblems(input, totals);
  const onIssueClick = async () => {
    if (busy) return;
    setAttempted(true);
    if (problems.first) {
      setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
      return;
    }
    if (!seller) return showError("ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร — ไปที่ ตั้งค่าบัญชี ก่อน");
    if (issueIssues.length > 0) return showError(issueIssues[0]);
    setBusy("issue");
    try {
      const doc = dirty || !current ? await save() : current;
      if (!doc) return;
      const next = await fetch(`/api/accounting/documents/next-number?type=INV&date=${encodeURIComponent(doc.issueDate)}`, { cache: "no-store" });
      const preview = next.ok ? ((await next.json())?.docNo as string) : null;
      setConfirm({ docNo: preview, doc });
    } catch {
      showError("ส่งข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(null);
    }
  };

  const issueNow = async (): Promise<string | null> => {
    if (!confirm) return null;
    const res = await fetch(`/api/accounting/documents/${encodeURIComponent(confirm.doc.id)}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: confirm.doc.updatedAt }),
    });
    if (!res.ok) return errorMessageOf(res, "ออกเอกสารไม่สำเร็จ");
    const issued: EditorDocument = await res.json();
    setSavedSnapshot(JSON.stringify(draft)); // nothing left unsaved — leave without the browser's warning
    onIssued(issued);
    return null;
  };

  const lineTotal = (i: number) => {
    const l = forTotals(input.lines)[i];
    return lineGrossSatang(l) - l.discountSatang;
  };

  return (
    <div className="space-y-6">
      {error && (
        <p ref={errorRef} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {attempted && (firstExternal || problems.first) && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ยังบันทึกไม่ได้: {firstExternal ?? problems.first}
        </p>
      )}

      {external && (
        <section className="bg-amber-50/60 rounded-2xl border border-amber-200 p-5 space-y-4" aria-labelledby="inv-external">
          <div>
            <h2 id="inv-external" className="text-base font-bold text-gray-900">เอกสารที่ออกจากที่อื่น</h2>
            <p className="text-sm text-gray-600">
              ใส่เลขที่และยอดตามเอกสารจริง ระบบไม่ใช้เลขรันของตัวเองกับใบนี้ — บันทึกแล้วเข้าลูกหนี้และรายการขายใน dashboard ทันที
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="inv-docNo" className={LABEL}>เลขที่ตามเอกสารจริง <span className="text-red-500">*</span></label>
              <input id="inv-docNo" className={inputClass(!!shownExternal.docNo)} maxLength={EXTERNAL_LIMITS.docNo}
                aria-invalid={!!shownExternal.docNo || undefined} value={draft.docNo} onChange={(e) => set({ docNo: e.target.value })} />
              <Problem id="inv-docNo-error">{shownExternal.docNo}</Problem>
            </div>
            <div>
              <label htmlFor="inv-externalNote" className={LABEL}>เก็บต้นฉบับไว้ที่ <span className="text-red-500">*</span></label>
              <input id="inv-externalNote" list="inv-externalNote-options" placeholder="เช่น แฟ้มใบกำกับ 2569 ตู้ 2"
                className={inputClass(!!shownExternal.externalNote)} maxLength={EXTERNAL_LIMITS.externalNote}
                aria-invalid={!!shownExternal.externalNote || undefined} value={draft.externalNote} onChange={(e) => set({ externalNote: e.target.value })} />
              <datalist id="inv-externalNote-options">
                {noteSuggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <Problem id="inv-externalNote-error">{shownExternal.externalNote}</Problem>
            </div>
          </div>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4" aria-labelledby="inv-customer">
        <h2 id="inv-customer" className="text-base font-bold text-gray-900">ลูกค้า</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="inv-companyId" className={LABEL}>บริษัทลูกค้า (เลือกแล้วเติมที่อยู่และเลขภาษีให้)</label>
            <SearchableDropdown
              id="inv-companyId"
              value={draft.companyId}
              onChange={pickCompany}
              placeholder={lookups.status === "loading" ? "กำลังโหลดรายชื่อ…" : "เลือกบริษัท หรือพิมพ์ข้อมูลเองด้านล่าง"}
              options={[{ value: "", label: "— ไม่เลือก (พิมพ์เอง) —" }, ...lookups.companies.map((c) => ({ value: c.id, label: c.name, subLabel: c.taxId || undefined }))]}
              buttonClassName="h-[42px] rounded-xl !border-gray-200"
            />
          </div>
          <div>
            <label htmlFor="inv-customerId" className={LABEL}>ผู้ติดต่อ</label>
            <fieldset disabled={!draft.companyId} className="contents">
              <SearchableDropdown
                id="inv-customerId"
                value={draft.customerId}
                onChange={(customerId) => set({ customerId })}
                placeholder={draft.companyId ? "เลือกผู้ติดต่อ" : "เลือกบริษัทก่อน"}
                options={[{ value: "", label: "— ไม่ระบุ —" }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
                searchable={contacts.length > 8}
                buttonClassName="h-[42px] rounded-xl !border-gray-200"
              />
            </fieldset>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="inv-buyerName" className={LABEL}>ชื่อลูกค้าที่พิมพ์ในเอกสาร <span className="text-red-500">*</span></label>
            <input id="inv-buyerName" className={inputClass(!!shown.fields.buyerName)} maxLength={INVOICE_LIMITS.buyerName}
              aria-invalid={!!shown.fields.buyerName || undefined} value={draft.buyerName} onChange={(e) => set({ buyerName: e.target.value })} />
            <Problem id="inv-buyerName-error">{shown.fields.buyerName}</Problem>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label htmlFor="inv-buyerTaxId" className={LABEL}>เลขประจำตัวผู้เสียภาษี</label>
              <input id="inv-buyerTaxId" inputMode="numeric" className={inputClass()} maxLength={INVOICE_LIMITS.buyerTaxId}
                value={draft.buyerTaxId} onChange={(e) => set({ buyerTaxId: e.target.value })} />
              {taxIdWarning(draft.buyerTaxId) && <p className="mt-1 text-sm text-amber-700">{taxIdWarning(draft.buyerTaxId)}</p>}
            </div>
            <div>
              <label htmlFor="inv-buyerBranch" className={LABEL}>สาขา</label>
              <input id="inv-buyerBranch" className={`${inputClass(!!shown.fields.buyerBranch)} w-36`} placeholder="สำนักงานใหญ่"
                aria-invalid={!!shown.fields.buyerBranch || undefined} aria-describedby={shown.fields.buyerBranch ? "inv-buyerBranch-error" : undefined}
                value={draft.buyerBranch} onChange={(e) => set({ buyerBranch: e.target.value })} />
            </div>
            <div className="col-span-2 -mt-2">
              <Problem id="inv-buyerBranch-error">{shown.fields.buyerBranch}</Problem>
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="inv-buyerAddress" className={LABEL}>ที่อยู่ลูกค้าที่พิมพ์ในเอกสาร{draft.isTaxInvoice && <span className="text-red-500"> *</span>}</label>
          <textarea id="inv-buyerAddress" rows={2} className={`${inputClass()} resize-none`} maxLength={INVOICE_LIMITS.buyerAddress}
            value={draft.buyerAddress} onChange={(e) => set({ buyerAddress: e.target.value })} />
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4" aria-labelledby="inv-doc">
        <h2 id="inv-doc" className="text-base font-bold text-gray-900">เอกสาร</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="inv-issueDate" className={LABEL}>{external ? "วันที่ตามเอกสารจริง" : "วันที่ออกเอกสาร"} <span className="text-red-500">*</span></label>
            <DatePicker
              id="inv-issueDate"
              selected={draft.issueDate ? new Date(`${draft.issueDate}T00:00:00`) : null}
              onChange={(date) => set({ issueDate: date ? toLocalDateString(date) : "" })}
              className={inputClass(!!shown.fields.issueDate)}
            />
            <Problem id="inv-issueDate-error">{shown.fields.issueDate}</Problem>
          </div>
          <div>
            <label htmlFor="inv-creditDays" className={LABEL}>เครดิต (วัน)</label>
            <input id="inv-creditDays" inputMode="numeric" className={inputClass(!!shown.fields.creditDays)}
              aria-invalid={!!shown.fields.creditDays || undefined} value={draft.creditDays} onChange={(e) => set({ creditDays: e.target.value })} />
            <Problem id="inv-creditDays-error">{shown.fields.creditDays}</Problem>
            {dueDate && <p className="mt-1 text-xs text-gray-500">ครบกำหนด {formatDisplayDate(dueDate)}</p>}
          </div>
          <div>
            <label htmlFor="inv-customerPoNo" className={LABEL}>เลขที่ PO ลูกค้า</label>
            <input id="inv-customerPoNo" className={inputClass()} maxLength={INVOICE_LIMITS.customerPoNo}
              value={draft.customerPoNo} onChange={(e) => set({ customerPoNo: e.target.value })} />
          </div>
          <div>
            <label htmlFor="inv-salespersonId" className={LABEL}>เซลล์</label>
            <SearchableDropdown id="inv-salespersonId" value={draft.salespersonId} onChange={(salespersonId) => set({ salespersonId })}
              placeholder="— ไม่ระบุ —" options={[{ value: "", label: "— ไม่ระบุ —" }, ...lookups.salespeople.map((s) => ({ value: s.id, label: s.name }))]}
              searchable={lookups.salespeople.length > 8} buttonClassName="h-[42px] rounded-xl !border-gray-200" />
          </div>
        </div>
        <div>
          <label htmlFor="inv-projectName" className={LABEL}>ชื่อโปรเจค / งาน (แสดงใต้ชื่อลูกค้าในรายการ)</label>
          <input id="inv-projectName" className={inputClass()} maxLength={INVOICE_LIMITS.projectName}
            value={draft.projectName} onChange={(e) => set({ projectName: e.target.value })} />
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4" aria-labelledby="inv-lines">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="inv-lines" className="text-base font-bold text-gray-900">รายการสินค้า / บริการ</h2>
          <div className="w-56">
            <SearchableDropdown
              id="inv-priceMode"
              value={draft.priceMode}
              onChange={(v) => set({ priceMode: v === "inclusive" ? "inclusive" : "exclusive" })}
              options={[
                { value: "exclusive", label: "ราคายังไม่รวม VAT" },
                { value: "inclusive", label: "ราคารวม VAT แล้ว" },
              ]}
              searchable={false}
              buttonClassName="h-[38px] rounded-xl !border-gray-200"
            />
          </div>
        </div>
        <Problem id="inv-lines-error">{shown.fields.lines}</Problem>

        <ol className="space-y-3">
          {draft.lines.map((line, i) => {
            const p = shown.lines[i] ?? {};
            const id = (field: string) => `inv-line-${i}-${field}`;
            return (
              <li key={line.key} className="rounded-xl border border-gray-200 p-4 space-y-3" data-testid="invoice-line">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-bold text-gray-500 w-6">{i + 1}.</span>
                  <div className="w-36">
                    <SearchableDropdown
                      id={id("lineType")}
                      value={line.lineType}
                      onChange={(v) => setLine(line.key, { lineType: v === "service" ? "service" : "goods", isMachine: v === "service" ? false : line.isMachine })}
                      options={[
                        { value: "goods", label: "สินค้า" },
                        { value: "service", label: "บริการ" },
                      ]}
                      searchable={false}
                      buttonClassName="h-[38px] rounded-xl !border-gray-200"
                    />
                  </div>
                  <div className="flex-1 min-w-48">
                    <SearchableDropdown
                      id={id("productId")}
                      value={line.productId}
                      onChange={(v) => pickProduct(line.key, v)}
                      placeholder="เลือกจากแคตตาล็อก (ไม่บังคับ)"
                      options={[{ value: "", label: "— ไม่ใช้แคตตาล็อก —" }, ...lookups.products.map((p) => ({ value: p.id, label: p.title }))]}
                      buttonClassName="h-[38px] rounded-xl !border-gray-200"
                    />
                  </div>
                  {draft.lines.length > 1 && (
                    <button type="button" onClick={() => set({ lines: draft.lines.filter((l) => l.key !== line.key) })}
                      className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50" aria-label={`ลบรายการที่ ${i + 1}`}>
                      ลบ
                    </button>
                  )}
                </div>
                <div>
                  <label htmlFor={id("name")} className="sr-only">ชื่อรายการที่ {i + 1}</label>
                  <input id={id("name")} placeholder="ชื่อรายการที่พิมพ์ในเอกสาร" className={inputClass(!!p.name)} maxLength={INVOICE_LIMITS.name}
                    aria-invalid={!!p.name || undefined} value={line.name} onChange={(e) => setLine(line.key, { name: e.target.value })} />
                  <Problem id={id("name-error")}>{p.name}</Problem>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label htmlFor={id("qty")} className="block text-xs font-semibold text-gray-600 mb-1">จำนวน</label>
                    <input id={id("qty")} inputMode="decimal" className={inputClass(!!p.qty)} aria-invalid={!!p.qty || undefined}
                      value={line.qty} onChange={(e) => setLine(line.key, { qty: e.target.value })} />
                    <Problem id={id("qty-error")}>{p.qty}</Problem>
                  </div>
                  <div>
                    <label htmlFor={id("unit")} className="block text-xs font-semibold text-gray-600 mb-1">หน่วย</label>
                    <input id={id("unit")} className={inputClass()} maxLength={INVOICE_LIMITS.unit} placeholder="เครื่อง / ชิ้น / งาน"
                      value={line.unit} onChange={(e) => setLine(line.key, { unit: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={id("unitPrice")} className="block text-xs font-semibold text-gray-600 mb-1">ราคา/หน่วย (บาท)</label>
                    <input id={id("unitPrice")} inputMode="decimal" className={`${inputClass(!!p.unitPriceSatang)} text-right`}
                      aria-invalid={!!p.unitPriceSatang || undefined} value={line.unitPrice} onChange={(e) => setLine(line.key, { unitPrice: e.target.value })} />
                    <Problem id={id("unitPrice-error")}>{p.unitPriceSatang}</Problem>
                  </div>
                  <div>
                    <label htmlFor={id("discount")} className="block text-xs font-semibold text-gray-600 mb-1">ส่วนลด (บาท)</label>
                    <input id={id("discount")} inputMode="decimal" className={`${inputClass(!!p.discountSatang)} text-right`}
                      aria-invalid={!!p.discountSatang || undefined} value={line.discount} onChange={(e) => setLine(line.key, { discount: e.target.value })} />
                    <Problem id={id("discount-error")}>{p.discountSatang}</Problem>
                  </div>
                  <div>
                    <p className="block text-xs font-semibold text-gray-600 mb-1">จำนวนเงิน</p>
                    <p className="px-3 py-2 text-right font-semibold tabular-nums" data-testid="line-total">{formatSatang(lineTotal(i))}</p>
                  </div>
                </div>
                {line.lineType === "goods" && (
                  <div className="space-y-3">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={line.isMachine} onChange={(e) => setLine(line.key, { isMachine: e.target.checked })} className="h-4 w-4" />
                      ลงทะเบียนเป็นเครื่องของลูกค้า (เก็บ Serial / ประกัน — เครื่องชั่ง เครื่องมือ ไม่ใช่อะไหล่)
                    </label>
                    {line.isMachine && (
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-3">
                        <div>
                          <label htmlFor={id("serials")} className="block text-xs font-semibold text-gray-600 mb-1">Serial Number (คั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่ — ใส่ทีหลังได้)</label>
                          <textarea id={id("serials")} rows={2} className={`${inputClass(!!p.serials)} resize-none`} maxLength={INVOICE_LIMITS.serials}
                            aria-invalid={!!p.serials || undefined} value={line.serials} onChange={(e) => setLine(line.key, { serials: e.target.value })} />
                          <Problem id={id("serials-error")}>{p.serials}</Problem>
                        </div>
                        <div>
                          <label htmlFor={id("warrantyMonths")} className="block text-xs font-semibold text-gray-600 mb-1">ประกัน (เดือน)</label>
                          <input id={id("warrantyMonths")} inputMode="numeric" placeholder="เช่น 12" className={inputClass(!!p.warrantyMonths)}
                            aria-invalid={!!p.warrantyMonths || undefined} value={line.warrantyMonths} onChange={(e) => setLine(line.key, { warrantyMonths: e.target.value })} />
                          <Problem id={id("warrantyMonths-error")}>{p.warrantyMonths}</Problem>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={() => set({ lines: [...draft.lines, emptyLine()] })} disabled={draft.lines.length >= INVOICE_LIMITS.lines}
          className="px-4 py-2 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50 disabled:opacity-50">
          + เพิ่มรายการ
        </button>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-6" aria-labelledby="inv-totals">
        <div className="space-y-4">
          <div>
            <label htmlFor="inv-note" className={LABEL}>หมายเหตุ (พิมพ์ในเอกสาร)</label>
            <textarea id="inv-note" rows={3} className={`${inputClass()} resize-none`} maxLength={INVOICE_LIMITS.note}
              value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="h-4 w-4 mt-0.5" checked={draft.isTaxInvoice}
              onChange={(e) => set({ isTaxInvoice: e.target.checked, taxInvoiceAuto: false })} />
            <span>
              ออกใบกำกับภาษีพร้อมใบแจ้งหนี้นี้
              <span className="block text-xs text-gray-500">
                ขายสินค้า: ออกพร้อมกันตอนส่งของ · งานบริการล้วน: ไม่ต้องติ๊ก — ระบบจะออกใบเสร็จรับเงิน/ใบกำกับภาษีให้ตอนรับเงิน
                {!draft.taxInvoiceAuto && " (ตั้งเองแล้ว)"}
              </span>
            </span>
          </label>
        </div>
        <div>
          <h2 id="inv-totals" className="sr-only">สรุปยอด</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 tabular-nums text-sm" data-testid="invoice-totals">
            <dt className="text-gray-600">รวมเป็นเงิน</dt>
            <dd className="text-right">{formatSatang(totals.subtotalSatang)}</dd>
            <dt className="text-gray-600 self-center"><label htmlFor="inv-discount">ส่วนลดท้ายบิล (บาท)</label></dt>
            <dd>
              <input id="inv-discount" inputMode="decimal" className={`${inputClass(!!shown.fields.discountSatang)} text-right w-36 ml-auto block py-1`}
                aria-invalid={!!shown.fields.discountSatang || undefined} value={draft.discount} onChange={(e) => set({ discount: e.target.value })} />
            </dd>
            {shown.fields.discountSatang && <dd className="col-span-2 text-sm text-red-600 text-right">{shown.fields.discountSatang}</dd>}
            <dt className="text-gray-600">มูลค่าก่อนภาษี</dt>
            <dd className="text-right">{formatSatang(totals.vatBaseSatang)}</dd>
            {external ? (
              <>
                <dt className="text-gray-600 self-center"><label htmlFor="inv-vatOverride">ภาษีมูลค่าเพิ่ม {vatRate}% (ตามเอกสาร)</label></dt>
                <dd>
                  <input id="inv-vatOverride" inputMode="decimal" placeholder={formatSatang(computedTotals.vatSatang)}
                    className={`${inputClass(!!shownExternal.vatSatangOverride)} text-right w-36 ml-auto block py-1`}
                    aria-invalid={!!shownExternal.vatSatangOverride || undefined}
                    value={draft.vatOverride} onChange={(e) => set({ vatOverride: e.target.value })} />
                </dd>
                {shownExternal.vatSatangOverride && <dd className="col-span-2 text-sm text-red-600 text-right">{shownExternal.vatSatangOverride}</dd>}
              </>
            ) : (
              <>
                <dt className="text-gray-600">ภาษีมูลค่าเพิ่ม {vatRate}%</dt>
                <dd className="text-right">{formatSatang(totals.vatSatang)}</dd>
              </>
            )}
            <dt className="font-bold text-gray-900 border-t border-gray-200 pt-2">ยอดรวมสุทธิ</dt>
            <dd className="font-bold text-gray-900 text-right border-t border-gray-200 pt-2">{formatSatang(totals.totalSatang)}</dd>
          </dl>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setShowPreview((v) => !v)} className="px-4 py-2.5 rounded-xl border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50">
          {showPreview ? "ซ่อนตัวอย่างเอกสาร" : "ดูตัวอย่างเอกสาร"}
        </button>
        {onDeleteDraft && current && (
          <button type="button" onClick={onDeleteDraft} className="px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50">
            ลบร่าง
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-3">
          {external ? (
            <button type="button" onClick={() => void onRecordClick()} disabled={!!busy}
              className="px-5 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60 flex items-center gap-2">
              {busy === "issue" && <Spinner className="h-4 w-4 text-white" />}
              บันทึกเอกสาร
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void onSaveClick()} disabled={!!busy}
                className="px-5 py-2.5 rounded-xl border border-sky-300 text-sky-700 font-semibold hover:bg-sky-50 disabled:opacity-60 flex items-center gap-2">
                {busy === "save" && <Spinner className="h-4 w-4 text-sky-600" />}
                บันทึกร่าง
              </button>
              <button type="button" onClick={() => void onIssueClick()} disabled={!!busy}
                className="px-5 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60 flex items-center gap-2">
                {busy === "issue" && <Spinner className="h-4 w-4 text-white" />}
                ออกเอกสาร ▸
              </button>
            </>
          )}
        </div>
      </div>

      {showPreview && (
        <InvoicePaper
          draft
          copyLabel={null}
          seller={seller ?? { name: "", address: "", taxId: "", branchCode: "", phone: "", email: "" }}
          doc={{
            ...input,
            docNo: external ? externalFields.docNo || null : null,
            dueDate,
            creditDays: Math.max(0, input.creditDays),
            vatRate,
            ...totals,
            lines: input.lines.map((l, i) => ({ ...l, ...forTotals([l])[0], amountSatang: lineTotal(i) })),
          }}
        />
      )}

      {confirm && (
        <IssueConfirmDialog
          docNo={confirm.docNo}
          title={invoiceTitle(input)}
          buyerName={input.buyerName}
          totalSatang={totals.totalSatang}
          issueDate={input.issueDate}
          onCancel={() => setConfirm(null)}
          onConfirm={issueNow}
        />
      )}
    </div>
  );
}

/** "This is what you are about to issue" — the number, who, how much — and that it cannot be edited after. */
function IssueConfirmDialog({
  docNo,
  title,
  buyerName,
  totalSatang,
  issueDate,
  onCancel,
  onConfirm,
}: {
  docNo: string | null;
  title: string;
  buyerName: string;
  totalSatang: number;
  issueDate: string;
  onCancel: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let problem: string | null;
    try {
      problem = await onConfirm();
    } catch {
      problem = "ออกเอกสารไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
    }
    setBusy(false);
    if (problem) setError(problem);
  };
  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="issue-confirm-title" className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
        <h2 id="issue-confirm-title" className="text-lg font-bold text-gray-900 mb-3">ออกเอกสารนี้?</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-4">
          <dt className="text-gray-500">เอกสาร</dt>
          <dd className="font-semibold">{title}</dd>
          <dt className="text-gray-500">จะได้เลขที่</dt>
          <dd className="font-semibold tabular-nums">{docNo ?? "เลขถัดไปของเดือน"}</dd>
          <dt className="text-gray-500">วันที่</dt>
          <dd>{formatDisplayDate(issueDate)}</dd>
          <dt className="text-gray-500">ลูกค้า</dt>
          <dd>{buyerName}</dd>
          <dt className="text-gray-500">ยอดรวมสุทธิ</dt>
          <dd className="font-semibold tabular-nums">{formatSatang(totalSatang)} บาท</dd>
        </dl>
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          ออกแล้วแก้ไขไม่ได้ ถ้าข้อมูลผิดต้องลบหรือยกเลิกแล้วออกใบใหม่ — ระบบจะบันทึกยอดขายใน dashboard ให้อัตโนมัติ
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
            กลับไปแก้
          </button>
          <button type="button" onClick={() => void go()} disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60 flex justify-center items-center gap-2">
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {busy ? "กำลังออก…" : "ยืนยันออกเอกสาร"}
          </button>
        </div>
      </div>
    </div>
  );
}
