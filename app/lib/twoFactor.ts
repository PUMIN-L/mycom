import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "./db";
import { generateTotpSecret, matchTotpStep } from "./totp";

// Two-factor login (TOTP + backup codes) — the storage side. The arithmetic
// is lib/totp.ts; the routes are /api/auth/login/2fa and /api/auth/2fa/*.
//
// WHAT IS STORED, AND HOW
//   users.totpSecret         the authenticator secret, AES-256-GCM encrypted
//   users.totpPendingSecret  a secret shown as a QR code but not yet confirmed
//   users.totpEnabled        0/1
//   users.totpLastStep       the 30-second step of the last code accepted —
//                            a code is good ONCE, never again (replay)
//   user_backup_codes        HMAC-SHA256 of each backup code, usedAt once spent
//
// Both keys are DERIVED from SESSION_SECRET (HKDF, one label each), so a copy
// of the database alone gives neither the secrets nor a way to test guesses at
// backup codes offline. The cost: rotating SESSION_SECRET makes every stored
// secret and backup code unreadable — 2FA then has to be reset by hand
// (ARCHITECTURE.md §10 has the SQL) and set up again.

/** What the authenticator app lists the entry under. */
export const TWO_FACTOR_ISSUER = "PROFIN";
export const BACKUP_CODE_COUNT = 10;
/** No 0/O, 1/I/L: a code read off paper must not be ambiguous. 31 symbols. */
const BACKUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BACKUP_CODE_LENGTH = 8; // 31^8 ≈ 8.5 × 10^11, each usable once

function derivedKey(label: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "", label, 32));
}

// ── The secret at rest ───────────────────────────────────────────────────────

/** "v1:" + base64(iv ‖ tag ‖ ciphertext). The prefix names the format, so a
 *  later scheme can sit beside this one. */
export function encryptTotpSecret(secretBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("mycom/totp-secret/v1"), iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

/** The secret, or null if `stored` is missing, malformed, tampered with, or
 *  was encrypted under a different SESSION_SECRET (GCM's tag says so). */
export function decryptTotpSecret(stored: string | null | undefined): string | null {
  if (!stored || !stored.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(stored.slice(3), "base64");
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", derivedKey("mycom/totp-secret/v1"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Backup codes ─────────────────────────────────────────────────────────────

/** `count` distinct codes, shown as "ABCD-EFGH". Plain text exists only in the
 *  response that shows them once; the database keeps hashes. */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = "";
    for (let i = 0; i < BACKUP_CODE_LENGTH; i++) raw += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

/** " abcd-efgh " → "ABCDEFGH"; null if it cannot be a backup code at all. */
export function normalizeBackupCode(input: string): string | null {
  const clean = input.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length !== BACKUP_CODE_LENGTH) return null;
  for (const char of clean) if (!BACKUP_ALPHABET.includes(char)) return null;
  return clean;
}

/** Keyed, so a leaked table of hashes cannot be brute-forced offline. */
export function hashBackupCode(normalized: string): string {
  return createHmac("sha256", derivedKey("mycom/totp-backup/v1")).update(normalized).digest("hex");
}

async function replaceBackupCodes(
  conn: PoolConnection,
  userId: string,
  codes: string[],
  now: string
): Promise<void> {
  await conn.query("DELETE FROM user_backup_codes WHERE userId = ?", [userId]);
  await conn.query(
    `INSERT INTO user_backup_codes (id, userId, codeHash, usedAt, createdAt) VALUES ${codes
      .map(() => "(?, ?, ?, NULL, ?)")
      .join(", ")}`,
    codes.flatMap((code) => [randomUUID(), userId, hashBackupCode(normalizeBackupCode(code)!), now])
  );
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface TwoFactorUser {
  id: string;
  username: string;
  passwordHash: string;
  totpEnabled: boolean;
}

export async function getTwoFactorUser(userId: string): Promise<TwoFactorUser | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, username, passwordHash, totpEnabled FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.passwordHash),
    totpEnabled: Number(row.totpEnabled) === 1,
  };
}

export async function countUnusedBackupCodes(userId: string): Promise<number> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM user_backup_codes WHERE userId = ? AND usedAt IS NULL",
    [userId]
  );
  return Number(rows[0]?.n) || 0;
}

// ── Setting up ───────────────────────────────────────────────────────────────

/**
 * Start setup: a fresh secret, stored as PENDING — nothing about logging in
 * changes until it is confirmed with a code from the app. Starting again
 * replaces it (the old QR code stops working). Null when 2FA is already on:
 * a live secret is only ever replaced by turning 2FA off first, which needs
 * the password and a code.
 */
export async function beginTotpSetup(userId: string): Promise<string | null> {
  const secret = generateTotpSecret();
  const [result] = await query<ResultSetHeader>(
    "UPDATE users SET totpPendingSecret = ? WHERE id = ? AND totpEnabled = 0",
    [encryptTotpSecret(secret), userId]
  );
  return result.affectedRows === 1 ? secret : null;
}

