// What a failed API call says to the admin, read off the response. Pure enough
// for any client component; the routes answer `{ error: "…" }` in Thai (see
// __tests__/apiErrorLanguage.test.ts), so the reason the server gave is the
// one worth showing — not a generic "เกิดข้อผิดพลาด" that hides it.

export const SESSION_EXPIRED_MESSAGE = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง";

/**
 * The message for a response that was not ok: a 401 is always "the session
 * expired" (the route's own text there is the English code "Unauthorized");
 * otherwise the route's `error`, or `fallback` when the body has none — a
 * proxy's HTML error page, an empty body, a network-level 502.
 */
export async function errorMessageOf(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return SESSION_EXPIRED_MESSAGE;
  try {
    const body = await res.json();
    if (body && typeof body.error === "string" && body.error.trim()) return body.error.trim();
  } catch {
    // Not JSON: the fallback says it.
  }
  return fallback;
}
