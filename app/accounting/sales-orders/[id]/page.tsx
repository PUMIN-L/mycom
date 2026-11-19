"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import InvoiceEditor from "../../invoices/InvoiceEditor";
import DocumentDeleteDialog from "../../DocumentDeleteDialog";
import OrderStatusBadge from "../OrderStatusBadge";
import { useOrderDetail, type OrderDetailView } from "../orderClient";
import DatePicker from "../../../components/DatePicker";
import Spinner from "../../../components/Spinner";
import { useModalEscape } from "../../../components/useModalEscape";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, formatDisplayDateTime, toLocalDateString } from "../../../lib/dateFormat";
import { formatSatang } from "../../../lib/accounting/money";
import { ORDER_LIMITS, isOrderLate, remainingQty } from "../../../lib/accounting/orderRules";
import type { AuditEntry } from "../../../lib/accounting/types";
import { useAccountingLookups } from "../../useAccountingLookups";
import { useAccountingSettings } from "../../useAccountingSettings";

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("PO ลูกค้า");
  return (
    <AccountingFrame tab="orders" title={title}>
      <SalesOrder id={String(id)} onTitle={setTitle} />
    </AccountingFrame>
  );
}

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function SalesOrder({ id, onTitle }: { id: string; onTitle: (title: string) => void }) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  const load = useOrderDetail(id, reloadKey);
  const lookups = useAccountingLookups();
  const settings = useAccountingSettings();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"schedule" | "cancel" | "delete" | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const reload = () => setReloadKey((n) => n + 1);

  const customerPoNo = load.status === "ok" ? load.detail.order.customerPoNo : null;
  useEffect(() => {
    if (customerPoNo) onTitle(`PO ลูกค้า ${customerPoNo}`);
  }, [customerPoNo, onTitle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/audit?documentId=${encodeURIComponent(id)}`, { cache: "no-store" });
        const rows: AuditEntry[] = res.ok ? await res.json() : [];
        if (!cancelled) setAudit(rows);
      } catch {
        if (!cancelled) setAudit([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (load.status === "loading" || load.status === "idle" || settings.state.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (load.status === "error" || settings.state.status === "error") {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">{load.status === "error" ? load.message : settings.state.status === "error" ? settings.state.message : ""}</p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={() => { reload(); settings.retry(); }} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
          <Link href="/accounting/sales-orders" className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">กลับไปรายการ</Link>
        </div>
      </div>
    );
  }

  const detail = load.detail;
  const o = detail.order;
  const accSettings = settings.state.settings;
  const cancelled = o.status === "void";
  const today = bangkokDateString(new Date());
  const late = isOrderLate(o, detail.backlogSatang, today);
  const canEditLines = !cancelled && detail.deliveries.length === 0;

  if (editing) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setEditing(false)} className="text-sm font-semibold text-sky-700 hover:text-sky-800">← กลับไปที่ PO</button>
        <InvoiceEditor
          key={o.updatedAt}
          mode="order"
          initial={{ ...o, docNo: null, salesOrderId: null }}
          vatRate={accSettings.vatRate}
          defaultCreditDays={accSettings.creditDays}
          seller={null}
          lookups={lookups}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onIssued={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        {cancelled && (
          <div role="status" className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <p className="font-semibold">PO นี้ถูกยกเลิกแล้ว{detail.deliveries.some((d) => d.status === "issued") && " (ส่วนที่ยังไม่ได้ส่ง)"}</p>
            {o.voidReason && <p>เหตุผล: {o.voidReason}</p>}
          </div>
        )}

        <section className="bg-white rounded-2xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="ข้อมูล PO">
          <div className="min-w-0">
            <p className="text-sm text-gray-500">ลูกค้า</p>
            <p className="font-semibold text-gray-900">{o.buyerName}</p>
            {o.buyerAddress && <p className="text-sm text-gray-600 whitespace-pre-line">{o.buyerAddress}</p>}
            {o.projectName && <p className="text-sm text-gray-600">โปรเจค: {o.projectName}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums self-start">
            <dt className="text-gray-500">เลขที่ PO ลูกค้า</dt>
            <dd className="font-semibold">{o.customerPoNo}</dd>
            <dt className="text-gray-500">วันที่ PO</dt>
            <dd>{formatDisplayDate(o.issueDate)}</dd>
            <dt className="text-gray-500">กำหนดส่ง</dt>
            <dd className={late ? "text-red-600 font-semibold" : ""}>{o.expectedDeliveryDate ? formatDisplayDate(o.expectedDeliveryDate) : "—"}</dd>
            <dt className="text-gray-500">เครดิต</dt>
            <dd>{o.creditDays} วัน</dd>
            {o.externalNote && (
              <>
                <dt className="text-gray-500">เก็บ PO ไว้ที่</dt>
                <dd>{o.externalNote}</dd>
              </>
            )}
          </dl>
          {o.note && <p className="md:col-span-2 text-sm text-gray-600 whitespace-pre-line">หมายเหตุ: {o.note}</p>}
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden" aria-labelledby="order-lines">
          <h2 id="order-lines" className="px-5 pt-4 pb-2 font-bold text-gray-900">รายการตาม PO</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="order-lines">
              <thead>
                <tr className="border-y border-gray-200 bg-gray-50 text-left text-gray-600">
                  <th className="py-2.5 px-4 font-semibold">รายการ</th>
                  <th className="py-2.5 px-3 font-semibold text-right">สั่ง</th>
                  <th className="py-2.5 px-3 font-semibold text-right">ส่งแล้ว</th>
                  <th className="py-2.5 px-3 font-semibold text-right">เหลือ</th>
                  <th className="py-2.5 px-3 font-semibold text-right">ราคา/หน่วย</th>
                  <th className="py-2.5 px-4 font-semibold text-right">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => {
                  const left = remainingQty(l);
                  return (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="py-2.5 px-4">
                        {l.name}
                        {l.lineType === "service" && <span className="ml-1 text-xs text-gray-400">(บริการ)</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right">{qty(l.qty)} {l.unit}</td>
                      <td className="py-2.5 px-3 text-right">{qty(l.deliveredQty)}</td>
                      <td className={`py-2.5 px-3 text-right font-semibold ${left > 0 && !cancelled ? "text-orange-600" : "text-gray-400"}`}>{qty(left)}</td>
                      <td className="py-2.5 px-3 text-right">{formatSatang(l.unitPriceSatang)}</td>
                      <td className="py-2.5 px-4 text-right">{formatSatang(l.amountSatang)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="text-gray-700">
                {o.discountSatang > 0 && (
                  <tr className="border-t border-gray-100">
                    <td colSpan={5} className="py-1.5 px-4 text-right">ส่วนลดท้ายบิล</td>
                    <td className="py-1.5 px-4 text-right">{formatSatang(o.discountSatang)}</td>
                  </tr>
                )}
                <tr className="border-t border-gray-200">
                  <td colSpan={5} className="py-1.5 px-4 text-right">มูลค่าก่อน VAT</td>
                  <td className="py-1.5 px-4 text-right font-semibold">{formatSatang(o.vatBaseSatang)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="py-1.5 px-4 text-right">รวม VAT {o.vatRate}%</td>
                  <td className="py-1.5 px-4 text-right font-bold">{formatSatang(o.totalSatang)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-5" aria-labelledby="order-deliveries">
          <h2 id="order-deliveries" className="font-bold text-gray-900 mb-2">การส่งของ (ใบแจ้งหนี้จาก PO นี้)</h2>
          {detail.deliveries.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่ได้ส่งของ</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm" data-testid="order-deliveries">
              {detail.deliveries.map((d) => (
                <li key={d.id} className="py-2 flex flex-wrap items-center justify-between gap-2 tabular-nums">
                  <Link href={`/accounting/invoices/${d.id}`} className="font-semibold text-sky-700 hover:text-sky-800">
                    {d.docNo ?? "ร่างใบแจ้งหนี้"}
                  </Link>
                  <span className="text-gray-500">{formatDisplayDate(d.issueDate)}{d.source === "external" ? " · ออกจากที่อื่น" : ""}</span>
                  <span className={d.status === "draft" ? "text-gray-400" : "font-semibold"}>
                    {formatSatang(d.totalSatang)}{d.status === "draft" && " (ร่าง — ยังไม่ตัดยอด)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6" aria-label="การทำรายการกับ PO">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold tabular-nums">{o.customerPoNo}</span>
            <OrderStatusBadge status={detail.orderStatus} late={late} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
            <dt className="text-gray-500">ยอด PO (ก่อน VAT)</dt>
            <dd className="text-right">{formatSatang(o.vatBaseSatang)}</dd>
            <dt className="text-gray-500">รอส่ง (ก่อน VAT)</dt>
            <dd className="text-right font-semibold" data-testid="order-backlog">{formatSatang(detail.backlogSatang)}</dd>
          </dl>
          {!cancelled && detail.orderStatus !== "complete" && (
            <>
              <Link href={`/accounting/invoices/new?fromOrder=${encodeURIComponent(o.id)}`}
                className="block text-center px-3 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700">
                ส่งของ / ออกใบแจ้งหนี้ ▸
              </Link>
              <Link href={`/accounting/invoices/record-external?fromOrder=${encodeURIComponent(o.id)}`}
                className="block text-center text-sm font-semibold text-sky-700 hover:text-sky-800">
                ออกใบแจ้งหนี้จากที่อื่นแล้ว? บันทึกที่นี่
              </Link>
            </>
          )}
        </div>

        {!cancelled && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2">
            {canEditLines && (
              <button type="button" onClick={() => setEditing(true)} className="w-full px-3 py-2 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50">
                แก้ไข PO
              </button>
            )}
            <button type="button" onClick={() => setDialog("schedule")} className="w-full px-3 py-2 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50">
              แก้กำหนดส่ง / หมายเหตุ
            </button>
            {detail.orderStatus !== "complete" && (
              <button type="button" onClick={() => setDialog("cancel")} className="w-full px-3 py-2 rounded-xl border border-amber-300 text-amber-800 font-semibold hover:bg-amber-50">
                {detail.deliveries.some((d) => d.status === "issued") ? "ยกเลิกส่วนที่เหลือ" : "ยกเลิก PO"}
              </button>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">ประวัติ</h2>
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

        <button type="button" onClick={() => setDialog("delete")} className="w-full px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50">
          ลบ PO
        </button>
      </aside>

      {dialog === "schedule" && <ScheduleDialog detail={detail} onCancel={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); }} />}
      {dialog === "cancel" && <CancelOrderDialog detail={detail} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog === "delete" && (
        <DocumentDeleteDialog
          docType="SO"
          documentId={o.id}
          label={`PO ${o.customerPoNo}`}
          impact={detail.impact}
          onCancel={() => setDialog(null)}
          onDeleted={() => router.push("/accounting/sales-orders")}
        />
      )}
    </div>
  );
}

function DialogShell({ title, busy, onCancel, children }: { title: string; busy: boolean; onCancel: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });
  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const FIELD = "w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500";

/** The delivery date, where the paper is kept, the note — any time before the PO is cancelled. */
function ScheduleDialog({ detail, onCancel, onSaved }: { detail: OrderDetailView; onCancel: () => void; onSaved: () => void }) {
  const o = detail.order;
  const [date, setDate] = useState(o.expectedDeliveryDate ?? "");
  const [storageNote, setStorageNote] = useState(o.externalNote);
  const [note, setNote] = useState(o.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/sales-orders/${encodeURIComponent(o.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDeliveryDate: date, storageNote, note }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "บันทึกไม่สำเร็จ"));
        return;
      }
      onSaved();
    } catch {
      setError("บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title="แก้กำหนดส่ง / หมายเหตุ" busy={busy} onCancel={onCancel}>
      <div>
        <label htmlFor="sched-date" className="block text-sm font-semibold text-gray-700 mb-1">กำหนดส่งของ</label>
        <DatePicker id="sched-date" selected={date ? new Date(`${date}T00:00:00`) : null} onChange={(d) => setDate(d ? toLocalDateString(d) : "")} className={FIELD} />
      </div>
      <div>
        <label htmlFor="sched-storage" className="block text-sm font-semibold text-gray-700 mb-1">เก็บ PO ตัวจริงไว้ที่</label>
        <input id="sched-storage" className={FIELD} maxLength={ORDER_LIMITS.storageNote} value={storageNote} onChange={(e) => setStorageNote(e.target.value)} />
      </div>
      <div>
        <label htmlFor="sched-note" className="block text-sm font-semibold text-gray-700 mb-1">หมายเหตุ</label>
        <textarea id="sched-note" rows={2} className={`${FIELD} resize-none`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">ยกเลิก</button>
        <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60">
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </DialogShell>
  );
}

/** The customer cancelled (the rest of) it — with the reason; what was delivered stays. */
function CancelOrderDialog({ detail, onCancel, onDone }: { detail: OrderDetailView; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delivered = detail.deliveries.some((d) => d.status === "issued");
  const drafts = detail.deliveries.filter((d) => d.status === "draft").length;
  const go = async () => {
    if (busy) return;
    if (!reason.trim()) {
      setError("กรุณาบอกเหตุผลที่ยกเลิก");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/sales-orders/${encodeURIComponent(detail.order.id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "ยกเลิก PO ไม่สำเร็จ"));
        return;
      }
      onDone();
    } catch {
      setError("ยกเลิก PO ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title={delivered ? "ยกเลิกส่วนที่ยังไม่ได้ส่ง?" : "ยกเลิก PO นี้?"} busy={busy} onCancel={onCancel}>
      <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
        <li>ยอดที่ยังไม่ได้ส่ง {formatSatang(detail.backlogSatang)} บาท (ก่อน VAT) จะออกจากยอดรอส่งของ</li>
        {delivered && <li>ใบแจ้งหนี้ที่ส่งของไปแล้วยังอยู่ตามเดิม</li>}
        {drafts > 0 && <li>ร่างใบแจ้งหนี้จาก PO นี้ {drafts} ใบ จะออกเป็นเอกสารไม่ได้</li>}
      </ul>
      <div>
        <label htmlFor="cancel-reason" className="block text-sm font-semibold text-gray-700 mb-1">เหตุผล <span className="text-red-500">*</span></label>
        <input id="cancel-reason" className={FIELD} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้ายกเลิกคำสั่งซื้อ" />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">กลับ</button>
        <button type="button" onClick={() => void go()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60">
          {busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
        </button>
      </div>
    </DialogShell>
  );
}
