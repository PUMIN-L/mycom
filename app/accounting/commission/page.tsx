"use client";

import { useState } from "react";
import AccountingFrame from "../AccountingFrame";
import MonthView from "./MonthView";
import PayoutsView from "./PayoutsView";
import RatesView from "./RatesView";

export default function CommissionPage() {
  return (
    <AccountingFrame tab="commission" title="ค่าคอมมิชชั่น">
      <CommissionBody />
    </AccountingFrame>
  );
}

type View = "month" | "payouts" | "rates";

const VIEWS: { key: View; label: string }[] = [
  { key: "month", label: "สรุปรายเดือน" },
  { key: "payouts", label: "สรุปการจ่าย" },
  { key: "rates", label: "ตารางอัตรา" },
];

/** ค่าคอมมิชชั่น of ฟอร์ด and พี่ต่อ (ARCHITECTURE.md §8h), one view at a time — the month first. */
function CommissionBody() {
  const [view, setView] = useState<View>("month");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="ค่าคอมมิชชั่น" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              view === v.key ? "bg-sky-600 border-sky-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "month" && <MonthView />}
      {view === "payouts" && <PayoutsView />}
      {view === "rates" && <RatesView />}
    </div>
  );
}
