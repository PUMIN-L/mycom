"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import Link from "next/link";
import { Supplier } from "../lib/types";

function SuppliersInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, isLoading } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Partial<Supplier> | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Supplier | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [searchName, setSearchName] = useState("");

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  const fetchData = async () => {
    setIsLoadingData(true);
    try {
      const res = await fetch("/api/suppliers");
      if (res.ok) setSuppliers(await res.json());
    } catch (err) {
      console.error(err);
      showToast("Error fetching suppliers", "error");
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchData();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const id = searchParams.get("id");
    if (id && suppliers.length > 0) {
      const s = suppliers.find(sup => sup.id === id);
      if (s) {
        setViewingSupplier(s);
        // Optional: clear the URL so it doesn't reopen on refresh
        window.history.replaceState({}, '', '/suppliers');
      }
    }
  }, [searchParams, suppliers]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveSupplier = async () => {
    setSubmitAttempted(true);
    if (!editingSupplier?.companyName?.trim()) {
      return;
    }
    
    try {
      const isNew = !editingSupplier.id;
      const res = await fetch(isNew ? "/api/suppliers" : `/api/suppliers/${editingSupplier.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingSupplier),
      });
      
      if (res.ok) {
        showToast(`Supplier ${isNew ? "created" : "updated"} successfully`, "success");
        setIsModalOpen(false);
        fetchData();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to save supplier", "error");
      }
    } catch (error) {
      showToast("Error saving supplier", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const res = await fetch(`/api/suppliers/${deleteConfirm.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Supplier deleted", "success");
        setDeleteConfirm(null);
        fetchData();
      } else {
        showToast("Failed to delete supplier", "error");
      }
    } catch (err) {
      showToast("Error deleting supplier", "error");
    }
  };

  const openAddModal = () => {
    setSubmitAttempted(false);
    setEditingSupplier({ companyName: "", contactName: "", phone: "", note: "" });
    setIsModalOpen(true);
  };

  const openEditModal = (s: Supplier, e: React.MouseEvent) => {
    e.stopPropagation();
    setSubmitAttempted(false);
    setEditingSupplier(s);
    setIsModalOpen(true);
  };

  const filteredSuppliers = suppliers.filter((s) => {
    return !searchName || s.companyName.toLowerCase().includes(searchName.toLowerCase());
  });

  if (isLoading || !isLoggedIn) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">จัดการผู้ผลิตสินค้า (Suppliers)</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/showcase"
              className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all text-sm flex items-center gap-1.5 shadow-sm"
            >
              🏠 กลับไปหน้าระบบจัดการ
            </Link>
            <button
              onClick={openAddModal}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all active:scale-95 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              เพิ่มรายชื่อ
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-6">
        <div className="mb-6 flex gap-4">
          <input
            type="text"
            placeholder="ค้นหาชื่อบริษัท..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className="px-4 py-2 border rounded-lg flex-1"
          />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-600 font-medium">
                  <th className="px-6 py-4 w-1/3">ชื่อบริษัท</th>
                  <th className="px-6 py-4 w-1/4">ผู้ติดต่อ</th>
                  <th className="px-6 py-4 w-1/4">เบอร์โทร</th>
                  <th className="px-6 py-4 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoadingData ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-48"></div></td>
                      <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
                      <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                      <td className="px-6 py-4"><div className="h-8 bg-gray-200 rounded w-16 ml-auto"></div></td>
                    </tr>
                  ))
                ) : filteredSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                      ไม่พบข้อมูลผู้ผลิต
                    </td>
                  </tr>
                ) : (
                  filteredSuppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50/50 cursor-pointer" onClick={() => setViewingSupplier(s)}>
                      <td className="px-6 py-4 font-medium text-gray-900">{s.companyName}</td>
                      <td className="px-6 py-4 text-gray-600">{s.contactName || "-"}</td>
                      <td className="px-6 py-4 text-gray-600">{s.phone || "-"}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => openEditModal(s, e)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
                            title="แก้ไข"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            <span className="text-xs font-medium">แก้ไข</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm(s);
                            }}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1"
                            title="ลบ"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Add/Edit Modal */}
      {isModalOpen && editingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slideUp">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">
                {editingSupplier.id ? "แก้ไขรายชื่อ" : "เพิ่มรายชื่อใหม่"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  ชื่อบริษัท <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingSupplier.companyName || ""}
                  onChange={(e) => setEditingSupplier({ ...editingSupplier, companyName: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none transition-all ${
                    submitAttempted && !editingSupplier.companyName?.trim() ? "border-red-300 bg-red-50" : "border-gray-200"
                  }`}
                  placeholder="เช่น บริษัท เอบีซี จำกัด"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">ผู้ติดต่อ</label>
                <input
                  type="text"
                  value={editingSupplier.contactName || ""}
                  onChange={(e) => setEditingSupplier({ ...editingSupplier, contactName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">เบอร์โทร</label>
                <input
                  type="text"
                  value={editingSupplier.phone || ""}
                  onChange={(e) => setEditingSupplier({ ...editingSupplier, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">หมายเหตุ</label>
                <textarea
                  value={editingSupplier.note || ""}
                  onChange={(e) => setEditingSupplier({ ...editingSupplier, note: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                  rows={3}
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveSupplier}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm hover:shadow transition-all"
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-slideUp text-center p-6">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">ยืนยันการลบ</h3>
            <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ว่าต้องการลบ &quot;{deleteConfirm.companyName}&quot;? การกระทำนี้ไม่สามารถกู้คืนได้</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors"
              >
                ลบข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal - Luxury Hotel UI */}
      {viewingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-md animate-fadeIn" onClick={() => setViewingSupplier(null)}>
          <div className="bg-[#FCFCFC] rounded-sm shadow-2xl w-full max-w-2xl overflow-hidden animate-slideUp flex flex-col max-h-[90vh] border border-gray-200" onClick={e => e.stopPropagation()}>

            {/* Elegant Header - Minimalist */}
            <div className="relative bg-white px-8 py-3 sm:py-4 flex-shrink-0 flex flex-col items-center justify-center">
              <button
                onClick={() => setViewingSupplier(null)}
                className="absolute top-1/2 -translate-y-1/2 right-4 sm:right-6 p-2 text-gray-400 hover:text-gray-900 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Elegant Body */}
            <div className="p-6 sm:p-8 overflow-y-auto bg-white flex-1">
              <div className="space-y-10">
                <div className="relative">
                  <div className="text-center mb-6">
                    <h4 className="text-xl font-medium text-gray-900">{viewingSupplier.companyName}</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-10 max-w-md mx-auto">
                    <div className="text-center sm:text-right border-b sm:border-b-0 sm:border-r border-gray-100 pb-4 sm:pb-0 sm:pr-10">
                      <p className="text-gray-400 uppercase tracking-[0.1em] text-[10px] mb-1.5 font-medium">Contact Person</p>
                      <p className="text-gray-800 font-light text-base">{viewingSupplier.contactName || "-"}</p>
                    </div>
                    <div className="text-center sm:text-left pt-2 sm:pt-0 sm:pl-2">
                      <p className="text-gray-400 uppercase tracking-[0.1em] text-[10px] mb-1.5 font-medium">Phone Number</p>
                      <p className="text-gray-800 font-light text-base">{viewingSupplier.phone || "-"}</p>
                    </div>
                  </div>
                </div>

                {/* Linked Products Section */}
                <div className="pt-8 border-t border-gray-100">
                  <p className="text-gray-400 uppercase tracking-[0.1em] text-[10px] mb-4 font-medium text-center">Linked Products</p>
                  <div className="flex flex-wrap justify-center gap-3">
                    {viewingSupplier.linkedProducts && viewingSupplier.linkedProducts.length > 0 ? (
                      viewingSupplier.linkedProducts.map((p) => (
                        <div 
                          key={p.id}
                          className="px-4 py-2 bg-gray-50 text-gray-600 text-sm font-light rounded-md border border-gray-100 [&_p]:inline [&_p]:m-0"
                          dangerouslySetInnerHTML={{ __html: p.title_th || p.title_en }}
                        />
                      ))
                    ) : (
                      <div className="px-4 py-2 bg-gray-50 text-gray-400 text-sm font-light rounded-md border border-dashed border-gray-200">
                        ไม่มีสินค้าที่เชื่อมโยง
                      </div>
                    )}
                  </div>
                </div>

                {/* Note Section */}
                {viewingSupplier.note && (
                  <div className="pt-8 border-t border-gray-100 text-center">
                    <p className="text-gray-400 uppercase tracking-[0.1em] text-[10px] mb-4 font-medium">Note</p>
                    <div className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap max-w-lg mx-auto font-light bg-gray-50 p-6 rounded-md border border-gray-100">
                      {viewingSupplier.note}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Elegant Footer */}
            <div className="px-8 py-6 bg-white flex justify-center border-t border-gray-100">
              <button
                onClick={() => setViewingSupplier(null)}
                className="px-10 py-3 text-xs font-semibold tracking-widest uppercase text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <Suspense>
      <SuppliersInner />
    </Suspense>
  );
}
