import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// TOTP — the 6-digit code an authenticator app (Google Authenticator, Authy,
// 1Password, Microsoft Authenticator…) shows, RFC 6238 on top of RFC 4226's
// HOTP: HMAC-SHA1 over the number of 30-second steps since 1970, truncated to
// six digits. The parameters below are the ones every one of those apps
// assumes when a QR code says nothing else, so they are fixed, not options.
//
// Pure functions over node:crypto — no network, no third party. The app
// computes the same number the phone does, from the same secret and the clock.

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/**
 * Steps either side of "now" that are still accepted: ±30 s of clock drift
 * between the phone and the server, plus the seconds it takes to type the
 * code. Wider would let more codes count as correct at any moment.
 */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding — the form authenticator apps take secrets in. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The inverse of base32Encode; spaces, dashes and case are ignored. Null if
 *  any character is not base32. */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** A new secret: 160 random bits (RFC 4226's recommended length), base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 30-second step `nowMs` falls in. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one step (RFC 4226 §5.3 dynamic truncation), zero-padded. */
export function totpCodeAt(secret: Uint8Array, step: number, digits: number = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * The step a typed code belongs to, or null if it matches none inside the
 * window. The STEP, not a boolean: the caller records it so the same code can
 * never be used twice (see verifyAndConsumeTotp in twoFactor.ts).
 *
 * Every candidate is compared, in constant time, even after a match — how long
 * this takes must not depend on which step (if any) the code is for.
 */
export function matchTotpStep(
  secretBase32: string,
  code: string,
  nowMs: number,
  window: number = TOTP_WINDOW
): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  if (!secret || secret.length === 0) return null;
  const typed = Buffer.from(digits);
  const now = totpStep(nowMs);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta++) {
    const expected = Buffer.from(totpCodeAt(secret, now + delta));
    if (timingSafeEqual(expected, typed) && matched === null) matched = now + delta;
  }
  return matched;
}

/**
 * The otpauth:// URI an authenticator app reads out of the QR code. Issuer
 * and account are what the app lists the entry under ("PROFIN (admin)").
 */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
