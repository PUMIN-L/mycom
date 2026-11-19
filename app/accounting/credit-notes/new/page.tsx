"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import DatePicker from "../../../components/DatePicker";
import SearchableDropdown from "../../../components/SearchableDropdown";
import Spinner from "../../../components/Spinner";
import { useModalEscape } from "../../../components/useModalEscape";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, isValidDateString, toLocalDateString } from "../../../lib/dateFormat";
import { formatSatang, lineGrossSatang, parseBahtToSatang } from "../../../lib/accounting/money";
import {
  CREDIT_LIMITS,
  CREDIT_REASONS,
  creditNoteKind,
  creditNoteProblems,
  creditTotals,
  creditValues,
  owedSatang,
  type CreditInvoice,
  type CreditNoteInput,
} from "../../../lib/accounting/creditRules";
import type { DocLineInput } from "../../../lib/accounting/invoiceRules";

export default function NewCreditNotePage() {
  return (
    <AccountingFrame tab="credits" title="ออกใบลดหนี้">
      {/* useSearchParams (?invoice=) needs a Suspense boundary. */}
      <Suspense>
        <NewCreditNote />
      </Suspense>
    </AccountingFrame>
  );
}

interface InvoiceView {
  id: string;
  docNo: string | null;
  issueDate: string;
  buyerName: string;
  isTaxInvoice: boolean;
  discountSatang: number;
  depositSatang?: number;
  lines: DocLineInput[];
}

interface ContextView {
  invoice: InvoiceView;
  credit: CreditInvoice;
}

type Load = { status: "loading" } | { status: "error"; message: string } | ({ status: "ok" } & ContextView);

/** A line being written: text as typed; `from` — the invoice line it came from (its discount follows the quantity). */
interface LineDraft {
  key: number;
  from: { qty: number; discountSatang: number } | null;
  lineType: DocLineInput["lineType"];
  productId: string;
  name: string;
  qty: string;
  unit: string;
  price: string;
}

const OTHER_REASON = "__other";
const FIELD = "w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500";
const LABEL = "block text-sm font-semibold text-gray-700 mb-1";

/** The line as the API takes it — an invoice line's discount shared by the quantity taken back. */
function lineOf(d: LineDraft): DocLineInput {
  const qty = Number(d.qty.replace(/,/g, ""));
  const unitPriceSatang = d.price.trim() === "" ? -1 : parseBahtToSatang(d.price) ?? -1;
  const discountSatang =
    d.from && d.from.discountSatang > 0 && Number.isFinite(qty) && qty > 0 && d.from.qty > 0
      ? Math.min(Math.round((d.from.discountSatang * Math.round(qty * 100)) / Math.round(d.from.qty * 100)), Math.max(0, lineGrossSatang({ qty, unitPriceSatang, discountSatang: 0 })))
      : 0;
  return {
    lineType: d.lineType,
    productId: d.productId,
    name: d.name.trim(),
    qty: Number.isFinite(qty) ? qty : -1,
    unit: d.unit.trim(),
    unitPriceSatang,
    discountSatang,
    isMachine: false,
    serials: "",
    warrantyMonths: null,
  };
}

/**
 * A credit note against an issued invoice: why (a case §86/10 allows), its
 * date, and what comes off — the invoice's own lines picked and their
 * quantity cut back, or a line typed in for a price cut. Shows the values the
 * paper prints and the number it will get before it is issued.
 */
