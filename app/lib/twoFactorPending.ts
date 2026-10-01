import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { getSessionEpoch } from "./settingsStore";

// The half-way token between the two login steps. A correct password on a
// two-factor account yields THIS, not a session: proof that step one passed,
// good for five minutes and for one endpoint only (POST /api/auth/login/2fa).
//
// ⚠️ Signed with a key DERIVED from SESSION_SECRET ("login-2fa:…"), never the
// session key itself — proxy.ts and getSession() check only a signature, so a
// pending token signed with the session key would BE a session, and the
// second factor would be decoration. Distinct keys plus an audience check mean
// neither kind of token verifies as the other (same reasoning as
// loginDevice.ts, whose key is "login-device:…").

export const LOGIN_2FA_COOKIE = "login_2fa";
const AUDIENCE = "login-2fa";
const TTL_SECONDS = 5 * 60;

function pendingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(`login-2fa:${secret}`);
}

export const LOGIN_2FA_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  // /api/auth/login/2fa is under this path; nothing else ever sees it.
  path: "/api/auth/login",
  maxAge: TTL_SECONDS,
};

/** Cookie options that delete it (same path, already expired). */
export const LOGIN_2FA_COOKIE_CLEAR = { ...LOGIN_2FA_COOKIE_OPTIONS, maxAge: 0 };

export interface TwoFactorPending {
  userId: string;
  username: string;
}

/**
 * A pending token for a user whose password was just accepted. Carries the
 * session epoch, so "ออกจากระบบอุปกรณ์อื่นทั้งหมด" voids a half-finished
 * login too. `epoch` is for a caller that has just bumped it.
 */
export async function issueTwoFactorPendingToken(
  userId: string,
  username: string,
  epoch?: number
): Promise<string> {
  return new SignJWT({ un: username, ep: epoch ?? (await getSessionEpoch()) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(pendingKey());
}

/** Who passed step one, if `token` is a valid unexpired pending token; null
 *  for missing, forged, expired, a session or device token, or one issued
 *  before the last "log out other devices". */
export async function readTwoFactorPendingToken(token: string | undefined): Promise<TwoFactorPending | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, pendingKey(), {
      algorithms: ["HS256"],
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.un !== "string") return null;
    if ((Number(payload.ep) || 0) < (await getSessionEpoch())) return null;
    return { userId: payload.sub, username: payload.un };
  } catch {
    return null;
  }
}
