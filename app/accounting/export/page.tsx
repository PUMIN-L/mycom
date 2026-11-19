"use client";

import { useState } from "react";
import AccountingFrame from "../AccountingFrame";
import PasswordConfirmDialog from "../PasswordConfirmDialog";
import SearchableDropdown from "../../components/SearchableDropdown";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokCurrentMonth } from "../../lib/dateFormat";
import { downloadExcel, type ExcelSheet } from "../../lib/xlsxExport";
import { monthLabel } from "../../lib/accounting/exportRules";

export default function AccountingExportPage() {
  return (
    <AccountingFrame tab="export" title="Excel สำหรับนักบัญชี">
      <ExportBody />
    </AccountingFrame>
  );
}

/** The `count` months up to `current` ("YYYY-MM"), newest first. */
function recentMonths(current: string, count = 24): string[] {
  const [y, m] = current.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = y * 12 + (m - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

const SHEETS = [
  { name: "ภาษีขาย", text: "รายงานภาษีขาย — ใบกำกับภาษีทุกใบของเดือน (ใบที่ยกเลิกยังอยู่ ยอดเป็น 0) ใบลดหนี้เป็นยอดติดลบ รวมใบกำกับภาษีที่ออกจากที่อื่น" },
  { name: "ทะเบียนเอกสาร", text: "เอกสารทุกใบที่ลงวันที่ในเดือน ทั้งที่ออกจากระบบและจากที่อื่น พร้อมสถานะและเหตุผลที่ยกเลิก" },
  { name: "รับชำระ", text: "เงินที่รับในเดือน — ยอดรับ หัก ณ ที่จ่าย ค่าธรรมเนียม เงินเข้าจริง ใบเสร็จ และการคืนเงินลูกค้า" },
  { name: "หัก ณ ที่จ่าย", text: "ภาษีที่ลูกค้าหักไว้ในเดือน และได้รับ 50 ทวิ แล้วหรือยัง" },
  { name: "ลูกหนี้คงค้าง", text: "ยอดค้างรับ ณ สิ้นเดือน แยกตามลูกค้าและอายุหนี้" },
  { name: "มัดจำคงเหลือ", text: "เงินมัดจำที่รับแล้วแต่ยังไม่ได้หักในใบแจ้งหนี้ ณ สิ้นเดือน" },
];

/**
 * One month's workbook for the accountant: pick the month (last month by
 * default — the one filed by the 15th), type the password again, and the
 * browser writes the .xlsx. Nothing is kept on the server.
 */
function ExportBody() {
  const months = recentMonths(bangkokCurrentMonth());
  const [month, setMonth] = useState(months[1]);
  const [asking, setAsking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const submit = async (password: string): Promise<string | null> => {
    const res = await fetch("/api/accounting/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, password }),
    });
    if (!res.ok) return errorMessageOf(res, "ส่งออก Excel ไม่สำเร็จ");
    const body = (await res.json()) as { filename?: unknown; sheets?: unknown };
    if (typeof body?.filename !== "string" || !Array.isArray(body.sheets)) return "ส่งออก Excel ไม่สำเร็จ";
    try {
      await downloadExcel(body.filename, body.sheets as ExcelSheet[]);
    } catch {
      return "สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง";
    }
    setSaved(body.filename);
    return null;
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4" aria-labelledby="export-title">
        <h2 id="export-title" className="text-lg font-bold text-gray-900">ไฟล์ Excel ประจำเดือนสำหรับนักบัญชี</h2>
        <div className="max-w-xs">
          <label htmlFor="export-month" className="block text-sm font-semibold text-gray-700 mb-1">เดือนภาษี</label>
          <SearchableDropdown
            id="export-month"
            value={month}
            onChange={(v) => {
              setMonth(v);
              setSaved(null);
            }}
            options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
            searchable={false}
            buttonClassName="h-[42px] rounded-xl !border-gray-200"
          />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-1">ในไฟล์มี {SHEETS.length} ชีต</p>
          <ul className="text-sm text-gray-700 space-y-1" data-testid="export-sheets">
            {SHEETS.map((s) => (
              <li key={s.name}>
                <span className="font-semibold">{s.name}</span> — {s.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-gray-500">ตัวเลขเงินเป็นตัวเลขหน่วยบาท รวมใน Excel ได้ทันที · ไฟล์สร้างในเครื่องนี้ ไม่ถูกเก็บไว้ในระบบ · ต้องใส่รหัสผ่านอีกครั้ง เพราะเป็นข้อมูลภาษีทั้งเดือน</p>
        <button
          type="button"
          onClick={() => {
            setSaved(null);
            setAsking(true);
          }}
          className="px-5 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700"
        >
          ดาวน์โหลด Excel เดือน{monthLabel(month)}
        </button>
        {saved && (
          <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            ดาวน์โหลดแล้ว — ไฟล์ {saved}
          </p>
        )}
      </section>
      {asking && (
        <PasswordConfirmDialog
          title={`ดาวน์โหลด Excel เดือน${monthLabel(month)}?`}
          confirmText="ดาวน์โหลด"
          onSubmit={submit}
          onCancel={() => setAsking(false)}
          onDone={() => setAsking(false)}
        >
          <p>ไฟล์มีข้อมูลภาษีขาย การรับเงิน และลูกหนี้ของทั้งเดือน — การส่งออกจะถูกบันทึกในประวัติการทำรายการ</p>
        </PasswordConfirmDialog>
      )}
    </div>
  );
}
