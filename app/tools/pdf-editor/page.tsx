"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import ConfirmDialog from "../../components/ConfirmDialog";
import ErrorModal from "../../components/ErrorModal";
import { useLeaveGuard, LeaveGuardModal } from "../../components/LeaveGuard";
import PdfEditorToolbar, {
  type EditorTool,
  type TextStyle,
} from "./PdfEditorToolbar";
import PdfFormPanel from "./PdfFormPanel";
import PdfEditorGuidePanel from "./PdfEditorGuidePanel";
import PdfPreviewWrapper from "./PdfPreviewWrapper";
import SignaturePad from "./SignaturePad";
import { useEditorStore } from "./useEditorStore";
import type {
  DrawableTool,
  PdfPreviewSource,
  RectOrigin,
  SignatureResult,
  SnapSample,
} from "./previewTypes";
import {
  addAnnotation,
  createModel,
  deleteAnnotation,
  deletePage as deletePageInModel,
  mergeSource,
  movePage,
  movePageById,
  nextId,
  normalizeRotation,
  rotatePage,
  setFlattenForm,
  setFormValue,
  splitSelection as splitPagesOutOfModel,
  updateAnnotation,
  type SourcePageSpec,
} from "../../lib/pdfEditModel";
import {
  MAX_PAGES,
  MAX_PDF_MB,
  validateImageUpload,
  validatePdfUpload,
  validatePageCount,
} from "../../lib/pdfValidate";
import {
  disposableCopy,
  indexOfAscii,
  sniffImageKind,
  toBytes,
  type ByteSource,
  type ImageKind,
} from "../../lib/pdfBytes";
import type { Point } from "../../lib/pdfCoords";
import type { FormFieldInfo } from "../../lib/pdfFormFill";
import type {
  Annotation,
  AssetId,
  DocPage,
  EditModel,
  PageId,
  Rect,
  SourceId,
  TextAnnotation,
} from "../../lib/pdfTypes";

/**
 * The general PDF editor. Replaces the old three-step header/footer wizard at
 * /tools/pdf-header-footer (deleted in the same change; that path now
 * redirects here from next.config.ts).
 *
 * NOTHING LEAVES THE BROWSER. No API route, no Cloudinary, no database — the
 * file is read into memory, edited as plain JSON, written back out with pdf-lib
 * and handed to a download. That is why there is no "save" anywhere in this UI,
 * and why LeaveGuard matters more here than on a form page: an hour of
 * un-downloaded annotations is gone for good on a refresh.
 *
 * THE TWO LIBRARIES NEVER MEET.
 *   pdfjs (via react-pdf, inside `PdfPreviewWrapper`) is strictly READ-ONLY —
 *   parse, render, measure, extract.
 *   pdf-lib is strictly WRITE-ONLY — `applyEdits`, called exactly once, on
 *   download. (`pdfFormFill.openPdfDocument` is the one narrow exception: page
 *   geometry and the AcroForm field list have to be read from somewhere, and
 *   reading them there keeps pdfjs out of this file entirely.)
 * Between them sits `EditModel`, plain JSON that neither library knows about.
 * That separation is what makes the ArrayBuffer detachment hazard structural
 * rather than accidental: pdfjs TRANSFERS (and therefore detaches) any buffer
 * it is handed, so the canonical source bytes in the store are never given to
 * it — only disposable copies from `getSourceCopy()`, remade whenever
 * `previewEpoch` changes. See useEditorStore.ts for the full argument.
 *
 * WHY A MODEL RATHER THAN MUTATING BYTES AS YOU GO: the admin has to be able to
 * place ten things, change his mind, undo, and only then press download. Bytes
 * cannot be un-drawn.
 *
 * PASSWORD PROTECTION IS NOT A FEATURE HERE AND IS NOT COMING. The owner cut it
 * ("เรื่อง pdf รหัสผ่าน/ห้ามคัดลอกไม่ได้. ไม่ต้องทำ"), so there is no padlock,
 * no protection tab and no `protect` field in the model. The related constraint
 * IS enforced, though: pdf-lib 1.17.1 cannot DECRYPT, so an encrypted upload is
 * refused outright with a Thai message telling the admin to remove the password
 * first. Half-opening one and handing him a broken download would be worse than
 * refusing it.
 *
 * REDACTION IS CUT TOO. "ทับขาว" covers text, it does not remove it, and the
 * guide says so in as many words.
 */

const DEFAULT_TEXT_STYLE: TextStyle = {
  sizePt: 16,
  bold: false,
  color: { r: 0, g: 0, b: 0 },
  angleDeg: 0,
  align: "left",
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

const ENCRYPTED_MESSAGE =
  "ไฟล์นี้ตั้งรหัสผ่านไว้ จึงเปิดแก้ไขที่นี่ไม่ได้\n\n" +
  "กรุณาเอารหัสผ่านออกจากไฟล์ก่อน แล้วค่อยอัปโหลดใหม่ — เปิดไฟล์ด้วยโปรแกรมอ่าน PDF " +
  "ใส่รหัสผ่านให้ถูกต้อง แล้วสั่ง “พิมพ์เป็น PDF” (Print to PDF) หรือลบรหัสผ่านใน Adobe Acrobat\n\n" +
  "ที่ระบบไม่ยอมเปิดให้ ไม่ใช่เพราะไฟล์เสีย แต่เพราะถ้าฝืนเปิดจะได้ไฟล์ที่อ่านไม่ออกกลับไป";

/**
 * What "unsaved" means for a tool with no save button: the annotations, the
 * form values and the page arrangement. Deliberately NOT the whole model —
 * merely opening a file must not immediately read as dirty, and the page
 * geometry that came out of the reader is not something the admin typed.
 */
function dirtyKey(model: EditModel): string {
  return JSON.stringify({
    annotations: model.annotations,
    formValues: model.formValues,
    flattenForm: model.flattenForm,
    order: model.pages.map((page) => `${page.id}:${page.addedRotation}`),
  });
}

/** Measure a bitmap the browser has already decoded, so a placed image keeps
 *  its aspect ratio instead of being squashed into a default box. */
function measureImage(url: string): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ widthPx: image.naturalWidth, heightPx: image.naturalHeight });
    image.onerror = () => reject(new Error("decode-failed"));
    image.src = url;
  });
}

