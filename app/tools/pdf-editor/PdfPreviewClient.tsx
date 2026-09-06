"use client";

/**
 * PdfPreviewClient — the browser-only half of the preview.
 *
 * Reached only through `PdfPreviewWrapper`, which wraps it in
 * `dynamic(..., { ssr: false })`. That is why this file can use plain static
 * `import { Document, Page, pdfjs } from "react-pdf"` and can import
 * react-pdf's AnnotationLayer.css / TextLayer.css, neither of which survives an
 * inline `dynamic()` call in a consuming page.
 *
 * ==========================================================================
 * THE ARRAYBUFFER DETACHMENT DISCIPLINE — THE POINT OF THIS FILE
 * ==========================================================================
 * pdf.js TRANSFERS the ArrayBuffer it is handed to its worker thread. Once
 * transferred the main-thread view is DETACHED: `byteLength` reads 0 and any
 * further use throws
 *     "Cannot perform Construct on a detached ArrayBuffer".
 * pdf-lib reads the master bytes again, much later, when the admin presses
 * download — potentially an hour of work after the preview ran. So:
 *
 *   • This module is the ONLY code in the feature that hands bytes to
 *     `<Document>`. Nothing else may.
 *   • What it hands over is always a disposable `.slice(0)` COPY, never the
 *     caller's master bytes.
 *   • The copy is regenerated on EVERY MOUNT, keyed on
 *     `(sourceId, previewEpoch, retry)` — not once per upload. An editor
 *     re-renders continuously and remounts far more often than an upload flow
 *     does, which is exactly why "copy once per file" is not good enough.
 *   • If a load still fails on a detached buffer (a remount that reused a
 *     memoised object), `retry` is bumped and a genuinely fresh copy is made.
 *     That is bounded, so a real parse failure cannot spin.
 *
 * pdfjs here is strictly READ-ONLY: parse, render, measure, extract. Nothing in
 * this directory writes a PDF; pdf-lib does that once, on download, from the
 * untouched master bytes plus the plain-JSON edit model.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import type { Annotation, DocPage, PageId, SourceId } from "@/app/lib/pdfTypes";
import PageOverlay from "./PageOverlay";
import PageThumbnailStrip from "./PageThumbnailStrip";
import { normalizeQuarterTurn } from "@/app/lib/pdfCoords";
import type { PdfPageLike, PdfPreviewProps, PdfPreviewSource } from "./previewTypes";

/**
 * The worker MUST be same-origin. `next.config.ts` ships an ENFORCING
 * Content-Security-Policy with `script-src 'self'` / `worker-src 'self' blob:`,
 * so a CDN worker URL is blocked outright and the preview simply never loads.
 * `new URL(..., import.meta.url)` makes the bundler emit it as an asset of this
 * app.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** Bounded so a genuinely corrupt file cannot spin re-slicing forever. */
const MAX_RELOAD_RETRIES = 2;

const PASSWORD_MESSAGE =
  "ไฟล์นี้ถูกล็อกด้วยรหัสผ่าน จึงเปิดแก้ไขไม่ได้ กรุณาปลดรหัสผ่านออกจากไฟล์ก่อนแล้วอัปโหลดใหม่";
const GENERIC_LOAD_MESSAGE =
  "เปิดไฟล์ PDF นี้ไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ไฟล์ PDF ที่ถูกต้อง";

/* -------------------------------------------------------------------------- */
/* Byte handling                                                              */
/* -------------------------------------------------------------------------- */

/** Reads 0 for a buffer pdf.js has already detached — which is the signal. */
function byteLengthOf(bytes: Uint8Array | ArrayBuffer): number {
  return bytes.byteLength;
}

/**
 * A genuinely independent copy of the master bytes.
 *
 * `Uint8Array.prototype.slice` allocates a new backing ArrayBuffer (unlike
 * `subarray`, which would share one and therefore be detached along with it),
 * and it honours `byteOffset`, so a view into a larger buffer copies correctly.
 */
function freshSlice(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0));
  return bytes.slice(0);
}

/* -------------------------------------------------------------------------- */
/* One <Document> per source, purely to obtain a PDFDocumentProxy              */
/* -------------------------------------------------------------------------- */

