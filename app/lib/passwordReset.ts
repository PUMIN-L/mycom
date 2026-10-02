import "server-only";
import { randomInt, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { query } from "./db";
import { getSetting, setSetting } from "./settingsStore";
import {
  claimOtpIssue,
  clearOtpAttempts,
  OTP_TOO_MANY_ATTEMPTS,
  resetOtpAttempts,
  takeOtpAttempt,
} from "./otpAttempts";
import { createRateLimiter } from "./rateLimit";
import { refundLoginAttempt, resetOtpLockKey, takeLoginAttempt } from "./loginThrottle";
import type { TwoFactorUser } from "./twoFactor";

// Changing the admin password, and setting a new one when it is forgotten —
// the pieces both flows share. The routes are /api/auth/password (+ /otp),
// logged in, and /api/auth/forgot-password (+ /otp), public.
//
// THE CODE GOES TO ONE FIXED ADDRESS, never to an address stored anywhere an
// admin session can change. The contact email (where the other OTPs go) is
// editable from /settings; a stolen session that pointed it at its own inbox
// could then mint a password of its own. This one changes only with a deploy.
export const PASSWORD_OTP_EMAIL = "ampumin@gmail.com";

/** "am****@gmail.com" — enough for the admin to know which inbox to open. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "****";
  return `${email.slice(0, Math.min(2, at))}****${email.slice(at)}`;
}

export type PasswordOtpPurpose = "change" | "reset";

/** Separate keys, so a code asked for on one page cannot be spent on the other. */
const OTP_KEY: Record<PasswordOtpPurpose, string> = {
  change: "password_change_otp",
  reset: "password_reset_otp",
};
const stateKey = (purpose: PasswordOtpPurpose) => `${OTP_KEY[purpose]}_state`;

export const PASSWORD_OTP_TTL_MINUTES = 10;
const OTP_TTL_MS = PASSWORD_OTP_TTL_MINUTES * 60 * 1000;

/** What the public "send me a code" step always answers — see its route. */
export const PASSWORD_RESET_SENT_MESSAGE =
  "หากชื่อผู้ใช้นี้มีอยู่ในระบบ รหัส OTP ถูกส่งไปที่อีเมลของผู้ดูแลระบบแล้ว (หากไม่ได้รับภายใน 2 นาที ให้ขอรหัสใหม่)";

export const PASSWORD_OTP_NO_REQUEST = "ไม่มีคำขอรหัส OTP หรือรหัสหมดอายุแล้ว กรุณาขอรหัสใหม่";

/**
 * EVERY refusal of the emailed code on the public page — no code asked for,
 * expired, wrong, five wrong, the daily budget spent, an unknown username —
 * says this, and only this. Separate messages were an oracle: ask for a code
 * for "admin", send a wrong one, and "รหัส OTP ไม่ถูกต้อง" (rather than "no
 * code asked for", what a made-up name gets) says the account is real; the
 * five-wrong and daily-budget messages, which only a real account can reach,
 * said the same. The logged-in change keeps its specific messages.
 */
export const PASSWORD_RESET_OTP_REFUSED =
  "รหัส OTP ไม่ถูกต้อง หมดอายุ หรือถูกยกเลิกแล้ว กรุณาตรวจสอบรหัส หรือขอรหัสใหม่ (หากกรอกผิดหลายครั้ง ระบบจะระงับชั่วคราวไม่เกิน 24 ชั่วโมง)";

// ── The new password (its rules: lib/passwordRules.ts) ───────────────────────

/** Same cost as the seeded admin (db.ts). */
const BCRYPT_COST = 12;

/** Hash and store. False when the user no longer exists. */
export async function setPassword(userId: string, newPassword: string): Promise<boolean> {
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const [result] = await query<ResultSetHeader>("UPDATE users SET passwordHash = ? WHERE id = ?", [hash, userId]);
  return result.affectedRows === 1;
}

/**
 * The account `username` names — by the same rule as the login route: the
 * database's collation also matches "admin " and "ADMİN", so only a row whose
 * username IS the input, case aside, counts.
 */
export async function findUserByUsername(username: string): Promise<TwoFactorUser | null> {
  const [rows] = await query<RowDataPacket[]>("SELECT * FROM users WHERE username = ?", [username]);
  const found = rows[0];
  if (!found || String(found.username).toLowerCase() !== username.toLowerCase()) return null;
  return {
    id: String(found.id),
    username: String(found.username),
    passwordHash: String(found.passwordHash),
    totpEnabled: Number(found.totpEnabled) === 1,
  };
}

// ── The emailed code ─────────────────────────────────────────────────────────

/** Per-IP brake on the two public "ลืมรหัสผ่าน" endpoints (per instance — see
 *  rateLimit.ts). The issue throttle and the five-guess limit do the real work. */
export const passwordResetIpLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

export type PasswordOtpIssue = { allowed: true; otp: string } | { allowed: false; retryAfterSeconds: number };

/**
 * A new 6-digit code for `userId`, valid PASSWORD_OTP_TTL_MINUTES, with five
 * fresh guesses — or a refusal when codes are being asked for too often
 * (claimOtpIssue: one a minute, five an hour). A new code replaces any earlier
 * one for the same purpose.
 */
export async function issuePasswordOtp(
  purpose: PasswordOtpPurpose,
  userId: string,
  now: number = Date.now()
): Promise<PasswordOtpIssue> {
  const claim = await claimOtpIssue(OTP_KEY[purpose], now);
  if (!claim.allowed) return claim;
  const otp = randomInt(100000, 1000000).toString();
  await setSetting(stateKey(purpose), JSON.stringify({ userId, otp, expiresAt: now + OTP_TTL_MS }));
  await resetOtpAttempts(OTP_KEY[purpose]);
  return { allowed: true, otp };
}

function sameCode(expected: string, typed: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(typed);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Wrong emailed codes the PUBLIC page allows per account, per 24 hours, across
 * every code issued. Five guesses a code is not a limit there by itself: each
 * new code resets that count, and anyone who knows the username may ask for
 * five codes an hour — 25 guesses an hour, every hour, at a 6-digit code: about
 * one chance in five of a hit within a year on an account without 2FA. Ten a
 * day makes that well under one in a hundred. The price is that a stranger
 * can use the ten up and close the page for that account for a day (every code
 * he asks for is an email in the admin's inbox, so it does not go unseen); the
 * logged-in change in /settings is unaffected.
 */
export const RESET_OTP_DAILY_LIMIT = 10;
const RESET_OTP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RESET_OTP_DAILY_EXCEEDED =
  "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนดใน 24 ชั่วโมง เพื่อความปลอดภัย กรุณาลองใหม่ในวันถัดไป";

export type PasswordOtpCheck = { ok: true; stateRaw: string } | { ok: false; error: string };

/**
 * Is `typed` the live code for `userId`? The guess is TAKEN before it is
 * compared (takeOtpAttempt), so a burst cannot get more than five; the fifth
 * wrong one, or any guess after it, wipes the code. A code issued for another
 * user, or for the other purpose, is no code at all.
 *
 * Passing does NOT spend the code — consumePasswordOtp does, once every other
 * check has passed, so a wrong 2FA code does not cost the admin a new email.
 */
export async function checkPasswordOtp(
  purpose: PasswordOtpPurpose,
  userId: string,
  typed: unknown,
  now: number = Date.now()
): Promise<PasswordOtpCheck> {
  const raw = await getSetting(stateKey(purpose));
  let state: { userId?: unknown; otp?: unknown; expiresAt?: unknown } | null = null;
  try {
    state = raw ? JSON.parse(raw) : null;
  } catch {
    state = null;
  }
  if (
    !raw ||
    !state ||
    state.userId !== userId ||
    typeof state.otp !== "string" ||
    !(Number(state.expiresAt) > now)
  ) {
    return { ok: false, error: PASSWORD_OTP_NO_REQUEST };
  }

  // The public page: one more from the account's daily budget first (taken
  // before comparing, like every other limit here; handed back if right).
  const dailyKey = purpose === "reset" ? resetOtpLockKey(userId) : null;
  if (dailyKey && !(await takeLoginAttempt(dailyKey, now, RESET_OTP_DAILY_LIMIT, RESET_OTP_WINDOW_MS))) {
    return { ok: false, error: RESET_OTP_DAILY_EXCEEDED };
  }

  const attempt = await takeOtpAttempt(OTP_KEY[purpose]);
  const wrong = !sameCode(state.otp, typeof typed === "string" ? typed.trim() : "");
  if (!attempt.allowed || (wrong && attempt.last)) {
    await setSetting(stateKey(purpose), "");
    return { ok: false, error: OTP_TOO_MANY_ATTEMPTS };
  }
  if (wrong) return { ok: false, error: "รหัส OTP ไม่ถูกต้อง" };
  if (dailyKey) await refundLoginAttempt(dailyKey, now);
  return { ok: true, stateRaw: raw };
}

/**
 * Spend the code checkPasswordOtp accepted — only if it is still the one it
 * read. Two requests carrying the same right code cannot both set a password:
 * the second finds the row already emptied and gets false.
 */
export async function consumePasswordOtp(purpose: PasswordOtpPurpose, stateRaw: string): Promise<boolean> {
  const [result] = await query<ResultSetHeader>(
    "UPDATE settings SET value = '' WHERE name = ? AND value = ?",
    [stateKey(purpose), stateRaw]
  );
  if (result.affectedRows !== 1) return false;
  await clearOtpAttempts(OTP_KEY[purpose]);
  return true;
}

export const PASSWORD_OTP_ALREADY_USED = "รหัส OTP นี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่";
