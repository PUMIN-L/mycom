"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import Link from "next/link";
import { stripHtml } from "../lib/stripHtml";
import SearchableDropdown from "../components/SearchableDropdown";

interface ProductSpec {
  id: string;
  productId: string;
  name: string;
  detail: string;
  createdAt: string;
}

interface ProductData {
  id: string;
  title_th: string;
  title_en: string;
}

export default function ProductSpecsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [specs, setSpecs] = useState<ProductSpec[]>([]);
  const [products, setProducts] = useState<ProductData[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSpec, setEditingSpec] = useState<Partial<ProductSpec>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<ProductSpec | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  const loadData = async () => {
    try {
      const [specsRes, productsRes] = await Promise.all([
        fetch("/api/product-specs"),
        fetch("/api/products")
      ]);
      const [specsData, productsData] = await Promise.all([
        specsRes.json(),
        productsRes.json()
      ]);
      setSpecs(specsData.data || []);
      setProducts(Array.isArray(productsData) ? productsData : []);
    } catch (error) {
      console.error("Failed to load data", error);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadData();
    }
  }, [isLoggedIn]);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

  const handleSave = async () => {
    setSubmitAttempted(true);
    if (!editingSpec.name || !editingSpec.detail || !editingSpec.productId) {
      return;
    }

    try {
      const url = editingSpec.id ? `/api/product-specs/${editingSpec.id}` : "/api/product-specs";
      const res = await fetch(url, {
        method: editingSpec.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingSpec),
      });

      if (!res.ok) throw new Error("Failed to save spec");
      
      await loadData();
      setIsModalOpen(false);
      showToast("บันทึกข้อมูลสเปคสำเร็จ");
    } catch (error) {
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const res = await fetch(`/api/product-specs/${deleteConfirm.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete spec");
      
      await loadData();
      setDeleteConfirm(null);
      showToast("ลบข้อมูลสเปคสำเร็จ");
    } catch (error) {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const getProductName = (productId: string) => {
    const p = products.find(x => x.id === productId);
    return p ? stripHtml(p.title_th || p.title_en) : "Unknown Product";
  };

  const filteredSpecs = specs.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const pName = getProductName(s.productId).toLowerCase();
    return s.name.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q) || pName.includes(q);
  });

  if (isLoading || !isLoggedIn) {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      {toast && <Toast message={toast.message} type={toast.type} />}
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">จัดการสเปคสินค้า (Product Specs)</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/adminpanel"
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all text-sm flex items-center gap-1.5 shadow-sm"
              >
                🏠 กลับไประบบจัดการ
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-8">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 text-blue-600 p-3 rounded-xl">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-800">สเปคทั้งหมด <span className="text-gray-400 text-lg font-normal">({filteredSpecs.length})</span></h2>
              </div>
              <button
                onClick={() => { setEditingSpec({}); setSubmitAttempted(false); setIsModalOpen(true); }}
                className="bg-blue-500 hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                เพิ่มสเปค
              </button>
            </div>

            <div className="mb-6">
              <input
                type="text"
                placeholder="ค้นหาสเปคสินค้า..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full md:w-96 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200">
                    <th className="px-6 py-4 font-semibold text-gray-700">สินค้า</th>
                    <th className="px-6 py-4 font-semibold text-gray-700">หัวข้อสเปค</th>
                    <th className="px-6 py-4 font-semibold text-gray-700">รายละเอียด</th>
                    <th className="px-6 py-4 font-semibold text-gray-700 text-right w-32">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoadingData ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-6 py-5"><div className="h-5 bg-gray-200 rounded w-48"></div></td>
                        <td className="px-6 py-5"><div className="h-5 bg-gray-200 rounded w-24"></div></td>
                        <td className="px-6 py-5"><div className="h-5 bg-gray-200 rounded w-64"></div></td>
                        <td className="px-6 py-5 text-right"><div className="h-5 bg-gray-200 rounded w-20 ml-auto"></div></td>
                      </tr>
                    ))
                  ) : filteredSpecs.length === 0 ? (
                    <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-500">ยังไม่มีข้อมูลสเปค</td></tr>
                  ) : filteredSpecs.map(s => (
                    <tr key={s.id} onClick={() => { setEditingSpec(s); setSubmitAttempted(false); setIsModalOpen(true); }} className="hover:bg-gray-50/50 transition-colors group cursor-pointer">
                      <td className="px-6 py-5">
                        <p className="font-semibold text-gray-900 truncate max-w-[200px]">{getProductName(s.productId)}</p>
                      </td>
                      <td className="px-6 py-5 font-medium text-gray-800">{s.name}</td>
                      <td className="px-6 py-5 text-gray-600 whitespace-pre-line text-sm max-w-[400px]">{s.detail}</td>
                      <td className="px-6 py-5 text-right space-x-3">
                        <button onClick={(e) => { e.stopPropagation(); setEditingSpec(s); setSubmitAttempted(false); setIsModalOpen(true); }} className="text-blue-500 hover:text-blue-700 font-medium text-sm transition-colors">แก้ไข</button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(s); }} className="text-red-500 hover:text-red-700 font-medium text-sm transition-colors">ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-lg font-bold text-gray-900">{editingSpec.id ? "แก้ไขสเปค" : "เพิ่มสเปคใหม่"}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เลือกสินค้า <span className="text-red-500">*</span></label>
                <SearchableDropdown
                  className="w-full"
                  buttonClassName={`!py-2.5 !rounded-xl ${submitAttempted && !editingSpec.productId ? "!border-red-300 !bg-red-50" : "!border-gray-200 !bg-gray-50"}`}
                  placeholder="-- เลือกสินค้า --"
                  value={editingSpec.productId || ""}
                  onChange={(val) => setEditingSpec({ ...editingSpec, productId: val })}
                  options={products.map(p => ({
                    value: p.id,
                    label: stripHtml(p.title_th || p.title_en)
                  }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">หัวข้อสเปค <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="เช่น สเปค 5kN"
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-colors ${submitAttempted && !editingSpec.name ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}
                  value={editingSpec.name || ""}
                  onChange={(e) => setEditingSpec({ ...editingSpec, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียด <span className="text-red-500">*</span></label>
                <textarea
                  rows={5}
                  placeholder="กรอกรายละเอียดสเปค..."
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-colors ${submitAttempted && !editingSpec.detail ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}
                  value={editingSpec.detail || ""}
                  onChange={(e) => setEditingSpec({ ...editingSpec, detail: e.target.value })}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-200 rounded-xl transition-colors">ยกเลิก</button>
              <button onClick={handleSave} className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors shadow-sm">บันทึกข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden text-center p-6">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบสเปค?</h3>
            <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ที่จะลบ &quot;{deleteConfirm.name}&quot;? การกระทำนี้ไม่สามารถย้อนกลับได้</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors">ยกเลิก</button>
              <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors shadow-sm">ลบข้อมูล</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
