// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  MAX_PDF_BYTES,
  WARN_PDF_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PAGES,
  MAX_PDF_MB,
  WARN_PDF_MB,
  MAX_IMAGE_MB,
  LIMITS_TH,
  MSG_TH,
  hasPdfMagic,
  looksEncrypted,
  hasXfa,
  validatePdfUpload,
  validatePageCount,
  validateImageUpload,
} from '@/app/lib/pdfValidate';

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A minimal but realistic-looking PDF byte string. */
function pdfBytes(extra = ''): Uint8Array {
  return ascii(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\n%%EOF`);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

describe('the limits are the single source of truth', () => {
  it('exposes the byte limits and their MB equivalents together', () => {
    expect(MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
    expect(WARN_PDF_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_PDF_MB).toBe(50);
    expect(WARN_PDF_MB).toBe(20);
    expect(MAX_IMAGE_MB).toBe(10);
    expect(MAX_PAGES).toBe(200);
  });

  it('warns below the hard limit, so the two thresholds cannot cross', () => {
    expect(WARN_PDF_BYTES).toBeLessThan(MAX_PDF_BYTES);
  });

  it('builds the guide strings FROM the numbers, so they cannot go stale', () => {
    expect(LIMITS_TH.maxPdf).toContain(String(MAX_PDF_MB));
    expect(LIMITS_TH.warnPdf).toContain(String(WARN_PDF_MB));
    expect(LIMITS_TH.maxImage).toContain(String(MAX_IMAGE_MB));
    expect(LIMITS_TH.maxPages).toContain(String(MAX_PAGES));
  });

  it('every message is in Thai', () => {
    for (const msg of Object.values({ ...MSG_TH, ...LIMITS_TH })) {
      expect(msg).toMatch(/[ก-๙]/);
    }
  });

  it('states plainly that white-out is NOT redaction', () => {
    // The admin will assume otherwise. The guide has to be honest about it.
    expect(MSG_TH.whiteoutNotRedaction).toContain('ยังอยู่ในไฟล์');
    expect(MSG_TH.whiteoutNotRedaction).toContain('คัดลอก');
  });

  it('tells the admin to remove the password rather than offering to do it', () => {
    expect(MSG_TH.encrypted).toContain('รหัสผ่าน');
    expect(MSG_TH.encrypted).toContain('ปลดรหัสผ่าน');
  });
});

describe('hasPdfMagic — the TYPE check the old tool never did', () => {
  it('accepts a header at offset 0', () => {
    expect(hasPdfMagic(ascii('%PDF-1.4\n...'))).toBe(true);
  });

  it('accepts a header a little way in, as Acrobat does', () => {
    expect(hasPdfMagic(ascii('junk'.repeat(50) + '%PDF-1.7'))).toBe(true);
  });

  it('rejects a header beyond the 1024-byte window', () => {
    expect(hasPdfMagic(ascii('x'.repeat(1100) + '%PDF-1.7'))).toBe(false);
  });

  it('rejects a renamed text file, a PNG and empty bytes', () => {
    expect(hasPdfMagic(ascii('สวัสดี ไฟล์นี้ไม่ใช่ PDF'))).toBe(false);
    expect(hasPdfMagic(PNG)).toBe(false);
    expect(hasPdfMagic(new Uint8Array(0))).toBe(false);
  });
});

describe('looksEncrypted', () => {
  it('detects an /Encrypt entry pointing at an object', () => {
    expect(looksEncrypted(ascii('trailer << /Size 9 /Encrypt 8 0 R >>'))).toBe(true);
  });

  it('detects an inline /Encrypt dictionary', () => {
    expect(looksEncrypted(ascii('<< /Encrypt<< /V 2 >> >>'))).toBe(true);
  });

  it('detects it after a newline or a tab', () => {
    expect(looksEncrypted(ascii('/Encrypt\n8 0 R'))).toBe(true);
    expect(looksEncrypted(ascii('/Encrypt\t8 0 R'))).toBe(true);
    expect(looksEncrypted(ascii('/Encrypt\r\n8 0 R'))).toBe(true);
  });

  it('detects it at the very end of the file', () => {
    expect(looksEncrypted(ascii('trailer << /Encrypt'))).toBe(true);
  });

  it('does NOT trip on a longer key that merely starts the same way', () => {
    // A false positive here refuses a perfectly good file, so the guard has to
    // require a real delimiter after the key.
    expect(looksEncrypted(ascii('<< /EncryptMetadata false >>'))).toBe(false);
    expect(looksEncrypted(ascii('/Encryption /None'))).toBe(false);
  });

  it('keeps scanning past a near miss to find a real one later', () => {
    expect(looksEncrypted(ascii('/EncryptMetadata false ... /Encrypt 8 0 R'))).toBe(true);
  });

  it('is false for an ordinary document', () => {
    expect(looksEncrypted(pdfBytes())).toBe(false);
    expect(looksEncrypted(new Uint8Array(0))).toBe(false);
  });
});

describe('hasXfa', () => {
  it('detects an XFA form', () => {
    expect(hasXfa(ascii('<< /AcroForm << /XFA 12 0 R >> >>'))).toBe(true);
  });

  it('is false for a plain AcroForm', () => {
    expect(hasXfa(ascii('<< /AcroForm << /Fields [] >> >>'))).toBe(false);
  });
});

describe('validatePdfUpload', () => {
  it('accepts an ordinary file with no warning', () => {
    expect(validatePdfUpload({ size: 1000, bytes: pdfBytes() })).toEqual({ ok: true });
  });

  it('refuses a file over the hard limit', () => {
    const r = validatePdfUpload({ size: MAX_PDF_BYTES + 1, bytes: pdfBytes() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('pdf-too-large');
    expect(r.errorTh).toBe(MSG_TH.pdfTooLarge);
    expect(r.errorTh).toContain('50');
  });

  it('accepts a file exactly at the limit (the boundary is inclusive)', () => {
    expect(validatePdfUpload({ size: MAX_PDF_BYTES, bytes: pdfBytes() }).ok).toBe(true);
  });

  it('checks SIZE before TYPE, so a huge junk file is not scanned first', () => {
    const r = validatePdfUpload({ size: MAX_PDF_BYTES + 1, bytes: ascii('not a pdf') });
    expect(r.code).toBe('pdf-too-large');
  });

  it('refuses an empty file', () => {
    expect(validatePdfUpload({ size: 0, bytes: new Uint8Array(0) }).code).toBe('pdf-empty');
    expect(validatePdfUpload({ size: 10, bytes: new Uint8Array(0) }).code).toBe('pdf-empty');
  });

  it('REFUSES A RENAMED FILE — the asymmetry the old page had', () => {
    // The old tool checked the size but never the type, so this died later in
    // a generic catch. It now fails at the door with a message that says why.
    const r = validatePdfUpload({ size: 500, bytes: ascii('this is a text file, honestly') });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('not-pdf');
    expect(r.errorTh).toBe(MSG_TH.notPdf);
  });

  it('refuses a password-protected file instead of half-opening it', () => {
    const r = validatePdfUpload({
      size: 5000,
      bytes: pdfBytes('trailer << /Encrypt 8 0 R >>'),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('encrypted');
    expect(r.errorTh).toBe(MSG_TH.encrypted);
  });

  it('checks encryption before it bothers reporting the size warning', () => {
    const r = validatePdfUpload({
      size: WARN_PDF_BYTES + 1,
      bytes: pdfBytes('/Encrypt 8 0 R'),
    });
    expect(r.code).toBe('encrypted');
  });

  it('accepts an XFA form but warns that fields cannot be filled', () => {
    const r = validatePdfUpload({ size: 5000, bytes: pdfBytes('/AcroForm << /XFA 1 0 R >>') });
    expect(r.ok).toBe(true);
    expect(r.warningCode).toBe('xfa');
    expect(r.warningTh).toBe(MSG_TH.xfa);
  });

  it('accepts a large file but warns that it will be slow', () => {
    const r = validatePdfUpload({ size: WARN_PDF_BYTES + 1, bytes: pdfBytes() });
    expect(r.ok).toBe(true);
    expect(r.warningCode).toBe('pdf-slow');
    expect(r.warningTh).toContain('20');
  });

  it('does not warn at exactly the warn threshold', () => {
    expect(validatePdfUpload({ size: WARN_PDF_BYTES, bytes: pdfBytes() })).toEqual({ ok: true });
  });
});

describe('validatePageCount', () => {
  it('accepts a normal document and the exact limit', () => {
    expect(validatePageCount(1)).toEqual({ ok: true });
    expect(validatePageCount(MAX_PAGES)).toEqual({ ok: true });
  });

  it('refuses more pages than the browser can handle', () => {
    const r = validatePageCount(MAX_PAGES + 1);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('too-many-pages');
    expect(r.errorTh).toContain(String(MAX_PAGES));
  });
});

describe('validateImageUpload', () => {
  it('accepts a PNG and a JPEG', () => {
    expect(validateImageUpload({ size: 100, bytes: PNG })).toEqual({ ok: true });
    expect(validateImageUpload({ size: 100, bytes: JPG })).toEqual({ ok: true });
  });

  it('refuses an oversized image', () => {
    const r = validateImageUpload({ size: MAX_IMAGE_BYTES + 1, bytes: PNG });
    expect(r.code).toBe('image-too-large');
    expect(r.errorTh).toContain('10');
  });

  it('accepts an image exactly at the limit', () => {
    expect(validateImageUpload({ size: MAX_IMAGE_BYTES, bytes: PNG }).ok).toBe(true);
  });

  it('refuses an empty image', () => {
    expect(validateImageUpload({ size: 0, bytes: new Uint8Array(0) }).code).toBe('image-empty');
  });

  it('refuses a GIF, a PDF and a renamed text file whatever file.type claimed', () => {
    expect(validateImageUpload({ size: 100, bytes: ascii('GIF89a') }).code).toBe('not-image');
    expect(validateImageUpload({ size: 100, bytes: pdfBytes() }).code).toBe('not-image');
    expect(validateImageUpload({ size: 100, bytes: ascii('hello') }).errorTh).toBe(
      MSG_TH.notImage,
    );
  });
});
