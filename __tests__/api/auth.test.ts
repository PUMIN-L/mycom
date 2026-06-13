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
      const body = await res.json();
      
      expect(res.status).toBe(200);
      expect(body).toEqual({ user: null });
    });

    it('returns user data if session exists', async () => {
      vi.mocked(getSession).mockResolvedValue({
        userId: '1',
        username: 'testadmin',
        expiresAt: new Date()
      });
      
      const res = await getMe();
      const body = await res.json();
      
      expect(res.status).toBe(200);
      expect(body).toEqual({ user: { username: 'testadmin', userId: '1' } });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes session and returns success', async () => {
      const res = await logout();
      const body = await res.json();
      
      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true });
      expect(deleteSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/auth/login', () => {
    const mockRequest = (body: any, ip: string = '127.0.0.1') => {
      return new NextRequest('http://localhost', {
        method: 'POST',
        headers: {
          'x-forwarded-for': ip
        },
        body: JSON.stringify(body)
      });
    };

    it('returns 400 if missing username or password', async () => {
      const req = mockRequest({ username: 'admin' });
      const res = await login(req);
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('กรุณากรอก username และ password');
    });

    it('returns 401 on invalid username', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      const req = mockRequest({ username: 'wrong', password: 'pwd' });
      
      const res = await login(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('username หรือ password ไม่ถูกต้อง');
    });

    it('returns 401 on invalid password', async () => {
      vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash: 'hash' }]] as any);
      (bcrypt.compare as any).mockResolvedValue(false);
      
      const req = mockRequest({ username: 'admin', password: 'wrongpwd' });
      const res = await login(req);
      
      expect(res.status).toBe(401);
    });

    it('returns 200 and creates session on success', async () => {
      vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash: 'hash' }]] as any);
      (bcrypt.compare as any).mockResolvedValue(true);
      
      const req = mockRequest({ username: 'admin', password: 'correctpwd' });
      const res = await login(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.username).toBe('admin');
      
      expect(createSession).toHaveBeenCalledWith('1', 'admin');
    });

    it('enforces rate limiting after 5 failed attempts', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      
      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        const req = mockRequest({ username: 'admin', password: 'bad' }, 'bad-ip');
        await login(req);
      }
      
      // 6th attempt should return 429
      const req6 = mockRequest({ username: 'admin', password: 'bad' }, 'bad-ip');
      const res = await login(req6);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toContain('เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป');
    });
  });
});
