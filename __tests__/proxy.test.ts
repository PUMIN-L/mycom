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
      '/adminpanel', '/billing', '/create-content', '/create-product', '/crm', '/customers',
      '/dashboard', '/documents', '/edit-product', '/expenses', '/product-specs',
      '/purchase-order', '/quotation', '/service-job', '/settings', '/suppliers', '/tools',
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
