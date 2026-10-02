import { ResultSetHeader, RowDataPacket } from "mysql2";
import { query, withTransaction } from "./db";
import { setSetting } from "./settingsStore";
import { createRateLimiter } from "./rateLimit";

// The login throttles, outside any route file (a route file may only export
// its HTTP handlers, and the password step, the two-factor step and the 2FA
// settings routes all count failures the same way).

/**
 * Every lockout row starts with this: `login_fail_u_<username>` for the
 * account's bucket, `login_fail_dev_<deviceId>` for a trusted browser's,
 * `login_fail_2fa_<userId>` / `login_fail_2fa_dev_<deviceId>` for the
 * two-factor step's, `login_fail_reauth_pw_<userId>` /
 * `login_fail_reauth_2fa_<userId>` for re-authentication in /settings (2FA and
 * the password change), `login_fail_reset_2fa_<userId>` /
 * `login_fail_reset_otp_<userId>` for the "ลืมรหัสผ่าน" page's codes.
 * The nightly purge cleans all of them by this prefix.
 */
export const LOGIN_FAIL_PREFIX = "login_fail_";

/** Wrong answers per bucket before it locks, and how long it stays locked. */
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOCK_KEY_MAX_LEN = 100;

/**
 * The password bucket for a username. Keyed on the account, not the client IP:
 * x-forwarded-for is attacker-controlled and can be rotated per request. The
 * key is lowercased and truncated to bound how large one settings row can get.
 *
 * ⚠️ The "u_" is what keeps strangers out of every OTHER bucket. This is the
 * one key whose name the caller chooses — anyone can type any username — and
 * it used to be `login_fail_<username>`, so the username "2fa_admin-001" WAS
 * the admin's two-factor bucket (his id is the fixed "admin-001"): five wrong
 * passwords for it from the login page locked his code screen without
 * knowing anything. No other bucket's name starts with "u_".
 */
export function loginLockKey(username: string): string {
  return `${LOGIN_FAIL_PREFIX}u_${username.toLowerCase().slice(0, LOCK_KEY_MAX_LEN)}`;
}

/**
 * The two-factor step's bucket. Separate from the password's: someone who has
 * the password gets five guesses at the 6-digit code per 15 minutes, however
 * many times he passes the password step. A browser with a valid device
 * cookie is counted in its own bucket (same reasoning as the password step),
 * so an attacker who has the password cannot keep the admin's own browser
 * locked out of the code screen.
 */
export function twoFactorLockKey(userId: string): string {
  return `${LOGIN_FAIL_PREFIX}2fa_${userId.slice(0, LOCK_KEY_MAX_LEN)}`;
}

export function twoFactorDeviceLockKey(deviceId: string): string {
  return `${LOGIN_FAIL_PREFIX}2fa_dev_${deviceId.slice(0, LOCK_KEY_MAX_LEN)}`;
}

/**
 * The 2FA settings' re-authentication buckets (lib/twoFactorReauth.ts) — the
 * password and the code, per user. Only a logged-in session reaches them, so
 * nobody on the login page can fill them: they used to share the username's
 * bucket, and five wrong logins as "admin" from anywhere kept the admin —
 * logged in, on his own trusted browser — from turning 2FA on or off or
 * minting new backup codes, for as long as someone kept doing it.
 *
 * The trade: a stolen session gets these five guesses per 15 minutes besides
 * the login page's five. It is already inside the CMS; what the re-auth keeps
 * from it is the 2FA settings, and five guesses a quarter-hour at a password
 * still keep them.
 */
export function reauthPasswordLockKey(userId: string): string {
  return `${LOGIN_FAIL_PREFIX}reauth_pw_${userId.slice(0, LOCK_KEY_MAX_LEN)}`;
}

export function reauthCodeLockKey(userId: string): string {
  return `${LOGIN_FAIL_PREFIX}reauth_2fa_${userId.slice(0, LOCK_KEY_MAX_LEN)}`;
}

/**
 * Wrong 2FA codes on the "ลืมรหัสผ่าน" page (lib/passwordReset.ts). Its own
 * bucket: that page is public, and counting there in the LOGIN code step's
 * bucket would let anyone holding a reset OTP lock the admin's code screen.
 */
export function resetCodeLockKey(userId: string): string {
  return `${LOGIN_FAIL_PREFIX}reset_2fa_${userId.slice(0, LOCK_KEY_MAX_LEN)}`;
}

/**
 * Wrong EMAILED codes on the "ลืมรหัสผ่าน" page, per account, across every
 * code issued — see RESET_OTP_DAILY_LIMIT in lib/passwordReset.ts.
 */
export function resetOtpLockKey(userId: string): string {
  return `${LOGIN_FAIL_PREFIX}reset_otp_${userId.slice(0, LOCK_KEY_MAX_LEN)}`;
}

/** A lockout row's value, "count|expiresAt" (ms). Anything unreadable is 0|0. */
export function parseLoginFailState(raw: string | null): { count: number; expiresAt: number } {
  const [countStr, expiresStr] = (raw || "0|0").split("|");
  return { count: parseInt(countStr, 10) || 0, expiresAt: parseInt(expiresStr, 10) || 0 };
}

