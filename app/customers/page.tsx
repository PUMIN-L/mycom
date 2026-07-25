"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import Link from "next/link";

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
  const [activeTab, setActiveTab] = useState<"customers" | "companies">("customers");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  
  const [editingCompany, setEditingCompany] = useState<Partial<Company> | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);
  
  const [viewingCompany, setViewingCompany] = useState<Company | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);

  const [deleteConfirmCompany, setDeleteConfirmCompany] = useState<Company | null>(null);
  const [deleteConfirmCustomer, setDeleteConfirmCustomer] = useState<Customer | null>(null);

  const [companySubmitAttempted, setCompanySubmitAttempted] = useState(false);
  const [customerSubmitAttempted, setCustomerSubmitAttempted] = useState(false);

  const [searchCustomerName, setSearchCustomerName] = useState("");
  const [searchCompanyName, setSearchCompanyName] = useState("");
  const [searchProvince, setSearchProvince] = useState("");
  const [searchDistrict, setSearchDistrict] = useState("");

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
      showToast("กรุณากรอกชื่อบริษัท", "error");
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
      
      showToast("บันทึกข้อมูลบริษัทสำเร็จ", "success");
      setIsCompanyModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    }
  };

  const executeDeleteCompany = async () => {
    if (!deleteConfirmCompany) return;
    try {
      const res = await fetch(`/api/companies/${deleteConfirmCompany.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete");
      }
      showToast("ลบบริษัทสำเร็จ", "success");
      setDeleteConfirmCompany(null);
      fetchData();
    } catch (err: any) {
      showToast(err.message || "เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer?.name || !editingCustomer?.companyId) {
      showToast("กรุณากรอกข้อมูลให้ครบถ้วน", "error");
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
      
      showToast("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
      setIsCustomerModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    }
  };

  const executeDeleteCustomer = async () => {
    if (!deleteConfirmCustomer) return;
    try {
      const res = await fetch(`/api/customers/${deleteConfirmCustomer.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("ลบลูกค้าสำเร็จ", "success");
      setDeleteConfirmCustomer(null);
      fetchData();
    } catch (err) {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const filteredCompanies = companies.filter(c => 
    c.name.toLowerCase().includes(searchCompanyName.toLowerCase()) &&
    (c.province || "").toLowerCase().includes(searchProvince.toLowerCase()) &&
    (c.district || "").toLowerCase().includes(searchDistrict.toLowerCase())
  );

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchCustomerName.toLowerCase()) || 
    (c.companyName?.toLowerCase() || "").includes(searchCustomerName.toLowerCase())
  );

  if (isLoading || !isLoggedIn) return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 font-sans">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">ลูกค้าและบริษัท</h1>
            <p className="text-gray-500 mt-2 text-lg">จัดการรายชื่อลูกค้าและข้อมูลบริษัทคู่ค้าของคุณ</p>
          </div>
          <Link href="/showcase" className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            กลับสู่หน้าหลัก
          </Link>
        </div>

        {/* Custom Tabs */}
        <div className="flex space-x-1 bg-gray-200/50 p-1.5 rounded-2xl w-fit mb-8 shadow-inner">
          <button
            onClick={() => setActiveTab("customers")}
            className={`py-2.5 px-6 rounded-xl font-semibold text-sm transition-all duration-200 ${
              activeTab === "customers" ? "bg-white text-orange-600 shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
            }`}
          >
            รายชื่อลูกค้า (Customers)
          </button>
          <button
            onClick={() => setActiveTab("companies")}
            className={`py-2.5 px-6 rounded-xl font-semibold text-sm transition-all duration-200 ${
              activeTab === "companies" ? "bg-white text-orange-600 shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
            }`}
          >
            รายชื่อบริษัท (Companies)
          </button>
        </div>

        {/* Content Area */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {activeTab === "companies" && (
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 text-blue-600 p-3 rounded-xl">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800">บริษัททั้งหมด <span className="text-gray-400 text-lg font-normal">({filteredCompanies.length})</span></h2>
                </div>
                <button
                  onClick={() => { setEditingCompany({}); setCompanySubmitAttempted(false); setIsCompanyModalOpen(true); }}
                  className="bg-gray-900 hover:bg-gray-800 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  เพิ่มบริษัท
                </button>
              </div>

              {/* Search Filters for Companies */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อบริษัท..."
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={searchCompanyName}
                  onChange={(e) => setSearchCompanyName(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="ค้นหาจังหวัด..."
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={searchProvince}
                  onChange={(e) => setSearchProvince(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="ค้นหาอำเภอ/เขต..."
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={searchDistrict}
                  onChange={(e) => setSearchDistrict(e.target.value)}
                />
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50/50 text-gray-500 text-sm uppercase tracking-wider">
                      <th className="px-6 py-4 font-semibold rounded-l-xl">ชื่อบริษัท</th>
                      <th className="px-6 py-4 font-semibold">เบอร์โทร</th>
                      <th className="px-6 py-4 font-semibold">หมายเหตุ</th>
                      <th className="px-6 py-4 font-semibold text-right rounded-r-xl">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredCompanies.map(c => (
                      <tr key={c.id} onClick={() => setViewingCompany(c)} className="hover:bg-gray-50/50 transition-colors group cursor-pointer">
                        <td className="px-6 py-5">
                          <p className="font-semibold text-gray-900">{c.name}</p>
                        </td>
                        <td className="px-6 py-5 text-gray-600">{c.phone || "-"}</td>
                        <td className="px-6 py-5">
                          <p className="text-gray-500 text-sm truncate max-w-xs">{c.note || "-"}</p>
                        </td>
                        <td className="px-6 py-5 text-right space-x-3">
                          <button onClick={(e) => { e.stopPropagation(); setViewingCompany(c); }} className="text-gray-400 hover:text-gray-800 font-medium text-sm transition-colors">ดูข้อมูล</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditingCompany(c); setCompanySubmitAttempted(false); setIsCompanyModalOpen(true); }} className="text-blue-500 hover:text-blue-700 font-medium text-sm transition-colors">แก้ไข</button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmCompany(c); }} className="text-red-500 hover:text-red-700 font-medium text-sm transition-colors">ลบ</button>
                        </td>
                      </tr>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center justify-center">
                            <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                            <p>ยังไม่มีข้อมูลบริษัท</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "customers" && (
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="bg-orange-100 text-orange-600 p-3 rounded-xl">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800">ลูกค้าทั้งหมด <span className="text-gray-400 text-lg font-normal">({filteredCustomers.length})</span></h2>
                </div>
                <button
                  onClick={() => { setEditingCustomer({}); setCustomerSubmitAttempted(false); setIsCustomerModalOpen(true); }}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  เพิ่มลูกค้า
                </button>
              </div>

              {/* Search Filters for Customers */}
              <div className="mb-6">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อลูกค้า หรือ ชื่อบริษัท..."
                  className="w-full md:w-1/3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                  value={searchCustomerName}
                  onChange={(e) => setSearchCustomerName(e.target.value)}
                />
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50/50 text-gray-500 text-sm uppercase tracking-wider">
                      <th className="px-6 py-4 font-semibold rounded-l-xl">ชื่อลูกค้า</th>
                      <th className="px-6 py-4 font-semibold">บริษัท</th>
                      <th className="px-6 py-4 font-semibold">แผนก</th>
                      <th className="px-6 py-4 font-semibold">เบอร์โทร</th>
                      <th className="px-6 py-4 font-semibold text-right rounded-r-xl">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredCustomers.map(c => (
                      <tr key={c.id} onClick={() => setViewingCustomer(c)} className="hover:bg-gray-50/50 transition-colors group cursor-pointer">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-orange-200 to-orange-100 flex items-center justify-center text-orange-700 font-bold">
                              {c.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">{c.name}</p>
                              <p className="text-sm text-gray-500">{c.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-gray-700 font-medium">{c.companyName}</td>
                        <td className="px-6 py-5 text-gray-600">{c.department || "-"}</td>
                        <td className="px-6 py-5 text-gray-600">{c.phone || "-"}</td>
                        <td className="px-6 py-5 text-right space-x-3">
                          <button onClick={(e) => { e.stopPropagation(); setViewingCustomer(c); }} className="text-gray-400 hover:text-gray-800 font-medium text-sm transition-colors">ดูข้อมูล</button>
                          <button onClick={(e) => { e.stopPropagation(); setEditingCustomer(c); setCustomerSubmitAttempted(false); setIsCustomerModalOpen(true); }} className="text-blue-500 hover:text-blue-700 font-medium text-sm transition-colors">แก้ไข</button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmCustomer(c); }} className="text-red-500 hover:text-red-700 font-medium text-sm transition-colors">ลบ</button>
                        </td>
                      </tr>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center justify-center">
                            <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            <p>ยังไม่มีข้อมูลลูกค้า</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Viewing Company Modal */}
      {viewingCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setViewingCompany(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full p-8 overflow-hidden transform transition-all">
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setViewingCompany(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{viewingCompany.name}</h2>
                <p className="text-gray-500">ข้อมูลบริษัท</p>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">รายละเอียดที่อยู่</h3>
                <p className="text-gray-800 leading-relaxed">
                  {viewingCompany.addressNo ? `เลขที่ ${viewingCompany.addressNo} ` : ""}
                  {viewingCompany.moo ? `หมู่ ${viewingCompany.moo} ` : ""}
                  {viewingCompany.soi ? `ซอย ${viewingCompany.soi} ` : ""}
                  {viewingCompany.road ? `ถนน ${viewingCompany.road} ` : ""}
                  <br/>
                  {viewingCompany.subDistrict ? `ตำบล/แขวง ${viewingCompany.subDistrict} ` : ""}
                  {viewingCompany.district ? `อำเภอ/เขต ${viewingCompany.district} ` : ""}
                  <br/>
                  {viewingCompany.province ? `จังหวัด ${viewingCompany.province} ` : ""}
                  {viewingCompany.postalCode ? `${viewingCompany.postalCode}` : ""}
                  {!viewingCompany.addressNo && !viewingCompany.province && <span className="text-gray-400 italic">ไม่มีข้อมูลที่อยู่</span>}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">เบอร์โทรศัพท์</h3>
                  <p className="text-gray-800 font-medium">{viewingCompany.phone || "-"}</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">สถานะ</h3>
                  <p className="text-green-600 font-medium">Active</p>
                </div>
              </div>

              {viewingCompany.note && (
                <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
                  <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">หมายเหตุ</h3>
                  <p className="text-orange-900">{viewingCompany.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Viewing Customer Modal */}
      {viewingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setViewingCustomer(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full p-8 overflow-hidden transform transition-all">
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setViewingCustomer(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="flex items-center gap-5 mb-8">
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-orange-200 to-orange-100 border-4 border-white shadow-sm flex items-center justify-center text-orange-700 font-bold text-3xl">
                {viewingCustomer.name.charAt(0)}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{viewingCustomer.name}</h2>
                <p className="text-orange-600 font-medium">{viewingCustomer.companyName}</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase">แผนก</p>
                  <p className="text-gray-900 font-medium">{viewingCustomer.department || "-"}</p>
                </div>
              </div>
              
              <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase">อีเมล</p>
                  <p className="text-gray-900 font-medium">{viewingCustomer.email || "-"}</p>
                </div>
              </div>
              
              <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase">เบอร์โทรศัพท์</p>
                  <p className="text-gray-900 font-medium">{viewingCustomer.phone || "-"}</p>
                </div>
              </div>

              {viewingCustomer.note && (
                <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100 mt-4">
                  <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">หมายเหตุ</h3>
                  <p className="text-orange-900">{viewingCustomer.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editing Company Form Modal */}
      {isCompanyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsCompanyModalOpen(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-800">{editingCompany?.id ? "แก้ไขข้อมูลบริษัท" : "เพิ่มบริษัทใหม่"}</h2>
              <button onClick={() => setIsCompanyModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 p-8">
              <form id="company-form" onSubmit={handleSaveCompany} onInvalid={() => setCompanySubmitAttempted(true)} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">ชื่อบริษัท <span className="text-red-500">*</span></label>
                  <input required type="text" className={`w-full bg-gray-50 border rounded-xl px-4 py-3 outline-none transition-all focus:bg-white focus:ring-2 ${companySubmitAttempted ? 'invalid:border-red-500 invalid:ring-red-500 invalid:bg-red-50 border-gray-200 focus:border-transparent focus:ring-blue-500 focus:invalid:border-red-500 focus:invalid:ring-red-500' : 'border-gray-200 focus:border-transparent focus:ring-blue-500'}`} placeholder="บริษัท เอบีซี จำกัด" value={editingCompany?.name || ""} onChange={e => setEditingCompany({...editingCompany, name: e.target.value})} />
                </div>
                
                <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100 space-y-4">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">ข้อมูลที่อยู่</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">เลขที่/อาคาร</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.addressNo || ""} onChange={e => setEditingCompany({...editingCompany, addressNo: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">หมู่</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.moo || ""} onChange={e => setEditingCompany({...editingCompany, moo: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">ซอย</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.soi || ""} onChange={e => setEditingCompany({...editingCompany, soi: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">ถนน</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.road || ""} onChange={e => setEditingCompany({...editingCompany, road: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">ตำบล/แขวง</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.subDistrict || ""} onChange={e => setEditingCompany({...editingCompany, subDistrict: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">อำเภอ/เขต</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.district || ""} onChange={e => setEditingCompany({...editingCompany, district: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">จังหวัด</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.province || ""} onChange={e => setEditingCompany({...editingCompany, province: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">รหัสไปรษณีย์</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.postalCode || ""} onChange={e => setEditingCompany({...editingCompany, postalCode: e.target.value})} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">เบอร์โทรศัพท์</label>
                  <input type="tel" pattern="[0-9]*" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={editingCompany?.phone || ""} onChange={e => setEditingCompany({...editingCompany, phone: e.target.value.replace(/\D/g, "")})} />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">หมายเหตุ</label>
                  <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none" placeholder="ข้อมูลเพิ่มเติม..." value={editingCompany?.note || ""} onChange={e => setEditingCompany({...editingCompany, note: e.target.value})}></textarea>
                </div>
              </form>
            </div>
            
            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 z-10">
              <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm">ยกเลิก</button>
              <button type="submit" form="company-form" className="px-6 py-2.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-all shadow-sm hover:shadow-md">บันทึกข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Editing Customer Form Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsCustomerModalOpen(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-800">{editingCustomer?.id ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้าใหม่"}</h2>
              <button onClick={() => setIsCustomerModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 px-8 py-6">
              <form id="customer-form" onSubmit={handleSaveCustomer} onInvalid={() => setCustomerSubmitAttempted(true)} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
                  <input required type="text" className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 outline-none transition-all focus:bg-white focus:ring-2 ${customerSubmitAttempted ? 'invalid:border-red-500 invalid:ring-red-500 invalid:bg-red-50 border-gray-200 focus:border-transparent focus:ring-orange-500 focus:invalid:border-red-500 focus:invalid:ring-red-500' : 'border-gray-200 focus:border-transparent focus:ring-orange-500'}`} placeholder="สมหญิง ใจดี" value={editingCustomer?.name || ""} onChange={e => setEditingCustomer({...editingCustomer, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">สังกัดบริษัท <span className="text-red-500">*</span></label>
                  <select required className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 outline-none transition-all appearance-none focus:bg-white focus:ring-2 ${customerSubmitAttempted ? 'invalid:border-red-500 invalid:ring-red-500 invalid:bg-red-50 border-gray-200 focus:border-transparent focus:ring-orange-500 focus:invalid:border-red-500 focus:invalid:ring-red-500' : 'border-gray-200 focus:border-transparent focus:ring-orange-500'}`} style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 20 20%27%3e%3cpath stroke=%27%236b7280%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%271.5%27 d=%27M6 8l4 4 4-4%27/%3e%3c/svg%3e")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }} value={editingCustomer?.companyId || ""} onChange={e => setEditingCustomer({...editingCustomer, companyId: e.target.value})}>
                    <option value="" disabled>-- เลือกบริษัท --</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">แผนก</label>
                  <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="เช่น บัญชี, การตลาด" value={editingCustomer?.department || ""} onChange={e => setEditingCustomer({...editingCustomer, department: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">เบอร์โทรศัพท์</label>
                  <input type="tel" pattern="[0-9]*" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="08XXXXXXXX" value={editingCustomer?.phone || ""} onChange={e => setEditingCustomer({...editingCustomer, phone: e.target.value.replace(/\D/g, "")})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อีเมล</label>
                  <input type="email" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="example@email.com" value={editingCustomer?.email || ""} onChange={e => setEditingCustomer({...editingCustomer, email: e.target.value})} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">หมายเหตุ</label>
                  <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all resize-none" placeholder="ข้อมูลเพิ่มเติม..." value={editingCustomer?.note || ""} onChange={e => setEditingCustomer({...editingCustomer, note: e.target.value})}></textarea>
                </div>
              </form>
            </div>
            
            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 z-10">
              <button type="button" onClick={() => setIsCustomerModalOpen(false)} className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm">ยกเลิก</button>
              <button type="submit" form="customer-form" className="px-6 py-2.5 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition-all shadow-sm hover:shadow-md">บันทึกข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Company Confirmation Modal */}
      {deleteConfirmCompany && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setDeleteConfirmCompany(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center transform transition-all scale-100 opacity-100">
            {(() => {
              const linkedCustomers = customers.filter(c => c.companyId === deleteConfirmCompany.id);
              if (linkedCustomers.length > 0) {
                return (
                  <>
                    <div className="w-16 h-16 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">ไม่สามารถลบบริษัทได้</h3>
                    <p className="text-gray-500 mb-6">บริษัท <strong>{deleteConfirmCompany.name}</strong> ยังมีลูกค้าระบุสังกัดอยู่จำนวน {linkedCustomers.length} ราย กรุณาลบหรือย้ายสังกัดลูกค้าก่อนทำการลบบริษัท</p>
                    <div className="flex justify-center">
                      <button onClick={() => setDeleteConfirmCompany(null)} className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors shadow-sm w-full">ตกลง</button>
                    </div>
                  </>
                );
              }
              return (
                <>
                  <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบบริษัท</h3>
                  <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ที่จะลบ <strong>{deleteConfirmCompany.name}</strong>? การลบนี้ไม่สามารถกู้คืนได้</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => setDeleteConfirmCompany(null)} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors flex-1">ยกเลิก</button>
                    <button onClick={executeDeleteCompany} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md flex-1">ลบข้อมูล</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Delete Customer Confirmation Modal */}
      {deleteConfirmCustomer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setDeleteConfirmCustomer(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center transform transition-all scale-100 opacity-100">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบลูกค้า</h3>
            <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ที่จะลบ <strong>{deleteConfirmCustomer.name}</strong>? ข้อมูลจะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmCustomer(null)} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors">ยกเลิก</button>
              <button onClick={executeDeleteCustomer} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md">ลบข้อมูล</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Customers() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div></div>}>
      <CustomersInner />
    </Suspense>
  );
}
