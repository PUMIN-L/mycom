// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMe } from '@/app/api/auth/me/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';

// Mock DB. recordLoginFailure locks/reads/writes its counter through
// withTransaction — these tests don't care about the counter's value, so a
// generic connection stub that answers every query the same way is enough.
const conn = { query: vi.fn().mockResolvedValue([[{ value: '0|0' }]]) };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  getDbConnection: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query } from '@/app/lib/db';

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn() as any
  }
}));
import bcrypt from 'bcryptjs';

// Mock session
vi.mock('@/app/lib/session', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn()
}));
import { getSession, createSession, deleteSession } from '@/app/lib/session';

describe('Auth API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/auth/me', () => {
    it('returns null user if no session', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await getMe();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: null });
    });

    it('returns user data if session exists', async () => {
      vi.mocked(getSession).mockResolvedValue({
        userId: '1',
        username: 'testadmin',
        expiresAt: new Date()
      });
      const res = await getMe();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: { username: 'testadmin', userId: '1' } });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes session and returns success for a same-origin request', async () => {
      const res = await logout(
        new NextRequest('http://localhost', {
          method: 'POST',
          headers: { origin: 'http://localhost', host: 'localhost' },
        })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(deleteSession).toHaveBeenCalledTimes(1);
    });

    it('rejects a cross-origin logout request (CSRF guard)', async () => {
      const res = await logout(
        new NextRequest('http://localhost', {
          method: 'POST',
          headers: { origin: 'http://evil.example.com', host: 'localhost' },
        })
      );
      expect(res.status).toBe(403);
      expect(deleteSession).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    // Each test uses a UNIQUE username so the module-level rate-limit map (keyed
    // on username) can't leak state between tests regardless of run order.
    const mockRequest = (body: any) =>
      new NextRequest('http://localhost', {
        method: 'POST',
        body: JSON.stringify(body)
      });

    it('returns 400 if missing username or password', async () => {
      const res = await login(mockRequest({ username: 'missing-pw-user' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('กรุณากรอก username และ password');
    });

    it('returns 401 on invalid username', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      (bcrypt.compare as any).mockResolvedValue(false);
      const res = await login(mockRequest({ username: 'no-such-user', password: 'pwd' }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('username หรือ password ไม่ถูกต้อง');
    });

    it('returns 401 on invalid password', async () => {
      vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'pw-user', passwordHash: 'hash' }]] as any);
      (bcrypt.compare as any).mockResolvedValue(false);
      const res = await login(mockRequest({ username: 'pw-user', password: 'wrongpwd' }));
      expect(res.status).toBe(401);
    });

    it('returns 200 and creates session on success', async () => {
      vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'ok-user', passwordHash: 'hash' }]] as any);
      (bcrypt.compare as any).mockResolvedValue(true);
      const res = await login(mockRequest({ username: 'ok-user', password: 'correctpwd' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(createSession).toHaveBeenCalledWith('1', 'ok-user');
    });

    // Rate-limit lockout/expiry/reset behavior is covered in
    // login-rate-limit.test.ts, which mocks settingsStore's getSetting/
    // setSetting directly (the lockout counter is persisted there, shared
    // across serverless instances) — that mock needs to be stateful, which
    // this file's plain db.query stub isn't, so those cases don't belong here.
  });
});
