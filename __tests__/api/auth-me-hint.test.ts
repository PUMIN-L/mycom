// @vitest-environment node
/**
 * /api/auth/me and the "a session exists" hint (lib/sessionHint.ts): a hint
 * that outlived its session (revoked, expired) is dropped, so that browser
 * stops asking on every page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(), enableDraftMode: vi.fn() }));
import { getSession, enableDraftMode } from '@/app/lib/session';
import { draftMode } from 'next/headers';

/** Draft Mode as the request carries it, with spies on its switches. */
function draft(isEnabled: boolean) {
  const state = { isEnabled, enable: vi.fn(), disable: vi.fn() };
  vi.mocked(draftMode).mockResolvedValue(state as never);
  return state;
}
import { GET } from '@/app/api/auth/me/route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/auth/me', () => {
  it('no live session: answers user null and deletes the hint', async () => {
    draft(false);
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(await res.json()).toEqual({ user: null });
    expect(res.headers.get('set-cookie') ?? '').toMatch(/has_session=;/);
  });

  it('a live session already in Draft Mode: answers the user, touches nothing', async () => {
    draft(true);
    vi.mocked(getSession).mockResolvedValue({ userId: '1', username: 'admin', expiresAt: new Date() } as never);
    const res = await GET();
    expect(await res.json()).toEqual({ user: { username: 'admin', userId: '1' } });
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/has_session/);
    expect(enableDraftMode).not.toHaveBeenCalled();
  });

  // A live session can lack Draft Mode (issued before it followed the
  // session, or a bypass cookie from an earlier build): it is given it back,
  // and told, so the page it is
  // on (the cached visitor's copy) is rendered again for the admin.
  it('a live session without Draft Mode: turns it on until the session expires, and says so', async () => {
    draft(false);
    // As it comes out of the token: the Date was serialized to a string.
    const expiresAt = '2026-10-07T10:00:00.000Z';
    vi.mocked(getSession).mockResolvedValue({ userId: '1', username: 'admin', expiresAt } as never);
    const res = await GET();
    expect(await res.json()).toEqual({ user: { username: 'admin', userId: '1' }, draftStarted: true });
    expect(enableDraftMode).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enableDraftMode).mock.calls[0][0]).toEqual(new Date(expiresAt));
  });

  it('no live session but still in Draft Mode: turns it off', async () => {
    const d = draft(true);
    vi.mocked(getSession).mockResolvedValue(null);
    await GET();
    expect(d.disable).toHaveBeenCalledTimes(1);
  });
});
