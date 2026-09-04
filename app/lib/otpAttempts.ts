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

/**
 * Record one failed verification attempt for `otpKey`. Once FAILURE_LIMIT is
 * reached, the OTP and its expiry are wiped immediately — the code can no
 * longer be redeemed even by a correct guess on the very next request — and
 * `locked: true` is returned so the caller can return a distinct message.
 *
 * The counter itself is read-and-incremented under a row lock (SELECT ... FOR
 * UPDATE inside a transaction) instead of a plain getSetting-then-setSetting
 * pair — the earlier non-atomic version let concurrent verification requests
 * against the same OTP all read the same pre-increment count and collapse
 * into a single +1, letting a burst of parallel guesses blow past
 * FAILURE_LIMIT (the same race class fixed for login in api/auth/login).
 * This relies on the attempts row already existing (every OTP-issuing route
 * calls resetOtpAttempts, which upserts it, before any verification can
 * happen), so the lock is on a real row rather than a not-yet-existing one.
 */
export async function recordOtpFailure(
  otpKey: string,
  otpExpiresKey: string
): Promise<{ locked: boolean }> {
  const next = await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT value FROM settings WHERE name = ? FOR UPDATE",
      [attemptsKey(otpKey)]
    );
    const current = parseInt((rows[0]?.value as string) || "0", 10);
    const count = current + 1;
    await conn.query(
      "INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [attemptsKey(otpKey), String(count)]
    );
    return count;
  });
  if (next >= FAILURE_LIMIT) {
    await setSetting(otpKey, "");
    await setSetting(otpExpiresKey, "0");
    return { locked: true };
  }
  return { locked: false };
}

/** Call once an OTP is consumed (success or expiry) to reset its counter. */
export async function clearOtpAttempts(otpKey: string): Promise<void> {
  await setSetting(attemptsKey(otpKey), "0");
}
