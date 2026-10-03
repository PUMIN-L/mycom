// "This browser has a session" — a hint, not a credential. Pure: read by the
// browser (AuthContext), set by the server (session.ts, proxy.ts).
//
// The session cookie is httpOnly, so a page's script cannot tell whether one
// is there; AuthContext used to ask /api/auth/me on EVERY page load of EVERY
// visitor — one server function run per page view, almost all of them for
// someone who has never logged in. This cookie is readable by script and
// says only that a session cookie was issued: no id, no name, no secret. It
// grants nothing — /api/auth/me still decides, from the real session — it
// only lets a browser with no session skip the question.
//
// Set with the session and gone with it (same expiry; deleted on logout);
// cleared by /api/auth/me when the session behind it is no longer valid
// (revoked, expired); and set again by proxy.ts for a valid session that
// lacks it — every session issued before this cookie existed.

export const SESSION_HINT_COOKIE = "has_session";

/** Options for setting the hint: NOT httpOnly — script must read it. */
export function sessionHintCookieOptions(expires: Date) {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** Whether `cookieHeader` (document.cookie) carries the hint. */
export function hasSessionHint(cookieHeader: string): boolean {
  return cookieHeader.split(";").some((part) => part.trim().startsWith(`${SESSION_HINT_COOKIE}=`));
}
