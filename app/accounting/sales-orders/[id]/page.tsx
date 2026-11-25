"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import InvoiceEditor from "../../invoices/InvoiceEditor";
import DocumentDeleteDialog from "../../DocumentDeleteDialog";
import OrderStatusBadge from "../OrderStatusBadge";
import { useOrderDetail, type OrderDetailView, type PlanItemView } from "../orderClient";
import PaymentDialog from "../../payments/PaymentDialog";
import PaymentsPanel, { useOrderDeposits } from "../../payments/PaymentsPanel";
import SearchableDropdown from "../../../components/SearchableDropdown";
import DatePicker from "../../../components/DatePicker";
import Spinner from "../../../components/Spinner";
import { useModalEscape } from "../../../components/useModalEscape";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, formatDisplayDateTime, toLocalDateString } from "../../../lib/dateFormat";
import { formatSatang, parseBahtToSatang } from "../../../lib/accounting/money";
import { ORDER_LIMITS, isOrderLate, remainingQty } from "../../../lib/accounting/orderRules";
import { PLAN_LIMITS, PLAN_STAGES, PLAN_STATUS_LABELS, planProblems, type PlanStage } from "../../../lib/accounting/depositRules";
import { COMMISSION_KIND_LABELS } from "../../../lib/accounting/commission";
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
  const [dialog, setDialog] = useState<"schedule" | "cancel" | "delete" | "plan" | "commission" | null>(null);
  // What saving ค่าคอมของ did — said above the PO until the next one.
  const [commissionNotice, setCommissionNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const deposits = useOrderDeposits(id);
  // A deposit dialog open, with the amount of a plan item (null: typed by hand).
  const [depositFor, setDepositFor] = useState<{ amountSatang: number | null } | null>(null);
  const [recorded, setRecorded] = useState<{ id: string; docNo: string } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const reload = () => setReloadKey((n) => n + 1);
  const reloadAll = () => {
    reload();
    deposits.reload();
  };

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
  const depositCtx = deposits.state.status === "ok" ? deposits.state.context : null;
  const canTakeDeposit = !cancelled && detail.orderStatus !== "complete" && !!depositCtx && depositCtx.outstandingSatang > 0;

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

        {commissionNotice && (
          <p
            role="status"
            data-testid="commission-notice"
            className={`rounded-xl border px-4 py-2 text-sm ${commissionNotice.warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}`}
          >
            {commissionNotice.text}
          </p>
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
            {/* Whose commission it is — chosen by hand, not the salesperson on the PO (§8h). */}
            <dt className="text-gray-500">ค่าคอมของ</dt>
            <dd data-testid="order-commission" className="flex flex-wrap items-center gap-2">
              {o.commissionOf ? (
                <span className="font-semibold text-gray-900">{COMMISSION_KIND_LABELS[o.commissionOf]}</span>
              ) : (
                <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">ยังไม่เลือก</span>
              )}
              <button
                type="button"
                onClick={() => setDialog("commission")}
                className="text-xs font-semibold text-sky-700 hover:text-sky-800 hover:underline"
              >
                {o.commissionOf ? "เปลี่ยน" : "เลือก"}
              </button>
            </dd>
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

        {recorded && (
          <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            บันทึกเงินมัดจำแล้ว — ออก{" "}
            <Link href={`/accounting/receipts/${recorded.id}`} className="font-semibold underline">ใบเสร็จรับเงิน/ใบกำกับภาษี {recorded.docNo}</Link>
          </div>
        )}

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

        <PlanSection
          detail={detail}
          cancelled={cancelled}
          canTakeDeposit={canTakeDeposit}
          onEdit={() => setDialog("plan")}
          onTakeDeposit={(amountSatang) => setDepositFor({ amountSatang })}
        />

        {detail.deposits && (detail.deposits.receivedSatang > 0 || canTakeDeposit || deposits.state.status !== "ok" || deposits.state.payments.length > 0) && (
          <div className="space-y-3">
            {detail.deposits.receivedSatang > 0 && (
              <dl className="bg-white rounded-2xl border border-gray-200 p-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums" data-testid="deposit-summary">
                <dt className="text-gray-500">รับมัดจำแล้ว (รวม VAT)</dt>
                <dd className="text-right font-semibold">{formatSatang(detail.deposits.receivedSatang)}</dd>
                <dt className="text-gray-500">หักในใบแจ้งหนี้แล้ว (ก่อน VAT)</dt>
                <dd className="text-right">{formatSatang(detail.deposits.deductedSatang)}</dd>
                <dt className="text-gray-500">เหลือให้หัก (ก่อน VAT)</dt>
                <dd className="text-right font-semibold text-orange-600">{formatSatang(detail.deposits.leftSatang)}</dd>
              </dl>
            )}
            {detail.orderStatus === "complete" && detail.deposits.leftSatang > 0 && (
              <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="deposit-left-over">
                ส่งของครบแล้ว แต่ยังมีมัดจำที่ไม่ได้หักในใบแจ้งหนี้ {formatSatang(detail.deposits.leftSatang)} บาท (ก่อน VAT) — ลูกค้าจ่ายเกิน
                ต้องคืนเงินหรือทำใบลดหนี้
              </p>
            )}
            <PaymentsPanel state={deposits.state} onChanged={reloadAll} onRetry={deposits.reload} title="เงินมัดจำ" emptyText="ยังไม่ได้รับมัดจำ" />
          </div>
        )}
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
          {canTakeDeposit && (
            <button type="button" onClick={() => setDepositFor({ amountSatang: null })}
              className="w-full px-3 py-2.5 rounded-xl border border-green-300 text-green-800 font-semibold hover:bg-green-50">
              รับเงินมัดจำ
            </button>
          )}
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
      {dialog === "commission" && (
        <CommissionDialog
          detail={detail}
          onCancel={() => setDialog(null)}
          onSaved={(emailSent) => {
            setDialog(null);
            setCommissionNotice(
              emailSent === false
                ? { text: "บันทึกค่าคอมของ PO แล้ว แต่ส่งอีเมลแจ้งไม่สำเร็จ", warn: true }
                : { text: emailSent ? "บันทึกค่าคอมของ PO แล้ว · ส่งอีเมลแจ้งเจ้าของแล้ว" : "บันทึกค่าคอมของ PO แล้ว", warn: false }
            );
            reload();
          }}
        />
      )}
      {dialog === "plan" && <PlanDialog detail={detail} onCancel={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); }} />}
      {depositFor && depositCtx && (
        <PaymentDialog
          kind="deposit"
          invoice={{ id: o.id, docNo: `PO ${o.customerPoNo}`, issueDate: o.issueDate, totalSatang: o.totalSatang }}
          context={depositCtx}
          bankAccounts={accSettings.bankAccounts}
          initialAmountSatang={depositFor.amountSatang}
          onCancel={() => setDepositFor(null)}
          onRecorded={(result) => {
            setDepositFor(null);
            setRecorded(result.receipt ? { id: result.receipt.id, docNo: result.receipt.docNo } : null);
            reloadAll();
          }}
        />
      )}
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

function DialogShell({
  title,
  busy,
  onCancel,
  children,
  wide = false,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });
  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-white rounded-2xl shadow-2xl p-6 w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92vh] overflow-y-auto space-y-3`}
      >
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

const COMMISSION_KIND_OPTIONS = [
  { value: "ford", label: COMMISSION_KIND_LABELS.ford },
  { value: "tor", label: COMMISSION_KIND_LABELS.tor },
];

/**
 * Whose commission the PO is (§8h) — ลูกค้าฟอร์ด / ลูกค้าพี่ต่อ, chosen by hand.
 * A switch from one person to the other emails the owner, and the window says
 * so before it is saved; `emailSent` is null when no email was due.
 */
function CommissionDialog({
  detail,
  onCancel,
  onSaved,
}: {
  detail: OrderDetailView;
  onCancel: () => void;
  onSaved: (emailSent: boolean | null) => void;
}) {
  const current = detail.order.commissionOf ?? null;
  const [choice, setChoice] = useState<string>(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = choice === "" || choice === current;
  const switching = current !== null && !unchanged;
  const save = async () => {
    if (busy || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/sales-orders/${encodeURIComponent(detail.order.id)}/commission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionOf: choice }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "บันทึกไม่สำเร็จ"));
        return;
      }
      const body = (await res.json().catch(() => null)) as { emailSent?: unknown } | null;
      onSaved(typeof body?.emailSent === "boolean" ? body.emailSent : null);
    } catch {
      setError("บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title="ค่าคอมของ PO นี้" busy={busy} onCancel={onCancel}>
      <p className="text-sm text-gray-600">
        เลือกว่า PO {detail.order.customerPoNo} เป็นค่าคอมของใคร — ไม่เกี่ยวกับเซลล์ที่ระบุใน PO
      </p>
      <div>
        <label htmlFor="commission-kind" className="block text-sm font-semibold text-gray-700 mb-1">ค่าคอมของ</label>
        <SearchableDropdown
          id="commission-kind"
          value={choice}
          onChange={setChoice}
          options={COMMISSION_KIND_OPTIONS}
          placeholder="— เลือก —"
          searchable={false}
          buttonClassName="h-[42px] rounded-xl !border-gray-200"
        />
      </div>
      {switching && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          เปลี่ยนเป็นอีกคน ระบบจะส่งอีเมลแจ้งเจ้าของ
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">ยกเลิก</button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || unchanged}
          className="flex-1 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60"
        >
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
        {(detail.deposits?.leftSatang ?? 0) > 0 && (
          <li className="text-amber-800">
            มีเงินมัดจำที่ยังไม่ได้หัก {formatSatang(detail.deposits?.leftSatang ?? 0)} บาท (ก่อน VAT) — ใบเสร็จมัดจำยังอยู่ตามเดิม
            ถ้าต้องคืนเงินลูกค้าให้ทำใบลดหนี้ภายหลัง
          </li>
        )}
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

const PLAN_BADGE: Record<PlanItemView["status"], string> = {
  paid: "bg-green-50 text-green-700",
  partial: "bg-sky-50 text-sky-700",
  open: "bg-gray-100 text-gray-600",
};

/**
 * แผนเก็บเงิน — what the customer is to pay and when, each item placed by the
 * money that actually came in; an item not yet paid says what to do next.
 */
function PlanSection({
  detail,
  cancelled,
  canTakeDeposit,
  onEdit,
  onTakeDeposit,
}: {
  detail: OrderDetailView;
  cancelled: boolean;
  canTakeDeposit: boolean;
  onEdit: () => void;
  onTakeDeposit: (amountSatang: number) => void;
}) {
  const plan = detail.plan ?? [];
  const planned = plan.reduce((s, p) => s + p.amountSatang, 0);
  // The oldest delivery still owing — where an item collected on the invoices is received.
  // Its credit notes count as settled (step 8).
  const owing = detail.deliveries.find((d) => d.status === "issued" && (d.paidSatang ?? 0) + (d.creditedSatang ?? 0) < d.totalSatang);
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5" aria-labelledby="order-plan">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 id="order-plan" className="font-bold text-gray-900">แผนเก็บเงิน</h2>
        {!cancelled && (
          <button type="button" onClick={onEdit} className="text-sm font-semibold text-sky-700 hover:text-sky-800">
            {plan.length > 0 ? "แก้แผน" : "+ ตั้งแผนเก็บเงิน"}
          </button>
        )}
      </div>
      {plan.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่ได้ตั้งแผน — เช่น มัดจำ 30% ก่อนส่งของ ที่เหลือเก็บตามใบแจ้งหนี้</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 text-sm" data-testid="order-plan">
            {plan.map((p) => (
              <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{p.label}</p>
                  <p className="text-xs text-gray-500">
                    {p.stage === "deposit" ? "มัดจำ (ก่อนส่งของ)" : "เก็บตามใบแจ้งหนี้"}
                    {p.dueDate && ` · กำหนด ${formatDisplayDate(p.dueDate)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 tabular-nums">
                  <span className="font-semibold">{formatSatang(p.amountSatang)}</span>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${p.late ? "bg-red-50 text-red-600" : PLAN_BADGE[p.status]}`}>
                    {p.late ? "เลยกำหนด" : PLAN_STATUS_LABELS[p.status]}
                    {p.status === "partial" && ` · รับแล้ว ${formatSatang(p.receivedSatang)}`}
                  </span>
                  {!cancelled && p.status !== "paid" && p.stage === "deposit" && canTakeDeposit && (
                    <button
                      type="button"
                      onClick={() => onTakeDeposit(p.amountSatang - p.receivedSatang)}
                      className="px-2.5 py-1 rounded-lg border border-green-300 text-green-800 text-xs font-semibold hover:bg-green-50"
                    >
                      รับมัดจำงวดนี้
                    </button>
                  )}
                  {!cancelled && p.status !== "paid" && p.stage === "invoice" && owing && (
                    <Link
                      href={`/accounting/invoices/${owing.id}`}
                      className="px-2.5 py-1 rounded-lg border border-sky-200 text-sky-700 text-xs font-semibold hover:bg-sky-50"
                    >
                      รับเงินที่ {owing.docNo}
                    </Link>
                  )}
                  {!cancelled && p.status !== "paid" && p.stage === "invoice" && !owing && detail.orderStatus !== "complete" && (
                    <Link
                      href={`/accounting/invoices/new?fromOrder=${encodeURIComponent(detail.order.id)}`}
                      className="px-2.5 py-1 rounded-lg border border-sky-200 text-sky-700 text-xs font-semibold hover:bg-sky-50"
                    >
                      ส่งของ ▸
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {planned !== detail.order.totalSatang && (
            <p className="text-xs text-amber-700 mt-2 tabular-nums">
              ตามแผน {formatSatang(planned)} จากยอด PO {formatSatang(detail.order.totalSatang)} บาท (รวม VAT)
            </p>
          )}
        </>
      )}
    </section>
  );
}

interface PlanRow {
  key: string;
  label: string;
  stage: PlanStage;
  amount: string;
  dueDate: string;
}

let planKey = 0;
const newPlanRow = (over: Partial<PlanRow> = {}): PlanRow => ({ key: `plan-${++planKey}`, label: "", stage: "invoice", amount: "", dueDate: "", ...over });

/** The payment plan, edited as a whole — with a helper for the usual "deposit N%, the rest on the invoices". */
function PlanDialog({ detail, onCancel, onSaved }: { detail: OrderDetailView; onCancel: () => void; onSaved: () => void }) {
  const total = detail.order.totalSatang;
  const [rows, setRows] = useState<PlanRow[]>(() =>
    (detail.plan ?? []).map((p) => newPlanRow({ label: p.label, stage: p.stage, amount: formatSatang(p.amountSatang), dueDate: p.dueDate }))
  );
  const [percent, setPercent] = useState("30");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = rows.map((r) => ({
    label: r.label.trim(),
    stage: r.stage,
    amountSatang: r.amount.trim() === "" ? -1 : parseBahtToSatang(r.amount) ?? -1,
    dueDate: r.dueDate,
  }));
  const problems = planProblems(items, total);
  const shown = attempted ? problems : { items: {} as typeof problems.items, total: null, first: null };
  const sum = items.reduce((s, it) => s + Math.max(0, it.amountSatang), 0);
  const setRow = (key: string, patch: Partial<PlanRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const fillFromPercent = () => {
    const pct = Number(percent);
    if (!(pct > 0 && pct < 100)) {
      setError("ใส่เปอร์เซ็นต์มัดจำระหว่าง 1–99");
      return;
    }
    const deposit = Math.round((total * pct) / 100);
    setError(null);
    setRows([
      newPlanRow({ label: `มัดจำ ${pct}%`, stage: "deposit", amount: formatSatang(deposit) }),
      newPlanRow({ label: `ส่วนที่เหลือ ${100 - pct}%`, stage: "invoice", amount: formatSatang(total - deposit) }),
    ]);
  };

  const save = async () => {
    if (busy) return;
    setAttempted(true);
    if (problems.first) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/sales-orders/${encodeURIComponent(detail.order.id)}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "บันทึกแผนเก็บเงินไม่สำเร็จ"));
        return;
      }
      onSaved();
    } catch {
      setError("บันทึกแผนเก็บเงินไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="แผนเก็บเงิน" busy={busy} onCancel={onCancel} wide>
      <p className="text-sm text-gray-600 tabular-nums">
        PO {detail.order.customerPoNo} · ยอดรวม VAT {formatSatang(total)} บาท — มัดจำรับที่หน้า PO (ออกใบกำกับภาษีให้) งวดอื่นเก็บตามใบแจ้งหนี้
      </p>
      <div className="flex flex-wrap items-end gap-2 rounded-xl bg-gray-50 border border-gray-100 p-3">
        <div>
          <label htmlFor="plan-percent" className="block text-xs font-semibold text-gray-600 mb-1">มัดจำ (%)</label>
          <input id="plan-percent" inputMode="decimal" className={`${FIELD} w-24`} value={percent} onChange={(e) => setPercent(e.target.value)} />
        </div>
        <button type="button" onClick={fillFromPercent} className="px-3 py-2 rounded-xl border border-sky-200 text-sky-700 text-sm font-semibold hover:bg-sky-50">
          สร้างแผน: มัดจำ + ที่เหลือตามใบแจ้งหนี้
        </button>
      </div>

      <ol className="space-y-3">
        {rows.map((r, i) => {
          const p = shown.items[i] ?? {};
          return (
            <li key={r.key} className="rounded-xl border border-gray-200 p-3 grid grid-cols-1 sm:grid-cols-[1fr_11rem] gap-2" data-testid="plan-row">
              <div>
                <label htmlFor={`plan-label-${i}`} className="sr-only">ชื่องวดที่ {i + 1}</label>
                <input
                  id={`plan-label-${i}`}
                  placeholder="ชื่องวด เช่น มัดจำ 30%"
                  maxLength={PLAN_LIMITS.label}
                  className={`${FIELD} ${p.label ? "border-red-500 bg-red-50" : ""}`}
                  aria-invalid={!!p.label || undefined}
                  value={r.label}
                  onChange={(e) => setRow(r.key, { label: e.target.value })}
                />
                {p.label && <p className="mt-1 text-sm text-red-600">{p.label}</p>}
              </div>
              <div>
                <label htmlFor={`plan-stage-${i}`} className="sr-only">ประเภทงวดที่ {i + 1}</label>
                <SearchableDropdown
                  id={`plan-stage-${i}`}
                  value={r.stage}
                  onChange={(v) => setRow(r.key, { stage: v === "deposit" ? "deposit" : "invoice" })}
                  options={PLAN_STAGES}
                  searchable={false}
                  buttonClassName="h-[42px] rounded-xl !border-gray-200"
                />
              </div>
              <div>
                <label htmlFor={`plan-amount-${i}`} className="block text-xs font-semibold text-gray-600 mb-1">ยอดงวดที่ {i + 1} (บาท รวม VAT)</label>
                <input
                  id={`plan-amount-${i}`}
                  inputMode="decimal"
                  className={`${FIELD} text-right tabular-nums ${p.amountSatang ? "border-red-500 bg-red-50" : ""}`}
                  aria-invalid={!!p.amountSatang || undefined}
                  value={r.amount}
                  onChange={(e) => setRow(r.key, { amount: e.target.value })}
                />
                {p.amountSatang && <p className="mt-1 text-sm text-red-600">{p.amountSatang}</p>}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor={`plan-due-${i}`} className="block text-xs font-semibold text-gray-600 mb-1">กำหนดรับ</label>
                  <DatePicker
                    id={`plan-due-${i}`}
                    selected={r.dueDate ? new Date(`${r.dueDate}T00:00:00`) : null}
                    onChange={(d) => setRow(r.key, { dueDate: d ? toLocalDateString(d) : "" })}
                    className={FIELD}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  aria-label={`ลบงวดที่ ${i + 1}`}
                  className="px-3 py-2 rounded-xl border border-red-200 text-red-600 text-sm hover:bg-red-50"
                >
                  ลบ
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={rows.length >= PLAN_LIMITS.items}
          onClick={() => setRows((rs) => [...rs, newPlanRow()])}
          className="px-3 py-2 rounded-xl border border-sky-200 text-sky-700 text-sm font-semibold hover:bg-sky-50 disabled:opacity-50"
        >
          + เพิ่มงวด
        </button>
        <p className={`text-sm tabular-nums ${sum > total ? "text-red-600 font-semibold" : "text-gray-600"}`} data-testid="plan-sum">
          รวม {formatSatang(sum)} จาก {formatSatang(total)} บาท
        </p>
      </div>
      {(error || shown.total) && (
        <p role="alert" className="text-sm text-red-600">
          {error ?? shown.total}
        </p>
      )}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
          ยกเลิก
        </button>
        <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60">
          {busy ? "กำลังบันทึก…" : "บันทึกแผน"}
        </button>
      </div>
    </DialogShell>
  );
}
