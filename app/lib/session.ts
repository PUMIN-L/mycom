import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, draftMode } from "next/headers";
import { getSessionEpoch } from "./settingsStore";
import { SESSION_HINT_COOKIE, sessionHintCookieOptions } from "./sessionHint";

const secretKey = process.env.SESSION_SECRET;
if (!secretKey) throw new Error("SESSION_SECRET is not set");
const encodedKey = new TextEncoder().encode(secretKey);

export interface SessionPayload {
  userId: string;
  username: string;
  expiresAt: Date;
  /** The session epoch this token was issued under (settingsStore). Absent on
   *  tokens issued before epochs existed, which read as 0. */
  epoch?: number;
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("3d")
    .sign(encodedKey);
}

export async function decrypt(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * `epoch` is passed explicitly by a caller that has just bumped it (so the
 * new session is not issued from a cache read of the old value); otherwise the
 * current epoch is used.
 */
export async function createSession(userId: string, username: string, epoch?: number) {
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
  const token = await encrypt({
    userId,
    username,
    expiresAt,
    epoch: epoch ?? (await getSessionEpoch()),
  });
  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "lax",
    path: "/",
  });
  // The script-readable "a session exists" hint, with the same lifetime
  // (lib/sessionHint.ts): lets AuthContext skip /api/auth/me without one.
  cookieStore.set(SESSION_HINT_COOKIE, "1", sessionHintCookieOptions(expiresAt));
  await enableDraftMode(expiresAt);
}

// Next's Draft Mode cookie — the name is documented (draftMode() API docs).
const PRERENDER_BYPASS_COOKIE = "__prerender_bypass";

/**
 * Draft Mode for this browser until `expires` — the session's own expiry.
 *
 * Cached and prerendered pages (the /showcase content pages are ISR) are
 * rendered fresh for a browser in Draft Mode, so a logged-in admin sees what
 * only an admin may — hidden products' pages, the edit picker's full list —
 * while visitors keep the cached copy. The bypass cookie is a per-build secret
 * and grants nothing by itself: those pages still decide from getSession().
 *
 * draftMode().enable() sets it as a browser-session cookie with SameSite=None
 * (made for a CMS previewing in a cross-site iframe). That outlives the
 * three-day session in a browser that restores its tabs — every page left
 * uncached after the session is gone, with nothing to turn it off — and dies
 * early in one that does not. Re-issued here with the session's expiry and
 * SameSite=Lax, it lives exactly as long as the session and the hint.
 *
 * Route Handlers only (where enable() is allowed): every caller is one.
 */
export async function enableDraftMode(expires: Date) {
  (await draftMode()).enable();
  if (Number.isNaN(expires.getTime())) return; // no usable expiry: Next's own cookie stands
  const cookieStore = await cookies();
  const bypass = cookieStore.get(PRERENDER_BYPASS_COOKIE)?.value;
  if (!bypass) return; // renamed in some Next upgrade: Next's own cookie stands
  cookieStore.set(PRERENDER_BYPASS_COOKIE, bypass, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
  cookieStore.delete(SESSION_HINT_COOKIE);
  (await draftMode()).disable();
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const payload = await decrypt(token);
  if (!payload) return null;
  // Revoked by "ออกจากระบบอุปกรณ์อื่นทั้งหมด" if issued under an older epoch.
  // Read only when a valid token is present, so anonymous traffic never pays
  // for it. proxy.ts (no DB, by choice) does not check this — it gates page
  // shells by signature alone; every API route and server-side read goes
  // through here.
  const tokenEpoch = Number(payload.epoch) || 0;
  return tokenEpoch >= (await getSessionEpoch()) ? payload : null;
}
