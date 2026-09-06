"use client";

/**
 * PdfPreviewWrapper — the ONLY entry point into the interactive preview.
 *
 * react-pdf must never render on the server: pdf.js reaches for `DOMMatrix`,
 * which Node does not have. The wrapper-file pattern (modelled on
 * `app/document/[id]/PdfViewerWrapper.tsx`) keeps that boundary in one place —
 * this file does the `dynamic(..., { ssr: false })`, and `PdfPreviewClient` is
 * therefore free to use plain static `import { Document, Page, pdfjs } from
 * "react-pdf"` and to import react-pdf's AnnotationLayer.css / TextLayer.css,
 * neither of which survives an inline `dynamic(...)` in the consuming page.
 *
 * It is also the mocking seam: a jsdom component test mocks THIS module and
 * never pulls react-pdf into the graph.
 */

import dynamic from "next/dynamic";
import type { PdfPreviewProps } from "./previewTypes";

const PdfPreviewClient = dynamic(() => import("./PdfPreviewClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-96 w-full flex-col items-center justify-center gap-3 text-gray-500">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500" />
      <p className="text-sm">กำลังเตรียมเครื่องมือแก้ไข PDF...</p>
    </div>
  ),
});

export default function PdfPreviewWrapper(props: PdfPreviewProps) {
  return <PdfPreviewClient {...props} />;
}
