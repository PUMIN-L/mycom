// @vitest-environment node
/**
 * proxy.ts — Next 16's `proxy` file convention (formerly middleware.ts,
 * which Next 16 deprecates). The page gate for the admin screens: no validly
 * signed session cookie → /login. Run against tokens the app itself issues.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

vi.mock('@/app/lib/settingsStore', () => ({ getSessionEpoch: vi.fn(async () => 0) }));

import { proxy, config } from '@/proxy';
import { encrypt } from '@/app/lib/session';
import { issueLoginDeviceToken } from '@/app/lib/loginDevice';

const root = path.resolve(__dirname, '..');

const visit = (pathname: string, session?: string) =>
  proxy(
    new NextRequest(`http://localhost:3000${pathname}`, {
      headers: session ? { cookie: `session=${session}` } : {},
    })
  );

const redirectedToLogin = (res: Response) =>
  res.status === 307 && new URL(res.headers.get('location')!).pathname === '/login';
const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('proxy — the admin page gate', () => {
  it('sends a visitor with no session to /login', async () => {
    expect(redirectedToLogin(await visit('/dashboard'))).toBe(true);
  });

  it('remembers where it was going, so the login can send it back — a sticker QR opens the piece', async () => {
    const res = await visit('/stock/item/abc-123?x=1');
    expect(redirectedToLogin(res)).toBe(true);
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/stock/item/abc-123?x=1');
  });

  it('lets a session the app issued through', async () => {
    const token = await encrypt({ userId: '1', username: 'admin', expiresAt: new Date(Date.now() + 60_000) });
    expect(passedThrough(await visit('/dashboard', token))).toBe(true);
  });

  it('refuses a token signed with another key', async () => {
    const forged = await new SignJWT({ userId: '1', username: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('not-the-session-secret-at-all-0000'));
    expect(redirectedToLogin(await visit('/settings', forged))).toBe(true);
  });

  it('refuses an expired session', async () => {
    const expired = await new SignJWT({ userId: '1', username: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    expect(redirectedToLogin(await visit('/settings', expired))).toBe(true);
  });

  // The device cookie is a JWT too, signed with a key DERIVED from the session
  // secret precisely so that it is never accepted as a session here.
  it('refuses a login-device token as a session', async () => {
    const device = await issueLoginDeviceToken('admin', 0);
    expect(redirectedToLogin(await visit('/billing', device))).toBe(true);
  });

  it('refuses garbage', async () => {
    expect(redirectedToLogin(await visit('/billing', 'not.a.jwt'))).toBe(true);
  });
});

describe('proxy — the file convention', () => {
  it('is proxy.ts exporting `proxy`; a leftover middleware.ts is gone', async () => {
    expect(typeof proxy).toBe('function');
    const mod = (await import('@/proxy')) as Record<string, unknown>;
    expect(mod.middleware).toBeUndefined();
    // Next refuses to build with both files, and the old name is deprecated.
    for (const old of ['middleware.ts', 'middleware.js', 'src/middleware.ts']) {
      expect(fs.existsSync(path.join(root, old)), old).toBe(false);
    }
  });

  it('declares no `runtime` — Proxy is Node.js only, and the export is an error', async () => {
    const mod = (await import('@/proxy')) as Record<string, unknown>;
    expect(mod.runtime).toBeUndefined();
  });

  it('still gates every admin area, and never the public pages beside them', () => {
    const matcher = config.matcher as string[];
    for (const area of [
      '/adminpanel', '/assets', '/billing', '/create-content', '/create-product', '/crm', '/customers',
      '/dashboard', '/documents', '/edit-product', '/expenses', '/product-specs',
      '/purchase-order', '/quotation', '/service-job', '/settings', '/stock', '/suppliers', '/tools',
    ]) {
      expect(matcher, area).toContain(area);
      expect(matcher, `${area}/:path*`).toContain(`${area}/:path*`);
    }
    // /showcase/{id}, /document/{id} (singular) and /catalog are customer-facing.
    for (const publicPath of ['/showcase', '/showcase/:path*', '/document', '/document/:path*', '/catalog', '/']) {
      expect(matcher).not.toContain(publicPath);
    }
  });
});

// A session issued before the "a session exists" hint existed has none, and
// AuthContext would then never ask /api/auth/me for it. The admin page gate
// gives such a session its hint, expiring with the session.
describe('proxy — the session hint for older sessions', () => {
  const visitWith = (cookie: string) =>
    proxy(new NextRequest('http://localhost:3000/dashboard', { headers: { cookie } }));
  const setCookie = (res: Response) => res.headers.get('set-cookie') ?? '';

  it('adds has_session to a valid session that lacks it, expiring with the session', async () => {
    const token = await encrypt({ userId: '1', username: 'admin', expiresAt: new Date(Date.now() + 60_000) });
    const res = await visitWith(`session=${token}`);
    expect(passedThrough(res)).toBe(true);
    expect(setCookie(res)).toMatch(/has_session=1/);
    expect(setCookie(res)).not.toMatch(/HttpOnly/i);
    expect(setCookie(res)).toMatch(/Expires=/i);
  });

  it('leaves a session that already has it alone', async () => {
    const token = await encrypt({ userId: '1', username: 'admin', expiresAt: new Date(Date.now() + 60_000) });
    const res = await visitWith(`session=${token}; has_session=1`);
    expect(setCookie(res)).not.toMatch(/has_session/);
  });

  it('never gives one to a visitor without a valid session', async () => {
    const res = await visitWith('session=not-a-token');
    expect(redirectedToLogin(res)).toBe(true);
    expect(setCookie(res)).not.toMatch(/has_session/);
  });
});
