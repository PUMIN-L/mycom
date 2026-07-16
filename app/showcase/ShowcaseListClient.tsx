"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";
import Toast from "../components/Toast";

import type { DocumentData, ContentData } from "../lib/types";

interface ShowcaseListClientProps {
  initialContents: ContentData[];
  initialDocuments: DocumentData[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ShowcaseListClient({
  initialContents,
  initialDocuments,
}: ShowcaseListClientProps) {
  const [contents, setContents] = useState<ContentData[]>(initialContents);
  const [documents, setDocuments] = useState<DocumentData[]>(initialDocuments);
  
  // Content delete state
  const [pendingDelete, setPendingDelete] = useState<ContentData | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Document delete state
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<DocumentData | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  
  // Document upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docDesc, setDocDesc] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);

  // Document edit state
  const [editingDoc, setEditingDoc] = useState<DocumentData | null>(null);
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocDesc, setEditDocDesc] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const { isLoggedIn, user, logout } = useAuth();

  const isProcessing = uploadingDoc || savingDoc || deletingDocId !== null || deletingId !== null;

  useEffect(() => {
    if (isProcessing) {
      document.body.style.cursor = "wait";
    } else {
      document.body.style.cursor = "default";
    }
    return () => {
      document.body.style.cursor = "default";
    };
  }, [isProcessing]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDeleteContent(item: ContentData) {
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/contents/${item.id}`, { method: "DELETE" });
      if (res.ok) {
        setContents((prev) => prev.filter((c) => c.id !== item.id));
        showToast("ลบ content สำเร็จ", "success");
      } else {
        showToast("เกิดข้อผิดพลาดในการลบ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }

  // ── Document Handlers ────────────────────────────────────────────────────────
  async function handleUploadDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docFile || !docTitle) {
      showToast("กรุณากรอกชื่อและเลือกไฟล์", "error");
      return;
    }
    
    setUploadingDoc(true);
    try {
      // 1. Upload PDF to Cloudinary (our API now handles double upload for PDFs to get both raw and cover images)
      const formData = new FormData();
      formData.append("file", docFile);
      formData.append("isDocument", "true");
      
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();
      
      const pdfUrl = uploadData.url;
      const coverUrl = uploadData.coverUrl || pdfUrl.replace(/\.pdf$/i, ".jpg");
      
      // 2. Save to database
      const id = "doc-" + Date.now();
      const saveRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: docTitle,
          description: docDesc,
          pdfUrl,
          coverUrl,
        }),
      });
      
      if (!saveRes.ok) throw new Error("Save failed");
      const newDoc = await saveRes.json();
      
      setDocuments((prev) => [newDoc, ...prev]);
      showToast("อัปโหลดเอกสารสำเร็จ", "success");
      
      // Reset form
      setShowUploadModal(false);
      setDocTitle("");
      setDocDesc("");
      setDocFile(null);
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการอัปโหลด", "error");
    } finally {
      setUploadingDoc(false);
    }
  }

  async function handleEditDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDoc) return;
    setSavingDoc(true);
    try {
      const res = await fetch(`/api/documents/${editingDoc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editDocTitle, description: editDocDesc }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${res.status} ${text}`);
      }
      
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === editingDoc.id ? { ...doc, title: editDocTitle, description: editDocDesc } : doc
        )
      );
      showToast("บันทึกการเปลี่ยนแปลงสำเร็จ", "success");
      setEditingDoc(null);
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleDeleteDocument(item: DocumentData) {
    setDeletingDocId(item.id);
    try {
      const res = await fetch(`/api/documents/${item.id}`, { method: "DELETE" });
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== item.id));
        showToast("ลบเอกสารสำเร็จ", "success");
      } else {
        showToast("เกิดข้อผิดพลาดในการลบเอกสาร", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบเอกสาร", "error");
    } finally {
      setDeletingDocId(null);
      setPendingDeleteDoc(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      {toast && <Toast message={toast.message} type={toast.type} />}
      {pendingDelete && (
        <ConfirmDialog
          message={`ต้องการลบ "${pendingDelete.title}" ใช่ไหม? รูปภาพทั้งหมดจะถูกลบออกจาก Cloudinary ด้วย`}
          onConfirm={() => handleDeleteContent(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
          loading={deletingId !== null}
        />
      )}

      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10 pb-6 border-b border-gray-200">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 font-serif">All Produce Content</h1>
            {/* <p className="text-gray-600 mt-2">Explore all dynamically created pages stored in TiDB Cloud</p> */}
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link
              href="/"
              className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition shadow-sm"
            >
              ← Back to Home
            </Link>
            {isLoggedIn && (
              <>
                <Link
                  href="/create-content"
                  className="px-5 py-2.5 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition shadow-sm"
                >
                  + Create New Content
                </Link>
                <button
                  onClick={logout}
                  className="px-5 py-2.5 bg-white border border-red-300 text-red-500 font-semibold rounded-lg hover:bg-red-500 hover:text-white transition shadow-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout ({user?.username})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content Grid */}
        {contents.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-16 text-center">
            <h3 className="text-xl font-bold text-gray-800 mb-2">No Contents Yet</h3>
            <p className="text-gray-600 mb-6">Create your first database-backed page using our content editor!</p>
            <Link
              href="/create-content"
              className="px-6 py-3 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition"
            >
              Get Started
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {contents.map((item) => {
              const textCount = item.blocks.filter((b) => b.type === "text").length;
              const imageCount = item.blocks.filter((b) => b.type === "image").length;
              const isDeleting = deletingId === item.id;

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md hover:border-orange-400 transition duration-300 ${
                    isDeleting ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  <Link href={`/showcase/${item.id}`} className="group p-6 flex-grow flex flex-col justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 group-hover:text-orange-500 transition duration-300 line-clamp-2 mb-2 font-serif">
                        {item.title}
                      </h2>
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                      <div className="flex gap-4">
                        <span className="flex items-center gap-1">
                          📝 {textCount} {textCount === 1 ? "Text" : "Texts"}
                        </span>
                        <span className="flex items-center gap-1">
                          🖼️ {imageCount} {imageCount === 1 ? "Image" : "Images"}
                        </span>
                      </div>
                      <span className="text-orange-500 font-bold group-hover:translate-x-1 transition duration-300 inline-block">
                        View →
                      </span>
                    </div>
                  </Link>

                  {/* Action bar — only visible to logged-in users */}
                  {isLoggedIn && (
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex gap-2">
                      <Link
                        href={`/showcase/${item.id}`}
                        className="flex-1 text-center py-1.5 text-sm rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-50 transition font-semibold"
                      >
                        ✏️ แก้ไข
                      </Link>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setPendingDelete(item);
                        }}
                        className="flex-1 py-1.5 text-sm rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition font-semibold border border-red-200"
                      >
                        🗑️ ลบ
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Document Library Section ──────────────────────────────────────── */}
        <div className="mt-24 pt-12 border-t border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 font-serif">เอกสารดาวน์โหลด</h2>
              <p className="text-gray-500 mt-2">Brochures & Specifications</p>
            </div>
            {isLoggedIn && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                อัปโหลด PDF
              </button>
            )}
          </div>

          {documents.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-gray-500">ยังไม่มีเอกสารในระบบ</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {documents.map((doc) => {
                const isDeleting = deletingDocId === doc.id;
                return (
                  <div
                    key={doc.id}
                    className={`group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-black/[0.04] transition-all duration-300 overflow-hidden flex flex-col ${
                      isDeleting ? "opacity-50 pointer-events-none" : ""
                    }`}
                  >
                    <Link href={`/document/${doc.id}`} target="_blank" rel="noopener noreferrer" className="block relative aspect-[4/3] bg-gray-50 border-b border-gray-100 p-4 overflow-hidden">
                      {/* We use standard img here because Cloudinary returns a jpg and we might not know dimensions */}
                      <div className="relative w-full h-full shadow-sm rounded overflow-hidden">
                        <img
                          src={doc.coverUrl}
                          alt={doc.title}
                          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-700"
                          loading="lazy"
                        />
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 flex items-center justify-center">
                        <div className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-bold text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-4 group-hover:translate-y-0">
                          ดูเอกสาร PDF
                        </div>
                      </div>
                    </Link>
                    <div className="p-5 flex flex-col flex-1">
                      <h3 className="text-lg font-bold text-gray-900 line-clamp-2 mb-1 group-hover:text-blue-600 transition-colors">{doc.title}</h3>
                      {doc.description && (
                        <p className="text-sm text-gray-500 line-clamp-2 mb-4">{doc.description}</p>
                      )}
                      
                      {isLoggedIn && (
                        <div className="mt-auto pt-4 border-t border-gray-100 flex gap-2">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setEditDocTitle(doc.title);
                              setEditDocDesc(doc.description || "");
                              setEditingDoc(doc);
                            }}
                            className="flex-1 py-1.5 text-xs font-bold text-blue-500 hover:text-white hover:bg-blue-500 rounded-lg transition-colors border border-blue-200"
                          >
                            แก้ไข
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setPendingDeleteDoc(doc);
                            }}
                            className="flex-1 py-1.5 text-xs font-bold text-red-500 hover:text-white hover:bg-red-500 rounded-lg transition-colors border border-red-200"
                          >
                            ลบ
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Document Upload Modal ───────────────────────────────────────── */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slideUp">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">อัปโหลดเอกสาร PDF</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleUploadDocument} className="p-6 flex flex-col gap-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อเอกสาร *</label>
                <input
                  type="text"
                  required
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="เช่น โบรชัวร์เครื่องชั่ง 2024"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">รายละเอียด (ถ้ามี)</label>
                <textarea
                  value={docDesc}
                  onChange={(e) => setDocDesc(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                  placeholder="รายละเอียดเอกสารเพิ่มเติม..."
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ไฟล์ PDF *</label>
                <input
                  type="file"
                  required
                  accept=".pdf"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                  className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                <p className="text-xs text-gray-500 mt-2">* ระบบจะดึงรูปหน้าแรกของ PDF มาเป็นหน้าปกให้อัตโนมัติ</p>
              </div>
              <div className="pt-4 mt-2 border-t border-gray-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={uploadingDoc || !docFile || !docTitle}
                  className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-default flex items-center justify-center gap-2"
                >
                  {uploadingDoc ? "กำลังอัปโหลด..." : "บันทึกเอกสาร"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Document Edit Modal ───────────────────────────────────────── */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slideUp">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">แก้ไขเอกสาร</h3>
              <button onClick={() => setEditingDoc(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleEditDocument} className="p-6 flex flex-col gap-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อเอกสาร *</label>
                <input
                  type="text"
                  required
                  value={editDocTitle}
                  onChange={(e) => setEditDocTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">รายละเอียด (ถ้ามี)</label>
                <textarea
                  value={editDocDesc}
                  onChange={(e) => setEditDocDesc(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                />
              </div>
              <div className="pt-4 mt-2 border-t border-gray-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingDoc(null)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingDoc || !editDocTitle.trim()}
                  className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-default flex items-center justify-center gap-2"
                >
                  {savingDoc ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Document Delete Confirm ──────────────────────────────────────── */}
      {pendingDeleteDoc && (
        <ConfirmDialog
          message={`ต้องการลบเอกสาร "${pendingDeleteDoc.title}" ใช่ไหม?`}
          onConfirm={() => handleDeleteDocument(pendingDeleteDoc)}
          onCancel={() => setPendingDeleteDoc(null)}
          loading={deletingDocId !== null}
        />
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
        .animate-slideUp { animation: slideUp 0.3s ease-out; }
      `}</style>
    </div>
  );
}
