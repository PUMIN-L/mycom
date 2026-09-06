"use client";
import { useState, useEffect, useCallback } from "react";
import FormattedNumberInput from "../FormattedNumberInput";
import SearchableDropdown from "../SearchableDropdown";
import ConfirmDialog from "../ConfirmDialog";
import Spinner from "../Spinner";
import { PAYMENT_METHODS, DEFAULT_PAYMENT_METHOD } from "../../lib/paymentMethods";
import { bangkokDateString, formatDisplayDate } from "../../lib/dateFormat";
import { SATANG_TOLERANCE } from "../../lib/receivables";

/**
 * "บันทึกรับชำระ" — ONE action for the ordinary paid-in-full case.
 *
 * The owner said: "ส่วนใหญ่ครั้งเดียว แต่บางงานมีมัดจำ". So this modal opens
 * pre-filled with the outstanding balance, today's Bangkok date and โอนเงิน,
 * and ยืนยัน is the whole interaction. Typing a SMALLER amount is the deposit
 * case, and the SAME single button collects the balance later, again pre-filled
 * with what is left. The word "งวด" never appears, and the admin never operates
 * a ledger.
 *
 * The payment HISTORY only appears once a document carries more than one live
 * payment — the second payment is what reveals the ledger, so the one-payment
 * case never pays for the two-payment case.
 *
 * Overpayment is CONFIRMED, not blocked: a customer really can transfer too
 * much, and blocking would force the admin to record a false amount.
 */

export interface PaymentTargetDoc {
  id: string;
  docNo: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
}

interface PaymentHistoryRow {
  id: string;
  amount: number;
  paidDate: string;
  method: string;
  ref: string;
  receiptDocId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: m }));