function NewCreditNote() {
  const router = useRouter();
  const search = useSearchParams();
  const invoiceId = search.get("invoice") ?? "";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reasonCase, setReasonCase] = useState<string>(CREDIT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [issueDate, setIssueDate] = useState(bangkokDateString(new Date()));
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/credit-notes/context?invoice=${encodeURIComponent(invoiceId)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดใบแจ้งหนี้ไม่สำเร็จ");
          if (!cancelled) setLoad({ status: "error", message });
          return;
        }
        const body = (await res.json()) as ContextView;
        if (cancelled) return;
        if (!body?.invoice || !Array.isArray(body.invoice.lines) || !body.credit) {
          setLoad({ status: "error", message: "โหลดใบแจ้งหนี้ไม่สำเร็จ" });
          return;
        }
        setLoad({ status: "ok", ...body });
      } catch {
        if (!cancelled) setLoad({ status: "error", message: "โหลดใบแจ้งหนี้ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // No invoice named: nothing to load.
  const shownLoad: Load = invoiceId ? load : { status: "error", message: "ไม่ได้ระบุใบแจ้งหนี้ — เปิดใบแจ้งหนี้ที่จะลดหนี้ แล้วกด «ออกใบลดหนี้»" };
  if (shownLoad.status === "loading") return <Spinner className="h-6 w-6 text-sky-600" />;
  if (shownLoad.status === "error") {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{shownLoad.message}</p>
        <Link href="/accounting/invoices" className="text-sm font-semibold text-sky-700">← ใบแจ้งหนี้ทั้งหมด</Link>
      </div>
    );
  }
  const { invoice, credit } = shownLoad;

  const reason = reasonCase === OTHER_REASON ? detail.trim() : detail.trim() ? `${reasonCase} — ${detail.trim()}` : reasonCase;
  const input: CreditNoteInput = { invoiceId: invoice.id, issueDate, reason, lines: lines.map(lineOf) };
  const problems = creditNoteProblems(input, credit);
  const shown = attempted ? problems : { fields: {}, lines: {}, first: null };
  const totals = creditTotals(input, credit);
  const values = creditValues(credit, totals.vatBaseSatang);
  const left = credit.totalSatang - credit.creditedSatang;

  const addFromInvoice = (index: number) => {
    const l = invoice.lines[index];
    if (!l) return;
    setLines((ls) => [
      ...ls,
      {
        key: nextKey,
        from: { qty: l.qty, discountSatang: l.discountSatang },
        lineType: l.lineType,
        productId: l.productId,
        name: l.name,
        qty: String(l.qty),
        unit: l.unit,
        price: formatSatang(l.unitPriceSatang),
      },
    ]);
    setNextKey((k) => k + 1);
  };
  const addFree = () => {
    const service = invoice.lines.every((l) => l.lineType === "service");
    setLines((ls) => [...ls, { key: nextKey, from: null, lineType: service ? "service" : "goods", productId: "", name: "", qty: "1", unit: "", price: "" }]);
    setNextKey((k) => k + 1);
  };
  const change = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const review = () => {
    setAttempted(true);
    setError(null);
    if (problems.first) return;
    setConfirming(true);
  };
  const issue = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/credit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setConfirming(false);
        setError(await errorMessageOf(res, "ออกใบลดหนี้ไม่สำเร็จ"));
        return;
      }
      const doc: { id: string } = await res.json();
      router.replace(`/accounting/credit-notes/${doc.id}`);
    } catch {
      setConfirming(false);
      setError("ออกใบลดหนี้ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-1 text-sm" aria-label="ใบแจ้งหนี้ที่ลดหนี้">
        <p>
          ลดหนี้ของ{invoice.isTaxInvoice ? "ใบแจ้งหนี้/ใบกำกับภาษี" : "ใบแจ้งหนี้"}{" "}
          <Link href={`/accounting/invoices/${invoice.id}`} className="font-semibold text-sky-700 hover:text-sky-800 tabular-nums">{invoice.docNo}</Link>
          {" · "}
          {formatDisplayDate(invoice.issueDate)} · {invoice.buyerName}
        </p>
        <p className="tabular-nums text-gray-700">
          ยอดรวม {formatSatang(credit.totalSatang)} บาท
          {credit.creditedSatang > 0 && <> · ลดหนี้ไปแล้ว {formatSatang(credit.creditedSatang)}</>} · รับชำระแล้ว {formatSatang(credit.paidSatang)} · ค้าง {formatSatang(owedSatang(credit))}
        </p>
        <p className="text-xs text-gray-500">{creditNoteKind(invoice.isTaxInvoice)}</p>
        {((invoice.discountSatang ?? 0) > 0 || (invoice.depositSatang ?? 0) > 0) && (
          <p className="text-xs text-amber-700">ใบแจ้งหนี้นี้มีส่วนลดท้ายบิลหรือหักเงินมัดจำ — ปรับราคาต่อหน่วยให้ตรงกับมูลค่าที่ลูกค้าจ่ายจริง</p>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="เหตุที่ลดหนี้และวันที่">
        <div>
          <label htmlFor="credit-reasonCase" className={LABEL}>เหตุที่ลดหนี้</label>
          <SearchableDropdown
            id="credit-reasonCase"
            value={reasonCase}
            onChange={setReasonCase}
            options={[...CREDIT_REASONS.map((r) => ({ value: r, label: r })), { value: OTHER_REASON, label: "อื่น ๆ (ระบุเอง)" }]}
            searchable={false}
          />
        </div>
        <div>
          <label htmlFor="credit-issueDate" className={LABEL}>วันที่ใบลดหนี้</label>
          <DatePicker id="credit-issueDate" selected={issueDate ? new Date(`${issueDate}T00:00:00`) : null}
            onChange={(d) => setIssueDate(d ? toLocalDateString(d) : "")} className={FIELD} />
          {shown.fields.issueDate && <p className="mt-1 text-sm text-red-600">{shown.fields.issueDate}</p>}
        </div>
        <div className="md:col-span-2">
          <label htmlFor="credit-detail" className={LABEL}>{reasonCase === OTHER_REASON ? "ระบุเหตุที่ลดหนี้" : "รายละเอียดเพิ่ม (ไม่บังคับ)"}</label>
          <input id="credit-detail" className={FIELD} maxLength={CREDIT_LIMITS.reason - 120} value={detail} onChange={(e) => setDetail(e.target.value)}
            placeholder="เช่น รับคืนเครื่อง 1 เครื่อง ตามใบรับคืนเลขที่ …" aria-invalid={shown.fields.reason ? true : undefined} />
          {shown.fields.reason && <p className="mt-1 text-sm text-red-600">{shown.fields.reason}</p>}
          <p className="mt-1 text-xs text-gray-500">พิมพ์บนใบลดหนี้ว่า: {reason || "—"}</p>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3" aria-labelledby="credit-lines">
        <h2 id="credit-lines" className="text-base font-bold text-gray-900">รายการที่ลดหนี้</h2>
        <div className="flex flex-wrap gap-2">
          {invoice.lines.map((l, i) => (
            <button key={i} type="button" onClick={() => addFromInvoice(i)} className="px-3 py-1.5 rounded-lg border border-sky-200 text-sky-700 text-sm font-semibold hover:bg-sky-50">
              + {l.name} ({l.qty} {l.unit})
            </button>
          ))}
          <button type="button" onClick={addFree} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50">
            + พิมพ์รายการเอง (ลดราคา)
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-gray-500">เลือกรายการจากใบแจ้งหนี้ที่รับคืน / ลดราคา หรือพิมพ์รายการเอง</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="credit-lines-table">
              <thead>
                <tr className="text-gray-600 border-b border-gray-200">
                  <th className="py-2 pr-2 text-left font-semibold">รายการ</th>
                  <th className="py-2 pr-2 text-right font-semibold w-24">จำนวน</th>
                  <th className="py-2 pr-2 text-left font-semibold w-24">หน่วย</th>
                  <th className="py-2 pr-2 text-right font-semibold w-36">ราคา/หน่วย</th>
                  <th className="py-2 pr-2 text-right font-semibold w-32">จำนวนเงิน</th>
                  <th className="w-10"><span className="sr-only">ลบ</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((d, i) => {
                  const line = lineOf(d);
                  const p = shown.lines[i] ?? {};
                  const amount = line.qty > 0 && line.unitPriceSatang >= 0 ? lineGrossSatang(line) - line.discountSatang : null;
                  return (
                    <tr key={d.key} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2">
                        <input aria-label={`ชื่อรายการที่ ${i + 1}`} className={FIELD} value={d.name} onChange={(e) => change(d.key, { name: e.target.value })} aria-invalid={p.name ? true : undefined} />
                        {p.name && <p className="mt-1 text-xs text-red-600">{p.name}</p>}
                        {d.from && d.from.discountSatang > 0 && <p className="mt-1 text-xs text-gray-500">หักส่วนลดของรายการตามสัดส่วนจำนวน</p>}
                      </td>
                      <td className="py-2 pr-2">
                        <input aria-label={`จำนวนรายการที่ ${i + 1}`} inputMode="decimal" className={`${FIELD} text-right`} value={d.qty} onChange={(e) => change(d.key, { qty: e.target.value })} aria-invalid={p.qty ? true : undefined} />
                        {p.qty && <p className="mt-1 text-xs text-red-600">{p.qty}</p>}
                      </td>
                      <td className="py-2 pr-2">
                        <input aria-label={`หน่วยรายการที่ ${i + 1}`} className={FIELD} value={d.unit} onChange={(e) => change(d.key, { unit: e.target.value })} />
                      </td>
                      <td className="py-2 pr-2">
                        <input aria-label={`ราคาต่อหน่วยรายการที่ ${i + 1}`} inputMode="decimal" className={`${FIELD} text-right`} value={d.price} onChange={(e) => change(d.key, { price: e.target.value })} aria-invalid={p.unitPriceSatang ? true : undefined} />
                        {(p.unitPriceSatang || p.discountSatang) && <p className="mt-1 text-xs text-red-600">{p.unitPriceSatang || p.discountSatang}</p>}
                      </td>
                      <td className="py-2 pr-2 text-right pt-4">{amount === null ? "—" : formatSatang(amount)}</td>
                      <td className="py-2 text-center pt-3">
                        <button type="button" onClick={() => setLines((ls) => ls.filter((l) => l.key !== d.key))} aria-label={`ลบรายการที่ ${i + 1}`} className="text-gray-400 hover:text-red-600 text-lg leading-none">
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.fields.lines && <p className="text-sm text-red-600">{shown.fields.lines}</p>}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5" aria-label="มูลค่าบนใบลดหนี้">
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums max-w-md ml-auto" data-testid="credit-values">
          <dt>มูลค่าตาม{invoice.isTaxInvoice ? "ใบกำกับภาษี" : "ใบแจ้งหนี้"}เดิม{credit.creditedBaseSatang > 0 && " (หลังลดหนี้ครั้งก่อน)"}</dt>
          <dd className="text-right">{formatSatang(values.originalSatang)}</dd>
          <dt>มูลค่าที่ถูกต้อง</dt>
          <dd className="text-right">{formatSatang(values.correctSatang)}</dd>
          <dt>ผลต่าง</dt>
          <dd className="text-right">{formatSatang(values.differenceSatang)}</dd>
          <dt>ภาษีมูลค่าเพิ่ม {credit.vatRate}%</dt>
          <dd className="text-right">{formatSatang(totals.vatSatang)}</dd>
          <dt className="font-bold border-t border-gray-200 pt-1">รวมลดหนี้ทั้งสิ้น</dt>
          <dd className="font-bold text-right border-t border-gray-200 pt-1">{formatSatang(totals.totalSatang)}</dd>
        </dl>
        <p className="text-xs text-gray-500 text-right mt-1">ลดได้ไม่เกิน {formatSatang(invoice.isTaxInvoice ? left : Math.min(left, owedSatang(credit)))} บาท</p>
        {shown.fields.total && <p className="text-sm text-red-600 text-right mt-1">{shown.fields.total}</p>}
        {credit.paidSatang > 0 && totals.totalSatang > owedSatang(credit) && invoice.isTaxInvoice && !shown.fields.total && (
          <p className="text-sm text-amber-700 text-right mt-1">
            ลดเกินยอดที่ยังค้าง — ลูกค้าจ่ายเกิน {formatSatang(totals.totalSatang - owedSatang(credit))} บาท: คืนเงิน หรือเก็บไว้หักใบถัดไป
          </p>
        )}
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3 justify-end">
        <Link href={`/accounting/invoices/${invoice.id}`} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ยกเลิก</Link>
        <button type="button" onClick={review} disabled={busy} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60">
          ออกใบลดหนี้
        </button>
      </div>
      {confirming && (
        <IssueCreditDialog
          issueDate={issueDate}
          totalSatang={totals.totalSatang}
          invoiceNo={invoice.docNo}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void issue()}
        />
      )}
    </div>
  );
}

/** Says the number it will get, and that it cannot be edited once issued. */
function IssueCreditDialog({
  issueDate,
  totalSatang,
  invoiceNo,
  busy,
  onCancel,
  onConfirm,
}: {
  issueDate: string;
  totalSatang: number;
  invoiceNo: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [nextNo, setNextNo] = useState<string | null>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });
  useEffect(() => {
    if (!isValidDateString(issueDate)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/documents/next-number?type=CN&date=${encodeURIComponent(issueDate)}`, { cache: "no-store" });
        const body = res.ok ? await res.json() : null;
        if (!cancelled && typeof body?.docNo === "string") setNextNo(body.docNo);
      } catch {
        /* the preview is a nicety — the number is handed out on issue either way */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueDate]);
  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="credit-confirm-title" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
        <h2 id="credit-confirm-title" className="text-lg font-bold text-gray-900">ออกใบลดหนี้?</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li className="tabular-nums">
            ลดหนี้ {formatSatang(totalSatang)} บาท ของใบแจ้งหนี้ {invoiceNo}
            {nextNo && <> — จะได้เลขที่ <span className="font-semibold">{nextNo}</span></>}
          </li>
          <li>ออกแล้วแก้ไม่ได้ ถ้าผิดให้ยกเลิก (เลขที่ยังอยู่ในทะเบียน) แล้วออกใบใหม่</li>
          <li>ยอดขายใน dashboard จะลดลงในเดือนของใบลดหนี้</li>
        </ul>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
            กลับไปแก้
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60">
            {busy ? "กำลังออก…" : "ยืนยันออกใบลดหนี้"}
          </button>
        </div>
      </div>
    </div>
  );
}
