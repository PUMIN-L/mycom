import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from "jose";

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

export async function middleware(request: NextRequest) {
  const session = request.cookies.get('session')?.value;
  const payload = await decrypt(session);

  if (!payload) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
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
    '/billing',
    '/billing/:path*',
    '/crm',
    '/crm/:path*'
  ],
};
