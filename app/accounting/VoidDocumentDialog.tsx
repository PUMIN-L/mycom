"use client";

import { useState } from "react";
import PasswordConfirmDialog from "./PasswordConfirmDialog";
import { errorMessageOf } from "../lib/apiErrorMessage";

/**
 * Voids an issued document — an invoice or a credit note (step 8): what will
 * happen, said first, then a reason and the password again. The number stays
 * in the register, marked ยกเลิก.
 */
export default function VoidDocumentDialog({
  url,
  title,
  effects,
  onCancel,
  onDone,
}: {
  /** POST { reason, password }. */
  url: string;
  title: string;
  effects: string[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const submit = async (password: string): Promise<string | null> => {
    if (!reason.trim()) return "กรุณาบอกเหตุผลที่ยกเลิก";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim(), password }),
    });
    return res.ok ? null : errorMessageOf(res, "ยกเลิกเอกสารไม่สำเร็จ");
  };
  return (
    <PasswordConfirmDialog title={title} confirmText="ยกเลิกเอกสาร" danger onSubmit={submit} onCancel={onCancel} onDone={onDone}>
      <ul className="list-disc pl-5 space-y-1">
        {effects.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <div>
        <label htmlFor="void-doc-reason" className="block text-sm font-semibold text-gray-700 mb-1">
          เหตุผลที่ยกเลิก <span className="text-red-500">*</span>
        </label>
        <input
          id="void-doc-reason"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น ออกผิดลูกค้า ออกใบใหม่แทนแล้ว"
        />
      </div>
    </PasswordConfirmDialog>
  );
}
