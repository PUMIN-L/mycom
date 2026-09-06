/**
 * pdfValidate.ts — the upload guards and their Thai messages.
 *
 * EVERY NUMBER THE IN-PAGE GUIDE DISPLAYS IS IMPORTED FROM HERE. Typing "50MB"
 * as prose in the guide is how a limit and its documentation drift apart.
 *
 * THE ASYMMETRY THIS FIXES: the tool being replaced checked the SIZE of an
 * upload but never its TYPE, so a renamed file sailed past the guard and died
 * later inside pdf-lib, surfacing as a generic "ไม่สามารถสร้าง PDF ได้". Both
 * halves are checked here, against the magic bytes rather than `file.type`.
 *
 * ENCRYPTION: pdf-lib 1.17.1 cannot DECRYPT. `ignoreEncryption` only suppresses
 * the throw and hands back ciphertext that renders as garbage, so a
 * password-protected upload must be REFUSED outright, never half-opened.
 */

import { indexOfAscii, sniffImageKind } from "./pdfBytes";

/* ------------------------------------------------------------------ *
 * The limits — the single source of truth for the UI and the guide
 * ------------------------------------------------------------------ */

const MB = 1024 * 1024;

/** Hard refusal above this. Everything happens in the browser's memory. */
export const MAX_PDF_BYTES = 50 * MB;
/** Accepted, but warn: editing gets sluggish and saving takes a while. */
export const WARN_PDF_BYTES = 20 * MB;
export const MAX_IMAGE_BYTES = 10 * MB;
/** Rendering thumbnails for more than this in one browser tab is not usable. */
export const MAX_PAGES = 200;

export const MAX_PDF_MB = MAX_PDF_BYTES / MB;
export const WARN_PDF_MB = WARN_PDF_BYTES / MB;
export const MAX_IMAGE_MB = MAX_IMAGE_BYTES / MB;

/** Ready-made Thai strings for the guide, so it can never quote a stale number. */
export const LIMITS_TH = {
  maxPdf: `ไฟล์ PDF ขนาดไม่เกิน ${MAX_PDF_MB} MB`,
  warnPdf: `ไฟล์ที่ใหญ่กว่า ${WARN_PDF_MB} MB จะทำงานช้าลง`,
  maxImage: `รูปภาพขนาดไม่เกิน ${MAX_IMAGE_MB} MB (รองรับ PNG และ JPG)`,
  maxPages: `รองรับสูงสุด ${MAX_PAGES} หน้าต่อไฟล์`,
} as const;

/* ------------------------------------------------------------------ *
 * Thai messages
 * ------------------------------------------------------------------ */

export const MSG_TH = {
  pdfTooLarge: `ไฟล์ PDF ขนาดใหญ่เกินไป (สูงสุด ${MAX_PDF_MB} MB)`,
  pdfEmpty: "ไฟล์ว่างเปล่า กรุณาเลือกไฟล์ใหม่",
  notPdf: "ไฟล์นี้ไม่ใช่ไฟล์ PDF แม้ชื่อไฟล์จะลงท้ายด้วย .pdf กรุณาตรวจสอบไฟล์อีกครั้ง",
  encrypted:
    "ไฟล์ PDF นี้ตั้งรหัสผ่านไว้ จึงเปิดแก้ไขไม่ได้ กรุณาปลดรหัสผ่านออกก่อน แล้วอัปโหลดใหม่อีกครั้ง",
  xfa:
    "ไฟล์นี้เป็นฟอร์มแบบ XFA (ฟอร์มของ Adobe LiveCycle) ระบบเปิดดูและแก้ไขหน้ากระดาษได้ แต่กรอกข้อมูลในช่องฟอร์มไม่ได้",
  tooManyPages: `ไฟล์นี้มีจำนวนหน้ามากเกินไป (สูงสุด ${MAX_PAGES} หน้า)`,
  pdfSlow: `ไฟล์มีขนาดใหญ่กว่า ${WARN_PDF_MB} MB การแก้ไขและการบันทึกอาจใช้เวลานาน`,
  imageTooLarge: `ไฟล์รูปภาพขนาดใหญ่เกินไป (สูงสุด ${MAX_IMAGE_MB} MB)`,
  imageEmpty: "ไฟล์รูปภาพว่างเปล่า กรุณาเลือกไฟล์ใหม่",
  notImage: "รองรับเฉพาะรูปภาพชนิด PNG และ JPG เท่านั้น กรุณาเลือกไฟล์ใหม่",
  /**
   * The honest limit of white-out. An admin WILL assume otherwise, so the
   * guide has to say it plainly: covering is not removing.
   */
  whiteoutNotRedaction:
    "การถมทับ (ลบข้อความ) เป็นการวางแผ่นสีทับข้อความเดิมเท่านั้น ข้อความเดิมยังอยู่ในไฟล์และยังคัดลอกออกมาได้ ห้ามใช้ปกปิดข้อมูลลับ",
} as const;

