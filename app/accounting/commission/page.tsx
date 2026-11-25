"use client";

import { useState } from "react";
import AccountingFrame from "../AccountingFrame";
import RatesView from "./RatesView";

export default function CommissionPage() {
  return (
    <AccountingFrame tab="commission" title="ค่าคอมมิชชั่น">
      <CommissionBody />
    </AccountingFrame>
  );
}

type View = "rates";

const VIEWS: { key: View; label: string }[] = [{ key: "rates", label: "ตารางอัตรา" }];

/** ค่าคอมมิชชั่น of ฟอร์ด and พี่ต่อ (ARCHITECTURE.md §8h), one view at a time. */
function CommissionBody() {
  const [view, setView] = useState<View>("rates");
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
      {view === "rates" && <RatesView />}
    </div>
  );
}
