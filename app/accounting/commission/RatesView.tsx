"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown";
import Spinner from "../../components/Spinner";
import { useModalEscape } from "../../components/useModalEscape";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokCurrentMonth, formatDisplayDateTime } from "../../lib/dateFormat";
import { monthLabel } from "../../lib/accounting/exportRules";
import {
  BP_WHOLE,
  FIRST_EFFECTIVE_MONTH,
  MAX_LADDER_STEPS,
  rateRulesProblems,
  rateSetForMonth,
  type RateRules,
  type RateSet,
} from "../../lib/accounting/commission";
import {
  NOTHING_CHANGED,
  effectiveMonthLabel,
  formatPercent,
  formatWholeBaht,
  ladderRowViews,
  percentTextToBp,
  rateChangeProblems,
  type RateChange,
} from "../../lib/accounting/commissionRateChange";

// The commission rate table (ARCHITECTURE.md §8h): the sets in force, as the
// owner's table writes them; an editor; and the window for the 6-digit code
// emailed to the owner — the only way a change is saved. A new set starts on
// the 1st of the month picked; the first set is edited, never removed.

interface RateSetView extends RateSet {
  savedAt: string | null;
  savedBy: string | null;
}
interface HistoryEntry {
  id: string;
  effectiveMonth: string;
  removed: boolean;
  savedAt: string;
  savedBy: string;
}
interface RatesAnswer {
  sets: RateSetView[];
  history: HistoryEntry[];
}

const isAnswer = (v: unknown): v is RatesAnswer =>
  !!v && typeof v === "object" && Array.isArray((v as RatesAnswer).sets) && (v as RatesAnswer).sets.length > 0 && Array.isArray((v as RatesAnswer).history);

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: RatesAnswer };
/** An open editor: a month's set, or a new one (its month picked in it). */
type Editing = { kind: "edit"; month: string } | { kind: "new" };
/** A change waiting for its emailed code. */
interface Pending {
  change: RateChange;
  email: string;
  minutes: number;
}

/** POST …/otp — the code is emailed for `change`; the server's reason when it is not. */
async function askCode(change: RateChange): Promise<{ pending: Pending } | { error: string }> {
  try {
    const res = await fetch("/api/accounting/commission/rates/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change }),
    });
    if (!res.ok) return { error: await errorMessageOf(res, "ส่งรหัสยืนยันไม่สำเร็จ") };
    const body = (await res.json().catch(() => null)) as { email?: unknown; minutes?: unknown } | null;
    return {
      pending: {
        change,
        email: typeof body?.email === "string" ? body.email : "อีเมลของเจ้าของ",
        minutes: typeof body?.minutes === "number" ? body.minutes : 15,
      },
    };
  } catch {
    return { error: "ส่งรหัสยืนยันไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" };
  }
}

const TH = "px-3 py-2 text-left text-xs font-semibold text-gray-500";
const TD = "px-3 py-2";

