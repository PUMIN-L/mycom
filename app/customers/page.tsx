"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";

interface Company {
  id: string;
  name: string;
  addressNo: string;
  moo: string;
  soi: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  phone: string;
  note: string;
}

interface Customer {
  id: string;
  companyId: string;
  companyName?: string;
  name: string;
  department: string;
  phone: string;
  email: string;
  note: string;
}

function CustomersInner() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"companies" | "customers">("customers");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  
  const [editingCompany, setEditingCompany] = useState<Partial<Company> | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);
  
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  const fetchData = async () => {
    try {
      const [compRes, custRes] = await Promise.all([
        fetch("/api/companies"),
        fetch("/api/customers")
      ]);
      if (compRes.ok) setCompanies(await compRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
    } catch (err) {
      console.error(err);
      showToast("Error fetching data", "error");
    }
  };

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany?.name) {
      showToast("Please enter company name", "error");
      return;
    }

    try {
      const method = editingCompany.id ? "PUT" : "POST";
      const url = editingCompany.id ? `/api/companies/${editingCompany.id}` : "/api/companies";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingCompany)
      });

      if (!res.ok) throw new Error("Failed to save");
      
      showToast("Company saved successfully", "success");
      setIsCompanyModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("Error saving company", "error");
    }
  };

  const handleDeleteCompany = async (id: string) => {
    if (!confirm("Are you sure you want to delete this company?")) return;
    try {
      const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete");
      }
      showToast("Company deleted", "success");
      fetchData();
    } catch (err: any) {
      showToast(err.message || "Error deleting company", "error");
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer?.name || !editingCustomer?.companyId) {
      showToast("Please enter name and select a company", "error");
      return;
    }

    try {
      const method = editingCustomer.id ? "PUT" : "POST";
      const url = editingCustomer.id ? `/api/customers/${editingCustomer.id}` : "/api/customers";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingCustomer)
      });

      if (!res.ok) throw new Error("Failed to save");
      
      showToast("Customer saved successfully", "success");
      setIsCustomerModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("Error saving customer", "error");
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer?")) return;
    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("Customer deleted", "success");
      fetchData();
    } catch (err) {
      showToast("Error deleting customer", "error");
    }
  };

  if (isLoading || !isLoggedIn) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Manage Customers & Companies</h1>
          <button onClick={() => router.push("/")} className="text-gray-600 hover:text-gray-900">
            ← Back to Home
          </button>
        </div>

        {/* Tabs */}
        <div className="flex space-x-4 border-b border-gray-200 mb-8">
          <button
            onClick={() => setActiveTab("customers")}
            className={`py-3 px-6 font-semibold border-b-4 transition-colors ${
              activeTab === "customers" ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            รายชื่อลูกค้า (Customers)
          </button>
          <button
            onClick={() => setActiveTab("companies")}
            className={`py-3 px-6 font-semibold border-b-4 transition-colors ${
              activeTab === "companies" ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            รายชื่อบริษัท (Companies)
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          {activeTab === "companies" && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">บริษัททั้งหมด ({companies.length})</h2>
                <button
                  onClick={() => { setEditingCompany({}); setIsCompanyModalOpen(true); }}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition"
                >
                  + เพิ่มบริษัท
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <th className="p-4 font-semibold">ชื่อบริษัท</th>
                      <th className="p-4 font-semibold">เบอร์โทร</th>
                      <th className="p-4 font-semibold">หมายเหตุ</th>
                      <th className="p-4 font-semibold">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map(c => (
                      <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                        <td className="p-4 font-medium">{c.name}</td>
                        <td className="p-4">{c.phone || "-"}</td>
                        <td className="p-4 text-gray-500 text-sm">{c.note || "-"}</td>
                        <td className="p-4 space-x-2">
                          <button onClick={() => { setEditingCompany(c); setIsCompanyModalOpen(true); }} className="text-blue-500 hover:text-blue-700 font-semibold text-sm">แก้ไข</button>
                          <button onClick={() => handleDeleteCompany(c.id)} className="text-red-500 hover:text-red-700 font-semibold text-sm">ลบ</button>
                        </td>
                      </tr>
                    ))}
                    {companies.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-gray-500">ยังไม่มีข้อมูลบริษัท</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "customers" && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">ลูกค้าทั้งหมด ({customers.length})</h2>
                <button
                  onClick={() => { setEditingCustomer({}); setIsCustomerModalOpen(true); }}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition"
                >
                  + เพิ่มลูกค้า
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <th className="p-4 font-semibold">ชื่อลูกค้า</th>
                      <th className="p-4 font-semibold">บริษัท</th>
                      <th className="p-4 font-semibold">แผนก</th>
                      <th className="p-4 font-semibold">เบอร์โทร</th>
                      <th className="p-4 font-semibold">หมายเหตุ</th>
                      <th className="p-4 font-semibold">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map(c => (
                      <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                        <td className="p-4 font-medium">{c.name}</td>
                        <td className="p-4 text-orange-600 font-medium">{c.companyName}</td>
                        <td className="p-4">{c.department || "-"}</td>
                        <td className="p-4">{c.phone || "-"}</td>
                        <td className="p-4 text-gray-500 text-sm">{c.note || "-"}</td>
                        <td className="p-4 space-x-2">
                          <button onClick={() => { setEditingCustomer(c); setIsCustomerModalOpen(true); }} className="text-blue-500 hover:text-blue-700 font-semibold text-sm">แก้ไข</button>
                          <button onClick={() => handleDeleteCustomer(c.id)} className="text-red-500 hover:text-red-700 font-semibold text-sm">ลบ</button>
                        </td>
                      </tr>
                    ))}
                    {customers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-gray-500">ยังไม่มีข้อมูลลูกค้า</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Company Modal */}
      {isCompanyModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-2xl font-bold">{editingCompany?.id ? "แก้ไขบริษัท" : "เพิ่มบริษัท"}</h2>
              <button onClick={() => setIsCompanyModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>
            <form onSubmit={handleSaveCompany} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold mb-1">ชื่อบริษัท *</label>
                  <input required type="text" className="w-full border rounded-lg p-2" value={editingCompany?.name || ""} onChange={e => setEditingCompany({...editingCompany, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">เลขที่บริษัท/อาคาร</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.addressNo || ""} onChange={e => setEditingCompany({...editingCompany, addressNo: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">หมู่</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.moo || ""} onChange={e => setEditingCompany({...editingCompany, moo: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">ซอย</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.soi || ""} onChange={e => setEditingCompany({...editingCompany, soi: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">ถนน</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.road || ""} onChange={e => setEditingCompany({...editingCompany, road: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">ตำบล/แขวง</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.subDistrict || ""} onChange={e => setEditingCompany({...editingCompany, subDistrict: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">อำเภอ/เขต</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.district || ""} onChange={e => setEditingCompany({...editingCompany, district: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">จังหวัด</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.province || ""} onChange={e => setEditingCompany({...editingCompany, province: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">รหัสไปรษณีย์</label>
                  <input type="text" className="w-full border rounded-lg p-2" value={editingCompany?.postalCode || ""} onChange={e => setEditingCompany({...editingCompany, postalCode: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">เบอร์โทรศัพท์</label>
                  <input type="tel" pattern="[0-9]*" className="w-full border rounded-lg p-2" value={editingCompany?.phone || ""} onChange={e => setEditingCompany({...editingCompany, phone: e.target.value.replace(/\\D/g, "")})} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold mb-1">หมายเหตุ</label>
                  <textarea rows={3} className="w-full border rounded-lg p-2" value={editingCompany?.note || ""} onChange={e => setEditingCompany({...editingCompany, note: e.target.value})}></textarea>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
                <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">ยกเลิก</button>
                <button type="submit" className="px-6 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600">บันทึก</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-2xl font-bold">{editingCustomer?.id ? "แก้ไขลูกค้า" : "เพิ่มลูกค้า"}</h2>
              <button onClick={() => setIsCustomerModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
            </div>
            <form onSubmit={handleSaveCustomer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">ชื่อ-นามสกุล *</label>
                <input required type="text" className="w-full border rounded-lg p-2" value={editingCustomer?.name || ""} onChange={e => setEditingCustomer({...editingCustomer, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">สังกัดบริษัท *</label>
                <select required className="w-full border rounded-lg p-2 bg-white" value={editingCustomer?.companyId || ""} onChange={e => setEditingCustomer({...editingCustomer, companyId: e.target.value})}>
                  <option value="" disabled>-- เลือกบริษัท --</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">แผนก</label>
                <input type="text" className="w-full border rounded-lg p-2" value={editingCustomer?.department || ""} onChange={e => setEditingCustomer({...editingCustomer, department: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">เบอร์โทรศัพท์</label>
                <input type="tel" pattern="[0-9]*" className="w-full border rounded-lg p-2" value={editingCustomer?.phone || ""} onChange={e => setEditingCustomer({...editingCustomer, phone: e.target.value.replace(/\\D/g, "")})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">อีเมล</label>
                <input type="email" className="w-full border rounded-lg p-2" value={editingCustomer?.email || ""} onChange={e => setEditingCustomer({...editingCustomer, email: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">หมายเหตุ</label>
                <textarea rows={3} className="w-full border rounded-lg p-2" value={editingCustomer?.note || ""} onChange={e => setEditingCustomer({...editingCustomer, note: e.target.value})}></textarea>
              </div>
              <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
                <button type="button" onClick={() => setIsCustomerModalOpen(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">ยกเลิก</button>
                <button type="submit" className="px-6 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600">บันทึก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Customers() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-500">Loading...</p></div>}>
      <CustomersInner />
    </Suspense>
  );
}