export type ConfirmSetupResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; reason: "already_enabled" | "no_pending" | "wrong_code" };

/**
 * Finish setup: the code must come from the PENDING secret — proof the app
 * really holds it before anyone can be locked out by it. In one transaction
 * the secret becomes live, the code's step is recorded (it cannot be replayed
 * at the login screen a moment later), and a fresh set of backup codes is
 * written. The codes are returned in plain text — the only time they exist.
 */
export async function confirmTotpSetup(userId: string, code: string, nowMs: number = Date.now()): Promise<ConfirmSetupResult> {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT totpEnabled, totpPendingSecret FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    const row = rows[0];
    if (!row) return { ok: false, reason: "no_pending" } as const;
    if (Number(row.totpEnabled) === 1) return { ok: false, reason: "already_enabled" } as const;
    const pending = decryptTotpSecret(row.totpPendingSecret as string | null);
    if (!pending) return { ok: false, reason: "no_pending" } as const;
    const step = matchTotpStep(pending, code, nowMs);
    if (step === null) return { ok: false, reason: "wrong_code" } as const;

    await conn.query(
      `UPDATE users SET totpEnabled = 1, totpSecret = totpPendingSecret, totpPendingSecret = NULL,
         totpLastStep = ? WHERE id = ?`,
      [step, userId]
    );
    const backupCodes = generateBackupCodes();
    await replaceBackupCodes(conn, userId, backupCodes, new Date(nowMs).toISOString());
    return { ok: true, backupCodes } as const;
  });
}

/** Turn 2FA off: secret, pending secret, replay marker and backup codes all go. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE users SET totpEnabled = 0, totpSecret = NULL, totpPendingSecret = NULL,
         totpLastStep = NULL WHERE id = ?`,
      [userId]
    );
    await conn.query("DELETE FROM user_backup_codes WHERE userId = ?", [userId]);
  });
}

/** A new set of backup codes; every earlier code, used or not, stops working. */
export async function regenerateBackupCodes(userId: string, nowMs: number = Date.now()): Promise<string[]> {
  const codes = generateBackupCodes();
  await withTransaction(async (conn) => {
    await replaceBackupCodes(conn, userId, codes, new Date(nowMs).toISOString());
  });
  return codes;
}

// ── Checking a second factor ─────────────────────────────────────────────────

export type SecondFactorResult =
  | { ok: true; method: "totp" | "backup" }
  | { ok: false; reason: "wrong" | "replayed" | "unavailable" };

/**
 * Check what was typed in the second step: six digits are an authenticator
 * code, anything else is tried as a backup code (they are 8 characters, so
 * the two never overlap). A correct answer is CONSUMED — the TOTP step is
 * recorded, the backup code marked used — in the same statement that checks
 * it was not consumed already, so two requests racing with one code cannot
 * both win.
 *
 * "unavailable": 2FA is not on, or the stored secret cannot be decrypted
 * (SESSION_SECRET rotated — see the note at the top). The caller treats it
 * as a refusal; it is logged because only a person can fix it.
 */
export async function verifySecondFactor(
  userId: string,
  input: string,
  nowMs: number = Date.now()
): Promise<SecondFactorResult> {
  const typed = input.trim();
  if (/^\d{3}\s?\d{3}$/.test(typed)) {
    const [rows] = await query<RowDataPacket[]>(
      "SELECT totpEnabled, totpSecret FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const row = rows[0];
    if (!row || Number(row.totpEnabled) !== 1) return { ok: false, reason: "unavailable" };
    const secret = decryptTotpSecret(row.totpSecret as string | null);
    if (!secret) {
      console.error(
        `[2fa] user ${userId}: stored TOTP secret cannot be decrypted — was SESSION_SECRET changed? Reset 2FA for this user (ARCHITECTURE.md §10).`
      );
      return { ok: false, reason: "unavailable" };
    }
    const step = matchTotpStep(secret, typed, nowMs);
    if (step === null) return { ok: false, reason: "wrong" };
    const [result] = await query<ResultSetHeader>(
      `UPDATE users SET totpLastStep = ?
        WHERE id = ? AND totpEnabled = 1 AND (totpLastStep IS NULL OR totpLastStep < ?)`,
      [step, userId, step]
    );
    return result.affectedRows === 1 ? { ok: true, method: "totp" } : { ok: false, reason: "replayed" };
  }

  // Backup codes exist only while 2FA is on: confirmTotpSetup writes them in
  // the transaction that turns it on, disableTwoFactor deletes them in the one
  // that turns it off (and so does the manual reset in ARCHITECTURE.md §10).
  const normalized = normalizeBackupCode(typed);
  if (!normalized) return { ok: false, reason: "wrong" };
  const [result] = await query<ResultSetHeader>(
    "UPDATE user_backup_codes SET usedAt = ? WHERE userId = ? AND codeHash = ? AND usedAt IS NULL",
    [new Date(nowMs).toISOString(), userId, hashBackupCode(normalized)]
  );
  return result.affectedRows === 1 ? { ok: true, method: "backup" } : { ok: false, reason: "wrong" };
}
