"use client";

/**
 * PageOverlay — an absolutely-positioned interaction layer sitting exactly on
 * top of one rendered `<Page>`.
 *
 * It owns three gestures and nothing else:
 *   • drag-to-draw a new rectangle,
 *   • drag-to-move an existing annotation,
 *   • drag a handle to resize one,
 * plus click-to-snap, which pre-fills a cover box from a real line of text.
 *
 * ------------------------------------------------------------------------
 * MEASUREMENT DISCIPLINE
 * ------------------------------------------------------------------------
 * Every pixel measurement here comes from `getBoundingClientRect()` — NEVER
 * from `canvas.width`. react-pdf renders into a backing store
 * `devicePixelRatio`x larger than the CSS box and then lets CSS scale it again,
 * so `canvas.width` bears no fixed relation to what the admin is pointing at.
 * Get this wrong and every box lands in the wrong place, but only on retina
 * machines, which is the worst possible way to be wrong.
 *
 * All CSS-pixel <-> PDF-point arithmetic is delegated to Group A's `pdfCoords`,
 * which maps BOTH opposite corners through the real viewport matrix. That
 * matters: at /Rotate 90 the matrix is a reflection, so mapping one corner and
 * adding width/height would silently produce a mirrored rectangle. This file is
 * the single place in the preview that imports `pdfCoords`.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Annotation, Rect } from "@/app/lib/pdfTypes";
import {
  makeViewport,
  pdfRectToScreenRect,
  screenRectToPdfRect,
  textMatrixOrigin,
  textMatrixToSizeAndAngle,
} from "@/app/lib/pdfCoords";
import type { BoxArray, Matrix6, ScreenBox } from "@/app/lib/pdfCoords";
import type {
  CssRect,
  DrawableTool,
  PageOverlayProps,
  SnapSample,
} from "./previewTypes";

/** Anything smaller than this (in CSS px) is a click, not a drag. */
const CLICK_SLOP = 4;
/** A rectangle the admin cannot see is a rectangle he cannot delete. */
const MIN_BOX_CSS = 8;
const HANDLE_SIZE = 10;
/**
 * A text item's `transform` gives the BASELINE. A cover box has to reach below
 * it for descenders and Thai below-vowels (สระอุ / สระอู sit at roughly -0.33em
 * in Sarabun). These two fractions of the item height are a heuristic — the
 * admin can always drag the box afterwards.
 */
const DESCENDER_FRACTION = 0.26;
const SNAP_BOX_FRACTION = 1 + DESCENDER_FRACTION;
/** Beyond this, an axis-aligned box no longer describes the text, so no snap. */
const MAX_SNAP_ANGLE_DEG = 1;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

type DragState =
  | {
      mode: "draw";
      pointerId: number;
      startX: number;
      startY: number;
      curX: number;
      curY: number;
      moved: boolean;
    }
  | {
      mode: "move" | "resize";
      pointerId: number;
      handle: Handle | null;
      annotationId: string;
      base: CssRect;
      startX: number;
      startY: number;
      curX: number;
      curY: number;
      moved: boolean;
    };

type SnapCandidate = { key: string; rect: Rect; sample: SnapSample };

/* -------------------------------------------------------------------------- */
/* Pure CSS-space helpers. No PDF maths lives here — see pdfCoords.            */
/* -------------------------------------------------------------------------- */

function rectFromPoints(ax: number, ay: number, bx: number, by: number): CssRect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

function clampToBox(r: CssRect, w: number, h: number): CssRect {
  const x = Math.max(0, Math.min(r.x, w));
  const y = Math.max(0, Math.min(r.y, h));
  return {
    x,
    y,
    width: Math.max(0, Math.min(r.width, w - x)),
    height: Math.max(0, Math.min(r.height, h - y)),
  };
}

function applyHandle(base: CssRect, handle: Handle, dx: number, dy: number): CssRect {
  let { x, y, width, height } = base;
  if (handle.includes("w")) {
    x = base.x + dx;
    width = base.width - dx;
  }
  if (handle.includes("e")) {
    width = base.width + dx;
  }
  if (handle.includes("n")) {
    y = base.y + dy;
    height = base.height - dy;
  }
  if (handle.includes("s")) {
    height = base.height + dy;
  }
  // Dragging past the opposite edge flips the rectangle rather than inverting it.
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  return { x, y, width, height };
}