/**
 * Centre a bitmap on a page at a sane default size (40% of the page width,
 * aspect preserved, never taller than half the page). The admin then drags it
 * where he wants with the select tool — a deterministic starting rect beats
 * guessing at intent. Points, bottom-left origin, unrotated: PDF user space.
 *
 * `origin` IS LOAD-BEARING. `page.widthPt`/`heightPt` are the CropBox's SIZE,
 * but a rect handed to pdf-lib is in absolute user space, and a print-ready PDF
 * with bleed has a CropBox that starts at, say, (36, 36). Centring on
 * `(0, 0)-(widthPt, heightPt)` on such a page puts the picture half an inch
 * down and to the left of where the admin is looking — the exact class of
 * silent misplacement `pdfCoords` exists to prevent on the drag path. Every
 * other placement in this file goes through the viewport matrix (which bakes
 * the origin in); this one does not, so it has to add the offset itself.
 */
function defaultImageRect(
  page: DocPage,
  widthPx: number,
  heightPx: number,
  origin: Point = { x: 0, y: 0 }
): Rect {
  const aspect = heightPx > 0 && widthPx > 0 ? heightPx / widthPx : 1;
  let width = page.widthPt * 0.4;
  let height = width * aspect;
  const maxHeight = page.heightPt * 0.5;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  return {
    x: origin.x + (page.widthPt - width) / 2,
    y: origin.y + (page.heightPt - height) / 2,
    width,
    height,
  };
}

/** The key a page's CropBox origin is remembered under. `srcIndex` refers to
 *  the ORIGINAL file, so the entry survives reorder, delete, merge and undo. */
function originKey(src: SourceId, srcIndex: number): string {
  return `${src}#${srcIndex}`;
}

/** Keep a dragged image box's aspect ratio: the admin's rectangle sets the
 *  available space, the bitmap is fitted inside it and centred. */
function fitRect(rect: Rect, widthPx: number, heightPx: number): Rect {
  if (widthPx <= 0 || heightPx <= 0 || rect.width <= 0 || rect.height <= 0) return rect;
  const aspect = heightPx / widthPx;
  let width = rect.width;
  let height = width * aspect;
  if (height > rect.height) {
    height = rect.height;
    width = height / aspect;
  }
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

/**
 * The ONE place a PDF is read.
 *
 * There is no pdfjs here on purpose: pdfjs lives behind the preview's ssr:false
 * boundary, and dragging it into the page shell is how `DOMMatrix is not
 * defined` gets into a jsdom test. pdf-lib is loaded lazily by
 * `openPdfDocument`, so the ~400KB library still stays out of the first paint.
 *
 * `getCropBox()` rather than `getSize()`: the model's `widthPt`/`heightPt` are
 * the UNROTATED, crop-relative box — `getSize()` reports the MediaBox and
 * ignores both /Rotate and the CropBox, which is the same trap `pdfApplyEdits`
 * warns about at the other end of the pipeline.
 */
async function readPdfSource(bytes: Uint8Array): Promise<{
  specs: SourcePageSpec[];
  /** Each page's CropBox ORIGIN, parallel to `specs`. The model carries only
   *  the box's size, but a rect drawn without the viewport matrix (the centred
   *  default for a picture) needs the offset too — see `defaultImageRect`. */
  origins: Point[];
  fields: FormFieldInfo[];
  isXfa: boolean;
}> {
  const { openPdfDocument, hasXfaEntry, listFormFields } = await import(
    "../../lib/pdfFormFill"
  );
  const doc = await openPdfDocument(bytes);
  // MUST be asked before anything calls getForm(), which deletes the entry.
  const isXfa = await hasXfaEntry(doc);

  const specs: SourcePageSpec[] = [];
  const origins: Point[] = [];
  for (const page of doc.getPages()) {
    const crop = page.getCropBox();
    specs.push({
      widthPt: crop.width,
      heightPt: crop.height,
      baseRotation: normalizeRotation(page.getRotation().angle),
    });
    origins.push({ x: crop.x, y: crop.y });
  }

  // Listing fields re-parses the file, so it is skipped entirely for the
  // ordinary case — a scanned or flattened document with no /AcroForm at all,
  // which is most of what an admin here opens.
  let fields: FormFieldInfo[] = [];
  if (!isXfa && indexOfAscii(bytes, "/AcroForm") >= 0) {
    try {
      fields = await listFormFields(bytes);
    } catch {
      // A form we cannot describe is not a reason to refuse the file: every
      // other tool still works on it. The panel says "no fields" instead.
      fields = [];
    }
  }

  return { specs, origins, fields, isXfa };
}

/** Is this a Thai message one of our own layers wrote? Those are safe to show
 *  verbatim; a raw pdf-lib string in English is not. */
function thaiMessageOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return /[฀-๿]/.test(error.message) ? error.message : null;
}

interface PendingConfirm {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
}

/** An in-progress piece of text: either brand new (`editingId === null`) or an
 *  existing annotation being retyped. */
interface TextDraft {
  pageId: PageId;
  rect: Rect;
  value: string;
  sizePt: number;
  angleDeg: number;
  editingId: string | null;
}