/* ------------------------------------------------------------------ *
 * Byte sniffing
 * ------------------------------------------------------------------ */

/**
 * `%PDF-` within the first 1024 bytes. The header is allowed to sit a little
 * way in — Acrobat itself accepts that — so the whole prefix window is scanned
 * rather than only offset 0.
 */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  return indexOfAscii(bytes, "%PDF-", 0, Math.min(1024, bytes.length)) >= 0;
}

/**
 * Heuristic pre-check for an encrypted file: an `/Encrypt` entry in a trailer
 * or XRef-stream dictionary. It is deliberately a fast pre-check — the
 * authoritative answer is pdf-lib throwing `EncryptedPDFError` on load, and the
 * caller must handle that too. The key is only accepted when followed by the
 * whitespace / digit / `<` that a real dictionary entry has, so the word
 * appearing inside uncompressed content does not trip it.
 */
export function looksEncrypted(bytes: Uint8Array): boolean {
  let at = 0;
  for (;;) {
    const i = indexOfAscii(bytes, "/Encrypt", at);
    if (i < 0) return false;
    const next = bytes[i + 8];
    if (
      next === undefined ||
      next === 0x20 || // space
      next === 0x0a || // LF
      next === 0x0d || // CR
      next === 0x09 || // tab
      next === 0x3c || // '<'
      (next >= 0x30 && next <= 0x39) // digit — "/Encrypt 12 0 R"
    ) {
      return true;
    }
    at = i + 8;
  }
}

/**
 * XFA forms. The page tree still renders, but the AcroForm field list is empty
 * or a stub, so form filling has to be reported as unavailable rather than
 * silently doing nothing.
 */
export function hasXfa(bytes: Uint8Array): boolean {
  return indexOfAscii(bytes, "/XFA") >= 0;
}

/* ------------------------------------------------------------------ *
 * The guards
 * ------------------------------------------------------------------ */

export type ValidationCode =
  | "pdf-too-large"
  | "pdf-empty"
  | "not-pdf"
  | "encrypted"
  | "too-many-pages"
  | "image-too-large"
  | "image-empty"
  | "not-image";

export type WarningCode = "pdf-slow" | "xfa";

export type ValidationResult = {
  ok: boolean;
  code?: ValidationCode;
  /** Thai, ready to put straight into the ErrorModal / Toast. */
  errorTh?: string;
  warningCode?: WarningCode;
  warningTh?: string;
};

/**
 * Size first (cheap), then type, then encryption. Order matters: a 200 MB file
 * should be refused for its size before anything scans 200 MB of it.
 */
export function validatePdfUpload(input: {
  size: number;
  bytes: Uint8Array;
}): ValidationResult {
  if (input.size > MAX_PDF_BYTES) {
    return { ok: false, code: "pdf-too-large", errorTh: MSG_TH.pdfTooLarge };
  }
  if (input.size <= 0 || input.bytes.length === 0) {
    return { ok: false, code: "pdf-empty", errorTh: MSG_TH.pdfEmpty };
  }
  if (!hasPdfMagic(input.bytes)) {
    return { ok: false, code: "not-pdf", errorTh: MSG_TH.notPdf };
  }
  if (looksEncrypted(input.bytes)) {
    return { ok: false, code: "encrypted", errorTh: MSG_TH.encrypted };
  }
  if (hasXfa(input.bytes)) {
    return { ok: true, warningCode: "xfa", warningTh: MSG_TH.xfa };
  }
  if (input.size > WARN_PDF_BYTES) {
    return { ok: true, warningCode: "pdf-slow", warningTh: MSG_TH.pdfSlow };
  }
  return { ok: true };
}

/** Checked after the page count is known, which needs the file parsed. */
export function validatePageCount(pageCount: number): ValidationResult {
  if (pageCount > MAX_PAGES) {
    return { ok: false, code: "too-many-pages", errorTh: MSG_TH.tooManyPages };
  }
  return { ok: true };
}

/** PNG/JPG by magic bytes — `file.type` is never consulted. */
export function validateImageUpload(input: {
  size: number;
  bytes: Uint8Array;
}): ValidationResult {
  if (input.size > MAX_IMAGE_BYTES) {
    return { ok: false, code: "image-too-large", errorTh: MSG_TH.imageTooLarge };
  }
  if (input.size <= 0 || input.bytes.length === 0) {
    return { ok: false, code: "image-empty", errorTh: MSG_TH.imageEmpty };
  }
  if (sniffImageKind(input.bytes) === null) {
    return { ok: false, code: "not-image", errorTh: MSG_TH.notImage };
  }
  return { ok: true };
}
