// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  toBytes,
  isDetached,
  disposableCopy,
  base64ToBytes,
  sniffImageKind,
  indexOfAscii,
} from '@/app/lib/pdfBytes';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_HEADER = [0xff, 0xd8, 0xff, 0xe0];

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

describe('toBytes', () => {
  it('copies an ArrayBuffer rather than viewing it', () => {
    const ab = new ArrayBuffer(3);
    new Uint8Array(ab).set([1, 2, 3]);
    const out = toBytes(ab);
    expect(Array.from(out)).toEqual([1, 2, 3]);

    new Uint8Array(ab)[0] = 99; // mutate the source afterwards
    expect(out[0]).toBe(1); // the copy is unaffected
  });

  it('copies a Uint8Array', () => {
    const src = new Uint8Array([4, 5, 6]);
    const out = toBytes(src);
    expect(Array.from(out)).toEqual([4, 5, 6]);
    expect(out).not.toBe(src);
    src[0] = 99;
    expect(out[0]).toBe(4);
  });

  it('honours byteOffset when given a view onto a larger buffer', () => {
    const ab = new ArrayBuffer(6);
    new Uint8Array(ab).set([0, 1, 2, 3, 4, 5]);
    const view = new Uint8Array(ab, 2, 3);
    expect(Array.from(toBytes(view))).toEqual([2, 3, 4]);
  });

  it('turns a Node Buffer into a PLAIN Uint8Array (the "type NaN" jsdom trap)', () => {
    // pdf-lib's embedPng rejects a value that is not a real Uint8Array of the
    // current realm — a Buffer handed across the jsdom boundary throws
    // "was actually of type NaN". The result here must be a plain Uint8Array.
    const buf = Buffer.from([7, 8, 9]);
    const out = toBytes(buf);
    expect(Array.from(out)).toEqual([7, 8, 9]);
    expect(out.constructor).toBe(Uint8Array);
    expect(Buffer.isBuffer(out)).toBe(false);
    expect(Object.getPrototypeOf(out)).toBe(Uint8Array.prototype);
  });

  it('handles a Buffer that is a slice of the shared pool (non-zero byteOffset)', () => {
    const buf = Buffer.from([10, 11, 12, 13]).subarray(1, 3);
    expect(buf.byteOffset).toBeGreaterThan(0);
    expect(Array.from(toBytes(buf))).toEqual([11, 12]);
  });

  it('reads a DataView too', () => {
    const ab = new ArrayBuffer(4);
    new Uint8Array(ab).set([1, 2, 3, 4]);
    expect(Array.from(toBytes(new DataView(ab, 1, 2)))).toEqual([2, 3]);
  });

  it('THROWS LOUDLY on a detached buffer instead of returning empty bytes', () => {
    const ab = new ArrayBuffer(8);
    structuredClone(ab, { transfer: [ab] }); // pdf.js does this to the worker
    expect(isDetached(ab)).toBe(true);
    expect(() => toBytes(ab)).toThrow(/detached/);
  });

  it('throws on an empty buffer', () => {
    expect(() => toBytes(new ArrayBuffer(0))).toThrow(/empty or detached/);
    expect(() => toBytes(new Uint8Array(0))).toThrow(/empty or detached/);
  });

  it('rejects a value that is neither bytes nor a string', () => {
    expect(() => toBytes(42 as never)).toThrow(TypeError);
    expect(() => toBytes(null as never)).toThrow(/unsupported input/);
  });

  it('decodes a base64 data: URI — what canvas.toDataURL() gives for a signature', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    const out = toBytes(uri);
    expect(Array.from(out)).toEqual(PNG_HEADER);
    expect(sniffImageKind(out)).toBe('png');
  });

  it('decodes a percent-encoded (non-base64) data: URI', () => {
    expect(Array.from(toBytes('data:text/plain,A%42C'))).toEqual([65, 66, 67]);
  });

  it('decodes a bare base64 payload', () => {
    expect(Array.from(toBytes('AQID'))).toEqual([1, 2, 3]);
  });

  it('tolerates whitespace and a leading/trailing trim', () => {
    expect(Array.from(toBytes('  AQ ID  '))).toEqual([1, 2, 3]);
  });

  it('refuses prose rather than silently encoding it as UTF-8 bytes', () => {
    expect(() => toBytes('ไม่ใช่รูปภาพ')).toThrow(/not valid base64/);
    expect(() => toBytes('hello, world!')).toThrow(/not valid base64/);
  });

  it('refuses a malformed data: URI', () => {
    expect(() => toBytes('data:image/png;base64')).toThrow(/malformed data: URI/);
  });
});

