import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, withTransaction } from "../../../lib/db";
import { createSession } from "../../../lib/session";
import { withRoute } from "../../../lib/apiHelpers";
import { getSetting, setSetting } from "../../../lib/settingsStore";
import { RowDataPacket } from "mysql2";

// Login throttle keyed on the *username* being targeted, persisted in the
// settings table (same DB-backed pattern as otpAttempts.ts) so the limit is
// shared across every serverless instance — an in-memory counter resets per
// instance/cold-start and lets a distributed attacker get far more than
// FAILURE_LIMIT guesses in total.
// Keying on the account (not the client IP) is deliberate: x-forwarded-for is
// attacker-controlled and can be rotated per request, so an IP-keyed limit is
// trivially bypassed. A username-keyed limit throttles credential-guessing
// against a given account regardless of the source IP, and — since it applies
// to the raw input rather than only known accounts — an attacker can't tell
// which usernames are real by seeing which ones eventually start 429'ing.
// The key is truncated to bound how large a single settings row can get; this
// intentionally does not cap the *number* of distinct usernames tracked (each
// costs one small settings row), which is an acceptable trade-off for a
// low-traffic admin login endpoint.
const FAILURE_LIMIT = 5;
const BLOCK_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_KEY_MAX_LEN = 100;

// A fixed, valid bcrypt hash used only to spend the same ~work when the
// username doesn't exist, so response timing doesn't reveal whether an account
// exists (user-enumeration side channel). It matches no real password.
const DUMMY_PASSWORD_HASH =
  "$2b$12$k6Pr6AL.tywtgyDcnIA8pOK1FX5OK0QXvp14WbDsprFvAwmqj6bBu";

function loginLockKey(username: string): string {
  return `login_fail_${username.toLowerCase().slice(0, LOCK_KEY_MAX_LEN)}`;
}

// count+expiresAt are kept in ONE settings row ("count|expiresAt") instead of
// two, specifically so recordLoginFailure below can lock and update them in a
// single atomic step — two separate get-then-set round trips (the previous
// design) let concurrent failed attempts for the same username all read the
// same pre-increment count and collapse into a single +1, letting an
// attacker blow through FAILURE_LIMIT with one burst of parallel requests.
function parseLockState(raw: string | null): { count: number; expiresAt: number } {
  const [countStr, expiresStr] = (raw || "0|0").split("|");
  return { count: parseInt(countStr, 10) || 0, expiresAt: parseInt(expiresStr, 10) || 0 };
}

async function isLockedOut(lockKey: string, now: number): Promise<boolean> {
  const { count, expiresAt } = parseLockState(await getSetting(lockKey));
  return count >= FAILURE_LIMIT && expiresAt > now;
}

async function recordLoginFailure(lockKey: string, now: number): Promise<void> {
  await withTransaction(async (conn) => {
    // Ensure the row exists so the SELECT below can actually take a row
    // lock — locking a nonexistent row locks nothing.
    await conn.query(
      "INSERT INTO settings (name, value) VALUES (?, '0|0') ON DUPLICATE KEY UPDATE name = name",
      [lockKey]
    );
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT value FROM settings WHERE name = ? FOR UPDATE",
      [lockKey]
    );
    const { count, expiresAt } = parseLockState(rows[0] ? String(rows[0].value) : null);
    const stillInWindow = expiresAt > now;
    const nextCount = stillInWindow ? count + 1 : 1;
    const nextExpires = stillInWindow ? expiresAt : now + BLOCK_MS;
    await conn.query("UPDATE settings SET value = ? WHERE name = ?", [
      `${nextCount}|${nextExpires}`,
      lockKey,
    ]);
  });
}

async function clearLoginFailures(lockKey: string): Promise<void> {
  await setSetting(lockKey, "0|0");
}

export const POST = withRoute(
  "เกิดข้อผิดพลาด กรุณาลองใหม่",
  async (request: NextRequest) => {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "กรุณากรอก username และ password" },
        { status: 400 }
      );
    }

    const now = Date.now();
    const lockKey = loginLockKey(String(username));

    if (await isLockedOut(lockKey, now)) {
      return NextResponse.json(
        { error: "เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณารอสักครู่" },
        { status: 429 }
      );
    }

    const [rows] = await query<RowDataPacket[]>(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );

    const user = rows[0];
    // Always run a bcrypt comparison (against a dummy hash when the user is not
    // found) so the response time is the same for existing and non-existing
    // usernames.
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    );
    if (!user || !passwordMatches) {
      // Record the failed attempt against this username.
      await recordLoginFailure(lockKey, now);

      return NextResponse.json(
        { error: "username หรือ password ไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    // Clear failed attempts on success.
    await clearLoginFailures(lockKey);

    // Create JWT session cookie.
    await createSession(user.id, user.username);
    return NextResponse.json({ success: true, username: user.username });
  }
);
