"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import StatusBadge from "../../StatusBadge";
import DocumentDeleteDialog, { type DeletionImpactView } from "../../DocumentDeleteDialog";
import InvoiceEditor, { type EditorDocument } from "../InvoiceEditor";
import InvoicePaper, { type PaperDocument } from "../InvoicePaper";
import Spinner from "../../../components/Spinner";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, formatDisplayDateTime } from "../../../lib/dateFormat";
import { formatSatang } from "../../../lib/accounting/money";
import { displayStatusOf } from "../../../lib/accounting/invoiceRules";
import type { AuditEntry, SellerProfile } from "../../../lib/accounting/types";
import { useAccountingLookups } from "../../useAccountingLookups";
import { useAccountingSettings } from "../../useAccountingSettings";

type LoadedDocument = EditorDocument &
  PaperDocument & {
    paidSatang: number;
    salesRecordId: string | null;
    issuedAt: string | null;
    issuedBy: string | null;
    createdBy: string;
  };

interface Loaded {
  document: LoadedDocument;
  seller: SellerProfile | null;
  impact: DeletionImpactView;
}

export default function InvoiceDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("ใบแจ้งหนี้");
  return (
    <AccountingFrame tab="invoices" title={title}>
      <InvoiceDocument id={String(id)} onTitle={setTitle} />
    </AccountingFrame>
  );
}

function InvoiceDocument({ id, onTitle }: { id: string; onTitle: (title: string) => void }) {
  const router = useRouter();
  const lookups = useAccountingLookups();
  const settings = useAccountingSettings();
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | ({ status: "ok" } & Loaded)>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดเอกสารไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const body: Loaded = await res.json();
        if (cancelled) return;
        setState({ status: "ok", ...body });
        onTitle(body.document.status === "draft" ? "แก้ไขร่างใบแจ้งหนี้" : body.document.docNo ?? "ใบแจ้งหนี้");
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดเอกสารไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reload, onTitle]);

  if (state.status === "loading" || settings.state.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (state.status === "error" || settings.state.status === "error") {
    const message = state.status === "error" ? state.message : settings.state.status === "error" ? settings.state.message : "";
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">{message}</p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={() => { setState({ status: "loading" }); setReload((n) => n + 1); settings.retry(); }}
            className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
          <Link href="/accounting/invoices" className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">กลับไปรายการ</Link>
        </div>
      </div>
    );
  }

  const { document: doc, seller, impact } = state;
  const { settings: accSettings } = settings.state;
  const label = doc.docNo ?? "ร่างใบแจ้งหนี้";
  const deleteDialog = deleting && (
    <DocumentDeleteDialog
      documentId={doc.id}
      label={label}
      impact={impact}
      onCancel={() => setDeleting(false)}
      onDeleted={() => router.push("/accounting/invoices")}
    />
  );

  if (doc.status === "draft") {
    return (
      <>
        <InvoiceEditor
          key={doc.updatedAt}
          initial={doc}
          // The rate a save will use (the server takes the current setting),
          // so the totals on screen are the totals that get stored.
          vatRate={accSettings.vatRate}
          defaultCreditDays={accSettings.creditDays}
          seller={accSettings.sellerVersionId ? accSettings.seller : null}
          lookups={lookups}
          onSaved={() => {}}
          onIssued={() => {
            setState({ status: "loading" });
            setReload((n) => n + 1);
          }}
          onDeleteDraft={() => setDeleting(true)}
        />
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <IssuedView doc={doc} seller={seller} onDelete={() => setDeleting(true)} />
      {deleteDialog}
    </>
  );
}

function IssuedView({ doc, seller, onDelete }: { doc: LoadedDocument; seller: SellerProfile | null; onDelete: () => void }) {
  const [copyLabel, setCopyLabel] = useState<"ต้นฉบับ" | "สำเนา">("ต้นฉบับ");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const status = displayStatusOf(doc, bangkokDateString(new Date()));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/audit?documentId=${encodeURIComponent(doc.id)}`, { cache: "no-store" });
        const rows: AuditEntry[] = res.ok ? await res.json() : [];
        if (!cancelled) setAudit(rows);
      } catch {
        if (!cancelled) setAudit([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  // Print after the label has been drawn on the paper.
  const printAs = (label: "ต้นฉบับ" | "สำเนา") => {
    setCopyLabel(label);
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6 items-start">
      <InvoicePaper doc={doc} seller={seller ?? { name: "", address: "", taxId: "", branchCode: "", phone: "", email: "" }} copyLabel={copyLabel} printable />

      <aside className="space-y-4 xl:sticky xl:top-6" aria-label="รายละเอียดเอกสาร">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold tabular-nums">{doc.docNo}</span>
            <StatusBadge status={status} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
            <dt className="text-gray-500">ยอดรวมสุทธิ</dt>
            <dd className="text-right font-semibold">{formatSatang(doc.totalSatang)}</dd>
            <dt className="text-gray-500">รับชำระแล้ว</dt>
            <dd className="text-right">{formatSatang(doc.paidSatang)}</dd>
            <dt className="text-gray-500">ค้างชำระ</dt>
            <dd className="text-right font-semibold">{formatSatang(Math.max(0, doc.totalSatang - doc.paidSatang))}</dd>
            {doc.dueDate && (
              <>
                <dt className="text-gray-500">ครบกำหนด</dt>
                <dd className={`text-right ${status === "overdue" ? "text-red-600 font-semibold" : ""}`}>{formatDisplayDate(doc.dueDate)}</dd>
              </>
            )}
          </dl>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => printAs("ต้นฉบับ")} className="px-3 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700">
              พิมพ์ต้นฉบับ
            </button>
            <button type="button" onClick={() => printAs("สำเนา")} className="px-3 py-2.5 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50">
              พิมพ์สำเนา
            </button>
          </div>
          <p className="text-xs text-gray-500">เลือกเครื่องพิมพ์ «Save as PDF» เพื่อบันทึกเป็นไฟล์ PDF</p>
        </div>

        {doc.salesRecordId && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 text-sm space-y-2">
            <p className="text-gray-700">ระบบบันทึกยอดขายใบนี้ใน dashboard แล้ว — กรอกต้นทุนได้ที่รายการขาย</p>
            <Link href={`/dashboard?edit=${encodeURIComponent(doc.salesRecordId)}`} className="font-semibold text-sky-700 hover:text-sky-800">
              เปิดรายการขายใน dashboard →
            </Link>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">ประวัติเอกสาร</h2>
          {audit === null ? (
            <Spinner className="h-4 w-4 text-sky-600" />
          ) : audit.length === 0 ? (
            <p className="text-sm text-gray-500">—</p>
          ) : (
            <ul className="space-y-1.5 text-sm" data-testid="document-audit">
              {audit.map((a) => (
                <li key={a.id}>
                  <span className="text-gray-500 tabular-nums">{formatDisplayDateTime(a.at)}</span> · {a.detail || a.action}
                  <span className="text-gray-400"> ({a.username})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="button" onClick={onDelete} className="w-full px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50">
          ลบเอกสาร
        </button>
      </aside>
    </div>
  );
}
