"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DatePicker from "../../components/DatePicker";
import Spinner from "../../components/Spinner";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokCurrentMonth, formatDisplayDate, isValidDateString, toLocalDateString } from "../../lib/dateFormat";
import { formatSatang } from "../../lib/accounting/money";
import { COMMISSION_KIND_LABELS } from "../../lib/accounting/commission";
import { formatWholeBaht } from "../../lib/accounting/commissionRateChange";
import { payoutRangeLabel, payoutSummary } from "../../lib/accounting/commissionPayoutPaper";
import type { PayoutReport } from "../../lib/accounting/commissionTypes";
import { PayoutPdfMaker } from "./CommissionPayoutPaper";

// The commission payouts (ARCHITECTURE.md §8h): what was marked paid in a
// range of PAID dates (this month first) — what each person got, every PO —
// and the payout summary as a PDF in one click, the cost breakdown in it only
// when switched on (off by default: the paper may be handed to the two).

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: T };

const isReport = (v: unknown): v is PayoutReport =>
  !!v && typeof v === "object" && Array.isArray((v as PayoutReport).rows) && Array.isArray((v as PayoutReport).rateSets) && !!(v as PayoutReport).seller;

/** A month's first and last day. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) - 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const reportUrl = (from: string, to: string, withCosts: boolean) =>
  `/api/accounting/commission/payouts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${withCosts ? "&withCosts=1" : ""}`;

const TH = "px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap";
const TD = "px-3 py-2 align-top";
const FIELD = "h-[42px] !py-2";

export default function PayoutsView() {
  const thisMonth = useMemo(() => bangkokCurrentMonth(), []);
  const [range, setRange] = useState(() => monthBounds(thisMonth));
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{ key: string; load: Load<PayoutReport> }>({ key: "", load: { status: "loading" } });
  const [withCosts, setWithCosts] = useState(false);
  const [making, setMaking] = useState<PayoutReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);

  const valid = isValidDateString(range.from) && isValidDateString(range.to) && range.from <= range.to;
  const key = `${range.from}|${range.to}|${reloadKey}`;
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    (async () => {
      let load: Load<PayoutReport>;
      try {
        const res = await fetch(reportUrl(range.from, range.to, false), { cache: "no-store" });
        if (!res.ok) load = { status: "error", message: await errorMessageOf(res, "โหลดสรุปการจ่ายค่าคอมไม่สำเร็จ") };
        else {
          const body = await res.json().catch(() => null);
          load = isReport(body) ? { status: "ok", data: body } : { status: "error", message: "โหลดสรุปการจ่ายค่าคอมไม่สำเร็จ" };
        }
      } catch {
        load = { status: "error", message: "โหลดสรุปการจ่ายค่าคอมไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" };
      }
      if (!cancelled) setState({ key: `${range.from}|${range.to}|${reloadKey}`, load });
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, reloadKey, valid]);
  const load: Load<PayoutReport> = state.key === key ? state.load : { status: "loading" };

  const pick = (next: { from: string; to: string }) => {
    setNotice(null);
    setRange(next);
  };

  /** Reads the summary afresh (with the costs when switched on), then the maker draws and saves it. */
  const exportPdf = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(reportUrl(range.from, range.to, withCosts), { cache: "no-store" });
      if (!res.ok) {
        setNotice({ text: await errorMessageOf(res, "ส่งออก PDF ไม่สำเร็จ"), warn: true });
        setBusy(false);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!isReport(body)) {
        setNotice({ text: "ส่งออก PDF ไม่สำเร็จ", warn: true });
        setBusy(false);
        return;
      }
      setMaking(body);
    } catch {
      setNotice({ text: "ส่งออก PDF ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่", warn: true });
      setBusy(false);
    }
  };
  const finished = useCallback((result: { file: string } | { error: string }) => {
    setMaking(null);
    setBusy(false);
    setNotice("file" in result ? { text: `ดาวน์โหลดแล้ว — ไฟล์ ${result.file}`, warn: false } : { text: result.error, warn: true });
  }, []);

  const rows = load.status === "ok" ? load.data.rows : [];
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label htmlFor="payouts-from" className="block text-sm font-semibold text-gray-700 mb-1">จ่ายตั้งแต่วันที่</label>
          <DatePicker
            id="payouts-from"
            selected={range.from ? new Date(`${range.from}T00:00:00`) : null}
            onChange={(d) => pick({ ...range, from: d ? toLocalDateString(d) : "" })}
            className={FIELD}
          />
        </div>
        <div className="w-44">
          <label htmlFor="payouts-to" className="block text-sm font-semibold text-gray-700 mb-1">ถึงวันที่</label>
          <DatePicker
            id="payouts-to"
            selected={range.to ? new Date(`${range.to}T00:00:00`) : null}
            onChange={(d) => pick({ ...range, to: d ? toLocalDateString(d) : "" })}
            className={FIELD}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => pick(monthBounds(thisMonth))} className="px-3 py-2 rounded-xl border border-gray-300 text-sm font-semibold hover:bg-gray-50">
            เดือนนี้
          </button>
          <button type="button" onClick={() => pick(monthBounds(previousMonth(thisMonth)))} className="px-3 py-2 rounded-xl border border-gray-300 text-sm font-semibold hover:bg-gray-50">
            เดือนที่แล้ว
          </button>
        </div>
      </div>

      {!valid && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          กรุณาเลือกช่วงวันที่ให้ถูกต้อง — วันเริ่มต้องไม่หลังวันสุดท้าย
        </p>
      )}
      {notice && (
        <p role="status" className={`rounded-xl border px-4 py-2 text-sm ${notice.warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}`}>
          {notice.text}
        </p>
      )}

      {valid && load.status === "loading" && (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-sky-600" />
        </div>
      )}
      {valid && load.status === "error" && (
        <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
          <p className="text-red-700">{load.message}</p>
          <button type="button" onClick={() => setReloadKey((n) => n + 1)} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">
            ลองใหม่
          </button>
        </div>
      )}
      {valid && load.status === "ok" && <PayoutsBody report={load.data} />}

      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" aria-labelledby="payouts-pdf-title">
        <h2 id="payouts-pdf-title" className="font-bold text-gray-900">PDF สรุปการจ่ายค่าคอม</h2>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            role="switch"
            aria-checked={withCosts}
            checked={withCosts}
            onChange={(e) => setWithCosts(e.target.checked)}
            className="h-4 w-4 accent-sky-600"
          />
          <span className="text-sm font-semibold text-gray-700">แสดงรายละเอียดต้นทุน</span>
        </label>
        <p className="text-xs text-gray-500">
          ปิดไว้: PDF แสดงเฉพาะกำไรและค่าคอม (เหมาะส่งให้เซลล์) · เปิด: ใต้แต่ละ PO มีต้นทุนทีละรายการ · ไฟล์สร้างในเครื่องนี้ ไม่ถูกเก็บไว้ในระบบ
        </p>
        <button
          type="button"
          onClick={() => void exportPdf()}
          disabled={busy || !valid || load.status !== "ok" || rows.length === 0}
          className="px-5 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? "กำลังสร้าง PDF…" : "ส่งออก PDF"}
        </button>
      </section>

      {making && <PayoutPdfMaker report={making} onFinish={finished} />}
    </div>
  );
}

