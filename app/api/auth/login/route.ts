import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "../../../lib/db";
import { createSession } from "../../../lib/session";
import { withRoute } from "../../../lib/apiHelpers";
import {
  LOGIN_DEVICE_COOKIE,
  LOGIN_DEVICE_COOKIE_OPTIONS,
  issueLoginDeviceToken,
  loginDeviceIdFor,
} from "../../../lib/loginDevice";
import {
  LOGIN_FAIL_PREFIX,
  clearLoginFailures,
  isLockedOut,
  loginIpLimiter,
  loginLockKey,
  recordLoginFailure,
} from "../../../lib/loginThrottle";
import { LOGIN_2FA_COOKIE, LOGIN_2FA_COOKIE_OPTIONS, issueTwoFactorPendingToken } from "../../../lib/twoFactorPending";
import { clientKey } from "../../../lib/rateLimit";
import { RowDataPacket } from "mysql2";

// Login throttle keyed on the *username* being targeted, persisted in the
// settings table (app/lib/loginThrottle.ts) so the limit is shared across
// every serverless instance — an in-memory counter resets per instance and
// lets a distributed attacker get far more than five guesses in total. Since
// it applies to the raw input rather than only known accounts, an attacker
// can't tell which usernames are real by seeing which ones start 429'ing.
// The *number* of distinct usernames tracked is bounded by the per-IP limit
// checked before any of this runs, and the nightly purge of ended windows.

// A fixed, valid bcrypt hash used only to spend the same ~work when the
// username doesn't exist, so response timing doesn't reveal whether an account
// exists (user-enumeration side channel). It matches no real password.
const DUMMY_PASSWORD_HASH =
  "$2b$12$k6Pr6AL.tywtgyDcnIA8pOK1FX5OK0QXvp14WbDsprFvAwmqj6bBu";

export const POST = withRoute(
  "เกิดข้อผิดพลาด กรุณาลองใหม่",
  async (request: NextRequest) => {
    const body: unknown = await request.json();
    const username = (body as { username?: unknown } | null)?.username;
    const password = (body as { password?: unknown } | null)?.password;

    // Strings only, checked before the lock or the database is touched. The
    // driver's `query()` inlines a non-string parameter into the SQL as-is, so
    // `"username": [0]` (truthy, so it passed a plain `!username` check) became
    // `WHERE username = 0` — which MySQL/TiDB evaluate by casting every
    // non-numeric username to 0, i.e. it matched EVERY user — while
    // String([0]) filed its failures under the lock key "0", not the
    // username's. Each such shape was a separate 5-guess allowance against
    // whichever user the database returned first.
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return NextResponse.json(
        { error: "กรุณากรอก username และ password" },
        { status: 400 }
      );
    }

    // Before the lockout row is read or bcrypt runs — the two things a flood
    // of made-up usernames would otherwise get for free.
    const ipLimit = loginIpLimiter.check(clientKey(request));
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "มีการพยายามเข้าสู่ระบบจากเครือข่ายนี้บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const now = Date.now();
    // A browser that has logged in as this user before (a valid device
    // cookie) is counted in its own bucket, so failures by anyone else —
    // which lock the username's bucket — cannot lock it out. Its own failures
    // stay in its own bucket too. See app/lib/loginDevice.ts.
    const deviceId = await loginDeviceIdFor(request.cookies.get(LOGIN_DEVICE_COOKIE)?.value, username);
    const lockKey = deviceId ? `${LOGIN_FAIL_PREFIX}dev_${deviceId}` : loginLockKey(username);

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

    // The database decides "equal" by its collation, which is looser than the
    // lock key: TiDB's default (utf8mb4_bin) is PAD SPACE, so "admin",
    // "admin ", "admin  "… all find the admin row, while each is counted under
    // its own lock key — five more guesses per trailing space (an _ai_
    // collation does the same with accents). Only an input that IS the
    // username, case aside (the lock key is lowercased), may log in; a row the
    // database stretched to match is treated as no user at all.
    const found = rows[0];
    const user =
      found && String(found.username).toLowerCase() === username.toLowerCase() ? found : undefined;
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

    // Clear failed attempts on success — only the bucket this attempt was
    // counted in. A login from a trusted device must not clear the username's
    // bucket, or it would reopen a lock someone else is still hammering.
    await clearLoginFailures(lockKey);

    // Two-factor accounts get NO session here — only a 5-minute pending token,
    // good for nothing but POST /api/auth/login/2fa (its cookie path and its
    // signing key both say so). The session, and the trusted-device cookie,
    // are issued there once the authenticator code is right. Because the
    // session cookie only ever exists after both factors, proxy.ts and every
    // requireAuth() need no change at all.
    if (Number(user.totpEnabled) === 1) {
      const response = NextResponse.json({ twoFactorRequired: true });
      response.cookies.set(
        LOGIN_2FA_COOKIE,
        await issueTwoFactorPendingToken(String(user.id), String(user.username)),
        LOGIN_2FA_COOKIE_OPTIONS
      );
      return response;
    }

    // Create JWT session cookie.
    await createSession(user.id, user.username);
    const response = NextResponse.json({ success: true, username: user.username });
    // Trust this browser for future lockouts (a fresh id each login).
    response.cookies.set(
      LOGIN_DEVICE_COOKIE,
      await issueLoginDeviceToken(user.username),
      LOGIN_DEVICE_COOKIE_OPTIONS
    );
    return response;
  }
);
