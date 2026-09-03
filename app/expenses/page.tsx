"use client";
import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Expense, RecurringExpense } from "../lib/types";
import ConfirmDialog from "../components/ConfirmDialog";
import FormattedNumberInput from "../components/FormattedNumberInput";
import SearchableDropdown from "../components/SearchableDropdown";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { bangkokCurrentMonth } from "../lib/dateFormat";

const EXPENSE_CATEGORIES = [
  "เงินเดือน",
  "ค่าเช่า",
  "ค่าน้ำ/ค่าไฟ",
  "ค่าเดินทาง",
  "ค่าโฆษณา/การตลาด",
  "ค่าเสื่อมราคา",
  "ค่าอุปกรณ์สำนักงาน",
  "อื่นๆ"
];

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];

function emptyForm(): Partial<Expense> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    title: "",
    amount: 0,
    expenseDate: today,
    category: EXPENSE_CATEGORIES[0],
    note: "",
  };
}

function emptyRecurringForm(): Partial<RecurringExpense> {
  return {
    title: "",
    amount: 0,
    category: EXPENSE_CATEGORIES[0],
    note: "",
    active: true,
  };
}

// Bangkok time, not the admin's own device timezone — the server always
// generates for the Bangkok "current month" (bangkokCurrentMonth()), so the
// UI must agree on what month that is or the Generate button/badges can be
// wrong right around a month boundary for an admin in a different timezone.
function currentMonthStr(): string {
  return bangkokCurrentMonth();
}