function PayoutsBody({ report }: { report: PayoutReport }) {
  const s = payoutSummary(report.rows);
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-500">ฟอร์ดได้รับ</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums" data-testid="payout-ford">{formatSatang(s.ford.totalSatang)}</p>
          <p className="text-xs text-gray-500 tabular-nums">{`จากลูกค้าฟอร์ด ${formatSatang(s.ford.fromFordSatang)} · จากลูกค้าพี่ต่อ ${formatSatang(s.ford.fromTorSatang)}`}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-500">พี่ต่อได้รับ</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums" data-testid="payout-tor">{formatSatang(s.tor.totalSatang)}</p>
          <p className="text-xs text-gray-500 tabular-nums">{`จากลูกค้าฟอร์ด ${formatSatang(s.tor.fromFordSatang)} · จากลูกค้าพี่ต่อ ${formatSatang(s.tor.fromTorSatang)}`}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-500">รวมจ่าย</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums" data-testid="payout-both">{formatSatang(s.bothSatang)}</p>
          <p className="text-xs text-gray-500 tabular-nums">{`จ่าย ${s.count} PO · กำไรรวม ${formatSatang(s.profitSatang)} · ส่วนของบริษัท ${formatSatang(s.companySatang)}`}</p>
        </div>
      </div>

      <p className="text-xs text-gray-500">{`วันที่จ่าย ${payoutRangeLabel(report.from, report.to)} · ยอดที่ล็อกไว้ตอนกดบันทึกจ่าย · ไม่รวมรายการที่ยกเลิกการบันทึกจ่ายแล้ว`}</p>
      {report.changedSince > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {`ข้อมูลเปลี่ยนหลังบันทึกจ่าย ${report.changedSince} รายการ (ยอดหรือสถานะ) — ดูส่วนต่างได้ที่ "สรุปรายเดือน" ของเดือน PO นั้น`}
        </p>
      )}

      {report.rows.length === 0 ? (
        <p className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500">ไม่มีการจ่ายค่าคอมในช่วงวันที่นี้</p>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-gray-50">
              <tr>
                <th className={TH}>วันที่จ่าย</th>
                <th className={TH}>PO / ลูกค้า</th>
                <th className={TH}>ประเภท</th>
                <th className={`${TH} text-right`}>กำไร</th>
                <th className={`${TH} text-right`}>ฟอร์ด</th>
                <th className={`${TH} text-right`}>พี่ต่อ</th>
                <th className={`${TH} text-right`}>บริษัท</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {report.rows.map((r) => (
                <tr key={r.id} data-testid={`payout-row-${r.id}`}>
                  <td className={`${TD} whitespace-nowrap`}>{formatDisplayDate(r.paidDate)}</td>
                  <td className={TD}>
                    <p className="font-semibold text-gray-900">{r.customerPoNo}</p>
                    <p className="text-xs text-gray-500">{r.buyerName}</p>
                    <p className="text-xs text-gray-400">
                      {`PO วันที่ ${formatDisplayDate(r.issueDate)}`}
                      {r.kind === "ford" && r.ladderFromSatang !== null && r.ladderToSatang !== null && r.ladderToSatang > r.ladderFromSatang
                        ? ` · กำไรสะสม ${formatWholeBaht(r.ladderFromSatang)} – ${formatWholeBaht(r.ladderToSatang)}`
                        : ""}
                    </p>
                    {r.changedSince && (
                      <span className="mt-1 inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">ข้อมูลเปลี่ยนหลังจ่าย</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{r.kind ? COMMISSION_KIND_LABELS[r.kind] : "—"}</td>
                  <td className={`${TD} text-right`}>{formatSatang(r.profitSatang)}</td>
                  <td className={`${TD} text-right font-semibold`}>{formatSatang(r.fordSatang)}</td>
                  <td className={`${TD} text-right font-semibold`}>{formatSatang(r.torSatang)}</td>
                  <td className={`${TD} text-right text-gray-500`}>{formatSatang(r.companySatang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
