"use client";
import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Expense } from "../lib/types";
import ConfirmDialog from "../components/ConfirmDialog";
import FormattedNumberInput from "../components/FormattedNumberInput";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";

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

export default function ExpensesPage() {
  const [records, setRecords] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Filter states
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [filterMonth, setFilterMonth] = useState(currentMonth);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Expense>>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const year = filterMonth.split("-")[0];
      const month = filterMonth.split("-")[1];
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const dateFrom = `${filterMonth}-01`;
      const dateTo = `${filterMonth}-${lastDay}`;

      const res = await fetch(`/api/admin/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRecords(data);
    } catch {
      showToast("ดึงข้อมูลรายจ่ายไม่สำเร็จ", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMonth]);

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
          <div className="flex gap-3 flex-wrap">
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="px-4 py-2 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            />
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
            <h2 className="text-gray-500 font-medium text-lg">รวมรายจ่ายประจำเดือน {filterMonth}</h2>
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
                    formatter={(value: number) => `฿${value.toLocaleString()}`}
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
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 bg-white"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
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
    </div>
  );
}