/**
 * A `ScreenBox` whose origin is the overlay itself.
 *
 * `pdfCoords` works in client coordinates, but a `left`/`top` of 0 paired with
 * overlay-local pointer coordinates is the same arithmetic with the scroll
 * offset already cancelled — and it means the box does not go stale when the
 * page scrolls, only when it resizes.
 */
function localBox(width: number, height: number): ScreenBox {
  return { left: 0, top: 0, width, height };
}

/* -------------------------------------------------------------------------- */

export default function PageOverlay({
  pageId,
  widthPt,
  heightPt,
  rotation,
  annotations,
  assetUrls,
  tool,
  selectedAnnotationId,
  pageProxy,
  textEpoch = 0,
  disabled = false,
  onSelectAnnotation,
  onCreateRect,
  onCommitRect,
  onTextUnavailable,
}: PageOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snaps, setSnaps] = useState<SnapCandidate[] | null>(null);
  const [scanned, setScanned] = useState(false);
  const [hoverSnap, setHoverSnap] = useState<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Measure the CSS box — the only source of truth for pixel geometry.      */
  /* ---------------------------------------------------------------------- */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    measure();

    // ResizeObserver is absent in some test environments; the initial measure
    // above still gives a usable box, so degrade rather than throw.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * The same viewport pdfjs rendered with. `page.view` is the CropBox, so a
   * page whose crop origin is not (0,0) still maps correctly; falling back to
   * the model's unrotated size covers the page not being loaded yet.
   *
   * Scale stays 1: `pdfCoords` scales through the measured bounding box, which
   * is what makes the maths independent of both `zoom` and devicePixelRatio.
   */
  const viewport = useMemo(() => {
    const view = pageProxy?.view;
    const viewBox: BoxArray | undefined =
      Array.isArray(view) && view.length === 4
        ? ([view[0], view[1], view[2], view[3]] as BoxArray)
        : undefined;
    return makeViewport(widthPt, heightPt, rotation, 1, viewBox);
  }, [pageProxy, widthPt, heightPt, rotation]);

  const ready = box.width > 0 && box.height > 0;
  const screenBox = useMemo(
    () => localBox(box.width, box.height),
    [box.width, box.height],
  );

  /* ---------------------------------------------------------------------- */
  /* Click-to-snap candidates                                               */
  /* ---------------------------------------------------------------------- */
  const wantsSnap = tool === "whiteout" || tool === "text";

  useEffect(() => {
    if (!pageProxy || !wantsSnap) return;
    let cancelled = false;

    (async () => {
      try {
        const content = await pageProxy.getTextContent();
        if (cancelled) return;

        const out: SnapCandidate[] = [];
        content.items.forEach((item, i) => {
          const t = item.transform;
          if (!Array.isArray(t) || t.length < 6) return;
          const w = typeof item.width === "number" ? item.width : 0;
          const h0 = typeof item.height === "number" ? item.height : 0;
          // Zero-area items are text-positioning operators, not visible glyphs.
          if (w <= 0.5) return;

          const m = [t[0], t[1], t[2], t[3], t[4], t[5]] as unknown as Matrix6;
          const { sizePt, angleDeg } = textMatrixToSizeAndAngle(m);
          // An axis-aligned cover box would not describe rotated text, and a
          // wrong box is worse than no box. Dragging still works.
          if (Math.abs(angleDeg) > MAX_SNAP_ANGLE_DEG) return;

          const height = h0 > 0.5 ? h0 : sizePt;
          if (height <= 0.5) return;

          // transform[4],[5] is byte-identical to the x/y that were handed to
          // drawText — that is what makes this exact rather than a guess.
          const origin = textMatrixOrigin(m);
          out.push({
            key: `${pageId}:${i}`,
            rect: {
              x: origin.x,
              y: origin.y - height * DESCENDER_FRACTION,
              width: w,
              height: height * SNAP_BOX_FRACTION,
            },
            sample: {
              text: typeof item.str === "string" ? item.str : "",
              sizePt,
              angleDeg,
            },
          });
        });

        setSnaps(out);
        // A scanned page yields nothing at all. Saying so beats letting clicks
        // silently do nothing.
        if (out.length === 0) {
          setScanned(true);
          onTextUnavailable?.(pageId);
        } else {
          setScanned(false);
        }
      } catch {
        if (cancelled) return;
        // Extraction failing is indistinguishable, to the admin, from a scan:
        // either way there is nothing to click, and dragging still works.
        setSnaps([]);
        setScanned(true);
        onTextUnavailable?.(pageId);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `onTextUnavailable` is intentionally excluded: an unmemoised callback
    // from the owner would otherwise re-run text extraction on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageProxy, wantsSnap, pageId, textEpoch]);

  const snapBoxes = useMemo(() => {
    if (!ready || !snaps) return [];
    return snaps.map((s) => ({
      ...s,
      css: pdfRectToScreenRect(s.rect, screenBox, viewport),
    }));
  }, [snaps, screenBox, viewport, ready]);

  /* ---------------------------------------------------------------------- */
  /* Existing annotations, positioned in CSS space                          */
  /* ---------------------------------------------------------------------- */
  const placed = useMemo(() => {
    if (!ready) return [] as Array<{ ann: Annotation; css: CssRect }>;
    return annotations.map((ann) => ({
      ann,
      css: pdfRectToScreenRect(ann.rect, screenBox, viewport),
    }));
  }, [annotations, screenBox, viewport, ready]);

  /* ---------------------------------------------------------------------- */
  /* Pointer plumbing                                                       */
  /* ---------------------------------------------------------------------- */
  const localPoint = useCallback((e: React.PointerEvent | PointerEvent) => {
    const el = rootRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const liveRect = useMemo<CssRect | null>(() => {
    if (!drag) return null;
    if (drag.mode === "draw") {
      return clampToBox(
        rectFromPoints(drag.startX, drag.startY, drag.curX, drag.curY),
        box.width,
        box.height,
      );
    }
    const dx = drag.curX - drag.startX;
    const dy = drag.curY - drag.startY;
    if (drag.mode === "move") {
      return clampToBox(
        { ...drag.base, x: drag.base.x + dx, y: drag.base.y + dy },
        box.width,
        box.height,
      );
    }
    return clampToBox(
      applyHandle(drag.base, drag.handle ?? "se", dx, dy),
      box.width,
      box.height,
    );
  }, [drag, box.width, box.height]);

  const beginDrag = useCallback(
    (e: React.PointerEvent, next: DragState) => {
      if (disabled || !ready) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is a nicety; the window-level listeners below still
        // finish the gesture if it is unavailable.
      }
      setDrag(next);
    },
    [disabled, ready],
  );

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !ready) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const p = localPoint(e);

      if (tool === "select") {
        // Empty space in select mode clears the selection.
        onSelectAnnotation(null);
        return;
      }
      beginDrag(e, {
        mode: "draw",
        pointerId: e.pointerId,
        startX: p.x,
        startY: p.y,
        curX: p.x,
        curY: p.y,
        moved: false,
      });
    },
    [disabled, ready, tool, localPoint, onSelectAnnotation, beginDrag],
  );

  // Move/up live on `window` so a gesture that leaves the page still completes
  // — otherwise a drag released over the toolbar strands a half-drawn box.
  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const p = localPoint(e);
      setDrag((d) => {
        if (!d) return d;
        const moved =
          d.moved ||
          Math.abs(p.x - d.startX) > CLICK_SLOP ||
          Math.abs(p.y - d.startY) > CLICK_SLOP;
        return { ...d, curX: p.x, curY: p.y, moved };
      });
    };

    const finish = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      setDrag(null);
      if (!drag.moved) return;

      // `liveRect` is derived from the same `drag` this effect closed over and
      // has already had clamping and handle semantics applied, so it — not the
      // raw event coordinates — is what gets converted.
      const finalCss = liveRect;
      if (!finalCss) return;
      if (finalCss.width < MIN_BOX_CSS || finalCss.height < MIN_BOX_CSS) return;

      const el = rootRef.current;
      if (!el) return;
      // Measure again at commit time: a zoom change mid-drag would otherwise
      // convert through a stale scale factor.
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const boxNow = localBox(r.width, r.height);

      // BOTH corners go through the matrix. At /Rotate 90 it is a reflection,
      // so mapping one corner and adding width/height gives a mirrored box.
      const pdfRect = screenRectToPdfRect(
        { x: finalCss.x, y: finalCss.y },
        { x: finalCss.x + finalCss.width, y: finalCss.y + finalCss.height },
        boxNow,
        viewport,
      );

      if (drag.mode === "draw") {
        onCreateRect(pageId, pdfRect, tool as DrawableTool, "drag");
      } else {
        onCommitRect(drag.annotationId, pdfRect);
      }
    };

    const cancel = () => setDrag(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag, liveRect, localPoint, viewport, pageId, tool, onCreateRect, onCommitRect]);

  const handleSnapClick = useCallback(
    (c: SnapCandidate) => {
      if (disabled || !wantsSnap) return;
      // Snap to the BOX. The sample travels along only as a hint the owner may
      // pre-fill an input with — `str` can be mojibake on a bad /ToUnicode map,
      // so it is never presented as authoritative.
      onCreateRect(pageId, c.rect, tool as DrawableTool, "snap", c.sample);
    },
    [disabled, wantsSnap, onCreateRect, pageId, tool],
  );

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */
  const drawing = drag?.mode === "draw";

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 select-none"
      style={{
        touchAction: "none",
        cursor: disabled ? "default" : tool === "select" ? "default" : "crosshair",
        pointerEvents: disabled ? "none" : "auto",
      }}
      onPointerDown={onRootPointerDown}
      data-page-overlay={pageId}
    >
      {/* --- snap candidates ------------------------------------------- */}
      {wantsSnap &&
        !drag &&
        snapBoxes.map((c) => (
          <button
            key={c.key}
            type="button"
            tabIndex={-1}
            aria-label="ใช้กรอบจากข้อความที่ตรวจพบ"
            className="absolute border border-dashed border-transparent bg-transparent transition-colors hover:border-sky-500 hover:bg-sky-400/20"
            style={{
              left: c.css.x,
              top: c.css.y,
              width: c.css.width,
              height: c.css.height,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => setHoverSnap(c.key)}
            onPointerLeave={() => setHoverSnap((k) => (k === c.key ? null : k))}
            onClick={(e) => {
              e.stopPropagation();
              handleSnapClick(c);
            }}
          />
        ))}

      {/* --- placed annotations ---------------------------------------- */}
      {placed.map(({ ann, css }) => {
        const isSelected = ann.id === selectedAnnotationId;
        const isDragging = drag && drag.mode !== "draw" && drag.annotationId === ann.id;
        const shown = isDragging && liveRect ? liveRect : css;

        return (
          <div
            key={ann.id}
            className={`absolute outline outline-offset-0 ${
              isSelected ? "outline-2 outline-blue-500" : "outline-1 outline-transparent"
            }`}
            style={{
              left: shown.x,
              top: shown.y,
              width: shown.width,
              height: shown.height,
              cursor: tool === "select" ? (isSelected ? "move" : "pointer") : "crosshair",
            }}
            onPointerDown={(e) => {
              if (tool !== "select") return;
              const p = localPoint(e);
              onSelectAnnotation(ann.id);
              beginDrag(e, {
                mode: "move",
                pointerId: e.pointerId,
                handle: null,
                annotationId: ann.id,
                base: css,
                startX: p.x,
                startY: p.y,
                curX: p.x,
                curY: p.y,
                moved: false,
              });
            }}
          >
            <AnnotationBody ann={ann} assetUrls={assetUrls} />

            {isSelected &&
              tool === "select" &&
              !disabled &&
              HANDLES.map((h) => (
                <span
                  key={h}
                  role="presentation"
                  className="absolute rounded-sm border border-white bg-blue-600 shadow"
                  style={{
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    cursor: HANDLE_CURSOR[h],
                    left: h.includes("w")
                      ? -HANDLE_SIZE / 2
                      : h.includes("e")
                        ? shown.width - HANDLE_SIZE / 2
                        : shown.width / 2 - HANDLE_SIZE / 2,
                    top: h.includes("n")
                      ? -HANDLE_SIZE / 2
                      : h.includes("s")
                        ? shown.height - HANDLE_SIZE / 2
                        : shown.height / 2 - HANDLE_SIZE / 2,
                  }}
                  onPointerDown={(e) => {
                    const p = localPoint(e);
                    beginDrag(e, {
                      mode: "resize",
                      pointerId: e.pointerId,
                      handle: h,
                      annotationId: ann.id,
                      base: css,
                      startX: p.x,
                      startY: p.y,
                      curX: p.x,
                      curY: p.y,
                      moved: false,
                    });
                  }}
                />
              ))}
          </div>
        );
      })}

      {/* --- the rectangle currently being drawn ------------------------ */}
      {drawing && liveRect && (
        <div
          className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/15"
          style={{
            left: liveRect.x,
            top: liveRect.y,
            width: liveRect.width,
            height: liveRect.height,
          }}
        />
      )}

      {/* --- hint for the detected text under the cursor ---------------- */}
      {hoverSnap && !drag && (
        <SnapHint candidate={snapBoxes.find((c) => c.key === hoverSnap) ?? null} />
      )}

      {/* --- scanned page notice ---------------------------------------- */}
      {wantsSnap && scanned && (
        <div className="pointer-events-none absolute top-2 left-2 max-w-[85%] rounded-md bg-amber-50/95 px-3 py-2 text-xs leading-relaxed text-amber-900 shadow ring-1 ring-amber-300">
          หน้านี้เป็นภาพสแกน จึงไม่มีข้อความให้คลิกเลือก — กรุณาลากเมาส์วาดกรอบเองได้ตามปกติ
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SnapHint({
  candidate,
}: {
  candidate: { css: CssRect; sample: SnapSample } | null;
}) {
  if (!candidate) return null;
  const text = candidate.sample.text.trim();
  if (!text) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-80 truncate rounded bg-gray-900/90 px-2 py-1 text-[11px] text-white shadow"
      style={{ left: candidate.css.x, top: Math.max(0, candidate.css.y - 24) }}
    >
      {/* Never presented as authoritative: a broken /ToUnicode map turns this
          into mojibake even though the BOX is still exact. */}
      <span className="opacity-70">ข้อความที่อ่านได้ (อาจไม่ตรง): </span>
      {text}
    </div>
  );
}

function AnnotationBody({
  ann,
  assetUrls,
}: {
  ann: Annotation;
  assetUrls: Readonly<Record<string, string>>;
}) {
  if (ann.kind === "whiteout") {
    return <div className="h-full w-full border border-dashed border-gray-400 bg-white" />;
  }

  if (ann.kind === "text") {
    const { color, sizePt, bold, align, angleDeg, text } = ann;
    return (
      <div
        className="flex h-full w-full items-start overflow-hidden"
        style={{
          // PDF angles run counter-clockwise, CSS clockwise.
          transform: angleDeg ? `rotate(${-angleDeg}deg)` : undefined,
          transformOrigin: "left bottom",
          justifyContent:
            align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        }}
      >
        <span
          className="leading-tight whitespace-pre-wrap"
          style={{
            fontFamily: "Sarabun, sans-serif",
            fontWeight: bold ? 700 : 400,
            // Points and CSS px coincide only at 100% zoom; this is a preview
            // approximation. `sizePt` is authoritative — pdf-lib uses it on
            // download, measured with the embedded Sarabun face.
            fontSize: `${sizePt}px`,
            color: `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`,
          }}
        >
          {text}
        </span>
      </div>
    );
  }

  const url = assetUrls[ann.assetId];
  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center border border-dashed border-gray-400 bg-gray-100 text-[10px] text-gray-500">
        ไม่พบรูปภาพ
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={ann.kind === "signature" ? "ภาพลายเซ็น" : "รูปภาพที่แทรก"}
      draggable={false}
      className="h-full w-full object-fill"
      style={{ opacity: ann.kind === "image" ? ann.opacity : 1 }}
    />
  );
}
