"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import StatusBadge from "../../StatusBadge";
import DocumentDeleteDialog, { type DeletionImpactView } from "../../DocumentDeleteDialog";
import ReceiptPaper, { type ReceiptPaperDocument, type ReceiptPaperInvoice } from "../ReceiptPaper";
import { VoidPaymentDialog, type PaymentView } from "../../payments/PaymentsPanel";
import Spinner from "../../../components/Spinner";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { formatDisplayDate, formatDisplayDateTime } from "../../../lib/dateFormat";
import { formatSatang } from "../../../lib/accounting/money";
import { methodLabel, receiptTitle } from "../../../lib/accounting/paymentRules";
import type { AuditEntry, SellerProfile } from "../../../lib/accounting/types";

interface LoadedReceipt {
  document: ReceiptPaperDocument & { id: string; docType: string; relatedDocId: string | null; voidReason: string | null };
  seller: SellerProfile | null;
  impact: DeletionImpactView;
  receipt?: { payment: PaymentView | null; invoice: (ReceiptPaperInvoice & { id: string }) | null };
}

export default function ReceiptDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("ใบเสร็จรับเงิน");
  return (
    <AccountingFrame tab="receipts" title={title}>
      <ReceiptDocument id={String(id)} onTitle={setTitle} />
    </AccountingFrame>
  );
}

function ReceiptDocument({ id, onTitle }: { id: string; onTitle: (title: string) => void }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | ({ status: "ok" } & LoadedReceipt)>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [copyLabel, setCopyLabel] = useState<"ต้นฉบับ" | "สำเนา">("ต้นฉบับ");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดใบเสร็จไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const body: LoadedReceipt = await res.json();
        if (cancelled) return;
        if (body.document.docType !== "RE") {
          router.replace(`/accounting/invoices/${encodeURIComponent(id)}`);
          return;
        }
        setState({ status: "ok", ...body });
        onTitle(body.document.docNo ?? "ใบเสร็จรับเงิน");
        const auditRes = await fetch(`/api/accounting/audit?documentId=${encodeURIComponent(id)}`, { cache: "no-store" });
        const rows: AuditEntry[] = auditRes.ok ? await auditRes.json() : [];
        if (!cancelled) setAudit(rows);
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดใบเสร็จไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reload, onTitle, router]);

  if (state.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">{state.message}</p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={() => { setState({ status: "loading" }); setReload((n) => n + 1); }}
            className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
          <Link href="/accounting/receipts" className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">กลับไปรายการ</Link>
        </div>
      </div>
    );
  }

  const { document: doc, seller, impact } = state;
  const payment = state.receipt?.payment ?? null;
  const invoice = state.receipt?.invoice ?? null;
  const voided = doc.status === "void";
  const printAs = (label: "ต้นฉบับ" | "สำเนา") => {
    setCopyLabel(label);
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6 items-start">
      <div className="space-y-3 min-w-0">
        {voided && (
          <div role="status" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">ใบเสร็จนี้ถูกยกเลิกแล้ว</p>
            {doc.voidReason && <p>เหตุผล: {doc.voidReason}</p>}
          </div>
        )}
        <ReceiptPaper
          doc={doc}
          seller={seller ?? { name: "", address: "", taxId: "", branchCode: "", phone: "", email: "" }}
          payment={payment}
          invoice={invoice}
          copyLabel={copyLabel}
        />
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6" aria-label="รายละเอียดใบเสร็จ">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold tabular-nums">{doc.docNo}</span>
            <StatusBadge status={voided ? "void" : "paid"} />
          </div>
          <p className="text-sm text-gray-600">{receiptTitle(doc.isTaxInvoice)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
            <dt className="text-gray-500">ยอดรับ</dt>
            <dd className="text-right font-semibold">{formatSatang(doc.totalSatang)}</dd>
            {payment && (
              <>
                <dt className="text-gray-500">วิธีรับเงิน</dt>
                <dd className="text-right">{methodLabel(payment.method)}</dd>
                {payment.whtSatang > 0 && (
                  <>
                    <dt className="text-gray-500">หัก ณ ที่จ่าย</dt>
                    <dd className="text-right">{formatSatang(payment.whtSatang)}</dd>
                  </>
                )}
                <dt className="text-gray-500">เงินเข้าจริง</dt>
                <dd className="text-right">{formatSatang(payment.netSatang)}</dd>
              </>
            )}
          </dl>
          {invoice && invoice.docType === "SO" ? (
            <Link href={`/accounting/sales-orders/${invoice.id}`} className="block text-sm font-semibold text-sky-700 hover:text-sky-800">
              ← มัดจำของ PO ลูกค้า {doc.customerPoNo} ({formatDisplayDate(invoice.issueDate)})
            </Link>
          ) : invoice ? (
            <Link href={`/accounting/invoices/${invoice.id}`} className="block text-sm font-semibold text-sky-700 hover:text-sky-800">
              ← ใบแจ้งหนี้ {invoice.docNo} ({formatDisplayDate(invoice.issueDate)})
            </Link>
          ) : null}
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

        {!voided && payment && !payment.voidedAt && (
          <button type="button" onClick={() => setVoiding(true)} className="w-full px-4 py-2.5 rounded-xl border border-amber-300 text-amber-800 font-semibold hover:bg-amber-50">
            ยกเลิกใบเสร็จ
          </button>
        )}
        <button type="button" onClick={() => setDeleting(true)} className="w-full px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50">
          ลบเอกสาร
        </button>
      </aside>

      {voiding && payment && (
        <VoidPaymentDialog
          payment={payment}
          onCancel={() => setVoiding(false)}
          onDone={() => {
            setVoiding(false);
            setReload((n) => n + 1);
          }}
        />
      )}
      {deleting && (
        <DocumentDeleteDialog
          documentId={doc.id}
          label={doc.docNo ?? "ใบเสร็จ"}
          impact={impact}
          onCancel={() => setDeleting(false)}
          onDeleted={() =>
            router.push(invoice ? (invoice.docType === "SO" ? `/accounting/sales-orders/${invoice.id}` : `/accounting/invoices/${invoice.id}`) : "/accounting/receipts")
          }
        />
      )}
    </div>
  );
}
