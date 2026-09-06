"use client";

/**
 * SignaturePad — draw a signature with mouse, finger or stylus and hand back a
 * PNG.
 *
 * This produces an IMAGE of a signature. It is NOT a cryptographic signature,
 * carries no certificate and proves nothing about who drew it, so nothing in
 * this component may be labelled "ลายเซ็นดิจิทัล".
 *
 * The one non-obvious requirement: the PNG is TRIMMED to the ink bounding box
 * before `toDataURL`. An untrimmed export is a mostly-empty rectangle the size
 * of the canvas, so when the admin drops it on the page the visible strokes sit
 * nowhere near where he aimed, and resizing the box scales the emptiness too.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SignaturePadProps, SignatureResult } from "./previewTypes";

/** Logical drawing surface, in CSS pixels. Backing store is DPR x this. */
const PAD_W = 640;
const PAD_H = 220;
const STROKE_W = 2.6;
/** Leave a little air around the ink so the outermost pixels are not clipped. */
const TRIM_PAD = 6;

type Point = { x: number; y: number };

export default function SignaturePad({
  open,
  onConfirm,
  onCancel,
  inkColor = "#111827",
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Canvas setup — sized for the device so strokes are not blurry.          */
  /* ---------------------------------------------------------------------- */
  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? Math.min(window.devicePixelRatio, 3)
        : 1;
    // Backing store only. The CSS box is left to `w-full h-auto`, which keeps
    // the pad usable on a narrow screen — `pointFrom` scales the measured box
    // back to the logical surface, so the strokes follow the pointer either way.
    canvas.width = Math.round(PAD_W * dpr);
    canvas.height = Math.round(PAD_H * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Transparent background: the signature has to composite over whatever is
    // already on the page, not paint a white block over it.
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    ctx.lineWidth = STROKE_W;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = inkColor;
    setHasInk(false);
    setError(null);
  }, [inkColor]);

  useEffect(() => {
    if (!open) return;
    // A fresh pad every time it opens — otherwise the previous signature is
    // still sitting there when the admin comes back for a second one.
    resetCanvas();
  }, [open, resetCanvas]);

  /* ---------------------------------------------------------------------- */
  /* Drawing                                                                */
  /* ---------------------------------------------------------------------- */
  const pointFrom = useCallback((e: React.PointerEvent | PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    // Scale from the on-screen box back to the logical 640x220 surface, so a
    // responsive shrink does not offset the strokes.
    const sx = r.width > 0 ? PAD_W / r.width : 1;
    const sy = r.height > 0 ? PAD_H / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }, []);

  const strokeTo = useCallback(
    (p: Point) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const from = lastRef.current ?? p;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional; window listeners finish the stroke */
      }
      pointerIdRef.current = e.pointerId;
      drawingRef.current = true;
      const p = pointFrom(e);
      lastRef.current = p;
      // A single tap should leave a dot, not nothing.
      strokeTo({ x: p.x + 0.01, y: p.y + 0.01 });
      setHasInk(true);
      setError(null);
    },
    [pointFrom, strokeTo],
  );

  useEffect(() => {
    if (!open) return;

    const move = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();
      strokeTo(pointFrom(e));
    };
    const end = (e: PointerEvent) => {
      if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
      drawingRef.current = false;
      lastRef.current = null;
      pointerIdRef.current = null;
    };

    // `passive: false` so `preventDefault` actually stops touch scrolling.
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [open, pointFrom, strokeTo]);

  /* ---------------------------------------------------------------------- */
  /* Trim + export                                                          */
  /* ---------------------------------------------------------------------- */
  const exportTrimmed = useCallback((): SignatureResult | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const { width: cw, height: ch } = canvas;
    if (cw === 0 || ch === 0) return null;

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch {
      return null;
    }

    let minX = cw;
    let minY = ch;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < ch; y++) {
      const row = y * cw * 4;
      for (let x = 0; x < cw; x++) {
        // Alpha only: the ink colour is configurable, transparency is not.
        if (data[row + x * 4 + 3] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null; // no ink at all

    const dpr = cw / PAD_W;
    const pad = Math.round(TRIM_PAD * dpr);
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(cw - sx, maxX - minX + 1 + pad * 2);
    const sh = Math.min(ch - sy, maxY - minY + 1 + pad * 2);

    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    return {
      dataUrl: out.toDataURL("image/png"),
      // Report the size in logical CSS pixels so the caller's aspect ratio is
      // right regardless of the device pixel ratio it was drawn at.
      width: sw / dpr,
      height: sh / dpr,
    };
  }, []);

  const handleConfirm = useCallback(() => {
    const result = exportTrimmed();
    if (!result) {
      setError("ยังไม่ได้วาดลายเซ็น กรุณาวาดในกรอบด้านบนก่อน");
      return;
    }
    onConfirm(result);
  }, [exportTrimmed, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="วาดลายเซ็น"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">วาดลายเซ็น</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              ใช้เมาส์ นิ้ว หรือปากกาสไตลัสวาดในกรอบด้านล่าง ระบบจะตัดขอบว่างออกให้อัตโนมัติ
              <br />
              หมายเหตุ: สิ่งที่ได้คือ &ldquo;ภาพลายเซ็น&rdquo; เท่านั้น ไม่ใช่ลายเซ็นอิเล็กทรอนิกส์ที่มีใบรับรอง
              และไม่สามารถใช้ยืนยันตัวตนทางกฎหมายได้
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border-2 border-dashed border-gray-300 bg-[repeating-linear-gradient(45deg,#fafafa_0_10px,#f3f4f6_10px_20px)]">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            className="block h-auto w-full cursor-crosshair"
            style={{ touchAction: "none" }}
          />
        </div>

        <div className="mt-1 h-5 text-xs text-red-600">{error}</div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={resetCanvas}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            ล้าง
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!hasInk}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            ใช้ลายเซ็นนี้
          </button>
        </div>
      </div>
    </div>
  );
}
