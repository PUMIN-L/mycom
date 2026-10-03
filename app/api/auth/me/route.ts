import { NextResponse } from "next/server";
import { draftMode } from "next/headers";
import { getSession, enableDraftMode } from "../../../lib/session";
import { SESSION_HINT_COOKIE } from "../../../lib/sessionHint";

export async function GET() {
  const session = await getSession();
  const draft = await draftMode();
  if (!session) {
    // A hint that outlived its session (revoked, expired, cookie cleared):
    // drop it, so this browser stops asking on every page — and Draft Mode
    // with it, so it is served the cached pages again.
    if (draft.isEnabled) draft.disable();
    const response = NextResponse.json({ user: null }, { status: 200 });
    response.cookies.delete(SESSION_HINT_COOKIE);
    return response;
  }
  // A live session without Draft Mode — issued before Draft Mode followed the
  // session, or carrying a bypass cookie from an earlier build (its value is
  // a per-build secret) — is given it back here, until the session expires,
  // and told so (draftStarted): AuthContext then re-renders the page it is
  // on, which was the cached, visitor's copy — a hidden product's page was a
  // 404 there.
  const draftStarted = !draft.isEnabled;
  if (draftStarted) await enableDraftMode(new Date(session.expiresAt));
  return NextResponse.json({
    user: { username: session.username, userId: session.userId },
    ...(draftStarted ? { draftStarted: true } : {}),
  });
}
