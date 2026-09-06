/**
 * pdfBytes.ts — every byte that enters the editor comes through here.
 *
 * TWO REAL BUGS THIS CLOSES
 *
 * 1. `file.type` IS NOT TRUSTWORTHY. The browser fills it from the file
 *    extension, so a renamed `.txt` claims `application/pdf` and a PNG renamed
 *    to `.jpg` claims `image/jpeg`. `sniffImageKind` reads the MAGIC BYTES
 *    instead, in ONE place — the old tool did the same check twice, in two
 *    slightly different ways.
 *
 * 2. THE CROSS-REALM / DETACHED BUFFER TRAP. pdf-lib's `embedPng` validates its
 *    input with an `instanceof`-style check that fails for a value created in
 *    another realm — a Node `Buffer` handed across the jsdom boundary throws
 *    `"was actually of type NaN"`. And pdf.js TRANSFERS any ArrayBuffer given
 *    to `<Document>` to its worker, leaving `byteLength === 0` in the main
 *    thread, after which pdf-lib throws "Cannot perform Construct on a detached
 *    ArrayBuffer". `toBytes` therefore always returns a FRESH, PLAIN
 *    `Uint8Array` allocated in the CURRENT realm — a copy, never a view onto
 *    somebody else's buffer — and refuses a detached one loudly.
 */

/** What `toBytes` accepts. `string` means a data: URI or bare base64. */
export type ByteSource = ArrayBuffer | ArrayBufferView | string;

/**
 * Normalise anything byte-ish into a fresh, plain, same-realm `Uint8Array`.
 *
 * Always COPIES. That is the point: the copy cannot be detached by pdf.js
 * later, and it is a genuine `Uint8Array` rather than a `Buffer` or a
 * foreign-realm view, so pdf-lib accepts it.
 */
export function toBytes(input: ByteSource): Uint8Array {
  if (typeof input === "string") return decodeStringBytes(input);

  if (isArrayBufferLike(input)) {
    if (input.byteLength === 0) throwEmptyOrDetached();
    return new Uint8Array(input.slice(0));
  }

  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    if (view.byteLength === 0) throwEmptyOrDetached();
    // Copies the *logical* bytes, honouring byteOffset — which matters because
    // a Node Buffer is usually a slice of a shared pool with a non-zero offset.
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
    );
  }

  throw new TypeError("toBytes: unsupported input (expected ArrayBuffer, TypedArray or string)");
}

function isArrayBufferLike(v: unknown): v is ArrayBuffer {
  return (
    v instanceof ArrayBuffer ||
    Object.prototype.toString.call(v) === "[object ArrayBuffer]"
  );
}

function throwEmptyOrDetached(): never {
  // A detached buffer reports byteLength 0 and cannot be sliced into data.
  // An intentionally empty buffer is equally useless to us, so both are errors.
  throw new Error(
    "toBytes: buffer is empty or detached. pdf.js transfers any ArrayBuffer " +
      "handed to <Document> to its worker — pass it a fresh .slice(0) copy and " +
      "keep the original for pdf-lib.",
  );
}

/** True when the buffer has been transferred away (pdf.js worker hand-off). */
export function isDetached(buffer: ArrayBuffer): boolean {
  return buffer.byteLength === 0;
}

/**
 * A disposable copy for `<Document>`, which will detach whatever it is given.
 * Make a NEW one on EVERY mount, not once per upload.
 */
export function disposableCopy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

/* ------------------------------------------------------------------ *
 * String inputs
 * ------------------------------------------------------------------ */

/**
 * A `data:` URI (what `canvas.toDataURL()` returns for a drawn signature) or a
 * bare base64 payload. Plain prose is NOT accepted — silently encoding text as
 * UTF-8 and calling it image bytes would fail much further downstream, inside
 * pdf-lib, with a message nobody can act on.
 */
function decodeStringBytes(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    if (comma < 0) throw new Error("toBytes: malformed data: URI (no comma)");
    const meta = trimmed.slice(5, comma);
    const payload = trimmed.slice(comma + 1);
    if (/;base64$/i.test(meta)) return base64ToBytes(payload);
    return latin1ToBytes(decodeURIComponent(payload));
  }
  return base64ToBytes(trimmed);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Pure base64 decode — no `atob`, no `Buffer`, so it behaves identically in the
 * browser, in jsdom and in a Node test.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const body = clean.replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(body)) {
    throw new Error("toBytes: string is not valid base64 or a data: URI");
  }
  if (body.length % 4 === 1) {
    throw new Error("toBytes: string is not valid base64 or a data: URI");
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < body.length; i++) {
    acc = (acc << 6) | B64.indexOf(body[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/* ------------------------------------------------------------------ *
 * Magic bytes
 * ------------------------------------------------------------------ */

export type ImageKind = "png" | "jpg";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_MAGIC = [0xff, 0xd8, 0xff];

/**
 * What this file ACTUALLY is, read from its first bytes.
 * `null` means "not a PNG and not a JPEG" — and therefore not something
 * `embedPng` / `embedJpg` can take, whatever `file.type` claims.
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, JPG_MAGIC)) return "jpg";
  return null;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/** Find an ASCII needle in a byte range. -1 when absent. */
export function indexOfAscii(
  bytes: Uint8Array,
  needle: string,
  from = 0,
  to: number = bytes.length,
): number {
  const n = needle.length;
  if (n === 0) return from;
  const end = Math.min(to, bytes.length) - n;
  for (let i = Math.max(0, from); i <= end; i++) {
    let hit = true;
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}
