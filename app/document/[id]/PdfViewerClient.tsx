"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  PDF_ZOOM_STEP,
  pdfDevicePixelRatio,
  pdfGutter,
  pdfPageWidth,
} from "../../lib/pdfViewerSizing";

// Configure PDF.js worker using Next.js App Router approach
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerClientProps {
  url: string;
}

/** A4 portrait, until the first page says otherwise. */
const DEFAULT_ASPECT = 297 / 210;

// The public catalog viewer. Each page is drawn AS WIDE AS IT IS SHOWN
// (lib/pdfViewerSizing.ts): "100%" fills the viewer's width, on a phone as on
// a desktop. It used to draw every page at scale 1.5 and shrink it with CSS:
// on a phone, canvases several times the screen, for every page at once.
//
// Only pages near the screen are drawn (LazyPage). A catalog of 40 pages
// keeps a handful of canvases alive, not 40; the rest are blank boxes of the
// right size, so the scrollbar and "page N" positions stay true.
export default function PdfViewerClient({ url }: PdfViewerClientProps) {
  const [numPages, setNumPages] = useState<number>();
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    // A phone turned sideways, a window resized: redraw at the new width.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function onDocumentLoadSuccess(pdf: PDFDocumentProxy) {
    setNumPages(pdf.numPages);
    try {
      const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (viewport.width > 0) setAspect(viewport.height / viewport.width);
    } catch {
      // Keep the A4 guess: it only sizes the boxes of pages not drawn yet.
    }
  }

  const width = pdfPageWidth(containerWidth, zoom);
  const gutter = pdfGutter(containerWidth);
  const zoomBy = (delta: number) =>
    setZoom((z) => Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, Math.round((z + delta) * 100) / 100)));

  return (
    <div className="flex flex-col h-full w-full bg-gray-200">
      {/* Viewer Toolbar */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 px-2 py-2 bg-gray-800 text-white shrink-0 shadow-md z-10 sticky top-0">
        <span className="font-mono text-xs sm:text-sm whitespace-nowrap">
          ทั้งหมด {numPages || "?"} หน้า
        </span>

        <div className="w-px h-6 bg-gray-600 mx-1 sm:mx-2" />

        <button
          onClick={() => zoomBy(-PDF_ZOOM_STEP)}
          disabled={zoom <= PDF_ZOOM_MIN}
          className="min-w-9 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-40"
          title="ซูมออก"
          aria-label="ซูมออก"
        >
          -
        </button>
        {/* 100% = the page fills the viewer's width. Tapping it goes back there. */}
        <button
          onClick={() => setZoom(1)}
          className="font-mono text-xs sm:text-sm min-w-14 text-center rounded hover:bg-gray-700 py-1"
          title="พอดีความกว้าง"
          aria-label={`ขนาด ${Math.round(zoom * 100)}% — แตะเพื่อกลับเป็นพอดีความกว้าง`}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => zoomBy(PDF_ZOOM_STEP)}
          disabled={zoom >= PDF_ZOOM_MAX}
          className="min-w-9 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-40"
          title="ซูมเข้า"
          aria-label="ซูมเข้า"
        >
          +
        </button>
      </div>

      {/* Main PDF Canvas — block, not flex + justify-center: a page zoomed
          wider than the viewer would overflow BOTH sides of a centred flex
          item, and its left part could never be scrolled to. */}
      <div ref={scrollerRef} className="flex-1 overflow-auto custom-scrollbar pb-24" style={{ paddingTop: gutter }}>
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3 w-full">
              <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              <p>กำลังโหลดเอกสาร...</p>
            </div>
          }
          error={
            <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-3 w-full">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <p>ไม่สามารถโหลดเอกสารได้</p>
            </div>
          }
          className="flex flex-col gap-4 sm:gap-8 items-center w-fit min-w-full mx-auto"
        >
          {width !== null &&
            Array.from(new Array(numPages || 0), (_, index) => (
              <LazyPage
                key={`page_${index + 1}`}
                pageNumber={index + 1}
                width={width}
                aspect={aspect}
                gutter={gutter}
                scrollerRef={scrollerRef}
              />
            ))}
        </Document>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(107, 114, 128, 0.8); }
      `}</style>
    </div>
  );
}

/**
 * One page: drawn while it is within about a screen and a half of the
 * viewport, a blank box of the same size otherwise. Leaving the range drops
 * the canvas again — that is what keeps a long catalog light on a phone.
 *
 * The box is sized by page 1's proportions until this page has loaded once,
 * then by its OWN, kept after the canvas is dropped. With page 1's alone, a
 * landscape page in a portrait catalog sat in a box far too tall, and a page
 * taller than page 1 shrank back when dropped above the screen — jerking
 * everything below it up.
 */
function LazyPage({
  pageNumber,
  width,
  aspect,
  gutter,
  scrollerRef,
}: {
  pageNumber: number;
  width: number;
  aspect: number;
  gutter: number;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ownAspect, setOwnAspect] = useState<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: scrollerRef.current, rootMargin: "150% 0px" }
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [scrollerRef]);

  const pageAspect = ownAspect ?? aspect;
  const height = Math.round(width * pageAspect);
  return (
    <div
      ref={boxRef}
      id={`pdf-page-${pageNumber}`}
      data-page={pageNumber}
      className="shadow-2xl bg-white"
      style={{ width, minHeight: height, marginLeft: gutter, marginRight: gutter }}
    >
      {near && (
        <Page
          pageNumber={pageNumber}
          width={width}
          devicePixelRatio={pdfDevicePixelRatio(width, pageAspect, typeof window === "undefined" ? 1 : window.devicePixelRatio)}
          onLoadSuccess={(page) => {
            if (page.originalWidth > 0) setOwnAspect(page.originalHeight / page.originalWidth);
          }}
          renderTextLayer={true}
          renderAnnotationLayer={true}
          className="bg-white"
        />
      )}
    </div>
  );
}
