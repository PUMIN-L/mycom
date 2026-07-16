// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We must set the env variable BEFORE importing session.ts
process.env.SESSION_SECRET = 'test-secret-key-12345678901234567890';
const { encrypt, decrypt, createSession, deleteSession, getSession } = await import('@/app/lib/session');

// In __tests__/setup.ts we mocked next/headers: cookies()
import { cookies } from 'next/headers';

describe('session', () => {
  const mockCookies = {
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue(mockCookies as any);
  });

  describe('encrypt & decrypt', () => {
    it('encrypts and decrypts a payload successfully', async () => {
      const payload = { userId: '1', username: 'admin', expiresAt: new Date() };
      const token = await encrypt(payload);
      
      expect(typeof token).toBe('string');
      
      const decrypted = await decrypt(token);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.userId).toBe('1');
      expect(decrypted?.username).toBe('admin');
    });

    it('returns null when decrypting an invalid token', async () => {
      const decrypted = await decrypt('invalid.token.here');
      expect(decrypted).toBeNull();
    });

    it('returns null when decrypting an empty token', async () => {
      const decrypted = await decrypt(undefined);
      expect(decrypted).toBeNull();
    });
  });

  describe('createSession', () => {
    it('sets a session cookie with the full security-critical flag set', async () => {
      await createSession('2', 'editor');

      expect(cookies).toHaveBeenCalled();
      expect(mockCookies.set).toHaveBeenCalledWith(
        'session',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          // In the (non-production) test env, secure is false.
          secure: false,
          // ~3-day expiry.
          expires: expect.any(Date),
        })
      );
    });

    it('marks the cookie Secure in production', async () => {
      const prev = process.env.NODE_ENV;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      try {
        await createSession('2', 'editor');
        expect(mockCookies.set).toHaveBeenCalledWith(
          'session',
          expect.any(String),
          expect.objectContaining({ secure: true })
        );
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = prev;
      }
    });
  });

  describe('deleteSession', () => {
    it('deletes the session cookie', async () => {
      await deleteSession();
      
      expect(cookies).toHaveBeenCalled();
      expect(mockCookies.delete).toHaveBeenCalledWith('session');
    });
  });

  describe('getSession', () => {
    it('returns decrypted session if cookie exists', async () => {
      const payload = { userId: '3', username: 'viewer', expiresAt: new Date() };
      const token = await encrypt(payload);
      
      mockCookies.get.mockReturnValue({ value: token });
      
      const session = await getSession();
      expect(session).not.toBeNull();
      expect(session?.username).toBe('viewer');
    });

    it('returns null if cookie does not exist', async () => {
      mockCookies.get.mockReturnValue(undefined);
      
      const session = await getSession();
      expect(session).toBeNull();
    });
  });
});