/**
 * A merged document draws pages from more than one file, in an order react-pdf
 * cannot express with a single `<Document>` + children. So each source gets its
 * own headless `<Document>` whose only job is to yield a `PDFDocumentProxy`;
 * the visible `<Page pdf={proxy} />` elements then render in MODEL order,
 * independent of which file each page came from.
 */
function SourceLoader({
  source,
  previewEpoch,
  onProxy,
  onError,
}: {
  source: PdfPreviewSource;
  previewEpoch: number;
  onProxy: (sourceId: SourceId, pdf: PDFDocumentProxy | null) => void;
  onError: (sourceId: SourceId, message: string) => void;
}) {
  const [retry, setRetry] = useState(0);
  const passwordSeenRef = useRef(false);
  const masterLength = byteLengthOf(source.bytes);

  // The disposable copy. Keyed on (sourceId, previewEpoch, retry) so a new
  // upload, a structural model change, or a failed remount each produce fresh
  // bytes — while an ordinary re-render does not, which would otherwise reload
  // the document on every keystroke.
  const file = useMemo(() => {
    if (masterLength === 0) return null;
    try {
      return { data: freshSlice(source.bytes) };
    } catch {
      // Only reachable if the MASTER buffer was detached by someone else —
      // i.e. somebody outside this file handed it to pdf.js. Fail loudly.
      return null;
    }
    // `source.bytes` is intentionally not a dependency: it is the master, and
    // the whole point of `previewEpoch` is that the owner tells us when it has
    // meaningfully changed. Re-slicing on identity alone would reload the
    // document constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.sourceId, previewEpoch, retry, masterLength]);

  useEffect(() => {
    passwordSeenRef.current = false;
  }, [source.sourceId, previewEpoch, retry]);

  useEffect(() => {
    if (file === null && masterLength > 0) {
      onError(source.sourceId, GENERIC_LOAD_MESSAGE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, masterLength, source.sourceId]);

  // Release the proxy when this source goes away, so a removed merge source
  // does not leave stale pages renderable.
  useEffect(() => {
    const id = source.sourceId;
    return () => onProxy(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.sourceId]);

  if (!file) return null;

  return (
    <Document
      key={`${source.sourceId}#${previewEpoch}#${retry}`}
      file={file}
      loading={null}
      error={null}
      noData={null}
      onLoadSuccess={(pdf) => onProxy(source.sourceId, pdf)}
      onPassword={(callback) => {
        // pdf-lib 1.17.1 cannot decrypt, and `ignoreEncryption` only suppresses
        // the throw while handing back ciphertext that renders as garbage. So
        // there is no half-open path worth offering: refuse the file.
        passwordSeenRef.current = true;
        callback(null);
      }}
      onLoadError={(error) => {
        const message = String(
          (error as { message?: unknown } | null)?.message ?? error ?? "",
        );
        if (passwordSeenRef.current || /password/i.test(message)) {
          onError(source.sourceId, PASSWORD_MESSAGE);
          return;
        }
        // The detachment signature. A remount that reused an already-transferred
        // copy lands here; one more genuinely fresh slice fixes it.
        if (/detached/i.test(message) && retry < MAX_RELOAD_RETRIES) {
          setRetry((r) => r + 1);
          return;
        }
        onError(source.sourceId, GENERIC_LOAD_MESSAGE);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* One rendered page + its interaction overlay                                */
/* -------------------------------------------------------------------------- */

function PageFrame({
  page,
  pageNumber,
  proxy,
  zoom,
  annotations,
  assetUrls,
  tool,
  selectedAnnotationId,
  isActive,
  disabled,
  index,
  onSelectPage,
  onSelectAnnotation,
  onCreateRect,
  onCommitRect,
  onTextUnavailable,
}: {
  page: DocPage;
  pageNumber: number;
  proxy: PDFDocumentProxy | undefined;
  zoom: number;
  annotations: Annotation[];
  assetUrls: Readonly<Record<string, string>>;
  tool: PdfPreviewProps["tool"];
  selectedAnnotationId: string | null;
  isActive: boolean;
  disabled: boolean;
  index: number;
  onSelectPage: (id: PageId) => void;
  onSelectAnnotation: (id: string | null) => void;
  onCreateRect: PdfPreviewProps["onCreateRect"];
  onCommitRect: PdfPreviewProps["onCommitRect"];
  onTextUnavailable?: (id: PageId) => void;
}) {
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);

  // pdfjs builds its viewport from this number and THROWS on anything that is
  // not a quarter turn — which takes down the whole preview, not just this
  // page. Normalising here is the last line of defence.
  const rotation = normalizeQuarterTurn(page.baseRotation + page.addedRotation);

  if (!proxy) {
    return (
      <div className="flex h-72 w-full max-w-2xl items-center justify-center rounded bg-white text-sm text-gray-400 shadow">
        กำลังโหลดหน้า {index + 1}...
      </div>
    );
  }

  return (
    <div
      className={`relative shadow-lg ${isActive ? "ring-2 ring-blue-500" : ""}`}
      // Capture phase: the overlay stops propagation on its own children, so a
      // bubbling handler would never see a click that lands on an annotation.
      onPointerDownCapture={() => onSelectPage(page.id)}
      data-pdf-page-frame={page.id}
    >
      <Page
        pdf={proxy}
        pageNumber={pageNumber}
        scale={zoom}
        rotate={rotation}
        // Both layers are off on purpose. Click-to-snap reads pdfjs's
        // `getTextContent()` off the page proxy directly, so the rendered text
        // layer buys nothing — and being an absolutely-positioned sibling that
        // swallows pointer events, it would fight the overlay's drag gestures
        // for every word the cursor crosses.
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onLoadSuccess={(p) => setPageProxy(p)}
        className="bg-white"
        loading={
          <div className="flex h-72 w-152 max-w-full items-center justify-center bg-white text-sm text-gray-400">
            กำลังแสดงหน้า {index + 1}...
          </div>
        }
        error={
          <div className="flex h-72 w-152 max-w-full items-center justify-center bg-white text-sm text-red-500">
            แสดงหน้า {index + 1} ไม่ได้
          </div>
        }
      />

      <PageOverlay
        pageId={page.id}
        widthPt={page.widthPt}
        heightPt={page.heightPt}
        rotation={rotation}
        annotations={annotations}
        assetUrls={assetUrls}
        tool={tool}
        selectedAnnotationId={selectedAnnotationId}
        pageProxy={pageProxy as unknown as PdfPageLike | null}
        disabled={disabled}
        onSelectAnnotation={onSelectAnnotation}
        onCreateRect={onCreateRect}
        onCommitRect={onCommitRect}
        onTextUnavailable={onTextUnavailable}
      />

      <div className="pointer-events-none absolute -top-6 left-0 text-xs text-gray-500">
        หน้า {index + 1}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The preview                                                                */
/* -------------------------------------------------------------------------- */

export default function PdfPreviewClient({
  sources,
  pages,
  annotations,
  assetUrls,
  previewEpoch,
  tool,
  zoom,
  activePageId,
  selectedAnnotationId,
  showThumbnails = true,
  disabled = false,
  onSelectPage,
  onSelectAnnotation,
  onCreateRect,
  onCommitRect,
  onMovePage,
  onRotatePage,
  onDeletePage,
  onTextUnavailable,
  onSourceLoad,
  onSourceError,
}: PdfPreviewProps) {
  const [proxies, setProxies] = useState<Record<string, PDFDocumentProxy>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A different file must not inherit the previous one's state, or annotations
  // end up stranded on page 7 of a 3-page document. Every epoch bump wipes the
  // per-source caches back to empty.
  //
  // Done during render — React's documented "adjust state when a prop changes"
  // pattern — rather than in an effect, so the stale proxies are never painted
  // for one frame and no cascading re-render is scheduled.
  const [seenEpoch, setSeenEpoch] = useState(previewEpoch);
  if (seenEpoch !== previewEpoch) {
    setSeenEpoch(previewEpoch);
    setProxies({});
    setErrors({});
  }

  const handleProxy = useCallback(
    (sourceId: SourceId, pdf: PDFDocumentProxy | null) => {
      setProxies((prev) => {
        if (!pdf) {
          if (!(sourceId in prev)) return prev;
          const next = { ...prev };
          delete next[sourceId];
          return next;
        }
        if (prev[sourceId] === pdf) return prev;
        return { ...prev, [sourceId]: pdf };
      });
      setErrors((prev) => {
        if (!pdf || !(sourceId in prev)) return prev;
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
      if (pdf) onSourceLoad?.(sourceId, pdf.numPages);
    },
    [onSourceLoad],
  );

  const handleError = useCallback(
    (sourceId: SourceId, message: string) => {
      setErrors((prev) =>
        prev[sourceId] === message ? prev : { ...prev, [sourceId]: message },
      );
      onSourceError?.(sourceId, message);
    },
    [onSourceError],
  );

  /** Annotation array order IS z-order, so the per-page buckets preserve it. */
  const byPage = useMemo(() => {
    const map = new Map<PageId, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.pageId);
      if (list) list.push(a);
      else map.set(a.pageId, [a]);
    }
    return map;
  }, [annotations]);

  const errorList = useMemo(() => Object.entries(errors), [errors]);

  return (
    <div className="flex h-full min-h-0 w-full bg-gray-200">
      {/* Headless loaders. They render nothing; they exist to produce proxies. */}
      <div hidden aria-hidden="true">
        {sources.map((s) => (
          <SourceLoader
            key={s.sourceId}
            source={s}
            previewEpoch={previewEpoch}
            onProxy={handleProxy}
            onError={handleError}
          />
        ))}
      </div>

      {showThumbnails && (
        <aside className="hidden w-40 shrink-0 border-r border-gray-300 bg-white md:block">
          <PageThumbnailStrip
            pages={pages}
            proxies={proxies}
            activePageId={activePageId}
            disabled={disabled}
            onSelectPage={onSelectPage}
            onMovePage={onMovePage}
            onRotatePage={onRotatePage}
            onDeletePage={onDeletePage}
          />
        </aside>
      )}

      <div className="min-w-0 flex-1 overflow-auto">
        {errorList.length > 0 && (
          <div className="space-y-2 p-4">
            {errorList.map(([sourceId, message]) => (
              <div
                key={sourceId}
                role="alert"
                className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
              >
                {message}
              </div>
            ))}
          </div>
        )}

        {pages.length === 0 ? (
          <div className="flex h-full min-h-80 items-center justify-center text-sm text-gray-500">
            ยังไม่มีเอกสาร กรุณาอัปโหลดไฟล์ PDF
          </div>
        ) : (
          <div className="flex flex-col items-center gap-10 p-6 pt-10">
            {pages.map((page, index) => (
              <PageFrame
                key={page.id}
                page={page}
                index={index}
                pageNumber={page.srcIndex + 1}
                proxy={proxies[page.src]}
                zoom={zoom}
                annotations={byPage.get(page.id) ?? []}
                assetUrls={assetUrls}
                tool={tool}
                selectedAnnotationId={selectedAnnotationId}
                isActive={page.id === activePageId}
                disabled={disabled}
                onSelectPage={onSelectPage}
                onSelectAnnotation={onSelectAnnotation}
                onCreateRect={onCreateRect}
                onCommitRect={onCommitRect}
                onTextUnavailable={onTextUnavailable}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        /* Belt and braces: even if a future change turns the text or annotation
           layer back on, it must never intercept a pointer, or the overlay's
           drag gestures die the moment the cursor crosses a word. */
        [data-pdf-page-frame] .react-pdf__Page__textContent,
        [data-pdf-page-frame] .react-pdf__Page__annotations,
        [data-pdf-page-frame] .textLayer {
          pointer-events: none;
          user-select: none;
        }
        /* Deliberately NOT constraining the canvas with max-width/height:auto.
           The overlay maps pointer positions through the measured CSS box, and
           an extra CSS scale on the canvas alone would desynchronise the two.
           Oversized pages scroll instead. */
        [data-pdf-page-frame] .react-pdf__Page__canvas {
          display: block;
        }
      `}</style>
    </div>
  );
}
