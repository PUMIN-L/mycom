// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/contact/messages/route';

vi.mock('@/app/lib/contactMessageStore', () => ({ listContactMessages: vi.fn() }));
import { listContactMessages } from '@/app/lib/contactMessageStore';
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

beforeEach(() => vi.clearAllMocks());

describe('GET /api/contact/messages (admin inbox)', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listContactMessages).not.toHaveBeenCalled();
  });

  it('returns the stored leads to a logged-in admin', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const rows = [
      { id: 'm1', name: 'A', email: 'a@x.com', subject: 'S', message: 'M', emailedOk: true, createdAt: 't' },
    ];
    vi.mocked(listContactMessages).mockResolvedValue(rows as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });
});