export default function RatesView() {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/commission/rates", { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดตารางอัตราไม่สำเร็จ");
          if (!cancelled) setLoad({ status: "error", message });
          return;
        }
        const body = await res.json().catch(() => null);
        if (!cancelled) setLoad(isAnswer(body) ? { status: "ok", data: body } : { status: "error", message: "โหลดตารางอัตราไม่สำเร็จ" });
      } catch {
        if (!cancelled) setLoad({ status: "error", message: "โหลดตารางอัตราไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (load.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">{load.message}</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const { sets, history } = load.data;
  const remove = async (month: string) => {
    if (removing) return;
    setRemoving(month);
    setPageError(null);
    setNotice(null);
    const result = await askCode({ kind: "remove", effectiveMonth: month });
    setRemoving(null);
    if ("error" in result) setPageError(result.error);
    else setPending(result.pending);
  };

  return (
    <div className="space-y-4">
      {notice && (
        <p
          role="status"
          data-testid="rates-notice"
          className={`rounded-xl border px-4 py-2 text-sm ${notice.warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}`}
        >
          {notice.text}
        </p>
      )}
      {pageError && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {pageError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 max-w-3xl">
          แก้ตารางต้องใส่รหัส 6 หลักที่ส่งไปทางอีเมลของเจ้าของ · ชุดใหม่ใช้กับ PO ตั้งแต่วันที่ 1 ของเดือนที่เลือก · ยอดที่บันทึกจ่ายแล้วไม่เปลี่ยนตามตารางใหม่
        </p>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setEditing({ kind: "new" });
          }}
          className="px-4 py-2 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50"
        >
          เพิ่มชุดใหม่
        </button>
      </div>

      {editing && (
        <RateEditor
          key={editing.kind === "edit" ? editing.month : "new"}
          editing={editing}
          sets={sets}
          onCancel={() => setEditing(null)}
          onCode={setPending}
        />
      )}

      {sets.map((set) => (
        <RateSetCard
          key={set.effectiveMonth}
          set={set}
          removing={removing === set.effectiveMonth}
          onEdit={() => {
            setNotice(null);
            setEditing({ kind: "edit", month: set.effectiveMonth });
          }}
          onRemove={() => void remove(set.effectiveMonth)}
        />
      ))}

      {history.length > 0 && (
        <details className="bg-white rounded-2xl border border-gray-200 p-5">
          <summary className="cursor-pointer text-sm font-bold text-gray-900">ประวัติการแก้ตาราง ({history.length})</summary>
          <ul className="mt-3 space-y-1.5 text-sm" data-testid="rates-history">
            {history.map((h) => (
              <li key={h.id}>
                <span className="text-gray-500 tabular-nums">{formatDisplayDateTime(h.savedAt)}</span> · {h.removed ? "ลบชุด" : "บันทึกชุด"}
                {effectiveMonthLabel(h.effectiveMonth)} <span className="text-gray-400">({h.savedBy})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending && (
        <CodeDialog
          pending={pending}
          onCancel={() => setPending(null)}
          onSaved={(answer, summaryEmailSent) => {
            setLoad({ status: "ok", data: answer });
            setPending(null);
            setEditing(null);
            setNotice(
              summaryEmailSent
                ? { text: "บันทึกตารางอัตราแล้ว · ส่งอีเมลสรุปแล้ว", warn: false }
                : { text: "บันทึกตารางอัตราแล้ว แต่ส่งอีเมลสรุปไม่สำเร็จ", warn: true }
            );
          }}
        />
      )}
    </div>
  );
}

/** One set as the owner's table writes it — steps, ฟอร์ด / พี่ต่อ / บริษัท, and พี่ต่อ's customers. */
function RateSetCard({ set, removing, onEdit, onRemove }: { set: RateSetView; removing: boolean; onEdit: () => void; onRemove: () => void }) {
  const flat = set.rules.torFlat;
  return (
    <section data-testid={`rate-set-${set.effectiveMonth}`} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-gray-900">{effectiveMonthLabel(set.effectiveMonth)}</h3>
          <p className="text-xs text-gray-500">
            {set.savedAt ? `บันทึกล่าสุด ${formatDisplayDateTime(set.savedAt)} โดย ${set.savedBy}` : "ตารางตั้งต้นตามที่เจ้าของกำหนด (ยังไม่เคยแก้)"}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className="px-3 py-1.5 rounded-lg border border-sky-200 text-sm font-semibold text-sky-700 hover:bg-sky-50">
            แก้ชุดนี้
          </button>
          {set.effectiveMonth !== FIRST_EFFECTIVE_MONTH && (
            <button
              type="button"
              onClick={onRemove}
              disabled={removing}
              className="px-3 py-1.5 rounded-lg border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              ลบชุดนี้
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-gray-50">
            <tr>
              <th className={TH}>ช่วงกำไรสะสมของเดือน (บาท)</th>
              <th className={`${TH} text-right`}>ฟอร์ด</th>
              <th className={`${TH} text-right`}>พี่ต่อ</th>
              <th className={`${TH} text-right`}>บริษัท</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ladderRowViews(set.rules.ladder).map((r) => (
              <tr key={r.label}>
                <td className={TD}>{r.label}</td>
                <td className={`${TD} text-right`}>{formatPercent(r.fordBp)}</td>
                <td className={`${TD} text-right`}>{formatPercent(r.torBp)}</td>
                <td className={`${TD} text-right text-gray-500`}>{formatPercent(r.companyBp)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50/60">
              <td className={`${TD} font-semibold`}>ดีลลูกค้าพี่ต่อ</td>
              <td className={`${TD} text-right`}>{formatPercent(flat.fordBp)}</td>
              <td className={`${TD} text-right`}>{formatPercent(flat.torBp)}</td>
              <td className={`${TD} text-right text-gray-500`}>{formatPercent(BP_WHOLE - flat.fordBp - flat.torBp)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Row {
  upTo: string;
  ford: string;
  tor: string;
}

const percentText = (bp: number) => formatPercent(bp).replace(/%$/, "");
const rowsOf = (rules: RateRules): Row[] =>
  rules.ladder.map((s) => ({ upTo: s.upToSatang === null ? "" : formatWholeBaht(s.upToSatang), ford: percentText(s.fordBp), tor: percentText(s.torBp) }));

/** Whole baht as typed ("100,000" or "100000") → satang; null for anything else. */
function wholeBahtToSatang(text: string): number | null {
  const raw = text.trim();
  if (!/^\d{1,3}(,\d{3})*$/.test(raw) && !/^\d+$/.test(raw)) return null;
  const satang = Number(raw.replace(/,/g, "")) * 100;
  return Number.isSafeInteger(satang) ? satang : null;
}

/** The editor's fields as a table — or what is wrong with them, in Thai. */
function readEditor(rows: Row[], flat: { ford: string; tor: string }): { rules: RateRules | null; problems: string[] } {
  const problems: string[] = [];
  const pct = (where: string, who: string, text: string) => {
    const bp = percentTextToBp(text);
    if (bp === null) problems.push(`${where}: กรอก % ของ${who}เป็นตัวเลข 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)`);
    return bp ?? 0;
  };
  const ladder = rows.map((r, i) => {
    const where = `ขั้นที่ ${i + 1}`;
    const last = i === rows.length - 1;
    const upToSatang = last ? null : wholeBahtToSatang(r.upTo);
    if (!last && upToSatang === null) problems.push(`${where}: กรอกกำไรสูงสุดของขั้นเป็นจำนวนเต็มบาท`);
    return { upToSatang, fordBp: pct(where, "ฟอร์ด", r.ford), torBp: pct(where, "พี่ต่อ", r.tor) };
  });
  const torFlat = { fordBp: pct("ดีลลูกค้าพี่ต่อ", "ฟอร์ด", flat.ford), torBp: pct("ดีลลูกค้าพี่ต่อ", "พี่ต่อ", flat.tor) };
  if (problems.length > 0) return { rules: null, problems };
  const rules: RateRules = { ladder, torFlat };
  const ruleProblems = rateRulesProblems(rules);
  return ruleProblems.length > 0 ? { rules: null, problems: ruleProblems } : { rules, problems: [] };
}

/** The company's share of a row as typed — "—" until both rates read. */
function companyText(ford: string, tor: string): string {
  const f = percentTextToBp(ford);
  const t = percentTextToBp(tor);
  return f !== null && t !== null && f + t <= BP_WHOLE ? formatPercent(BP_WHOLE - f - t) : "—";
}

const INPUT = "w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-right tabular-nums outline-none focus:ring-2 focus:ring-sky-500";

/** The months a new set may start in: a year back to two ahead, but not one that has a set. */
function startMonths(sets: readonly RateSet[]): { value: string; label: string }[] {
  const [y, m] = bangkokCurrentMonth().split("-").map(Number);
  const taken = new Set(sets.map((s) => s.effectiveMonth));
  const out: { value: string; label: string }[] = [];
  for (let i = -12; i <= 24; i++) {
    const index = y * 12 + (m - 1) + i;
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    if (!taken.has(month)) out.push({ value: month, label: monthLabel(month) });
  }
  return out;
}

function RateEditor({
  editing,
  sets,
  onCancel,
  onCode,
}: {
  editing: Editing;
  sets: readonly RateSet[];
  onCancel: () => void;
  onCode: (pending: Pending) => void;
}) {
  // A new set starts from the latest set's figures.
  const base = editing.kind === "edit" ? rateSetForMonth(sets, editing.month).rules : sets[sets.length - 1].rules;
  const [month, setMonth] = useState(editing.kind === "edit" ? editing.month : "");
  const [rows, setRows] = useState<Row[]>(() => rowsOf(base));
  const [flat, setFlat] = useState(() => ({ ford: percentText(base.torFlat.fordBp), tor: percentText(base.torFlat.torBp) }));
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const months = useMemo(() => startMonths(sets), [sets]);

  const read = readEditor(rows, flat);
  const monthProblem = editing.kind === "new" && !month ? "เลือกเดือนที่เริ่มใช้" : null;
  const change: RateChange | null = read.rules && month ? { kind: "save", effectiveMonth: month, rules: read.rules } : null;
  const changeProblems = change ? rateChangeProblems(change, sets) : [];
  const unchanged = changeProblems.includes(NOTHING_CHANGED);
  const problems = [...(monthProblem ? [monthProblem] : []), ...read.problems, ...changeProblems.filter((p) => p !== NOTHING_CHANGED)];
  const canSave = !busy && change !== null && problems.length === 0 && !unchanged;
  const title = editing.kind === "edit" ? `แก้ตารางอัตรา ${effectiveMonthLabel(editing.month)}` : "เพิ่มตารางอัตราชุดใหม่";

  const setRow = (i: number, patch: Partial<Row>) => {
    setServerError(null);
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  };
  const addStep = () => {
    setServerError(null);
    setRows((rs) => {
      const last = rs[rs.length - 1];
      return [...rs.slice(0, -1), { upTo: "", ford: last.ford, tor: last.tor }, last];
    });
  };
  const removeStep = (i: number) => {
    setServerError(null);
    setRows((rs) => rs.filter((_, k) => k !== i));
  };
  const save = async () => {
    if (!canSave || !change) return;
    setBusy(true);
    setServerError(null);
    const result = await askCode(change);
    setBusy(false);
    if ("error" in result) setServerError(result.error);
    else onCode(result.pending);
  };

  return (
    <section aria-label={title} className="bg-white rounded-2xl border border-sky-200 p-5 space-y-4">
      <h2 className="font-bold text-gray-900">{title}</h2>
      {editing.kind === "new" && (
        <div className="max-w-xs">
          <label htmlFor="rates-month" className="block text-sm font-semibold text-gray-700 mb-1">เริ่มใช้กับ PO ตั้งแต่เดือน</label>
          <SearchableDropdown
            id="rates-month"
            value={month}
            onChange={(v) => {
              setServerError(null);
              setMonth(v);
            }}
            options={months}
            placeholder="— เลือกเดือน —"
            searchable={false}
            buttonClassName="h-[42px] rounded-xl !border-gray-200"
          />
          <p className="mt-1 text-xs text-gray-500">ใช้กับ PO ที่ลงวันที่ตั้งแต่วันที่ 1 ของเดือนนี้</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th className={TH}>ขั้น</th>
              <th className={TH}>กำไรสะสมของเดือนถึง (บาท)</th>
              <th className={`${TH} text-right`}>% ฟอร์ด</th>
              <th className={`${TH} text-right`}>% พี่ต่อ</th>
              <th className={`${TH} text-right`}>บริษัท</th>
              <th className={TH}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              return (
                <tr key={i}>
                  <td className={`${TD} text-gray-500`}>{i + 1}</td>
                  <td className={TD}>
                    {last ? (
                      <span className="text-gray-600">{i === 0 ? "กำไรทุกยอด" : `เกิน ${rows[i - 1].upTo || "…"}`}</span>
                    ) : (
                      <input
                        aria-label={`ขั้นที่ ${i + 1} กำไรสะสมถึง (บาท)`}
                        inputMode="numeric"
                        className={`${INPUT} w-36`}
                        value={r.upTo}
                        onChange={(e) => setRow(i, { upTo: e.target.value })}
                      />
                    )}
                  </td>
                  <td className={TD}>
                    <input aria-label={`ขั้นที่ ${i + 1} % ฟอร์ด`} inputMode="decimal" className={INPUT} value={r.ford} onChange={(e) => setRow(i, { ford: e.target.value })} />
                  </td>
                  <td className={TD}>
                    <input aria-label={`ขั้นที่ ${i + 1} % พี่ต่อ`} inputMode="decimal" className={INPUT} value={r.tor} onChange={(e) => setRow(i, { tor: e.target.value })} />
                  </td>
                  <td className={`${TD} text-right text-gray-500 tabular-nums`} data-testid={`company-${i}`}>
                    {companyText(r.ford, r.tor)}
                  </td>
                  <td className={TD}>
                    {rows.length > 1 && (
                      <button type="button" aria-label={`ลบขั้นที่ ${i + 1}`} onClick={() => removeStep(i)} className="text-xs font-semibold text-red-600 hover:underline">
                        ลบ
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-100">
              <td className={TD}></td>
              <td className={`${TD} font-semibold`}>ดีลลูกค้าพี่ต่อ</td>
              <td className={TD}>
                <input
                  aria-label="ดีลลูกค้าพี่ต่อ % ฟอร์ด"
                  inputMode="decimal"
                  className={INPUT}
                  value={flat.ford}
                  onChange={(e) => {
                    setServerError(null);
                    setFlat((f) => ({ ...f, ford: e.target.value }));
                  }}
                />
              </td>
              <td className={TD}>
                <input
                  aria-label="ดีลลูกค้าพี่ต่อ % พี่ต่อ"
                  inputMode="decimal"
                  className={INPUT}
                  value={flat.tor}
                  onChange={(e) => {
                    setServerError(null);
                    setFlat((f) => ({ ...f, tor: e.target.value }));
                  }}
                />
              </td>
              <td className={`${TD} text-right text-gray-500 tabular-nums`} data-testid="company-flat">
                {companyText(flat.ford, flat.tor)}
              </td>
              <td className={TD}></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addStep}
        disabled={rows.length >= MAX_LADDER_STEPS}
        className="text-sm font-semibold text-sky-700 hover:text-sky-800 disabled:opacity-50"
      >
        + เพิ่มขั้น
      </button>
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <ul className="list-disc pl-5 space-y-0.5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {unchanged && problems.length === 0 && <p className="text-xs text-gray-500">ยังไม่ได้แก้ตัวเลข</p>}
      {serverError && <p className="text-sm text-red-600">{serverError}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="px-4 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? "กำลังส่งรหัส…" : "บันทึก — ส่งรหัสยืนยันทางอีเมล"}
        </button>
      </div>
    </section>
  );
}

/** The 6-digit code from the owner's email — what saves the change it was sent for. */
function CodeDialog({
  pending,
  onCancel,
  onSaved,
}: {
  pending: Pending;
  onCancel: () => void;
  onSaved: (answer: RatesAnswer, summaryEmailSent: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });
  const ready = /^\d{6}$/.test(code);

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/accounting/commission/rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: code }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "บันทึกไม่สำเร็จ"));
        return;
      }
      const body = (await res.json().catch(() => null)) as (RatesAnswer & { summaryEmailSent?: unknown }) | null;
      if (!isAnswer(body)) {
        setError("บันทึกแล้ว แต่โหลดตารางใหม่ไม่สำเร็จ กรุณาโหลดหน้าใหม่");
        return;
      }
      onSaved(body, body.summaryEmailSent === true);
    } catch {
      setError("บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await askCode(pending.change);
    setBusy(false);
    if ("error" in result) setError(result.error);
    else {
      setCode("");
      setInfo("ส่งรหัสใหม่แล้ว — ใช้รหัสล่าสุดเท่านั้น");
    }
  };

  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="ยืนยันด้วยรหัสจากอีเมล" className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold text-gray-900">ยืนยันด้วยรหัสจากอีเมล</h2>
        <p className="text-sm text-gray-600">
          ส่งรหัส 6 หลักไปที่ {pending.email} แล้ว ใช้ได้ {pending.minutes} นาที · ในอีเมลบอกด้วยว่ารหัสนี้ยืนยันการเปลี่ยนอะไร
        </p>
        <div>
          <label htmlFor="rates-otp" className="block text-sm font-semibold text-gray-700 mb-1">รหัส 6 หลักจากอีเมล</label>
          <input
            id="rates-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-center text-xl tracking-[0.4em] tabular-nums outline-none focus:ring-2 focus:ring-sky-500"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        {info && <p className="text-sm text-green-700">{info}</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={() => void resend()} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
            ขอรหัสใหม่
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!ready || busy}
            className="flex-1 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60"
          >
            {busy ? "กำลังบันทึก…" : "ยืนยัน"}
          </button>
        </div>
      </div>
    </div>
  );
}
