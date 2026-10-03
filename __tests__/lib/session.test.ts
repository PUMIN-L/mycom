// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// getSession()/createSession() read the session epoch ("log out other devices").
// Pinned here so these tests never reach the real settings store.
vi.mock('@/app/lib/settingsStore', () => ({ getSessionEpoch: vi.fn(async () => 0) }));

// We must set the env variable BEFORE importing session.ts
process.env.SESSION_SECRET = 'test-secret-key-12345678901234567890';
const { encrypt, decrypt, createSession, deleteSession, getSession, enableDraftMode } = await import('@/app/lib/session');

// In __tests__/setup.ts we mocked next/headers: cookies()
import { cookies, draftMode } from 'next/headers';

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

    it('deletes the "a session exists" hint with it', async () => {
      await deleteSession();
      expect(mockCookies.delete).toHaveBeenCalledWith('has_session');
    });
  });

  // Draft Mode: the admin's browser gets fresh renders of cached pages (the
  // /showcase content pages are ISR) — on with the session, off with it, and
  // its cookie expiring WITH the session (Next's own is a browser-session
  // cookie, which a tab-restoring browser keeps long after the session).
  describe('Draft Mode follows the session', () => {
    const draftOff = () => {
      const state = { isEnabled: false, enable: vi.fn(), disable: vi.fn() };
      vi.mocked(draftMode).mockResolvedValue(state as never);
      return state;
    };
    const bypassCookie = (value: string | undefined) =>
      mockCookies.get.mockImplementation((name: string) =>
        name === '__prerender_bypass' && value !== undefined ? { value } : undefined
      );

    it('createSession turns it on, deleteSession turns it off', async () => {
      const state = draftOff();
      await createSession('2', 'editor');
      expect(state.enable).toHaveBeenCalledTimes(1);
      await deleteSession();
      expect(state.disable).toHaveBeenCalledTimes(1);
    });

    it("re-issues Next's bypass cookie to expire with the session, SameSite=Lax", async () => {
      draftOff();
      bypassCookie('build-preview-id');
      await createSession('2', 'editor');
      const sessionCall = mockCookies.set.mock.calls.find(([name]) => name === 'session')!;
      const bypassCall = mockCookies.set.mock.calls.find(([name]) => name === '__prerender_bypass')!;
      expect(bypassCall[1]).toBe('build-preview-id');
      expect(bypassCall[2]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
      expect(bypassCall[2].expires).toEqual(sessionCall[2].expires);
    });

    it("leaves Next's own cookie alone when it cannot find it, or has no usable expiry", async () => {
      draftOff();
      bypassCookie(undefined);
      await enableDraftMode(new Date(Date.now() + 1000));
      draftOff();
      bypassCookie('build-preview-id');
      await enableDraftMode(new Date('not a date'));
      expect(mockCookies.set.mock.calls.find(([name]) => name === '__prerender_bypass')).toBeUndefined();
    });
  });

  // The script-readable hint (lib/sessionHint.ts) lets AuthContext skip
  // /api/auth/me in a browser with no session. It must expire WITH the
  // session, be readable by script, and carry nothing secret.
  describe('createSession — the session hint', () => {
    it('sets has_session=1, script-readable, expiring with the session', async () => {
      await createSession('2', 'editor');
      const sessionCall = mockCookies.set.mock.calls.find(([name]) => name === 'session')!;
      const hintCall = mockCookies.set.mock.calls.find(([name]) => name === 'has_session')!;
      expect(hintCall[1]).toBe('1');
      expect(hintCall[2]).toMatchObject({ httpOnly: false, path: '/', sameSite: 'lax' });
      expect(hintCall[2].expires).toEqual(sessionCall[2].expires);
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
