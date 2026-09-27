import { ResultSetHeader, RowDataPacket } from "mysql2";
import { query } from "./db";
import { createRateLimiter } from "./rateLimit";

// The login route's two throttles that live outside the route file (a route
// file may only export its HTTP handlers, and the tests need to reach these).
// The per-account lockout itself stays in app/api/auth/login/route.ts.

/**
 * Every lockout row starts with this: `login_fail_<username>` for the
 * account's bucket, `login_fail_dev_<deviceId>` for a trusted browser's.
 */
export const LOGIN_FAIL_PREFIX = "login_fail_";

/** A lockout row's value, "count|expiresAt" (ms). Anything unreadable is 0|0. */
export function parseLoginFailState(raw: string | null): { count: number; expiresAt: number } {
  const [countStr, expiresStr] = (raw || "0|0").split("|");
  return { count: parseInt(countStr, 10) || 0, expiresAt: parseInt(expiresStr, 10) || 0 };
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