export default function PdfEditorPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();

  const store = useEditorStore();
  const {
    model,
    apply,
    undo,
    redo,
    canUndo,
    canRedo,
    hasDocument,
    previewEpoch,
    loadDocument,
    addSource,
    getSourceCopy,
    sources,
    assets,
    addAsset,
    assetUrls,
    createTrackedUrl,
    releaseTrackedUrl,
    reset,
  } = store;

  const [tool, setTool] = useState<EditorTool>("select");
  const [textStyle, setTextStyle] = useState<TextStyle>(DEFAULT_TEXT_STYLE);
  const [selectedPageId, setSelectedPageId] = useState<PageId | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<FormFieldInfo[]>([]);
  const [isXfa, setIsXfa] = useState(false);
  const [fileName, setFileName] = useState("");
  const [splitIds, setSplitIds] = useState<Set<PageId>>(() => new Set());
  const [zoom, setZoom] = useState(1);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const [isParsing, setIsParsing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Real <input type="file"> elements behind refs. The tool this replaced built
  // an input with document.createElement() on every click and threw it away —
  // it was also the only page in the whole app/ tree calling alert() outside
  // modals/. Both are gone: feedback here is Toast / ConfirmDialog / ErrorModal
  // like everywhere else in the admin UI.
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const lastDownloadUrlRef = useRef<string | null>(null);
  /** Where the next bitmap should land, when the admin dragged a box for it
   *  rather than just arming the tool. Consumed once. */
  const pendingRectRef = useRef<{ pageId: PageId; rect: Rect } | null>(null);
  /** Pages already reported as "no extractable text", so the toast fires once. */
  const scannedPagesRef = useRef<Set<PageId>>(new Set());
  /** `src#srcIndex` -> that page's CropBox origin. Out of the model on purpose:
   *  it is geometry read off the file, not something the admin can edit, and it
   *  must not sit in the undo history. */
  const cropOriginsRef = useRef<Map<string, Point>>(new Map());

  const {
    setSnapshot,
    guardedNavigate,
    showModal: showLeaveModal,
    confirmLeave,
    cancelLeave,
  } = useLeaveGuard(dirtyKey(model));

  // ── auth gate ──────────────────────────────────────────────────────────
  // Copied unchanged from the page this replaces, and deliberately NOT
  // extracted into a shared useRequireAuth hook: twelve admin pages carry this
  // exact pattern, and turning that into a refactor would make this diff about
  // something other than the PDF editor. The early return below is the
  // load-bearing half — without it the editor paints for a frame before the
  // redirect lands.
  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, authLoading, router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * A page can vanish out from under the selection — delete, split, the undo of
   * a merge. The active page is therefore DERIVED rather than corrected in an
   * effect: falling back to the first page keeps every page-scoped control live
   * instead of silently disabling itself with no explanation, and doing it
   * during render means no extra pass where the UI briefly points at a page
   * that no longer exists.
   */
  const activePageId = useMemo<PageId | null>(() => {
    if (model.pages.length === 0) return null;
    if (selectedPageId && model.pages.some((page) => page.id === selectedPageId)) {
      return selectedPageId;
    }
    return model.pages[0].id;
  }, [model.pages, selectedPageId]);

  const selectedPage = useMemo(
    () => model.pages.find((page) => page.id === activePageId) ?? null,
    [model.pages, activePageId]
  );
  const selectedPageNumber = selectedPage
    ? model.pages.findIndex((page) => page.id === selectedPage.id) + 1
    : 0;

  const selectedAnnotation = useMemo(
    () => model.annotations.find((a) => a.id === selectedAnnotationId) ?? null,
    [model.annotations, selectedAnnotationId]
  );

  const fail = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  /**
   * The bytes the preview may see: a DISPOSABLE copy per source, remade
   * whenever `previewEpoch` changes. The canonical buffers in the store are
   * never handed over — pdf.js transfers what it is given and detaches it, and
   * pdf-lib has to read those same bytes again on download.
   */
  const sourceIdsKey = useMemo(
    () => Array.from(new Set(model.pages.map((page) => page.src))).join("|"),
    [model.pages]
  );

  const previewSources = useMemo<PdfPreviewSource[]>(() => {
    const out: PdfPreviewSource[] = [];
    for (const sourceId of sourceIdsKey ? sourceIdsKey.split("|") : []) {
      const bytes = getSourceCopy(sourceId);
      if (bytes) out.push({ sourceId, bytes });
    }
    return out;
    // `getSourceCopy` is stable; the epoch is the signal that new bytes exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdsKey, previewEpoch]);

  // ── uploads ────────────────────────────────────────────────────────────

  const readBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

  const handlePdfUpload = useCallback(
    async (file: File) => {
      setIsParsing(true);
      try {
        const bytes = await readBytes(file);

        // Size, then magic bytes, then encryption — all in pdfValidate, which
        // owns the limits AND their Thai wording. An encrypted file is refused
        // here, before anything else touches it: pdf-lib 1.17.1 cannot decrypt,
        // and `ignoreEncryption` only suppresses the throw while handing back
        // ciphertext that renders as garbage.
        const verdict = validatePdfUpload({ size: file.size, bytes });
        if (!verdict.ok) {
          fail(verdict.code === "encrypted" ? ENCRYPTED_MESSAGE : verdict.errorTh ?? "");
          return;
        }

        const sourceId = nextId("src");
        const { specs, origins, fields, isXfa: xfa } = await readPdfSource(bytes);

        if (specs.length === 0) {
          fail("อ่านไฟล์นี้ไม่สำเร็จ — ไม่พบหน้าใด ๆ ในไฟล์ อาจเป็นไฟล์เสียหรือไม่ใช่ PDF จริง");
          return;
        }
        const pageVerdict = validatePageCount(specs.length);
        if (!pageVerdict.ok) {
          fail(
            `${pageVerdict.errorTh}\nไฟล์นี้มี ${specs.length} หน้า\n` +
              "ลองแยกไฟล์ให้เล็กลงก่อนแล้วค่อยนำมาแก้ทีละส่วน"
          );
          return;
        }

        // A NEW UPLOAD RESETS EVERYTHING — history, both byte maps, every
        // object URL. Carrying anything across is how an annotation ends up
        // stranded on page 7 of a 3-page document.
        const nextModel = createModel(sourceId, specs);
        loadDocument(sourceId, bytes, nextModel);

        const nextOrigins = new Map<string, Point>();
        origins.forEach((origin, index) =>
          nextOrigins.set(originKey(sourceId, index), origin)
        );
        cropOriginsRef.current = nextOrigins;

        setFormFields(fields);
        setIsXfa(xfa);
        setSelectedPageId(nextModel.pages[0].id);
        setSelectedAnnotationId(null);
        setSplitIds(new Set());
        setTextDraft(null);
        setTool("select");
        setFileName(file.name);
        setZoom(1);
        scannedPagesRef.current = new Set();
        lastDownloadUrlRef.current = null;
        setWarning(verdict.warningTh ?? "");
        setSnapshot(dirtyKey(nextModel));
        setToast({ message: `เปิดไฟล์แล้ว ${specs.length} หน้า`, type: "success" });
      } catch (error) {
        console.error("Failed to open PDF:", error);
        fail(
          thaiMessageOf(error) ??
            "เปิดไฟล์นี้ไม่สำเร็จ\n\nไฟล์อาจเสียหาย ไม่ใช่ PDF จริง หรือถูกป้องกันไว้ " +
              "ลองเปิดไฟล์ด้วยโปรแกรมอ่าน PDF แล้วสั่งพิมพ์เป็น PDF ใหม่ จากนั้นค่อยนำไฟล์ใหม่มาลองอีกครั้ง"
        );
      } finally {
        setIsParsing(false);
      }
    },
    [fail, loadDocument, setSnapshot]
  );

  const handleMergePdf = useCallback(
    async (file: File) => {
      setIsParsing(true);
      try {
        const bytes = await readBytes(file);
        const verdict = validatePdfUpload({ size: file.size, bytes });
        if (!verdict.ok) {
          fail(verdict.code === "encrypted" ? ENCRYPTED_MESSAGE : verdict.errorTh ?? "");
          return;
        }

        const sourceId = nextId("src");
        const { specs, origins } = await readPdfSource(bytes);
        if (specs.length === 0) {
          fail("อ่านไฟล์ที่จะนำมารวมไม่สำเร็จ — ไม่พบหน้าใด ๆ ในไฟล์");
          return;
        }
        if (model.pages.length + specs.length > MAX_PAGES) {
          fail(
            `รวมแล้วจะได้ ${model.pages.length + specs.length} หน้า ` +
              `เกินที่ระบบรับไหว (สูงสุด ${MAX_PAGES} หน้า)`
          );
          return;
        }

        // Merge KEEPS the session — the source bytes join the map, the pages
        // are appended to the model, and undo can walk the whole thing back.
        addSource(sourceId, bytes);
        origins.forEach((origin, index) =>
          cropOriginsRef.current.set(originKey(sourceId, index), origin)
        );
        apply((current) => mergeSource(current, sourceId, specs));
        setToast({ message: `รวมไฟล์แล้ว เพิ่มมา ${specs.length} หน้า`, type: "success" });
      } catch (error) {
        console.error("Failed to merge PDF:", error);
        fail(
          thaiMessageOf(error) ??
            "รวมไฟล์ไม่สำเร็จ — ไฟล์ที่เลือกอาจเสียหายหรือไม่ใช่ PDF จริง"
        );
      } finally {
        setIsParsing(false);
      }
    },
    [addSource, apply, fail, model.pages.length]
  );

  /** Shared by the image tool and the signature pad: register the bitmap as an
   *  asset and drop it on the page being edited — inside the rectangle the
   *  admin dragged, if he dragged one, otherwise centred. */
  const placeBitmap = useCallback(
    async (
      bytes: Uint8Array,
      kind: ImageKind,
      purpose: "image" | "signature",
      knownSize?: { widthPx: number; heightPx: number }
    ) => {
      const pending = pendingRectRef.current;
      pendingRectRef.current = null;

      const page =
        (pending && model.pages.find((p) => p.id === pending.pageId)) ??
        selectedPage ??
        model.pages[0];
      if (!page) {
        fail("ยังไม่ได้เปิดไฟล์ PDF");
        return;
      }

      const mime = kind === "png" ? "image/png" : "image/jpeg";
      let size = knownSize;
      if (!size) {
        const probeUrl = createTrackedUrl(
          new Blob([disposableCopy(bytes).buffer as ArrayBuffer], { type: mime })
        );
        try {
          size = await measureImage(probeUrl);
        } catch {
          releaseTrackedUrl(probeUrl);
          fail("อ่านไฟล์รูปนี้ไม่สำเร็จ — ไฟล์อาจเสียหาย ลองใช้รูปอื่น");
          return;
        }
        releaseTrackedUrl(probeUrl);
      }

      const assetId: AssetId = nextId("asset");
      addAsset({ id: assetId, kind, bytes, widthPx: size.widthPx, heightPx: size.heightPx });

      const rect =
        pending && pending.pageId === page.id
          ? // A dragged rectangle already came through the viewport matrix, so
            // it is absolute user space and needs no offset.
            fitRect(pending.rect, size.widthPx, size.heightPx)
          : defaultImageRect(
              page,
              size.widthPx,
              size.heightPx,
              cropOriginsRef.current.get(originKey(page.src, page.srcIndex))
            );

      const annotation: Annotation =
        purpose === "signature"
          ? { kind: "signature", id: nextId("ann"), pageId: page.id, rect, assetId }
          : { kind: "image", id: nextId("ann"), pageId: page.id, rect, assetId, opacity: 1 };

      apply((current) => addAnnotation(current, annotation));
      setSelectedPageId(page.id);
      setSelectedAnnotationId(annotation.id);
      setTool("select");
      setToast({
        message:
          purpose === "signature" ? "วางลายเซ็นแล้ว ลากย้ายได้เลย" : "วางรูปแล้ว ลากย้ายได้เลย",
        type: "success",
      });
    },
    [addAsset, apply, createTrackedUrl, fail, model.pages, releaseTrackedUrl, selectedPage]
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      const bytes = await readBytes(file);
      // PNG/JPG by MAGIC BYTES — `file.type` is filled in from the extension by
      // the browser and a renamed file lies about it.
      const verdict = validateImageUpload({ size: file.size, bytes });
      if (!verdict.ok) {
        pendingRectRef.current = null;
        fail(verdict.errorTh ?? "");
        return;
      }
      const kind = sniffImageKind(bytes);
      if (!kind) {
        pendingRectRef.current = null;
        fail("รองรับเฉพาะรูป PNG และ JPG เท่านั้น");
        return;
      }
      await placeBitmap(bytes, kind, "image");
    },
    [fail, placeBitmap]
  );

  const handleSignatureConfirm = useCallback(
    async (result: SignatureResult) => {
      setIsSignatureOpen(false);
      try {
        // `toBytes` decodes the data: URL without atob and without a Buffer, so
        // it behaves the same in the browser and under vitest.
        await placeBitmap(toBytes(result.dataUrl), "png", "signature", {
          widthPx: result.width,
          heightPx: result.height,
        });
      } catch (error) {
        console.error("Failed to place signature:", error);
        fail("วางลายเซ็นไม่สำเร็จ ลองเซ็นใหม่อีกครั้ง");
      }
    },
    [fail, placeBitmap]
  );

  // ── drawing on the page ────────────────────────────────────────────────

  /** A rectangle was dragged (or snapped onto a line of existing text). What it
   *  becomes depends on the armed tool. */
  const handleCreateRect = useCallback(
    (pageId: PageId, rect: Rect, drawTool: DrawableTool, origin: RectOrigin, snap?: SnapSample) => {
      setSelectedPageId(pageId);

      if (drawTool === "whiteout") {
        const annotation: Annotation = { kind: "whiteout", id: nextId("ann"), pageId, rect };
        apply((current) => addAnnotation(current, annotation));
        setSelectedAnnotationId(annotation.id);
        return;
      }

      if (drawTool === "text") {
        // A snap hands back what pdfjs THINKS the line says. It is a starting
        // point for the input, never authoritative — a bad /ToUnicode map turns
        // perfectly good Thai into mojibake — so the admin always sees it in an
        // editable box before anything is placed.
        setTextDraft({
          pageId,
          rect,
          value: origin === "snap" ? (snap?.text ?? "") : "",
          sizePt:
            origin === "snap" && snap && snap.sizePt > 0
              ? Math.round(snap.sizePt * 10) / 10
              : textStyle.sizePt,
          angleDeg: origin === "snap" && snap ? Math.round(snap.angleDeg) : textStyle.angleDeg,
          editingId: null,
        });
        return;
      }

      // image / signature: the box says WHERE, the file picker says WHAT.
      pendingRectRef.current = { pageId, rect };
      if (drawTool === "image") imageInputRef.current?.click();
      else setIsSignatureOpen(true);
    },
    [apply, textStyle.angleDeg, textStyle.sizePt]
  );

  /** A placed thing finished being dragged or resized. One gesture is one undo
   *  step, which is what the coalesce key buys. */
  const handleCommitRect = useCallback(
    (annotationId: string, rect: Rect) => {
      apply((current) => updateAnnotation(current, annotationId, { rect }), {
        coalesceKey: `annotation:${annotationId}`,
      });
    },
    [apply]
  );

  const commitTextDraft = useCallback(() => {
    if (!textDraft) return;
    // Only whitespace-only input is treated as "nothing typed" and cancels the
    // draft. A real value must be stored EXACTLY as typed — leading/trailing
    // spaces are part of what the admin wrote (e.g. aligning text after a
    // logo), and trimming here silently ate them on confirm.
    if (!textDraft.value.trim()) {
      setTextDraft(null);
      return;
    }
    const text = textDraft.value;

    if (textDraft.editingId) {
      const id = textDraft.editingId;
      // Explicitly a TEXT patch: `updateAnnotation`'s default type parameter is
      // the whole union, and `Omit` over a union keeps only the keys every
      // member shares (`pageId`, `rect`) — so `text` needs the narrower type.
      apply((current) =>
        updateAnnotation<TextAnnotation>(current, id, {
          text,
          sizePt: textDraft.sizePt,
          angleDeg: textDraft.angleDeg,
          color: textStyle.color,
          bold: textStyle.bold,
          align: textStyle.align,
        })
      );
      setSelectedAnnotationId(id);
    } else {
      const annotation: Annotation = {
        kind: "text",
        id: nextId("ann"),
        pageId: textDraft.pageId,
        rect: textDraft.rect,
        text,
        sizePt: textDraft.sizePt,
        color: textStyle.color,
        bold: textStyle.bold,
        angleDeg: textDraft.angleDeg,
        align: textStyle.align,
      };
      apply((current) => addAnnotation(current, annotation));
      setSelectedAnnotationId(annotation.id);
    }

    setTextDraft(null);
    setTool("select");
  }, [apply, textDraft, textStyle.align, textStyle.bold, textStyle.color]);

  const handleEditSelectedText = useCallback(() => {
    if (!selectedAnnotation || selectedAnnotation.kind !== "text") return;
    setTextDraft({
      pageId: selectedAnnotation.pageId,
      rect: selectedAnnotation.rect,
      value: selectedAnnotation.text,
      sizePt: selectedAnnotation.sizePt,
      angleDeg: selectedAnnotation.angleDeg,
      editingId: selectedAnnotation.id,
    });
  }, [selectedAnnotation]);

  const handleDeleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId) return;
    const id = selectedAnnotationId;
    apply((current) => deleteAnnotation(current, id));
    setSelectedAnnotationId(null);
  }, [apply, selectedAnnotationId]);

  const handleTextUnavailable = useCallback((pageId: PageId) => {
    if (scannedPagesRef.current.has(pageId)) return;
    scannedPagesRef.current.add(pageId);
    setToast({
      message: "หน้านี้เป็นภาพสแกน จึงคลิกดูดข้อความเดิมไม่ได้ — ลากกรอบเองได้ตามปกติ",
      type: "error",
    });
  }, []);

  // ── download ───────────────────────────────────────────────────────────

  const runExport = useCallback(
    async (exportModel: EditModel, suffix: string) => {
      setIsExporting(true);
      try {
        // pdf-lib is imported here and nowhere else on the write side: it runs
        // exactly once per download, and keeping it out of the initial bundle
        // keeps the editor's first paint cheap.
        const { applyEdits } = await import("../../lib/pdfApplyEdits");

        const sourceBytes: Record<SourceId, ByteSource> = {};
        for (const [id, bytes] of sources) sourceBytes[id] = bytes;
        const assetBytes: Record<AssetId, ByteSource> = {};
        for (const [id, asset] of assets) assetBytes[id] = asset.bytes;

        const bytes = await applyEdits({
          sources: sourceBytes,
          assets: assetBytes,
          model: exportModel,
        });

        // Every object URL goes through the store's registry. The previous
        // download's URL is released the moment a new one replaces it, and
        // anything still outstanding is revoked on reset/unmount.
        if (lastDownloadUrlRef.current) releaseTrackedUrl(lastDownloadUrlRef.current);
        const url = createTrackedUrl(
          new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" })
        );
        lastDownloadUrlRef.current = url;

        const base = fileName.replace(/\.pdf$/i, "") || "document";
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${base}${suffix}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setToast({ message: "สร้างไฟล์และดาวน์โหลดแล้ว", type: "success" });
        return true;
      } catch (error) {
        console.error("Failed to export PDF:", error);
        fail(
          thaiMessageOf(error) ??
            "สร้างไฟล์ PDF ไม่สำเร็จ\n\n" +
              "ถ้าเพิ่งวางรูปหรือลายเซ็นไป ลองลบอันล่าสุดออกแล้วสั่งดาวน์โหลดใหม่ " +
              "ถ้ายังไม่ได้ ให้กด “เริ่มใหม่” แล้วเปิดไฟล์อีกครั้ง — งานที่ยังไม่ได้ดาวน์โหลดจะหายไป"
        );
        return false;
      } finally {
        setIsExporting(false);
      }
    },
    [assets, createTrackedUrl, fail, fileName, releaseTrackedUrl, sources]
  );

  const handleDownload = useCallback(async () => {
    const ok = await runExport(model, "_edited");
    // Only a download that actually produced a file clears the leave guard.
    if (ok) setSnapshot(dirtyKey(model));
    // The caller needs this: LeaveGuard must not navigate away on a failure.
    return ok;
  }, [model, runExport, setSnapshot]);

  const handleSplit = useCallback(async () => {
    if (splitIds.size === 0) return;
    // Split does NOT change the document being edited — it exports a second
    // file containing only the ticked pages. Mutating the model here would
    // make "แยกหน้า" quietly destructive, which is not what the word means.
    const subset = splitPagesOutOfModel(model, Array.from(splitIds));
    if (!subset) {
      fail("ยังไม่ได้เลือกหน้าที่จะแยกออกมา");
      return;
    }
    await runExport(subset, "_selected");
  }, [fail, model, runExport, splitIds]);

  // ── page operations ────────────────────────────────────────────────────

  const handleRotate = useCallback(
    (delta: number) => {
      if (!activePageId) return;
      apply((current) => rotatePage(current, activePageId, delta));
    },
    [apply, activePageId]
  );

  const handleRotatePageById = useCallback(
    (pageId: PageId, delta: 90 | -90) => {
      apply((current) => rotatePage(current, pageId, delta));
    },
    [apply]
  );

  const handleDeletePage = useCallback(
    (pageId: PageId) => {
      const index = model.pages.findIndex((page) => page.id === pageId);
      if (index < 0 || model.pages.length <= 1) return;
      setPendingConfirm({
        title: "ยืนยันการลบหน้า",
        message: `ลบหน้า ${index + 1} ออกจากเอกสารใช่หรือไม่?\n\nสิ่งที่วางไว้บนหน้านี้จะหายไปด้วย แต่กด “ย้อนกลับ” เอาคืนได้`,
        confirmText: "ลบหน้านี้",
        onConfirm: () => {
          apply((current) => deletePageInModel(current, pageId));
          setSplitIds((current) => {
            if (!current.has(pageId)) return current;
            const next = new Set(current);
            next.delete(pageId);
            return next;
          });
          setPendingConfirm(null);
        },
      });
    },
    [apply, model.pages]
  );

  /** The list's ↑ / ↓ buttons. The index arithmetic itself is the pure,
   *  unit-tested `movePageById`; this only decides the target slot. */
  const handleMovePage = useCallback(
    (pageId: PageId, direction: -1 | 1) => {
      const index = model.pages.findIndex((page) => page.id === pageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= model.pages.length) return;
      apply((current) => movePageById(current, pageId, target));
    },
    [apply, model.pages]
  );

  /** Drag-to-reorder in the thumbnail rail reports indices, not ids. */
  const handleMovePageByIndex = useCallback(
    (from: number, to: number) => {
      apply((current) => movePage(current, from, to));
    },
    [apply]
  );

  const handleReset = useCallback(() => {
    setPendingConfirm({
      title: "เริ่มใหม่ทั้งหมด",
      message:
        "ล้างทุกอย่างแล้วเริ่มจากการเปิดไฟล์ใหม่ใช่หรือไม่?\n\nสิ่งที่แก้ไว้และยังไม่ได้ดาวน์โหลดจะหายไปทั้งหมด และเอาคืนไม่ได้",
      confirmText: "เริ่มใหม่",
      onConfirm: () => {
        reset();
        lastDownloadUrlRef.current = null;
        pendingRectRef.current = null;
        scannedPagesRef.current = new Set();
        cropOriginsRef.current = new Map();
        setFormFields([]);
        setIsXfa(false);
        setFileName("");
        setSelectedPageId(null);
        setSelectedAnnotationId(null);
        setSplitIds(new Set());
        setTextDraft(null);
        setWarning("");
        setZoom(1);
        setTool("select");
        setSnapshot(dirtyKey({ pages: [], annotations: [], formValues: {}, flattenForm: false }));
        setPendingConfirm(null);
      },
    });
  }, [reset, setSnapshot]);

  // ── drag & drop ────────────────────────────────────────────────────────
  // Kept from the tool this replaces: the drop zone was the good part of it,
  // and there is no shared component for one.

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handlePdfUpload(file);
  };

  /** Hidden-input handler: clearing `value` afterwards is what lets the admin
   *  pick the SAME file twice in a row (a `change` event needs a change).
   *  Written as one function taking the handler, rather than a curried factory
   *  called from JSX, so nothing is invoked during render. */
  const onPicked = (
    event: React.ChangeEvent<HTMLInputElement>,
    handler: (file: File) => void | Promise<void>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handler(file);
  };

  // ── auth gate: the early return ────────────────────────────────────────

  if (authLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50/50">
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(event) => onPicked(event, handlePdfUpload)}
      />
      <input
        ref={mergeInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(event) => onPicked(event, handleMergePdf)}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => onPicked(event, handleImageUpload)}
      />

      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <Link
                href="/adminpanel"
                onClick={(event) => {
                  event.preventDefault();
                  guardedNavigate("/adminpanel");
                }}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors mb-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                กลับไป Admin Panel
              </Link>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center text-xl shadow-sm">
                  📄
                </div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  เครื่องมือแก้ไข PDF
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIsGuideOpen(true)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm flex items-center gap-2 whitespace-nowrap"
                aria-haspopup="dialog"
                aria-expanded={isGuideOpen}
                title="อธิบายว่าเครื่องมือนี้ทำอะไรได้ ทำยังไง และมีอะไรที่ทำไม่ได้"
              >
                📖 คู่มือการใช้งาน
              </button>
              {hasDocument && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm whitespace-nowrap"
                >
                  🔄 เริ่มใหม่
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {!hasDocument ? (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-800 mb-2">เริ่มจากอัปโหลดไฟล์ PDF</h2>
              <p className="text-gray-500 text-sm">
                ไฟล์จะถูกเปิดและแก้ไขในเครื่องคุณเท่านั้น ไม่ได้ถูกส่งขึ้นเซิร์ฟเวอร์
              </p>
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => pdfInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") pdfInputRef.current?.click();
              }}
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer hover:border-violet-400 hover:bg-violet-50/50 ${
                isDragOver ? "border-violet-500 bg-violet-50" : "border-gray-300"
              }`}
            >
              {isParsing ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                  <p className="font-bold text-gray-700">กำลังเปิดไฟล์...</p>
                </div>
              ) : (
                <>
                  <div className="text-5xl mb-4">📄</div>
                  <p className="text-lg font-bold text-gray-700 mb-1">
                    ลากไฟล์ PDF มาวางที่นี่ หรือคลิกเพื่อเลือก
                  </p>
                  <p className="text-sm text-gray-400">
                    รองรับไฟล์ .pdf ขนาดไม่เกิน {MAX_PDF_MB} MB และไม่เกิน {MAX_PAGES} หน้า
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    ไฟล์ที่ตั้งรหัสผ่านไว้เปิดไม่ได้ — ต้องเอารหัสผ่านออกก่อน
                  </p>
                </>
              )}
            </div>

            <p className="text-center text-sm text-gray-500">
              ไม่แน่ใจว่าทำอะไรได้บ้าง?{" "}
              <button
                type="button"
                onClick={() => setIsGuideOpen(true)}
                className="font-semibold text-violet-600 hover:text-violet-700 underline underline-offset-2"
              >
                เปิดคู่มือการใช้งาน
              </button>
            </p>
          </div>
        ) : (
          <div className="space-y-5 animate-fade-in">
            {warning && (
              <div
                role="status"
                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                {warning}
              </div>
            )}

            <PdfEditorToolbar
              disabled={isParsing || isExporting}
              tool={tool}
              onToolChange={(next) => {
                setTool(next);
                // Arming these two is itself the instruction: there is nothing
                // to drag until a file has been chosen or a signature drawn.
                if (next === "image") {
                  pendingRectRef.current = null;
                  imageInputRef.current?.click();
                }
                if (next === "signature") {
                  pendingRectRef.current = null;
                  setIsSignatureOpen(true);
                }
              }}
              textStyle={textStyle}
              onTextStyleChange={setTextStyle}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              currentPageNumber={selectedPageNumber}
              pageCount={model.pages.length}
              onRotateCurrentPage={handleRotate}
              onDeleteCurrentPage={() => activePageId && handleDeletePage(activePageId)}
              onMergePdf={() => mergeInputRef.current?.click()}
              onDownload={handleDownload}
              isExporting={isExporting}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2">
                  <p className="text-xs text-gray-400 truncate">
                    {fileName ? `ไฟล์: ${fileName}` : "เอกสารที่กำลังแก้ไข"}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100))}
                      disabled={zoom <= MIN_ZOOM}
                      title="ย่อหน้าเอกสารลง"
                      className="px-2 py-1 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ➖ ย่อ
                    </button>
                    <span className="text-xs font-semibold text-gray-500 w-12 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100))}
                      disabled={zoom >= MAX_ZOOM}
                      title="ขยายหน้าเอกสารขึ้น"
                      className="px-2 py-1 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ➕ ขยาย
                    </button>
                  </div>
                </div>

                <div className="h-[70vh] min-h-96">
                  {/* Keyed on previewEpoch so a new upload or a merge mounts a
                      FRESH preview that pulls FRESH byte copies. Reusing the old
                      one would hand pdf.js a buffer it has already transferred
                      and detached. */}
                  <PdfPreviewWrapper
                    key={previewEpoch}
                    sources={previewSources}
                    pages={model.pages}
                    annotations={model.annotations}
                    assetUrls={assetUrls}
                    previewEpoch={previewEpoch}
                    tool={tool}
                    zoom={zoom}
                    activePageId={activePageId}
                    selectedAnnotationId={selectedAnnotationId}
                    disabled={isParsing || isExporting}
                    onSelectPage={setSelectedPageId}
                    onSelectAnnotation={setSelectedAnnotationId}
                    onCreateRect={handleCreateRect}
                    onCommitRect={handleCommitRect}
                    onMovePage={handleMovePageByIndex}
                    onRotatePage={handleRotatePageById}
                    onDeletePage={handleDeletePage}
                    onTextUnavailable={handleTextUnavailable}
                    onSourceError={(_sourceId, message) => fail(message)}
                  />
                </div>
              </div>

              <div className="space-y-5">
                {selectedAnnotation && (
                  <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3">
                    <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <span aria-hidden="true">🎯</span> สิ่งที่เลือกอยู่
                    </h2>
                    <p className="text-xs text-gray-500">
                      {selectedAnnotation.kind === "text"
                        ? `ข้อความ: “${selectedAnnotation.text}”`
                        : selectedAnnotation.kind === "whiteout"
                          ? "แผ่นทับขาว"
                          : selectedAnnotation.kind === "signature"
                            ? "ลายเซ็น"
                            : "รูปภาพ"}
                    </p>
                    <fieldset disabled={isExporting || isParsing} className="flex gap-2">
                      {selectedAnnotation.kind === "text" && (
                        <button
                          type="button"
                          onClick={handleEditSelectedText}
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:opacity-40"
                        >
                          ✏️ แก้ไขข้อความ
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDeleteSelectedAnnotation}
                        className="flex-1 px-3 py-2 rounded-xl border border-red-200 bg-white text-red-600 font-semibold text-sm hover:bg-red-50 disabled:opacity-40"
                      >
                        🗑️ ลบสิ่งที่เลือก
                      </button>
                    </fieldset>
                  </section>
                )}

                <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3">
                  <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span aria-hidden="true">📚</span> จัดการหน้า
                    <span className="text-xs font-normal text-gray-400">
                      ({model.pages.length} หน้า)
                    </span>
                  </h2>

                  <fieldset
                    disabled={isExporting || isParsing}
                    className="space-y-1.5 max-h-80 overflow-y-auto overscroll-contain disabled:opacity-60"
                  >
                    {model.pages.map((page, index) => (
                      <div
                        key={page.id}
                        className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors ${
                          page.id === activePageId
                            ? "border-violet-300 bg-violet-50"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={splitIds.has(page.id)}
                          onChange={(event) =>
                            setSplitIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(page.id);
                              else next.delete(page.id);
                              return next;
                            })
                          }
                          aria-label={`เลือกหน้า ${index + 1} เพื่อแยกไฟล์`}
                          className="w-4 h-4 accent-violet-600"
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedPageId(page.id)}
                          className="flex-1 text-left text-sm font-semibold text-gray-700 truncate"
                        >
                          หน้า {index + 1}
                          {page.addedRotation !== 0 && (
                            <span className="text-xs font-normal text-violet-600">
                              {" "}
                              (หมุน {page.addedRotation}°)
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMovePage(page.id, -1)}
                          disabled={index === 0}
                          title="เลื่อนขึ้นหนึ่งตำแหน่ง"
                          className="px-1.5 py-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMovePage(page.id, 1)}
                          disabled={index === model.pages.length - 1}
                          title="เลื่อนลงหนึ่งตำแหน่ง"
                          className="px-1.5 py-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePage(page.id)}
                          disabled={model.pages.length <= 1}
                          title="ลบหน้านี้"
                          className="px-1.5 py-1 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </fieldset>

                  <button
                    type="button"
                    onClick={handleSplit}
                    disabled={splitIds.size === 0 || isExporting}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    title="ดาวน์โหลดเฉพาะหน้าที่ติ๊กไว้เป็นไฟล์ใหม่ โดยไฟล์ที่กำลังแก้อยู่ไม่เปลี่ยน"
                  >
                    ✂️ แยกหน้าที่เลือก
                    {splitIds.size > 0 ? ` (${splitIds.size} หน้า)` : ""}
                  </button>
                </section>

                <PdfFormPanel
                  hasDocument={hasDocument}
                  isXfa={isXfa}
                  fields={formFields}
                  values={model.formValues}
                  onChange={(name, value) =>
                    apply((current) => setFormValue(current, name, value), {
                      coalesceKey: `form:${name}`,
                    })
                  }
                  flattenForm={model.flattenForm}
                  onFlattenFormChange={(flatten) =>
                    apply((current) => setFlattenForm(current, flatten))
                  }
                  disabled={isExporting}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* The text box. A snapped rectangle pre-fills it with what pdfjs read
          off the page, which the admin corrects before anything is placed. */}
      {textDraft && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">
              {textDraft.editingId ? "แก้ไขข้อความ" : "พิมพ์ข้อความที่จะวางลงบนเอกสาร"}
            </h3>
            <label htmlFor="pdf-editor-text-draft" className="block text-xs font-bold text-gray-500">
              ข้อความ (ฟอนต์ Sarabun)
            </label>
            <textarea
              id="pdf-editor-text-draft"
              autoFocus
              rows={4}
              value={textDraft.value}
              onChange={(event) =>
                setTextDraft((current) =>
                  current ? { ...current, value: event.target.value } : current
                )
              }
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              placeholder="พิมพ์ข้อความที่นี่..."
            />
            <p className="text-xs text-gray-400">
              ขนาด {textDraft.sizePt} pt · เอียง {textDraft.angleDeg}° · ปรับสี ตัวหนา
              และการจัดวางได้จากแถบเครื่องมือด้านบน
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTextDraft(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={commitTextDraft}
                disabled={textDraft.value.trim().length === 0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {textDraft.editingId ? "บันทึกข้อความ" : "วางข้อความ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}

      {errorMessage && (
        <ErrorModal isOpen message={errorMessage} onClose={() => setErrorMessage("")} />
      )}

      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmText={pendingConfirm.confirmText}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {/* An IMAGE of a signature, never "ลายเซ็นดิจิทัล": it carries no
          certificate and proves nothing about who drew it. */}
      <SignaturePad
        open={isSignatureOpen}
        onConfirm={handleSignatureConfirm}
        onCancel={() => {
          pendingRectRef.current = null;
          setIsSignatureOpen(false);
          setTool("select");
        }}
      />

      {/* Nothing here is stored anywhere, so leaving the page really does
          destroy the work. "บันทึกแล้วออก" is therefore the download. */}
      <LeaveGuardModal
        show={showLeaveModal}
        onSave={async () => {
          // ONLY on a download that produced a file. Nothing in this editor is
          // stored server-side, so navigating after a failed export — an
          // unreachable Sarabun, an unsupported picture — throws the whole
          // session away and leaves the admin with nothing at all. The error
          // modal is already up; staying put is what lets him act on it.
          if (await handleDownload()) confirmLeave();
        }}
        onDiscard={confirmLeave}
        onCancel={cancelLeave}
        saving={isExporting}
        documentLabel="ไฟล์ PDF ที่แก้ไว้ (ดาวน์โหลด)"
      />

      {/* Rendered LAST so it stacks above every other layer on the page. */}
      {isGuideOpen && <PdfEditorGuidePanel onClose={() => setIsGuideOpen(false)} />}
    </div>
  );
}