/**
 * Take one attempt from `lockKey`'s allowance — BEFORE the answer is checked —
 * in ONE locked read-modify-write. False, and nothing taken, when the bucket
 * is already full: the caller refuses without checking anything.
 *
 * WHY BEFORE, NOT AFTER. The old shape was "is it locked? → check the answer
 * → if wrong, count it". Every request in a burst sent at once passed the
 * first step before any of them reached the third, so a botnet got as many
 * guesses as it sent requests: 20 wrong codes fired together were all checked
 * where the limit promised 5 — against a 6-digit code, that is the whole of
 * 2FA's protection. Here the take IS the check: the row lock queues the burst,
 * the first five get an attempt, the rest get `false`.
 *
 * A correct answer then resets the bucket (clearLoginFailures), or hands its
 * attempt back (refundLoginAttempt) where resetting would be wrong. The row is
 * created first because a SELECT … FOR UPDATE on a missing row locks nothing.
 */
export async function takeLoginAttempt(
  lockKey: string,
  now: number = Date.now(),
  limit: number = LOGIN_FAILURE_LIMIT,
  windowMs: number = LOGIN_BLOCK_MS
): Promise<boolean> {
  return withTransaction(async (conn) => {
    await conn.query(
      "INSERT INTO settings (name, value) VALUES (?, '0|0') ON DUPLICATE KEY UPDATE name = name",
      [lockKey]
    );
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT value FROM settings WHERE name = ? FOR UPDATE",
      [lockKey]
    );
    const { count, expiresAt } = parseLoginFailState(rows[0] ? String(rows[0].value) : null);
    const inWindow = expiresAt > now;
    if (inWindow && count >= limit) return false;
    const nextCount = inWindow ? count + 1 : 1;
    const nextExpires = inWindow ? expiresAt : now + windowMs;
    await conn.query("UPDATE settings SET value = ? WHERE name = ?", [
      `${nextCount}|${nextExpires}`,
      lockKey,
    ]);
    return true;
  });
}

/**
 * Give back one attempt taken by takeLoginAttempt, for an outcome that was
 * not a guess (setup not started, the password was right but the bucket must
 * not be reset). Never goes below zero, and does nothing to an ended window.
 */
export async function refundLoginAttempt(lockKey: string, now: number = Date.now()): Promise<void> {
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT value FROM settings WHERE name = ? FOR UPDATE",
      [lockKey]
    );
    const { count, expiresAt } = parseLoginFailState(rows[0] ? String(rows[0].value) : null);
    if (count <= 0 || expiresAt <= now) return;
    await conn.query("UPDATE settings SET value = ? WHERE name = ?", [`${count - 1}|${expiresAt}`, lockKey]);
  });
}

/** Reset a bucket after a correct answer. */
export async function clearLoginFailures(lockKey: string): Promise<void> {
  await setSetting(lockKey, "0|0");
}

/**
 * Attempts per client IP, checked BEFORE the lockout row is read and before
 * bcrypt runs. The lockout stops guessing against one account, but a caller
 * cycling through made-up usernames is never locked out — each name is its own
 * bucket — and every attempt costs ~0.25 s of bcrypt CPU plus a settings row.
 * This caps how fast one source can do that.
 *
 * An addition to the lockout, not a replacement: it is per instance (see
 * rateLimit.ts) and an IP is not an identity. The ceiling is far above a
 * person's pace — five wrong passwords lock the account before a person gets
 * near it — so an office behind one address is not the one it stops.
 */
export const LOGIN_IP_LIMIT = 10;
export const loginIpLimiter = createRateLimiter({ limit: LOGIN_IP_LIMIT, windowMs: 60 * 1000 });

const PURGE_PAGE = 500;

/**
 * Delete the lockout rows whose window has ended — the nightly cron's job. A
 * failed login writes a row even for a username that does not exist (so the
 * lockout cannot reveal which ones do), and a successful one leaves "0|0"
 * behind; nothing else ever deletes them.
 *
 * Only rows that no longer do anything go: a window that has ended counts as
 * no failures at all (the route starts a fresh count), so removing it changes
 * no login's outcome. Each row is deleted only if its value is still the one
 * read — a failure recorded in between opened a new window and must stay.
 * The expiry is parsed here rather than CAST in SQL, where a malformed value
 * would be an error under strict mode, not a skipped row.
 *
 * Read a page at a time, so a table flooded with junk usernames is still a
 * bounded amount of memory per step. Returns the number of rows deleted.
 */
export async function purgeExpiredLoginFailures(now: number = Date.now()): Promise<number> {
  const like = `${LOGIN_FAIL_PREFIX.replace(/[!%_]/g, "!$&")}%`;
  let after = "";
  let deleted = 0;
  for (;;) {
    const [rows] = await query<RowDataPacket[]>(
      "SELECT name, value FROM settings WHERE name LIKE ? ESCAPE '!' AND name > ? ORDER BY name LIMIT ?",
      [like, after, PURGE_PAGE]
    );
    const expired = rows.filter((r) => parseLoginFailState(String(r.value)).expiresAt <= now);
    if (expired.length > 0) {
      const [result] = await query<ResultSetHeader>(
        `DELETE FROM settings WHERE ${expired.map(() => "(name = ? AND value = ?)").join(" OR ")}`,
        expired.flatMap((r) => [r.name, r.value])
      );
      deleted += result?.affectedRows ?? 0;
    }
    if (rows.length < PURGE_PAGE) return deleted;
    after = String(rows[rows.length - 1].name);
  }
}
