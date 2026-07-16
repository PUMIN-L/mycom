// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMe } from '@/app/api/auth/me/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';

// Mock DB
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  getDbConnection: vi.fn()
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
    it('deletes session and returns success', async () => {
      const res = await logout();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(deleteSession).toHaveBeenCalledTimes(1);
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

    it('enforces rate limiting after 5 failed attempts (per username, ignoring spoofable IP)', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      (bcrypt.compare as any).mockResolvedValue(false);

      for (let i = 0; i < 5; i++) {
        await login(mockRequest({ username: 'brute-target', password: 'bad' }));
      }
      const res = await login(mockRequest({ username: 'brute-target', password: 'bad' }));
      expect(res.status).toBe(429);
      expect((await res.json()).error).toContain('เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป');
    });

    it('clears the block after the 15-minute window expires', async () => {
      // Fake only Date (not timers) so request/promise I/O keeps working.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      try {
        vi.mocked(query).mockResolvedValue([[]] as any);
        (bcrypt.compare as any).mockResolvedValue(false);

        for (let i = 0; i < 5; i++) {
          await login(mockRequest({ username: 'expire-user', password: 'bad' }));
        }
        expect((await login(mockRequest({ username: 'expire-user', password: 'bad' }))).status).toBe(429);

        // Advance past the 15-minute block window.
        vi.setSystemTime(new Date('2026-01-01T00:16:00Z'));
        expect((await login(mockRequest({ username: 'expire-user', password: 'bad' }))).status).toBe(401);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets the failure counter after a successful login', async () => {
      // 4 failures (not yet blocked)
      vi.mocked(query).mockResolvedValue([[]] as any);
      (bcrypt.compare as any).mockResolvedValue(false);
      for (let i = 0; i < 4; i++) {
        await login(mockRequest({ username: 'reset-user', password: 'bad' }));
      }
      // A successful login clears the counter.
      vi.mocked(query).mockResolvedValue([[{ id: '9', username: 'reset-user', passwordHash: 'hash' }]] as any);
      (bcrypt.compare as any).mockResolvedValue(true);
      expect((await login(mockRequest({ username: 'reset-user', password: 'ok' }))).status).toBe(200);

      // Counter is reset: the next 4 failures are 401 (not immediately 429).
      vi.mocked(query).mockResolvedValue([[]] as any);
      (bcrypt.compare as any).mockResolvedValue(false);
      for (let i = 0; i < 4; i++) {
        const res = await login(mockRequest({ username: 'reset-user', password: 'bad' }));
        expect(res.status).toBe(401);
      }
    });
  });
});
