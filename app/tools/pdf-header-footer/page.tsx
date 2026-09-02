"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "../../context/AuthContext";

// Dynamically import react-pdf to avoid SSR issues (DOMMatrix not available in Node.js).
// Worker MUST be same-origin (bundled via import.meta.url), not the unpkg CDN — the
// site's CSP script-src is 'self' only (see next.config.ts), so a CDN workerSrc gets
// silently blocked by the browser and PDF rendering fails. Mirrors
// app/document/[id]/PdfViewerClient.tsx, which already does this correctly.
const DynDocument = dynamic(
  () => import("react-pdf").then((mod) => {
    mod.pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return mod.Document;
  }),
  { ssr: false }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

const DynPage = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

type PageConfig = {
  header: boolean;
  footer: boolean;
};

// No full customize step anymore — header/footer images are always
// centered, flush to the edge, fully opaque. Height is the one adjustable
// setting (see headerHeightPercent/footerHeightPercent below); width is
// then derived from height to keep the image's own proportions (never
// stretched/distorted), capped to the page width.
const PLACEMENT = {
  marginTop: 0,
  marginBottom: 0,
  opacity: 1.0,
};

const DEFAULT_HEIGHT_PERCENT = 8; // % of page height
const MIN_HEIGHT_PERCENT = 2;
const MAX_HEIGHT_PERCENT = 30;

/**
 * Size an image by target height (as % of page height), deriving width from
 * the image's own aspect ratio so it's never stretched/distorted — then cap
 * to the page width for an unusually wide image at a large height setting.
 */
function sizeByHeight(
  heightPercent: number,
  pageWidth: number,
  pageHeight: number,
  nativeWidth: number,
  nativeHeight: number
): { width: number; height: number } {
  let height = (heightPercent / 100) * pageHeight;
  let width = height * (nativeWidth / nativeHeight);
  if (width > pageWidth) {
    width = pageWidth;
    height = width * (nativeHeight / nativeWidth);
  }
  return { width, height };
}

export default function PdfHeaderFooterPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();

  // Step management: 1 = upload, 2 = select pages, 3 = download
  const [step, setStep] = useState(1);

  // File states
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  // react-pdf (pdf.js) TRANSFERS the ArrayBuffer passed as `file.data` to its
  // worker thread for zero-copy parsing — this DETACHES that exact ArrayBuffer
  // in the main thread (byteLength becomes 0, unusable). If `pdfBytes` itself
  // were handed to <Document>, the later pdf-lib step (`generatePdf`, which
  // also reads `pdfBytes`) would crash with "Cannot perform Construct on a
  // detached ArrayBuffer". So <Document> only ever gets a disposable `.slice(0)`
  // copy, never the original — `pdfBytes` stays intact for pdf-lib.
  //
  // The copy must also be freshly made every time Step 2 is (re-)entered, not
  // just once per upload — <Document> fully unmounts leaving Step 2, so
  // going back to Step 2 a second time mounts a NEW <Document> that would
  // otherwise reuse (and re-transfer) the SAME already-detached clone from
  // the first visit. Keying the memo on `step` too (not just `pdfBytes`)
  // still keeps the reference stable while simply toggling pages within one
  // Step 2 visit, so a single toggle doesn't reload the whole document.
  const pdfFileProp = useMemo(
    () => (pdfBytes ? { data: pdfBytes.slice(0) } : null),
    [pdfBytes, step]
  );
  const [headerImage, setHeaderImage] = useState<File | null>(null);
  const [footerImage, setFooterImage] = useState<File | null>(null);
  const [headerPreview, setHeaderPreview] = useState<string>("");
  const [footerPreview, setFooterPreview] = useState<string>("");
  const [headerHeightPercent, setHeaderHeightPercent] = useState(DEFAULT_HEIGHT_PERCENT);
  const [footerHeightPercent, setFooterHeightPercent] = useState(DEFAULT_HEIGHT_PERCENT);

  // PDF info
  const [numPages, setNumPages] = useState(0);

  // Page config: which pages get header/footer
  const [pageConfigs, setPageConfigs] = useState<Record<number, PageConfig>>({});

  // Final PDF
  const [finalPdfUrl, setFinalPdfUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, authLoading, router]);

  // ── File handlers ──────────────────────────────────────────────────────

  const handlePdfUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      alert("ไฟล์ PDF ขนาดใหญ่เกินไป (สูงสุด 50MB)");
      return;
    }
    // A NEW document's page count/content has nothing to do with whatever was
    // selected for the previous one — without this, going back to Step 1 and
    // uploading a different PDF (without hitting "เริ่มใหม่") silently carries
    // over the old file's per-page header/footer selections.
    configsInitializedRef.current = false;
    setPageConfigs({});
    setNumPages(0);
    setPdfFile(file);
    const bytes = await file.arrayBuffer();
    setPdfBytes(bytes);
  };

  const handleImageUpload = (file: File, type: "header" | "footer") => {
    if (file.size > 10 * 1024 * 1024) {
      alert("ไฟล์รูปภาพขนาดใหญ่เกินไป (สูงสุด 10MB)");
      return;
    }
    const url = URL.createObjectURL(file);
    if (type === "header") {
      if (headerPreview) URL.revokeObjectURL(headerPreview);
      setHeaderImage(file);
      setHeaderPreview(url);
    } else {
      if (footerPreview) URL.revokeObjectURL(footerPreview);
      setFooterImage(file);
      setFooterPreview(url);
    }
  };

  const configsInitializedRef = useRef(false);

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    // Only initialize configs on first load — prevent reset when navigating back
    if (configsInitializedRef.current) return;
    configsInitializedRef.current = true;
    const configs: Record<number, PageConfig> = {};
    for (let i = 1; i <= n; i++) {
      configs[i] = { header: false, footer: false };
    }
    setPageConfigs(configs);
  };

  // ── Page config toggles ────────────────────────────────────────────────

  const togglePage = (pageNum: number, type: "header" | "footer") => {
    setPageConfigs((prev) => ({
      ...prev,
      [pageNum]: { ...prev[pageNum], [type]: !prev[pageNum]?.[type] },
    }));
  };

  const selectAll = (type: "header" | "footer") => {
    setPageConfigs((prev) => {
      const next = { ...prev };
      for (let i = 1; i <= numPages; i++) {
        next[i] = { ...next[i], [type]: true };
      }
      return next;
    });
  };

  const deselectAll = (type: "header" | "footer") => {
    setPageConfigs((prev) => {
      const next = { ...prev };
      for (let i = 1; i <= numPages; i++) {
        next[i] = { ...next[i], [type]: false };
      }
      return next;
    });
  };

  // ── Generate final PDF ─────────────────────────────────────────────────

  const generatePdf = async () => {
    if (!pdfBytes) return;
    setIsGenerating(true);

    try {
      const { PDFDocument } = await import("pdf-lib");

      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();

      // Embed images
      let headerEmbed: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
      let footerEmbed: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;

      if (headerImage) {
        const hBytes = await headerImage.arrayBuffer();
        const uint8 = new Uint8Array(hBytes);
        const isPng = uint8[0] === 0x89 && uint8[1] === 0x50;
        const isJpg = uint8[0] === 0xFF && uint8[1] === 0xD8;
        if (!isPng && !isJpg) {
          alert("รูปหัวกระดาษรองรับเฉพาะ PNG และ JPG เท่านั้น");
          setIsGenerating(false);
          return;
        }
        headerEmbed = isPng ? await pdfDoc.embedPng(hBytes) : await pdfDoc.embedJpg(hBytes);
      }

      if (footerImage) {
        const fBytes = await footerImage.arrayBuffer();
        const uint8 = new Uint8Array(fBytes);
        const isPng = uint8[0] === 0x89 && uint8[1] === 0x50;
        const isJpg = uint8[0] === 0xFF && uint8[1] === 0xD8;
        if (!isPng && !isJpg) {
          alert("รูปท้ายกระดาษรองรับเฉพาะ PNG และ JPG เท่านั้น");
          setIsGenerating(false);
          return;
        }
        footerEmbed = isPng ? await pdfDoc.embedPng(fBytes) : await pdfDoc.embedJpg(fBytes);
      }

      for (let i = 0; i < pages.length; i++) {
        const pageNum = i + 1;
        const config = pageConfigs[pageNum];
        if (!config) continue;

        const page = pages[i];
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // Draw header
        if (config.header && headerEmbed) {
          const { width: imgW, height: imgH } = sizeByHeight(
            headerHeightPercent, pageWidth, pageHeight, headerEmbed.width, headerEmbed.height
          );
          const x = (pageWidth - imgW) / 2; // always centered
          const y = pageHeight - imgH - PLACEMENT.marginTop;

          page.drawImage(headerEmbed, {
            x, y, width: imgW, height: imgH, opacity: PLACEMENT.opacity,
          });
        }

        // Draw footer
        if (config.footer && footerEmbed) {
          const { width: imgW, height: imgH } = sizeByHeight(
            footerHeightPercent, pageWidth, pageHeight, footerEmbed.width, footerEmbed.height
          );
          const x = (pageWidth - imgW) / 2; // always centered
          const y = PLACEMENT.marginBottom;

          page.drawImage(footerEmbed, {
            x, y, width: imgW, height: imgH, opacity: PLACEMENT.opacity,
          });
        }
      }

      const newPdfBytes = await pdfDoc.save();
      const blob = new Blob([newPdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setFinalPdfUrl(url);
      setStep(3);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      alert("ไม่สามารถสร้าง PDF ได้ กรุณาตรวจสอบไฟล์อีกครั้ง");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Drop handler ───────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent, type: "pdf" | "header" | "footer") => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (type === "pdf") {
      if (file.type === "application/pdf") handlePdfUpload(file);
    } else {
      if (file.type.startsWith("image/")) handleImageUpload(file, type);
    }
  };

  // ── Auth guard ─────────────────────────────────────────────────────────

  if (authLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasAnySelection = Object.values(pageConfigs).some((c) => c.header || c.footer);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex justify-between items-center">
            <div>
              <Link href="/adminpanel" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors mb-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                กลับไป Admin Panel
              </Link>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center text-xl shadow-sm">📄</div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">เครื่องมือ PDF — ใส่หัว/ท้ายกระดาษ</h1>
              </div>
            </div>

            {/* Step indicators */}
            <div className="hidden md:flex items-center gap-2">
              {[
                { n: 1, label: "อัปโหลด" },
                { n: 2, label: "เลือกหน้า" },
                { n: 3, label: "ดาวน์โหลด" },
              ].map((s) => (
                <div key={s.n} className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    step >= s.n ? "bg-violet-600 text-white" : "bg-gray-200 text-gray-500"
                  }`}>
                    {step > s.n ? "✓" : s.n}
                  </div>
                  <span className={`text-xs font-semibold ${step >= s.n ? "text-violet-600" : "text-gray-400"}`}>{s.label}</span>
                  {s.n < 3 && <div className={`w-8 h-0.5 ${step > s.n ? "bg-violet-600" : "bg-gray-200"}`} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* ════════════════════════ STEP 1: Upload ════════════════════════ */}
        {step === 1 && (
          <div className="space-y-8 animate-fade-in">
            <div className="text-center mb-8">
              <h2 className="text-xl font-bold text-gray-800 mb-2">ขั้นตอนที่ 1: อัปโหลดไฟล์</h2>
              <p className="text-gray-500">อัปโหลดไฟล์ PDF และรูปภาพสำหรับหัวกระดาษ/ท้ายกระดาษ</p>
            </div>

            {/* PDF Upload */}
            <div
              onDrop={(e) => handleDrop(e, "pdf")}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 ${
                pdfFile ? "border-violet-400 bg-violet-50/30" : "border-gray-300"
              }`}
              onClick={() => {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.accept = ".pdf";
                inp.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) handlePdfUpload(f);
                };
                inp.click();
              }}
            >
              <div className="text-5xl mb-4">{pdfFile ? "✅" : "📄"}</div>
              <p className="text-lg font-bold text-gray-700 mb-1">
                {pdfFile ? pdfFile.name : "ลากไฟล์ PDF มาวางที่นี่ หรือคลิกเพื่อเลือก"}
              </p>
              <p className="text-sm text-gray-400">รองรับไฟล์ .pdf</p>
            </div>

            {/* Image Uploads */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Header Image */}
              <div>
                <div
                  onDrop={(e) => handleDrop(e, "header")}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 ${
                    headerImage ? "border-blue-400 bg-blue-50/30" : "border-gray-300"
                  }`}
                  onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = "image/*";
                    inp.onchange = (e) => {
                      const f = (e.target as HTMLInputElement).files?.[0];
                      if (f) handleImageUpload(f, "header");
                    };
                    inp.click();
                  }}
                >
                  {headerPreview ? (
                    <img src={headerPreview} alt="Header" className="max-h-24 mx-auto mb-3 rounded-lg shadow-sm" />
                  ) : (
                    <div className="text-4xl mb-3">🖼️</div>
                  )}
                  <p className="font-bold text-gray-700 mb-1">
                    {headerImage ? headerImage.name : "รูปหัวกระดาษ (Header)"}
                  </p>
                  <p className="text-xs text-gray-400">PNG, JPG</p>
                </div>
                {headerImage && (
                  <div className="mt-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                    <label className="flex justify-between text-xs font-semibold text-gray-600 mb-1.5">
                      <span>ความสูงของหัวกระดาษ</span>
                      <span className="text-blue-600">{headerHeightPercent}% ของหน้ากระดาษ</span>
                    </label>
                    <input
                      type="range"
                      min={MIN_HEIGHT_PERCENT}
                      max={MAX_HEIGHT_PERCENT}
                      value={headerHeightPercent}
                      onChange={(e) => setHeaderHeightPercent(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>
                )}
              </div>

              {/* Footer Image */}
              <div>
                <div
                  onDrop={(e) => handleDrop(e, "footer")}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 ${
                    footerImage ? "border-emerald-400 bg-emerald-50/30" : "border-gray-300"
                  }`}
                  onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = "image/*";
                    inp.onchange = (e) => {
                      const f = (e.target as HTMLInputElement).files?.[0];
                      if (f) handleImageUpload(f, "footer");
                    };
                    inp.click();
                  }}
                >
                  {footerPreview ? (
                    <img src={footerPreview} alt="Footer" className="max-h-24 mx-auto mb-3 rounded-lg shadow-sm" />
                  ) : (
                    <div className="text-4xl mb-3">🖼️</div>
                  )}
                  <p className="font-bold text-gray-700 mb-1">
                    {footerImage ? footerImage.name : "รูปท้ายกระดาษ (Footer)"}
                  </p>
                  <p className="text-xs text-gray-400">PNG, JPG</p>
                </div>
                {footerImage && (
                  <div className="mt-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                    <label className="flex justify-between text-xs font-semibold text-gray-600 mb-1.5">
                      <span>ความสูงของท้ายกระดาษ</span>
                      <span className="text-emerald-600">{footerHeightPercent}% ของหน้ากระดาษ</span>
                    </label>
                    <input
                      type="range"
                      min={MIN_HEIGHT_PERCENT}
                      max={MAX_HEIGHT_PERCENT}
                      value={footerHeightPercent}
                      onChange={(e) => setFooterHeightPercent(Number(e.target.value))}
                      className="w-full accent-emerald-600"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Next button */}
            <div className="flex justify-end">
              <button
                disabled={!pdfFile || (!headerImage && !footerImage)}
                onClick={() => setStep(2)}
                className="px-8 py-3 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-200 text-sm"
              >
                ถัดไป: เลือกหน้า →
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════ STEP 2: Select pages ════════════════════════ */}
        {step === 2 && pdfBytes && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 mb-2">ขั้นตอนที่ 2: เลือกหน้าที่จะใส่</h2>
              <p className="text-gray-500">คลิกเลือกว่าจะใส่หัวกระดาษ/ท้ายกระดาษในหน้าไหนบ้าง</p>
            </div>

            {/* Quick select buttons */}
            <div className="flex flex-wrap gap-3 justify-center">
              {headerImage && (
                <>
                  <button onClick={() => selectAll("header")} className="px-4 py-2 bg-blue-100 text-blue-700 font-semibold rounded-xl text-sm hover:bg-blue-200 transition-colors">
                    ✅ เลือกหัวกระดาษทุกหน้า
                  </button>
                  <button onClick={() => deselectAll("header")} className="px-4 py-2 bg-gray-100 text-gray-600 font-semibold rounded-xl text-sm hover:bg-gray-200 transition-colors">
                    ❌ ยกเลิกหัวกระดาษทั้งหมด
                  </button>
                </>
              )}
              {footerImage && (
                <>
                  <button onClick={() => selectAll("footer")} className="px-4 py-2 bg-emerald-100 text-emerald-700 font-semibold rounded-xl text-sm hover:bg-emerald-200 transition-colors">
                    ✅ เลือกท้ายกระดาษทุกหน้า
                  </button>
                  <button onClick={() => deselectAll("footer")} className="px-4 py-2 bg-gray-100 text-gray-600 font-semibold rounded-xl text-sm hover:bg-gray-200 transition-colors">
                    ❌ ยกเลิกท้ายกระดาษทั้งหมด
                  </button>
                </>
              )}
            </div>

            {/* Page grid */}
            <DynDocument file={pdfFileProp} onLoadSuccess={onDocumentLoadSuccess} loading={
              <div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>
            }>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
                  const config = pageConfigs[pageNum] || { header: false, footer: false };
                  return (
                    <div key={pageNum} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden group hover:shadow-md transition-all">
                      {/* Page thumbnail */}
                      <div className="relative bg-gray-100 flex justify-center items-start">
                        <DynPage
                          pageNumber={pageNum}
                          width={180}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                        />
                        {/* Header overlay preview */}
                        {config.header && headerPreview && (
                          <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ opacity: 0.7 }}>
                            <img src={headerPreview} alt="" className="w-full" />
                          </div>
                        )}
                        {/* Footer overlay preview */}
                        {config.footer && footerPreview && (
                          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ opacity: 0.7 }}>
                            <img src={footerPreview} alt="" className="w-full" />
                          </div>
                        )}
                      </div>

                      {/* Page controls */}
                      <div className="p-3 space-y-2">
                        <p className="text-xs font-bold text-gray-500 text-center">หน้า {pageNum}</p>
                        <div className="flex gap-2">
                          {headerImage && (
                            <button
                              onClick={() => togglePage(pageNum, "header")}
                              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                config.header
                                  ? "bg-blue-500 text-white shadow-sm"
                                  : "bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
                              }`}
                            >
                              {config.header ? "✓ หัว" : "หัว"}
                            </button>
                          )}
                          {footerImage && (
                            <button
                              onClick={() => togglePage(pageNum, "footer")}
                              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                config.footer
                                  ? "bg-emerald-500 text-white shadow-sm"
                                  : "bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-600"
                              }`}
                            >
                              {config.footer ? "✓ ท้าย" : "ท้าย"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </DynDocument>

            {/* Navigation */}
            <div className="flex justify-between pt-4">
              <button onClick={() => setStep(1)} className="px-6 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm shadow-sm">
                ← ย้อนกลับ
              </button>
              <button
                disabled={!hasAnySelection || isGenerating}
                onClick={generatePdf}
                className="px-8 py-3 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-200 text-sm flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    กำลังสร้าง PDF...
                  </>
                ) : (
                  "สร้าง PDF →"
                )}
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════ STEP 3: Download ════════════════════════ */}
        {step === 3 && finalPdfUrl && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 mb-2">ขั้นตอนที่ 3: ดาวน์โหลด</h2>
              <p className="text-gray-500">สร้างไฟล์ PDF เรียบร้อยแล้ว ดาวน์โหลดได้เลย</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 flex flex-col items-center gap-4">
              <div className="text-6xl">✅</div>
              <p className="font-bold text-gray-700">{pdfFile?.name}</p>
              <p className="text-sm text-gray-400">พร้อมดาวน์โหลด</p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4">
              <button
                onClick={() => { if (finalPdfUrl) URL.revokeObjectURL(finalPdfUrl); setFinalPdfUrl(""); setStep(2); }}
                className="px-6 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm shadow-sm"
              >
                ← กลับไปแก้ไข
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    // Reset everything — revoke object URLs first
                    if (finalPdfUrl) URL.revokeObjectURL(finalPdfUrl);
                    if (headerPreview) URL.revokeObjectURL(headerPreview);
                    if (footerPreview) URL.revokeObjectURL(footerPreview);
                    configsInitializedRef.current = false;
                    setPdfFile(null); setPdfBytes(null);
                    setHeaderImage(null); setFooterImage(null);
                    setHeaderPreview(""); setFooterPreview("");
                    setHeaderHeightPercent(DEFAULT_HEIGHT_PERCENT);
                    setFooterHeightPercent(DEFAULT_HEIGHT_PERCENT);
                    setFinalPdfUrl(""); setNumPages(0);
                    setPageConfigs({});
                    setStep(1);
                  }}
                  className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm shadow-sm"
                >
                  🔄 เริ่มใหม่
                </button>
                <a
                  href={finalPdfUrl}
                  download={pdfFile ? `${pdfFile.name.replace(".pdf", "")}_with_header_footer.pdf` : "output.pdf"}
                  className="px-8 py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-200 text-sm flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  ดาวน์โหลด PDF
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
