import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "../../../lib/db";
import { createSession } from "../../../lib/session";
import { withRoute } from "../../../lib/apiHelpers";
import { RowDataPacket } from "mysql2";

// In-memory login throttle keyed on the *username* being targeted.
// Keying on the account (not the client IP) is deliberate: x-forwarded-for is
// attacker-controlled and can be rotated per request, so an IP-keyed limit is
// trivially bypassed. A username-keyed limit throttles credential-guessing
// against a given account regardless of the source IP.
// NOTE: per-instance memory only. For multi-instance deployments this must move
// to a shared store (Redis / DB row with TTL). Entries are pruned on each
// request and hard-capped so the map cannot grow without bound.
const FAILURE_LIMIT = 5;
const BLOCK_MS = 15 * 60 * 1000; // 15 minutes
const MAX_TRACKED = 10_000;

// A fixed, valid bcrypt hash used only to spend the same ~work when the
// username doesn't exist, so response timing doesn't reveal whether an account
// exists (user-enumeration side channel). It matches no real password.
const DUMMY_PASSWORD_HASH =
  "$2b$12$k6Pr6AL.tywtgyDcnIA8pOK1FX5OK0QXvp14WbDsprFvAwmqj6bBu";
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();

function prune(now: number) {
  for (const [key, rec] of rateLimitMap) {
    if (rec.expiresAt <= now) rateLimitMap.delete(key);
  }
  // Backstop against unbounded growth (e.g. an attacker cycling usernames).
  if (rateLimitMap.size > MAX_TRACKED) {
    let excess = rateLimitMap.size - MAX_TRACKED;
    for (const key of rateLimitMap.keys()) {
      if (excess-- <= 0) break;
      rateLimitMap.delete(key);
    }
  }
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
    prune(now);
    const key = String(username).toLowerCase();
    const limitRecord = rateLimitMap.get(key);

    if (
      limitRecord &&
      limitRecord.expiresAt > now &&
      limitRecord.count >= FAILURE_LIMIT
    ) {
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
      const current = rateLimitMap.get(key);
      rateLimitMap.set(key, {
        count: (current?.count || 0) + 1,
        expiresAt:
          current && current.expiresAt > now
            ? current.expiresAt
            : now + BLOCK_MS,
      });

      return NextResponse.json(
        { error: "username หรือ password ไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    // Clear failed attempts on success.
    rateLimitMap.delete(key);

    // Create JWT session cookie.
    await createSession(user.id, user.username);
    return NextResponse.json({ success: true, username: user.username });
  }
);
