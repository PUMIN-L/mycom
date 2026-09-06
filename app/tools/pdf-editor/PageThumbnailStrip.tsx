"use client";

/**
 * PageThumbnailStrip — the page rail: thumbnails, selection, drag-to-reorder,
 * per-page rotate and delete.
 *
 * The drag MECHANICS live here because they can only be hand-tested (jsdom has
 * no drag-and-drop worth the name). The RESULT is a single `movePage(from, to)`
 * call into Group A's pure, unit-tested reordering function — this file never
 * reimplements the index arithmetic, it only reports the two indices.
 *
 * Only reachable through `PdfPreviewClient`, which is itself behind
 * `dynamic(..., { ssr: false })`, so the static react-pdf import is safe.
 */

import React, { useCallback, useState } from "react";
import { Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DocPage } from "@/app/lib/pdfTypes";
import { normalizeQuarterTurn } from "@/app/lib/pdfCoords";
import type { PageThumbnailStripProps } from "./previewTypes";

const THUMB_WIDTH = 118;

export default function PageThumbnailStrip({
  pages,
  proxies,
  activePageId,
  disabled = false,
  onSelectPage,
  onMovePage,
  onRotatePage,
  onDeletePage,
}: PageThumbnailStripProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const endDrag = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (to: number) => {
      const from = dragIndex;
      endDrag();
      if (from === null || from === to) return;
      if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) return;
      onMovePage(from, to);
    },
    [dragIndex, endDrag, onMovePage, pages.length],
  );

  if (pages.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-gray-400">
        ยังไม่มีหน้าเอกสาร
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 border-b border-gray-200 px-3 py-2 text-xs font-medium text-gray-600">
        หน้าเอกสาร ({pages.length})
        <span className="ml-1 font-normal text-gray-400">· ลากเพื่อสลับลำดับ</span>
      </div>

      <ul className="flex-1 space-y-2 overflow-y-auto p-3">
        {pages.map((page, index) => {
          const proxy = proxies[page.src] as PDFDocumentProxy | undefined;
          const isActive = page.id === activePageId;
          const isDragging = dragIndex === index;
          const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <li
              key={page.id}
              draggable={!disabled}
              onDragStart={(e) => {
                if (disabled) return;
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
                // Firefox refuses to start a drag without payload.
                try {
                  e.dataTransfer.setData("text/plain", String(index));
                } catch {
                  /* ignore */
                }
              }}
              onDragOver={(e) => {
                if (disabled || dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverIndex(index);
              }}
              onDragLeave={() =>
                setOverIndex((i) => (i === index ? null : i))
              }
              onDrop={(e) => {
                if (disabled) return;
                e.preventDefault();
                handleDrop(index);
              }}
              onDragEnd={endDrag}
              className={[
                "group relative rounded-lg border transition-colors",
                isActive
                  ? "border-blue-500 ring-2 ring-blue-200"
                  : "border-gray-200 hover:border-gray-300",
                isDragging ? "opacity-40" : "",
                isOver ? "border-blue-400 bg-blue-50" : "bg-white",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onSelectPage(page.id)}
                disabled={disabled}
                className="block w-full cursor-pointer p-1.5"
                aria-label={`เลือกหน้า ${index + 1}`}
                aria-current={isActive}
              >
                <div className="flex min-h-30 items-center justify-center overflow-hidden bg-gray-100">
                  <Thumbnail page={page} proxy={proxy} />
                </div>
                <div className="pt-1 text-center text-[11px] text-gray-600">
                  หน้า {index + 1}
                </div>
              </button>

              <div className="flex items-center justify-center gap-1 border-t border-gray-100 px-1 py-1">
                <IconButton
                  label="หมุนซ้าย 90°"
                  disabled={disabled}
                  onClick={() => onRotatePage(page.id, -90)}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a4 4 0 014 4v2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l4-4M3 10l4 4" />
                  </svg>
                </IconButton>
                <IconButton
                  label="หมุนขวา 90°"
                  disabled={disabled}
                  onClick={() => onRotatePage(page.id, 90)}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a4 4 0 00-4 4v2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 10l-4-4M21 10l-4 4" />
                  </svg>
                </IconButton>
                <IconButton
                  label="ลบหน้านี้"
                  danger
                  // Deleting the last remaining page would leave pdf-lib with a
                  // zero-page document, which cannot be saved.
                  disabled={disabled || pages.length <= 1}
                  onClick={() => onDeletePage(page.id)}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" />
                  </svg>
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Thumbnail({
  page,
  proxy,
}: {
  page: DocPage;
  proxy: PDFDocumentProxy | undefined;
}) {
  if (!proxy) {
    return (
      <div className="flex h-30 w-full items-center justify-center text-[10px] text-gray-400">
        กำลังโหลด...
      </div>
    );
  }
  return (
    <Page
      pdf={proxy}
      pageNumber={page.srcIndex + 1}
      width={THUMB_WIDTH}
      // pdfjs builds its viewport from this and throws if it is not a multiple
      // of 90 — which kills the whole preview, not just this thumbnail.
      rotate={normalizeQuarterTurn(page.baseRotation + page.addedRotation)}
      renderTextLayer={false}
      renderAnnotationLayer={false}
      loading={
        <div className="flex h-30 w-full items-center justify-center text-[10px] text-gray-400">
          กำลังโหลด...
        </div>
      }
      error={
        <div className="flex h-30 w-full items-center justify-center text-[10px] text-red-400">
          แสดงไม่ได้
        </div>
      }
    />
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30",
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
