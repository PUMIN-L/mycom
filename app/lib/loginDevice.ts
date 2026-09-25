import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { getSessionEpoch } from "./settingsStore";

// "Device cookies" against login lockout abuse (OWASP's recommended fix).
//
// The login lockout counts failures per username, so anyone can keep an
// account locked by failing 5 times every 15 minutes — including the admin's
// own, from anywhere. A browser that has logged in successfully gets this
// cookie; while it presents a valid one for the username it is trying, its
// failures are counted in its OWN bucket instead of the username's. An
// attacker locks the username; the admin's browser is not in that bucket.
// The attacker gains nothing: without a successful login there is no cookie,
// so every guess still lands in the username bucket, 5 per 15 minutes.
//
// ⚠️ The signing key is DERIVED from SESSION_SECRET, never the session key
// itself. getSession()/middleware verify only the signature, so a token
// signed with the session key would be accepted AS a session. With distinct
// keys (and the audience check) neither kind of token verifies as the other.

export const LOGIN_DEVICE_COOKIE = "login_device";
const AUDIENCE = "login-device";
const TTL_DAYS = 180;

function deviceKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(`login-device:${secret}`);
}

export const LOGIN_DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  // Sent to the login endpoint and nowhere else.
  path: "/api/auth/login",
  maxAge: TTL_DAYS * 24 * 60 * 60,
};

/**
 * A fresh device token for `username`, with a new device id. Carries the
 * session epoch like a session does, so "ออกจากระบบอุปกรณ์อื่นทั้งหมด" also
 * stops every other browser being treated as trusted. `epoch` is passed by a
 * caller that has just bumped it.
 */
export async function issueLoginDeviceToken(username: string, epoch?: number): Promise<string> {
  return new SignJWT({ ep: epoch ?? (await getSessionEpoch()) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username.toLowerCase())
    .setAudience(AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TTL_DAYS}d`)
    .sign(deviceKey());
}

/**
 * The device id when `token` is a valid, unexpired device token issued for
 * `username`; otherwise null (missing, forged, expired, another user's, a
 * session token, or issued before the last "log out other devices").
 */
export async function loginDeviceIdFor(
  token: string | undefined,
  username: string
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, deviceKey(), {
      algorithms: ["HS256"],
      audience: AUDIENCE,
    });
    if (payload.sub !== username.toLowerCase() || typeof payload.jti !== "string") return null;
    if ((Number(payload.ep) || 0) < (await getSessionEpoch())) return null;
    return payload.jti;
  } catch {
    return null;
  }
}