describe('base64ToBytes', () => {
  it('decodes with and without padding', () => {
    expect(Array.from(base64ToBytes('QUJD'))).toEqual([65, 66, 67]);
    expect(Array.from(base64ToBytes('QUI='))).toEqual([65, 66]);
    expect(Array.from(base64ToBytes('QQ=='))).toEqual([65]);
    expect(Array.from(base64ToBytes('QUI'))).toEqual([65, 66]);
  });

  it('accepts the URL-safe alphabet', () => {
    expect(Array.from(base64ToBytes('-_8='))).toEqual(
      Array.from(base64ToBytes('+/8=')),
    );
  });

  it('decodes an empty string to empty bytes', () => {
    expect(base64ToBytes('').length).toBe(0);
  });

  it('rejects a length that cannot be base64 and non-alphabet characters', () => {
    expect(() => base64ToBytes('QUJDQ')).toThrow(/not valid base64/);
    expect(() => base64ToBytes('ab*d')).toThrow(/not valid base64/);
  });

  it('agrees with Buffer for a random payload', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256);
    const b64 = Buffer.from(bytes).toString('base64');
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
  });
});

describe('disposableCopy — the <Document> detachment dance', () => {
  it('returns a copy that can be detached without harming the original', () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const copy = disposableCopy(original);
    expect(Array.from(copy)).toEqual([1, 2, 3, 4]);
    expect(copy.buffer).not.toBe(original.buffer);

    // Hand the copy to the "worker" and let it be transferred away.
    structuredClone(copy.buffer, { transfer: [copy.buffer] });
    expect(isDetached(copy.buffer as ArrayBuffer)).toBe(true);
    expect(isDetached(original.buffer as ArrayBuffer)).toBe(false);
    expect(Array.from(original)).toEqual([1, 2, 3, 4]);
  });

  it('makes a NEW copy every time, so re-mounting is safe', () => {
    const original = new Uint8Array([1, 2, 3]);
    expect(disposableCopy(original).buffer).not.toBe(disposableCopy(original).buffer);
  });

  it('honours byteOffset', () => {
    const ab = new ArrayBuffer(5);
    new Uint8Array(ab).set([1, 2, 3, 4, 5]);
    expect(Array.from(disposableCopy(new Uint8Array(ab, 1, 3)))).toEqual([2, 3, 4]);
  });
});

describe('sniffImageKind — file.type is not trustworthy', () => {
  it('recognises a PNG by its 8-byte signature', () => {
    expect(sniffImageKind(new Uint8Array([...PNG_HEADER, 0, 0]))).toBe('png');
  });

  it('recognises a JPEG by FF D8 FF', () => {
    expect(sniffImageKind(new Uint8Array([...JPG_HEADER, 0]))).toBe('jpg');
  });

  it('sees through a PNG that was renamed to .jpg', () => {
    // The browser would report type "image/jpeg" for this file; embedJpg would
    // then fail deep inside pdf-lib. The magic bytes say otherwise.
    expect(sniffImageKind(new Uint8Array(PNG_HEADER))).toBe('png');
  });

  it('returns null for a PDF, for text and for a near-miss signature', () => {
    expect(sniffImageKind(ascii('%PDF-1.7'))).toBeNull();
    expect(sniffImageKind(ascii('GIF89a'))).toBeNull();
    expect(sniffImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x46, 0, 0, 0, 0]))).toBeNull();
    expect(sniffImageKind(new Uint8Array([0xff, 0xd8, 0xfe]))).toBeNull();
  });

  it('returns null for bytes shorter than a signature, without throwing', () => {
    expect(sniffImageKind(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageKind(new Uint8Array([]))).toBeNull();
  });
});

describe('indexOfAscii', () => {
  const hay = ascii('abc %PDF-1.7 xyz %PDF-');

  it('finds a needle and reports its offset', () => {
    expect(indexOfAscii(hay, '%PDF-')).toBe(4);
  });

  it('resumes from an offset to find a later occurrence', () => {
    expect(indexOfAscii(hay, '%PDF-', 5)).toBe(17);
  });

  it('returns -1 when absent', () => {
    expect(indexOfAscii(hay, '/Encrypt')).toBe(-1);
  });

  it('respects the end of the search window', () => {
    expect(indexOfAscii(hay, '%PDF-', 0, 8)).toBe(-1);
    expect(indexOfAscii(hay, '%PDF-', 0, 9)).toBe(4);
  });

  it('handles an empty needle and a negative start', () => {
    expect(indexOfAscii(hay, '')).toBe(0);
    expect(indexOfAscii(hay, '%PDF-', -10)).toBe(4);
  });

  it('does not match a needle longer than the haystack', () => {
    expect(indexOfAscii(ascii('ab'), 'abcdef')).toBe(-1);
  });
});
