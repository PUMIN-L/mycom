import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionEpoch } from "./settingsStore";

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
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const payload = await decrypt(token);
  if (!payload) return null;
  // Revoked by "ออกจากระบบอุปกรณ์อื่นทั้งหมด" if issued under an older epoch.
  // Read only when a valid token is present, so anonymous traffic never pays
  // for it. middleware.ts (edge, no DB) cannot check this — it gates page
  // shells by signature alone; every API route and server-side read goes
  // through here.
  const tokenEpoch = Number(payload.epoch) || 0;
  return tokenEpoch >= (await getSessionEpoch()) ? payload : null;
}
