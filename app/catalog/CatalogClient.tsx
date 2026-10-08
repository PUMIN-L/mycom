"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentData } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import SkeletonImage from "../components/SkeletonImage";
import Toast from "../components/Toast";
import Link from "next/link";

interface CatalogClientProps {
  initialDocuments: DocumentData[];
  /** The copy was rendered for an admin (page.tsx): hidden catalogs included,
   *  each with the button that hides or shows it. */
  adminView: boolean;
}

export default function CatalogClient({ initialDocuments, adminView }: CatalogClientProps) {
  const t = useT();
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [documents, setDocuments] = useState(initialDocuments);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // A copy rendered for the other kind of viewer — the cached visitor's copy
  // in an admin's tab (prefetched before logging in), or an admin's copy kept
  // after logging out: render again, once, for whoever is looking. The same
  // check as ShowcaseClient; page.tsx keys this component on the copy, so the
  // fresh list reseeds the state above.
  const checkedViewer = useRef(false);
  useEffect(() => {
    if (authLoading || checkedViewer.current) return;
    checkedViewer.current = true;
    if (isLoggedIn !== adminView) router.refresh();
  }, [authLoading, isLoggedIn, adminView, router]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  async function togglePublished(doc: DocumentData) {
    if (togglingId) return;
    const next = doc.isPublished === false;
    setTogglingId(doc.id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "เปลี่ยนการแสดงแคตตาล็อกไม่สำเร็จ");
      }
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, isPublished: next } : d)));
      showToast(next ? "แสดงแคตตาล็อกแล้ว" : "ซ่อนแคตตาล็อกแล้ว ผู้เข้าชมจะไม่เห็นอีก", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "เปลี่ยนการแสดงแคตตาล็อกไม่สำเร็จ", "error");
    } finally {
      setTogglingId(null);
    }
  }

  const hiddenCount = documents.filter((d) => d.isPublished === false).length;

  return (
    <div className="section-wrapper">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-serif font-bold text-[#2d2e38] mb-4 mt-8">
          {t(translations.catalogPage.title)}
        </h1>
        <p className="text-lg text-gray-500 max-w-4xl mx-auto">
          {t(translations.catalogPage.description)}
        </p>
        {adminView && hiddenCount > 0 && (
          <p className="mt-4 inline-block px-4 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold">
            ซ่อนอยู่ {hiddenCount} รายการ — เห็นเฉพาะแอดมิน
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {documents.length === 0 ? (
          <div className="col-span-full py-20 text-center text-gray-400">
            {t(translations.catalogPage.noCatalogs)}
          </div>
        ) : (
          documents.map((doc) => {
            const hidden = doc.isPublished === false;
            return (
              // The admin button sits BESIDE the link, not inside it: a button
              // inside an <a> is invalid HTML, and its click would open the PDF.
              // The lift on hover is the wrapper's, so the admin button moves
              // with the card instead of staying behind 4px out of line.
              <div key={doc.id} className="relative transition-transform duration-300 hover:-translate-y-1">
                <Link
                  href={`/document/${doc.id}`}
                  target="_blank"
                  className={`group flex flex-col h-full bg-white rounded-2xl border overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 ${hidden ? "border-dashed border-gray-300" : "border-gray-100"}`}
                >
                  {/* Cover Image Area */}
                  <div className={`relative aspect-[4/3] bg-gray-50 border-b border-gray-100 overflow-hidden p-4 ${hidden ? "opacity-50 grayscale" : ""}`}>
                    {doc.coverUrl ? (
                      <div className="relative w-full h-full shadow-sm rounded overflow-hidden">
                        <SkeletonImage
                          src={doc.coverUrl}
                          alt={doc.title}
                          fill
                          className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
                        />
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                    )}

                    {/* Glassmorphism Overlay on Hover */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-6">
                      <div className="px-5 py-2 bg-white/20 backdrop-blur-md border border-white/30 rounded-full text-white text-sm font-medium shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                        {t(translations.catalogPage.viewPdf)}
                      </div>
                    </div>
                  </div>

                  {/* Text Content */}
                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className={`text-lg font-bold mb-1 line-clamp-2 group-hover:text-[var(--accent)] transition-colors ${hidden ? "text-gray-500" : "text-gray-800"}`}>
                      {doc.title}
                    </h3>
                    {doc.description && (
                      <p className="text-sm text-gray-500 line-clamp-2">
                        {doc.description}
                      </p>
                    )}
                  </div>
                </Link>

                {adminView && hidden && (
                  <span className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full bg-gray-800/85 text-white text-xs font-bold shadow pointer-events-none">
                    ซ่อนอยู่
                  </span>
                )}

                {adminView && (
                  <button
                    type="button"
                    onClick={() => togglePublished(doc)}
                    disabled={togglingId !== null}
                    title={hidden ? "แสดงแคตตาล็อกนี้ให้ผู้เข้าชมเห็น" : "ซ่อนแคตตาล็อกนี้จากผู้เข้าชม"}
                    className={`absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shadow-md border transition disabled:opacity-60 disabled:cursor-wait ${hidden ? "bg-green-600 border-green-600 text-white hover:bg-green-700" : "bg-white/95 border-gray-200 text-gray-700 hover:bg-gray-800 hover:border-gray-800 hover:text-white"}`}
                  >
                    {togglingId === doc.id ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : hidden ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    )}
                    {hidden ? "แสดง" : "ซ่อน"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
