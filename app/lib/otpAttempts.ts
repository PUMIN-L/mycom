import { getSetting, setSetting } from "./settingsStore";

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
 */
export async function recordOtpFailure(
  otpKey: string,
  otpExpiresKey: string
): Promise<{ locked: boolean }> {
  const current = parseInt((await getSetting(attemptsKey(otpKey))) || "0", 10);
  const next = current + 1;
  await setSetting(attemptsKey(otpKey), String(next));
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
