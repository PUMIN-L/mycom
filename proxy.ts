// Next 16's `proxy` file convention — formerly middleware.ts, which Next 16
// deprecates (renamed, same behaviour; see node_modules/next/dist/docs/
// 01-app/03-api-reference/03-file-conventions/proxy.md). Runs before every
// page in `config.matcher` and sends a visitor without a validly SIGNED
// session cookie to /login. It checks the signature only — no database, so a
// revoked session still passes here; every protected API rejects it through
// getSession() (ARCHITECTURE.md §10). Proxy runs on the Node.js runtime; a
// `runtime` export here is an error.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from "jose";
import { SESSION_HINT_COOKIE, sessionHintCookieOptions } from "./app/lib/sessionHint";

const secretKey = process.env.SESSION_SECRET;
const encodedKey = secretKey ? new TextEncoder().encode(secretKey) : null;

async function decrypt(token: string | undefined) {
  if (!token || !encodedKey) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    return payload;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const session = request.cookies.get('session')?.value;
  const payload = await decrypt(session);

  if (!payload) {
    // Back here after the login (app/lib/loginDestination.ts) — a sticker's
    // QR scanned on a logged-out phone opens the piece, not the admin panel.
    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // A signed session without the "a session exists" hint — one issued before
  // the hint existed (lib/sessionHint.ts). Give it one, expiring with the
  // session, so AuthContext asks /api/auth/me for this browser again.
  const response = NextResponse.next();
  if (!request.cookies.has(SESSION_HINT_COOKIE) && typeof payload.exp === "number") {
    response.cookies.set(SESSION_HINT_COOKIE, "1", sessionHintCookieOptions(new Date(payload.exp * 1000)));
  }
  return response;
}

export const config = {
  matcher: [
    '/create-content',
    '/create-content/:path*',
    '/create-product',
    '/create-product/:path*',
    '/customers',
    '/customers/:path*',
    '/edit-product',
    '/edit-product/:path*',
    '/quotation',
    '/quotation/:path*',
    // ใบ Job — the printed service job sheet builder and its list. The sheet is
    // assembled from customer names, machines and SERIAL NUMBERS, so an ungated
    // page here hands the whole equipment registry to anyone with the URL.
    // Nothing under /service-job is ever meant to be public — unlike
    // /document/[id] and /showcase/{id} below, there is no customer-facing
    // counterpart to keep out of the matcher.
    '/service-job',
    '/service-job/:path*',
    '/settings',
    '/settings/:path*',
    // NOTE: /document/[id] (singular) is the PUBLIC catalog PDF viewer reached
    // from /catalog — it must NOT be gated. Only /documents (plural) is the admin
    // management page.
    '/documents',
    '/documents/:path*',
    '/product-specs',
    '/product-specs/:path*',
    '/suppliers',
    '/suppliers/:path*',
    '/purchase-order',
    '/purchase-order/:path*',
    '/billing',
    '/billing/:path*',
    '/crm',
    '/crm/:path*',
    '/dashboard',
    '/dashboard/:path*',
    '/expenses',
    '/expenses/:path*',
    // Asset register + stock — also the pages a sticker's QR opens, so a
    // phone that is not logged in lands on /login first.
    '/assets',
    '/assets/:path*',
    '/stock',
    '/stock/:path*',
    // Admin Panel hub (moved from /showcase). NOTE: /showcase/{id} content
    // pages and /showcase/product/{pid} are PUBLIC — never add /showcase back
    // here (doing so bounced customers + Google to /login).
    '/adminpanel',
    '/adminpanel/:path*',
    '/tools',
    '/tools/:path*'
  ],
};
