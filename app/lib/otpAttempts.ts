import { NextResponse } from "next/server";
import { setSetting } from "./settingsStore";
import { withTransaction } from "./db";
import type { RowDataPacket } from "mysql2";

// Persistent (settings-table) failed-attempt counter for one-time codes.
// In-memory counters don't work here — the app runs as multiple serverless
// instances, so a counter kept in process memory can be bypassed just by
// having consecutive requests land on different instances. Mirrors the
// FAILURE_LIMIT idea in /api/auth/login, but caps total wrong guesses against
// a single issued code rather than throttling by time.
const FAILURE_LIMIT = 5;

function attemptsKey(otpKey: string): string {
  return `${otpKey}_attempts`;
}

/** Call when issuing a fresh OTP so the new code starts with a clean count. */
export async function resetOtpAttempts(otpKey: string): Promise<void> {
  await setSetting(attemptsKey(otpKey), "0");
}

export interface OtpAttempt {
  /** False: FAILURE_LIMIT guesses were already taken at this code — refuse
   *  without comparing (and make sure the code is gone). */
  allowed: boolean;
  /** This guess was the last one allowed: if it is wrong, wipe the code and
   *  say "too many attempts". */
  last: boolean;
}

/**
 * Take one guess at the code issued for `otpKey`, BEFORE comparing it, in one
 * locked read-modify-write.
 *
 * WHY BEFORE. The old shape was "compare → if wrong, count". Requests in a
 * burst all read the stored code and compared it before any of their failures
 * landed, so a burst of N parallel guesses got N comparisons where the limit
 * promised 5 — the same hole the login lockout had (lib/loginThrottle.ts,
 * takeLoginAttempt). Here the row lock queues the burst: five get a guess,
 * the rest get `allowed: false`.
 *
 * A right answer resets the count (clearOtpAttempts); a new code resets it too
 * (resetOtpAttempts). The row is created first, so FOR UPDATE always has a
 * real row to lock.
 */
export async function takeOtpAttempt(otpKey: string): Promise<OtpAttempt> {
  const key = attemptsKey(otpKey);
  return withTransaction(async (conn) => {
    await conn.query(
      "INSERT INTO settings (name, value) VALUES (?, '0') ON DUPLICATE KEY UPDATE name = name",
      [key]
    );
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT value FROM settings WHERE name = ? FOR UPDATE",
      [key]
    );
    const taken = parseInt((rows[0]?.value as string) || "0", 10) || 0;
    if (taken >= FAILURE_LIMIT) return { allowed: false, last: false };
    const next = taken + 1;
    await conn.query("UPDATE settings SET value = ? WHERE name = ?", [String(next), key]);
    return { allowed: true, last: next >= FAILURE_LIMIT };
  });
}

/** The message a route answers with once the guesses at a code are used up. */
export const OTP_TOO_MANY_ATTEMPTS = "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่";

/** Call once an OTP is consumed (success or expiry) to reset its counter. */
export async function clearOtpAttempts(otpKey: string): Promise<void> {
  await setSetting(attemptsKey(otpKey), "0");
}

// ── Issuing ─────────────────────────────────────────────────────────────────
// FAILURE_LIMIT caps the guesses against ONE code, and every new code starts
// its count again (resetOtpAttempts). Without a limit on issuing, "request a
// code, guess 5 times, request another" was unlimited guessing — and each
// request is an email in the owner's inbox. So a code for the same otpKey can
// be issued at most once a minute and ISSUE_LIMIT times an hour: at most 25
// guesses an hour against a 6-digit code. A person who did not get the email
// asks again after a minute (EquipmentTab's resend button already counts 60 s).
//
// Kept in the settings table under a row lock, for the same reason as the
// failure count: an in-memory limit is per serverless instance.
const ISSUE_COOLDOWN_MS = 60 * 1000;
const ISSUE_WINDOW_MS = 60 * 60 * 1000;
const ISSUE_LIMIT = 5;

function issuedKey(otpKey: string): string {
  return `${otpKey}_issued`;
}

export type OtpIssueClaim = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Take one issue of a code for `otpKey`, or be told how long to wait. Call it
 * once the request has been validated and a code is about to be sent — a
 * refused or invalid request must not use one up. A granted claim is not
 * handed back if sending then fails: the code was stored and its attempts
 * reset already, and releasing the claim would reopen exactly that loop.
 *
 * The value is the issue times (ms) still inside the window, oldest first.
 */
export async function claimOtpIssue(otpKey: string, now: number = Date.now()): Promise<OtpIssueClaim> {
  const key = issuedKey(otpKey);
  return withTransaction(async (conn) => {
    // Make sure the row exists, so FOR UPDATE locks something.
    await conn.query(
      "INSERT INTO settings (name, value) VALUES (?, '') ON DUPLICATE KEY UPDATE name = name",
      [key]
    );
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT value FROM settings WHERE name = ? FOR UPDATE",
      [key]
    );
    const issued = String(rows[0]?.value ?? "")
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((t) => Number.isFinite(t) && t > now - ISSUE_WINDOW_MS && t <= now);

    const last = issued[issued.length - 1];
    if (last !== undefined && now - last < ISSUE_COOLDOWN_MS) {
      return { allowed: false, retryAfterSeconds: Math.ceil((last + ISSUE_COOLDOWN_MS - now) / 1000) };
    }
    if (issued.length >= ISSUE_LIMIT) {
      return { allowed: false, retryAfterSeconds: Math.ceil((issued[0] + ISSUE_WINDOW_MS - now) / 1000) };
    }
    issued.push(now);
    await conn.query("UPDATE settings SET value = ? WHERE name = ?", [issued.join(","), key]);
    return { allowed: true };
  });
}

/** The 429 an OTP route answers with when claimOtpIssue refuses. */
export function otpIssueRefused(retryAfterSeconds: number): NextResponse {
  const wait =
    retryAfterSeconds < 60 ? `${retryAfterSeconds} วินาที` : `ประมาณ ${Math.ceil(retryAfterSeconds / 60)} นาที`;
  return NextResponse.json(
    { error: `ขอรหัส OTP ถี่เกินไป กรุณารออีก ${wait} แล้วลองใหม่` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
