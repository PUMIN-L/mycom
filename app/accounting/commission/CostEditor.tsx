"use client";

import { useMemo, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { formatSatang, parseBahtToSatang } from "../../lib/accounting/money";
import { COST_TYPE_LABELS } from "../../lib/costTypes";
import {
  COST_EDIT_LIMITS,
  EDITABLE_COST_TYPES,
  costEditProblems,
  costRowName,
  isEditableCostType,
  type CostEditInput,
} from "../../lib/accounting/costEditRules";
import type { DeliveryCosts, PoCosts } from "../../lib/accounting/commissionTypes";

// One delivery's costs edited right on the commission screen (ARCHITECTURE.md
// §8h): each product line's cost, and the other costs added / changed /
// removed — saved together in one go, then the PO's costs and the month are
// read again. The same costs the dashboard's sale form edits. Checked here
// with the server's own rules (costEditProblems) before anything is sent.

const TYPE_OPTIONS = EDITABLE_COST_TYPES.map((t) => ({ value: t, label: COST_TYPE_LABELS[t] }));
const FIELD = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-sky-500";
const MONEY_FIELD = `${FIELD} text-right tabular-nums`;
const TYPE_A_FIGURE = "กรุณากรอกตัวเลข เช่น 1,500 หรือ 1500.50";

interface LineDraft {
  id: string;
  name: string;
  before: number;
  text: string;
}
interface RowDraft {
  key: string;
  /** null for a row added here. */
  id: string | null;
  costType: string;
  label: string;
  note: string;
  text: string;
}

/** A figure as it starts in its box: "400,000.00" — empty for nothing. */
const toText = (satang: number) => (satang === 0 ? "" : formatSatang(satang));
/** A product's cost typed → satang; an empty box is 0; null when it is not a figure. */
const lineSatang = (text: string): number | null => (text.trim() === "" ? 0 : parseBahtToSatang(text));

export default function CostEditor({
  poId,
  delivery,
  title,
  paid,
  onSaved,
  onCancel,
}: {
  poId: string;
  delivery: DeliveryCosts;
  /** "ส่งของครั้งที่ 1". */
  title: string;
  /** The PO's commission is marked paid. */
  paid: boolean;
  onSaved: (costs: PoCosts) => void;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState<LineDraft[]>(() =>
    delivery.items.map((i) => ({ id: i.id, name: `${i.productName} × ${i.qty}`, before: i.costSatang, text: toText(i.costSatang) }))
  );
  const [rows, setRows] = useState<RowDraft[]>(() =>
    delivery.costs.map((c) => ({ key: c.id, id: c.id, costType: c.costType, label: c.label, note: c.note, text: toText(c.amountSatang) }))
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [addedCount, setAddedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const original = useMemo(() => new Map(delivery.costs.map((c) => [c.id, c])), [delivery]);

  /** What the delivery would come to — the commission rows shown but not deducted. */
  const preview = useMemo(() => {
    let cost = 0;
    for (const l of lines) {
      const s = lineSatang(l.text);
      if (s === null) return null;
      cost += s;
    }
    for (const r of rows) {
      const s = lineSatang(r.text);
      if (s === null) return null;
      if (r.costType !== "commission") cost += s;
    }
    return { cost, profit: delivery.salesSatang - cost };
  }, [lines, rows, delivery.salesSatang]);

  const setLine = (index: number, text: string) => setLines((ls) => ls.map((l, k) => (k === index ? { ...l, text } : l)));
  const setRow = (key: string, patch: Partial<RowDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (row: RowDraft) => {
    if (row.id) setRemoved((ids) => [...ids, row.id!]);
    setRows((rs) => rs.filter((r) => r.key !== row.key));
  };
  const addRow = () => {
    const n = addedCount + 1;
    setAddedCount(n);
    setRows((rs) => [...rs, { key: `new-${n}`, id: null, costType: "", label: "", note: "", text: "" }]);
  };

  /** The edit to send — only what changed — or what is wrong, in Thai. */
  const build = (): { edit: CostEditInput } | { problems: string[] } => {
    const wrong: string[] = [];
    const edit: CostEditInput = { saleId: delivery.saleId, expectedCostSatang: delivery.storedCostSatang, lines: [], add: [], update: [], remove: [...removed] };
    for (const l of lines) {
      const s = lineSatang(l.text);
      if (s === null) wrong.push(`ต้นทุน ${l.name}: ${TYPE_A_FIGURE}`);
      else if (s !== l.before) edit.lines.push({ id: l.id, costSatang: s });
    }
    if (rows.some((r) => !isEditableCostType(r.costType))) wrong.push("กรุณาเลือกประเภทของค่าใช้จ่ายทุกรายการ");
    for (const r of rows) {
      const s = r.text.trim() === "" ? null : parseBahtToSatang(r.text);
      const row = { costType: r.costType, label: r.label.trim(), note: r.note.trim(), amountSatang: s ?? 0 };
      if (s === null) {
        wrong.push(`${isEditableCostType(r.costType) ? costRowName(row) : "ค่าใช้จ่าย"}: ${TYPE_A_FIGURE}`);
        continue;
      }
      if (!r.id) edit.add.push(row);
      else {
        const was = original.get(r.id);
        if (!was || was.costType !== row.costType || was.label !== row.label || was.note !== row.note || was.amountSatang !== row.amountSatang) {
          edit.update.push({ id: r.id, ...row });
        }
      }
    }
    if (wrong.length > 0) return { problems: wrong };
    const left = costEditProblems(edit);
    return left.length > 0 ? { problems: left } : { edit };
  };

  const save = async () => {
    if (busy) return;
    const built = build();
    if ("problems" in built) {
      setProblems(built.problems);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const res = await fetch(`/api/accounting/commission/orders/${encodeURIComponent(poId)}/costs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.edit),
      });
      if (!res.ok) {
        setProblems([await errorMessageOf(res, "บันทึกต้นทุนไม่สำเร็จ")]);
        return;
      }
      const body = (await res.json().catch(() => null)) as PoCosts | null;
      if (!body || !Array.isArray(body.deliveries) || !body.totals) {
        setProblems(["บันทึกแล้ว แต่โหลดต้นทุนใหม่ไม่สำเร็จ — กรุณาโหลดหน้านี้ใหม่"]);
        return;
      }
      onSaved(body);
    } catch {
      setProblems(["บันทึกต้นทุนไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`แก้ต้นทุน ${title}`} className="max-w-4xl space-y-3 rounded-xl border border-sky-200 bg-white p-3">
      <p className="font-semibold text-gray-900 tabular-nums">
        {`แก้ต้นทุน · ${title} · ${delivery.invoiceRef || "—"} · ยอดขาย ${formatSatang(delivery.salesSatang)}`}
      </p>
      {paid && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          PO นี้บันทึกจ่ายค่าคอมแล้ว — แก้ต้นทุนได้ แต่ยอดที่จ่ายไปจะไม่เปลี่ยน ส่วนที่ต่างจะขึ้นเป็น &quot;ส่วนต่างหลังจ่าย&quot;
        </p>
      )}

      {lines.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-500">ต้นทุนสินค้า (ทั้งบรรทัด ไม่ใช่ต่อชิ้น)</p>
          {lines.map((l, i) => (
            <div key={l.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-gray-700">{l.name}</span>
              <input
                aria-label={`ต้นทุน ${l.name}`}
                inputMode="decimal"
                placeholder="0.00"
                className={`${MONEY_FIELD} max-w-40`}
                value={l.text}
                onChange={(e) => setLine(i, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-gray-500">ค่าใช้จ่ายอื่น</p>
        {rows.length === 0 && <p className="text-xs text-gray-400">ยังไม่มี</p>}
        {rows.map((r) => (
          <div key={r.key} data-testid={`cost-row-${r.key}`} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[11rem_1fr_1fr_8rem_auto]">
            <div>
              <label htmlFor={`cost-type-${r.key}`} className="sr-only">ประเภทค่าใช้จ่าย</label>
              <SearchableDropdown
                id={`cost-type-${r.key}`}
                value={isEditableCostType(r.costType) ? r.costType : ""}
                onChange={(v) => setRow(r.key, { costType: v })}
                options={TYPE_OPTIONS}
                placeholder="— ประเภท —"
                searchable={false}
                buttonClassName="h-9 rounded-lg !border-gray-200 text-sm"
              />
            </div>
            <input aria-label="รายละเอียด" placeholder="รายละเอียด เช่น Kerry" maxLength={COST_EDIT_LIMITS.label} className={FIELD} value={r.label} onChange={(e) => setRow(r.key, { label: e.target.value })} />
            <input aria-label="หมายเหตุ" placeholder="หมายเหตุ (ไม่บังคับ)" maxLength={COST_EDIT_LIMITS.note} className={FIELD} value={r.note} onChange={(e) => setRow(r.key, { note: e.target.value })} />
            <input aria-label="จำนวนเงิน" inputMode="decimal" placeholder="0.00" className={MONEY_FIELD} value={r.text} onChange={(e) => setRow(r.key, { text: e.target.value })} />
            <button type="button" onClick={() => removeRow(r)} className="justify-self-start text-xs font-semibold text-red-700 hover:underline">
              ลบ
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="text-xs font-semibold text-sky-700 hover:underline">
          + เพิ่มค่าใช้จ่าย
        </button>
      </div>

      {preview && (
        <p className="text-sm font-semibold text-gray-800 tabular-nums">{`ต้นทุนครั้งนี้ ${formatSatang(preview.cost)} · กำไรครั้งนี้ ${formatSatang(preview.profit)}`}</p>
      )}
      <p className="text-xs text-gray-400">ค่าคอมมิชชั่นที่ลงเป็นต้นทุนไม่นำมาหักจากกำไร · เป็นข้อมูลชุดเดียวกับหน้า dashboard · บันทึกแล้วลงประวัติของ PO</p>
      {problems.length > 0 && (
        <div role="alert" className="space-y-0.5 text-sm text-red-600">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? "กำลังบันทึก…" : "บันทึกต้นทุน"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60">
          ยกเลิก
        </button>
      </div>
    </section>
  );
}