export default function ExpensesPage() {
  const [records, setRecords] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Filter states
  const [periodType, setPeriodType] = useState<"month" | "quarter" | "year">("month");
  const [periodValue, setPeriodValue] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
  const yearOptions = useMemo(() =>
    [0, 1, 2, 3, 4].map((i) => {
      const y = String(new Date().getFullYear() - i);
      return { value: y, label: `ปี ${y}` };
    }),
    []
  );

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Expense>>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Recurring expense templates (e.g. rent/salary — same amount every month)
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringExpense[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [recurringForm, setRecurringForm] = useState<Partial<RecurringExpense>>(emptyRecurringForm());
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [recurringSubmitting, setRecurringSubmitting] = useState(false);
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      let dateFrom = "";
      let dateTo = "";
      
      const year = periodValue.split("-")[0];
      
      if (periodType === "year") {
        dateFrom = `${year}-01-01`;
        dateTo = `${year}-12-31`;
      } else if (periodType === "quarter") {
        const q = periodValue.split("-")[1] || "Q1";
        if (q === "Q1") { dateFrom = `${year}-01-01`; dateTo = `${year}-03-31`; }
        else if (q === "Q2") { dateFrom = `${year}-04-01`; dateTo = `${year}-06-30`; }
        else if (q === "Q3") { dateFrom = `${year}-07-01`; dateTo = `${year}-09-30`; }
        else if (q === "Q4") { dateFrom = `${year}-10-01`; dateTo = `${year}-12-31`; }
      } else {
        const month = periodValue.split("-")[1];
        const lastDay = new Date(Number(year), Number(month) || 1, 0).getDate();
        dateFrom = `${periodValue}-01`;
        dateTo = `${periodValue}-${String(lastDay).padStart(2, "0")}`;
      }

      const res = await fetch(`/api/admin/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const stripHtml = (html: string) => html ? html.replace(/<[^>]*>?/gm, '') : '';
      setRecords(data.map((r: any) => ({
        ...r,
        title: stripHtml(r.title),
        category: stripHtml(r.category),
        note: stripHtml(r.note)
      })));
    } catch {
      showToast("ดึงข้อมูลรายจ่ายไม่สำเร็จ", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodType, periodValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.amount || form.amount <= 0 || !form.expenseDate) {
      showToast("กรุณากรอกข้อมูลให้ครบถ้วนและจำนวนเงินต้องมากกว่า 0", "error");
      return;
    }
    setSubmitting(true);
    try {
      const url = editingId ? `/api/admin/expenses/${editingId}` : "/api/admin/expenses";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "บันทึกไม่สำเร็จ");
      }
      showToast("บันทึกรายจ่ายเรียบร้อย");
      setShowForm(false);
      fetchRecords();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const res = await fetch(`/api/admin/expenses/${deletingId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("ลบไม่สำเร็จ");
      showToast("ลบรายจ่ายเรียบร้อย");
      fetchRecords();
    } catch {
      showToast("ไม่สามารถลบรายการได้", "error");
    } finally {
      setDeletingId(null);
    }
  };

  // ── Recurring expense templates ─────────────────────────────────────────
  const fetchRecurringTemplates = async () => {
    setRecurringLoading(true);
    try {
      const res = await fetch("/api/admin/expenses/recurring");
      if (!res.ok) throw new Error("Failed to fetch");
      setRecurringTemplates(await res.json());
    } catch {
      showToast("ดึงข้อมูลรายจ่ายประจำไม่สำเร็จ", "error");
    } finally {
      setRecurringLoading(false);
    }
  };

  useEffect(() => {
    fetchRecurringTemplates();
  }, []);

  const handleSubmitRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recurringForm.title || !recurringForm.amount || recurringForm.amount <= 0) {
      showToast("กรุณากรอกข้อมูลให้ครบถ้วนและจำนวนเงินต้องมากกว่า 0", "error");
      return;
    }
    setRecurringSubmitting(true);
    try {
      const url = editingRecurringId
        ? `/api/admin/expenses/recurring/${editingRecurringId}`
        : "/api/admin/expenses/recurring";
      const method = editingRecurringId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recurringForm),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "บันทึกไม่สำเร็จ");
      }
      showToast("บันทึกรายการประจำเรียบร้อย");
      setShowRecurringForm(false);
      fetchRecurringTemplates();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setRecurringSubmitting(false);
    }
  };

  const handleDeleteRecurring = async () => {
    if (!deletingRecurringId) return;
    try {
      const res = await fetch(`/api/admin/expenses/recurring/${deletingRecurringId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("ลบไม่สำเร็จ");
      showToast("ลบรายการประจำเรียบร้อย");
      fetchRecurringTemplates();
    } catch {
      showToast("ไม่สามารถลบรายการได้", "error");
    } finally {
      setDeletingRecurringId(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/expenses/recurring/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "สร้างรายการไม่สำเร็จ");
      const failedCount: number = data.failed?.length ?? 0;
      if (data.generated.length === 0 && failedCount === 0) {
        showToast("ไม่มีรายการที่ต้องสร้างสำหรับเดือนนี้ (สร้างไปแล้วทั้งหมด)", "success");
      } else if (failedCount > 0) {
        // Some templates errored mid-loop while others may have already
        // succeeded — say exactly what happened instead of a blanket
        // "failed", since retrying is safe (already-generated ones skip).
        showToast(
          `สร้างสำเร็จ ${data.generated.length} รายการ, ล้มเหลว ${failedCount} รายการ (${data.failed.join(", ")}) — ลองกด "สร้าง" อีกครั้งได้ รายการที่สำเร็จแล้วจะไม่ถูกสร้างซ้ำ`,
          "error"
        );
      } else {
        showToast(`สร้างรายจ่าย ${data.generated.length} รายการสำหรับเดือน ${data.month} เรียบร้อย`);
      }
      fetchRecurringTemplates();
      fetchRecords();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  // Client-display only (badge on each template) — the server independently
  // computes the correct Bangkok month itself when generating.
  const thisMonth = currentMonthStr();
  const pendingCount = recurringTemplates.filter(
    (t) => t.active && t.lastGeneratedMonth !== thisMonth
  ).length;

  const totalExpense = records.reduce((sum, r) => sum + Number(r.amount), 0);

  // Compute chart data
  const chartData = useMemo(() => {
    const grouped: Record<string, number> = {};
    records.forEach(r => {
      const cat = r.category || "อื่นๆ";
      grouped[cat] = (grouped[cat] || 0) + Number(r.amount);
    });
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [records]);

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 md:p-8 pt-32">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-lg text-white font-semibold animate-fade-in ${toast.type === "success" ? "bg-emerald-500" : "bg-red-500"}`}>
          {toast.msg}
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">💸 บันทึกรายจ่าย (Expenses)</h1>
            <p className="text-gray-500 mt-1">จัดการและบันทึกรายจ่ายทั่วไปของบริษัท</p>
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            <div className="flex items-center gap-2 mr-2">
              <SearchableDropdown
                options={[
                  { value: "month", label: "รายเดือน" },
                  { value: "quarter", label: "รายไตรมาส" },
                  { value: "year", label: "รายปี" }
                ]}
                value={periodType}
                onChange={(v) => {
                  const type = v as "month" | "quarter" | "year";
                  setPeriodType(type);
                  const d = new Date();
                  if (type === "year") setPeriodValue(d.getFullYear().toString());
                  else if (type === "quarter") setPeriodValue(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
                  else setPeriodValue(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}
                className="w-32 bg-white rounded-xl"
                buttonClassName="h-[42px] border-gray-200"
              />
              {periodType === "month" && (
                <input
                  type="month"
                  value={periodValue}
                  onChange={(e) => setPeriodValue(e.target.value)}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 h-[42px]"
                />
              )}
              {periodType === "quarter" && (
                <div className="flex gap-2">
                  <SearchableDropdown
                    options={[
                      { value: "Q1", label: "Q1 (ม.ค. - มี.ค.)" },
                      { value: "Q2", label: "Q2 (เม.ย. - มิ.ย.)" },
                      { value: "Q3", label: "Q3 (ก.ค. - ก.ย.)" },
                      { value: "Q4", label: "Q4 (ต.ค. - ธ.ค.)" }
                    ]}
                    value={periodValue.split('-')[1] || "Q1"}
                    onChange={(v) => setPeriodValue(`${periodValue.split('-')[0]}-${v}`)}
                    className="w-40 bg-white"
                    buttonClassName="h-[42px] border-gray-200"
                  />
                  <SearchableDropdown
                    options={yearOptions}
                    value={periodValue.split('-')[0] || String(new Date().getFullYear())}
                    onChange={(v) => setPeriodValue(`${v}-${periodValue.split('-')[1] || "Q1"}`)}
                    className="w-32 bg-white"
                    buttonClassName="h-[42px] border-gray-200"
                  />
                </div>
              )}
              {periodType === "year" && (
                <SearchableDropdown
                  options={yearOptions}
                  value={periodValue}
                  onChange={setPeriodValue}
                  className="w-32 bg-white"
                  buttonClassName="h-[42px] border-gray-200"
                />
              )}
            </div>
            <button
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
                setShowForm(true);
              }}
              className="px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-all shadow-sm flex items-center gap-2"
            >
              + เพิ่มรายจ่าย
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm flex items-center gap-2 shadow-sm"
            >
              📊 กลับไป Dashboard
            </Link>
          </div>
        </div>

        {/* Summary Card with Chart */}
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 mb-8 flex flex-col md:flex-row gap-8 items-center justify-between">
          <div className="flex-1 w-full text-center md:text-left">
            <h2 className="text-gray-500 font-medium text-lg">รวมรายจ่าย {periodType === "month" ? `ประจำเดือน ${periodValue}` : periodType === "quarter" ? `ไตรมาส ${periodValue}` : `ปี ${periodValue}`}</h2>
            <p className="text-5xl font-black text-rose-600 mt-3">
              ฿{totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {chartData.slice(0, 3).map((item, idx) => (
                <div key={item.name} className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                  <div className="flex items-center gap-2 text-gray-600">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></span>
                    {item.name}
                  </div>
                  <span className="font-semibold text-gray-800">฿{item.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="w-full md:w-[400px] h-[250px]">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value: any) => `฿${Number(value || 0).toLocaleString()}`}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">ไม่มีข้อมูลแสดงกราฟ</div>
            )}
          </div>
        </div>

        {/* Recurring expense templates */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800">🔁 รายการประจำ (ค่าเช่า, เงินเดือน ฯลฯ)</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                ตั้งไว้ครั้งเดียว แล้วกด &quot;สร้างรายการเดือนนี้&quot; ทุกเดือนแทนการกรอกซ้ำ
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingRecurringId(null);
                  setRecurringForm(emptyRecurringForm());
                  setShowRecurringForm(true);
                }}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm"
              >
                + เพิ่มรายการประจำ
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || recurringLoading || pendingCount === 0}
                className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating
                  ? "กำลังสร้าง..."
                  : pendingCount > 0
                    ? `▶ สร้างรายการเดือนนี้ (${pendingCount})`
                    : "✓ สร้างครบทุกรายการแล้ว"}
              </button>
            </div>
          </div>

          {recurringLoading ? (
            <p className="text-sm text-gray-400 py-4">กำลังโหลด...</p>
          ) : recurringTemplates.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">ยังไม่มีรายการประจำ — เพิ่มค่าเช่าหรือเงินเดือนที่จ่ายเท่าเดิมทุกเดือนได้ที่นี่</p>
          ) : (
            <div className="space-y-2">
              {recurringTemplates.map((t) => {
                const generatedThisMonth = t.lastGeneratedMonth === thisMonth;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                      t.active ? "border-gray-100 bg-gray-50/50" : "border-gray-100 bg-gray-50/50 opacity-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-800 truncate">{t.title}</p>
                        {!t.active && (
                          <span className="text-xs font-semibold text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">ปิดใช้งาน</span>
                        )}
                        {t.active && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            generatedThisMonth ? "text-emerald-700 bg-emerald-100" : "text-amber-700 bg-amber-100"
                          }`}>
                            {generatedThisMonth ? "สร้างแล้วเดือนนี้" : "ยังไม่สร้างเดือนนี้"}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{t.category} · ฿{Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}/เดือน</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setEditingRecurringId(t.id);
                          setRecurringForm(t);
                          setShowRecurringForm(true);
                        }}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="แก้ไข"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setDeletingRecurringId(t.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="ลบ"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-600 text-sm">
                  <th className="p-4 font-semibold w-32">วันที่</th>
                  <th className="p-4 font-semibold">รายการ (Title)</th>
                  <th className="p-4 font-semibold w-48">หมวดหมู่</th>
                  <th className="p-4 font-semibold text-right w-40">จำนวนเงิน</th>
                  <th className="p-4 font-semibold text-center w-36">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="p-4"><div className="h-5 bg-gray-200 rounded w-20 animate-pulse"></div></td>
                      <td className="p-4"><div className="h-5 bg-gray-200 rounded w-48 animate-pulse"></div></td>
                      <td className="p-4"><div className="h-5 bg-gray-200 rounded w-24 animate-pulse"></div></td>
                      <td className="p-4"><div className="h-5 bg-gray-200 rounded w-20 ml-auto animate-pulse"></div></td>
                      <td className="p-4"><div className="h-5 bg-gray-200 rounded w-16 mx-auto animate-pulse"></div></td>
                    </tr>
                  ))
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-gray-400">
                      ไม่มีรายการรายจ่ายในเดือนนี้
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className={`border-b border-gray-50 transition-colors ${r.source === 'sale_cost' ? 'bg-orange-50/30' : 'hover:bg-gray-50/50'}`}>
                      <td className="p-4 text-gray-600 whitespace-nowrap text-sm">{r.expenseDate}</td>
                      <td className="p-4 font-medium text-gray-800">
                        {r.title}
                        {r.note && <p className="text-xs text-gray-500 font-normal mt-1">{r.note}</p>}
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          r.source === 'sale_cost' ? 'bg-orange-100 text-orange-700' : 'bg-rose-50 text-rose-700'
                        }`}>
                          {r.category}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-gray-700">
                        ฿{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-center">
                        {r.source === "sale_cost" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg whitespace-nowrap">
                            🔒 เชื่อมโยงอัตโนมัติ
                          </span>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                setForm(r);
                                setEditingId(r.id);
                                setShowForm(true);
                              }}
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                              title="แก้ไข"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => setDeletingId(r.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="ลบ"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">
                {editingId ? "แก้ไขรายจ่าย" : "เพิ่มรายจ่ายใหม่"}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  รายการ (Title) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="เช่น ค่าเช่าออฟฟิศเดือนตุลาคม, ค่าทำโฆษณา FB"
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    จำนวนเงิน (บาท) <span className="text-red-500">*</span>
                  </label>
                  <FormattedNumberInput
                    value={form.amount || 0}
                    onChange={(val) => setForm({ ...form, amount: val })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-600 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    วันที่ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={form.expenseDate}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">หมวดหมู่</label>
                <SearchableDropdown
                  options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
                  value={form.category || ""}
                  onChange={(v) => setForm({ ...form, category: v })}
                  className="w-full"
                  buttonClassName="h-[42px] border-gray-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">หมายเหตุ (ถ้ามี)</label>
                <textarea
                  value={form.note || ""}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 min-h-[80px] resize-y"
                ></textarea>
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                >
                  {submitting ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {!!deletingId && (
        <ConfirmDialog
          title="ยืนยันการลบรายจ่าย"
          message="คุณต้องการลบรายการรายจ่ายนี้ใช่หรือไม่? ข้อมูลที่ถูกลบจะไม่สามารถกู้คืนได้ และอาจส่งผลให้ยอด Net Profit เปลี่ยนแปลง"
          confirmText="ลบข้อมูล"
          cancelText="ยกเลิก"
          onConfirm={handleDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}

      {/* Recurring Form Modal */}
      {showRecurringForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">
                {editingRecurringId ? "แก้ไขรายการประจำ" : "เพิ่มรายการประจำใหม่"}
              </h2>
              <button
                onClick={() => setShowRecurringForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitRecurring} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  รายการ (Title) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={recurringForm.title}
                  onChange={(e) => setRecurringForm({ ...recurringForm, title: e.target.value })}
                  placeholder="เช่น ค่าเช่าออฟฟิศ, เงินเดือนพนักงาน"
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  จำนวนเงินต่อเดือน (บาท) <span className="text-red-500">*</span>
                </label>
                <FormattedNumberInput
                  value={recurringForm.amount || 0}
                  onChange={(val) => setRecurringForm({ ...recurringForm, amount: val })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-emerald-600 font-bold"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">หมวดหมู่</label>
                <SearchableDropdown
                  options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
                  value={recurringForm.category || ""}
                  onChange={(v) => setRecurringForm({ ...recurringForm, category: v })}
                  className="w-full"
                  buttonClassName="h-[42px] border-gray-300 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">หมายเหตุ (ถ้ามี)</label>
                <textarea
                  value={recurringForm.note || ""}
                  onChange={(e) => setRecurringForm({ ...recurringForm, note: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 min-h-[70px] resize-y"
                ></textarea>
              </div>

              {editingRecurringId && (
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <input
                    type="checkbox"
                    checked={recurringForm.active !== false}
                    onChange={(e) => setRecurringForm({ ...recurringForm, active: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  เปิดใช้งาน (ไม่ติ๊ก = หยุดสร้างรายการนี้ทุกเดือน แต่ไม่ลบประวัติเดิม)
                </label>
              )}

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowRecurringForm(false)}
                  className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={recurringSubmitting}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                >
                  {recurringSubmitting ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recurring Delete Confirm */}
      {!!deletingRecurringId && (
        <ConfirmDialog
          title="ยืนยันการลบรายการประจำ"
          message="คุณต้องการลบรายการประจำนี้ใช่หรือไม่? รายจ่ายที่สร้างไปแล้วในอดีตจะไม่ถูกลบ มีผลแค่หยุดสร้างรายการใหม่ในเดือนถัดไป"
          confirmText="ลบรายการประจำ"
          cancelText="ยกเลิก"
          onConfirm={handleDeleteRecurring}
          onCancel={() => setDeletingRecurringId(null)}
        />
      )}
    </div>
  );
}