export default function RecordPaymentModal({
  doc,
  onClose,
  onSaved,
  onError,
}: {
  doc: PaymentTargetDoc;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const outstanding = Math.max(0, doc.totalAmount - doc.paidAmount);

  const [amount, setAmount] = useState<number>(outstanding);
  // Bangkok, not the browser's local day: the server stamps and compares these
  // dates in Bangkok, so a laptop set elsewhere must not disagree with it.
  const [paidDate, setPaidDate] = useState<string>(() => bangkokDateString(new Date()));
  const [method, setMethod] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOverpay, setConfirmOverpay] = useState(false);

  const [history, setHistory] = useState<PaymentHistoryRow[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PaymentHistoryRow | null>(null);
  const [voiding, setVoiding] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/billing/${encodeURIComponent(doc.id)}/payments`);
      if (!res.ok) return;
      const rows = await res.json();
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      /* the history is a disclosure, not the action — a failed read must not
         block recording a payment */
    }
  }, [doc.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const livePayments = (history ?? []).filter((p) => !p.voidedAt);
  const overpayBy = amount - outstanding;
  const isOverpay = overpayBy > SATANG_TOLERANCE;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/billing/${encodeURIComponent(doc.id)}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, paidDate, method, ref }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        onError(data?.error ?? "บันทึกการรับชำระไม่สำเร็จ");
        return;
      }
      onSaved(`บันทึกรับชำระ ฿${fmt(amount)} แล้ว`);
    } catch {
      onError("บันทึกการรับชำระไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
      setConfirmOverpay(false);
    }
  }

  function handleConfirm() {
    if (amount <= 0) {
      onError("จำนวนเงินต้องมากกว่า 0");
      return;
    }
    if (isOverpay) {
      setConfirmOverpay(true);
      return;
    }
    submit();
  }

  async function handleVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      const res = await fetch(
        `/api/billing/payments/${encodeURIComponent(voidTarget.id)}/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "แก้ไขรายการรับชำระ" }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        onError(data?.error ?? "ยกเลิกรายการรับชำระไม่สำเร็จ");
        return;
      }
      onSaved("ยกเลิกรายการรับชำระแล้ว");
    } catch {
      onError("ยกเลิกรายการรับชำระไม่สำเร็จ");
    } finally {
      setVoiding(false);
      setVoidTarget(null);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 pt-6 pb-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">💰 บันทึกรับชำระ</h3>
            <p className="text-sm text-gray-500 mt-1 line-clamp-1">
              {doc.customerName || "-"} · {doc.docNo || "-"}
            </p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xs font-semibold text-gray-500">ยอดคงค้าง</span>
              <span className="text-2xl font-bold text-gray-900">฿{fmt(outstanding)}</span>
            </div>
            {doc.paidAmount > SATANG_TOLERANCE && (
              <p className="text-xs text-gray-500 mt-1">
                ชำระแล้ว ฿{fmt(doc.paidAmount)} จาก ฿{fmt(doc.totalAmount)}
              </p>
            )}
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                จำนวนเงิน
              </label>
              <FormattedNumberInput
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {isOverpay && (
                <p className="text-xs text-red-500 mt-1">
                  ยอดนี้เกินยอดคงค้าง ฿{fmt(overpayBy)}
                </p>
              )}
              {!isOverpay && outstanding - amount > SATANG_TOLERANCE && amount > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  รับเป็นมัดจำ — จะเหลือค้าง ฿{fmt(outstanding - amount)}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                วันที่รับชำระ
              </label>
              <input
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                {formatDisplayDate(paidDate)}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                ช่องทาง
              </label>
              {/* Five fixed options — a search box would be dead weight. */}
              <SearchableDropdown
                value={method}
                onChange={setMethod}
                options={METHOD_OPTIONS}
                searchable={false}
                placeholder="เลือกช่องทาง..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                เลขอ้างอิง (ไม่บังคับ)
              </label>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="เลขที่โอน / เลขที่เช็ค"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* The ledger only appears once there IS a ledger to look at. */}
            {livePayments.length > 1 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="w-full px-3 py-2 text-left text-sm font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 transition flex items-center justify-between"
                >
                  <span>ประวัติการรับชำระ ({livePayments.length})</span>
                  <span className="text-xs text-gray-400">{historyOpen ? "▲" : "▼"}</span>
                </button>
                {historyOpen && (
                  <ul className="divide-y divide-gray-100">
                    {(history ?? []).map((p) => (
                      <li
                        key={p.id}
                        className={`px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                          p.voidedAt ? "text-gray-400 line-through" : "text-gray-700"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="font-semibold">฿{fmt(p.amount)}</span>{" "}
                          {formatDisplayDate(p.paidDate)} · {p.method}
                          {p.ref ? ` · ${p.ref}` : ""}
                          {p.voidedAt && p.voidReason ? ` (${p.voidReason})` : ""}
                        </span>
                        {!p.voidedAt && (
                          <button
                            type="button"
                            onClick={() => setVoidTarget(p)}
                            className="shrink-0 text-red-500 hover:text-red-700 font-semibold"
                          >
                            ยกเลิกรายการ
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="px-6 pb-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-60"
            >
              ปิด
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving || amount <= 0}
              className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition flex justify-center items-center gap-2 disabled:opacity-60"
            >
              {saving && <Spinner className="h-4 w-4 text-white" />}
              ยืนยัน
            </button>
          </div>
        </div>
      </div>

      {confirmOverpay && (
        <ConfirmDialog
          title="ยอดเกินยอดคงค้าง"
          message={`ยอดนี้เกินยอดคงค้าง ฿${fmt(overpayBy)} ยืนยันหรือไม่?`}
          confirmText="ยืนยัน"
          loadingText="กำลังบันทึก..."
          onConfirm={submit}
          onCancel={() => setConfirmOverpay(false)}
          loading={saving}
        />
      )}

      {voidTarget && (
        <ConfirmDialog
          title="ยกเลิกรายการรับชำระ"
          message={`ยกเลิกรายการ ฿${fmt(voidTarget.amount)} วันที่ ${formatDisplayDate(
            voidTarget.paidDate
          )} หรือไม่?\nรายการจะไม่ถูกลบ แต่จะถูกขีดฆ่าไว้ในประวัติและไม่นับรวมในยอดที่ชำระแล้ว`}
          confirmText="ยกเลิกรายการ"
          loadingText="กำลังยกเลิก..."
          onConfirm={handleVoid}
          onCancel={() => setVoidTarget(null)}
          loading={voiding}
        />
      )}
    </>
  );
}
