"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import CreditNotePaper, { type CreditPaperDocument } from "../CreditNotePaper";
import DocumentDeleteDialog, { type DeletionImpactView } from "../../DocumentDeleteDialog";
import VoidDocumentDialog from "../../VoidDocumentDialog";
import Spinner from "../../../components/Spinner";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate } from "../../../lib/dateFormat";
import { formatSatang } from "../../../lib/accounting/money";
import type { SellerProfile } from "../../../lib/accounting/types";

export default function CreditNotePage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("ใบลดหนี้");
  return (
    <AccountingFrame tab="credits" title={title}>
      <CreditNote id={String(id)} onTitle={setTitle} />
    </AccountingFrame>
  );
}

interface Loaded {
  document: CreditPaperDocument & {
    id: string;
    docType: string;
    refValueSatang: number | null;
    voidReason: string | null;
    voidedAt: string | null;
  };
  seller: SellerProfile | null;
  impact: DeletionImpactView;
  creditOf?: { id: string; docNo: string | null; issueDate: string; isTaxInvoice: boolean };
}

type State = { status: "loading" } | { status: "error"; message: string } | ({ status: "ok" } & Loaded);

const EMPTY_SELLER: SellerProfile = { name: "", address: "", taxId: "", branchCode: "", phone: "", email: "" };

/** One credit note: the paper to print, and voiding or deleting it. */
function CreditNote({ id, onTitle }: { id: string; onTitle: (title: string) => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<"void" | "delete" | null>(null);
  const [copyLabel, setCopyLabel] = useState<"ต้นฉบับ" | "สำเนา">("ต้นฉบับ");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดใบลดหนี้ไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const body: Loaded = await res.json();
        if (cancelled) return;
        if (body.document?.docType !== "CN") {
          setState({ status: "error", message: "เอกสารนี้ไม่ใช่ใบลดหนี้" });
          return;
        }
        setState({ status: "ok", ...body });
        onTitle(body.document.docNo ? `ใบลดหนี้ ${body.document.docNo}` : "ใบลดหนี้");
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดใบลดหนี้ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reload, onTitle]);

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
          <Link href="/accounting/credit-notes" className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">กลับไปรายการ</Link>
        </div>
      </div>
    );
  }

  const { document: doc, seller, impact, creditOf } = state;
  const voided = doc.status === "void";
  const invoice = creditOf ?? { id: "", docNo: null, issueDate: doc.issueDate, isTaxInvoice: doc.isTaxInvoice };
  const printAs = (label: "ต้นฉบับ" | "สำเนา") => {
    setCopyLabel(label);
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6 items-start">
      <div className="min-w-0">
        <CreditNotePaper doc={{ ...doc, refValueSatang: doc.refValueSatang ?? doc.vatBaseSatang }} invoice={invoice} seller={seller ?? EMPTY_SELLER} copyLabel={copyLabel} />
      </div>
      <aside className="space-y-4 xl:sticky xl:top-6" aria-label="รายละเอียดใบลดหนี้">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold tabular-nums">{doc.docNo}</span>
            <span className={`inline-block px-3 py-1 rounded-md font-semibold ${voided ? "bg-gray-100 text-gray-400 line-through" : "bg-amber-100 text-amber-800"}`}>
              {voided ? "ยกเลิก" : "ออกแล้ว"}
            </span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
            <dt className="text-gray-500">ยอดลดหนี้</dt>
            <dd className="text-right font-semibold">{formatSatang(doc.totalSatang)}</dd>
            <dt className="text-gray-500">ของใบแจ้งหนี้</dt>
            <dd className="text-right">
              {creditOf ? (
                <Link href={`/accounting/invoices/${creditOf.id}`} className="font-semibold text-sky-700 hover:text-sky-800">{creditOf.docNo}</Link>
              ) : "—"}
            </dd>
          </dl>
          {voided && (
            <div role="status" className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-gray-700">
              <p className="font-semibold">ยกเลิกแล้ว{doc.voidedAt && ` · ${formatDisplayDate(bangkokDateString(new Date(doc.voidedAt)))}`}</p>
              {doc.voidReason && <p>เหตุผล: {doc.voidReason}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => printAs("ต้นฉบับ")} className="px-3 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700">
              พิมพ์ต้นฉบับ
            </button>
            <button type="button" onClick={() => printAs("สำเนา")} className="px-3 py-2.5 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50">
              พิมพ์สำเนา
            </button>
          </div>
          <p className="text-xs text-gray-500">เลือกเครื่องพิมพ์ «Save as PDF» เพื่อบันทึกเป็นไฟล์ PDF</p>
          {!voided && (
            <button type="button" onClick={() => setDialog("void")} className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50">
              ยกเลิกใบลดหนี้
            </button>
          )}
          <button type="button" onClick={() => setDialog("delete")} className="w-full px-3 py-2 rounded-xl text-red-600 font-semibold hover:bg-red-50">
            ลบเอกสาร
          </button>
        </div>
      </aside>
      {dialog === "void" && (
        <VoidDocumentDialog
          url={`/api/accounting/credit-notes/${encodeURIComponent(doc.id)}/void`}
          title={`ยกเลิกใบลดหนี้ ${doc.docNo ?? ""}?`}
          effects={[
            "เลขที่ยังอยู่ในทะเบียน ทำเครื่องหมาย ยกเลิก พร้อมเหตุผล",
            `ยอด ${formatSatang(doc.totalSatang)} บาท กลับเป็นยอดของใบแจ้งหนี้ ${creditOf?.docNo ?? ""}`,
            "ยอดขายติดลบใน dashboard ของใบนี้จะถูกลบ",
          ]}
          onCancel={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {dialog === "delete" && (
        <DocumentDeleteDialog
          documentId={doc.id}
          label={doc.docNo ?? "ใบลดหนี้"}
          impact={impact}
          docType="CN"
          onCancel={() => setDialog(null)}
          onDeleted={() => router.push(creditOf ? `/accounting/invoices/${creditOf.id}` : "/accounting/credit-notes")}
        />
      )}
    </div>
  );
}
