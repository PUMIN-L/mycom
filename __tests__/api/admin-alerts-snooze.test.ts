// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/alerts/snooze/route';

vi.mock('@/app/lib/crmStore', () => ({ snoozeAlert: vi.fn() }));
import { snoozeAlert } from '@/app/lib/crmStore';

// Drive the REAL requireAuth by controlling getSession (null = anonymous).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const req = (body: any) =>
  new NextRequest('http://localhost:3000/api/admin/alerts/snooze', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(adminSession);
});

describe('POST /api/admin/alerts/snooze', () => {
  it('rejects anonymous callers with 401 and never calls snoozeAlert', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(req({ alertType: 'schedule', referenceId: 's1', snoozeUntil: '2026-08-07T23:00:00.000Z' }));
    expect(res.status).toBe(401);
    expect(snoozeAlert).not.toHaveBeenCalled();
  });

  it('snoozes an alert for a logged-in admin', async () => {
    vi.mocked(snoozeAlert).mockResolvedValue(undefined);
    const res = await POST(req({ alertType: 'schedule', referenceId: 's1', snoozeUntil: '2026-08-07T23:00:00.000Z' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(snoozeAlert).toHaveBeenCalledWith('schedule', 's1', '2026-08-07T23:00:00.000Z');
  });

  it.each([
    ['missing alertType', { referenceId: 's1', snoozeUntil: '2026-08-07T23:00:00.000Z' }],
    ['missing referenceId', { alertType: 'schedule', snoozeUntil: '2026-08-07T23:00:00.000Z' }],
    ['missing snoozeUntil', { alertType: 'schedule', referenceId: 's1' }],
    ['snoozeUntil not a valid ISO datetime', { alertType: 'schedule', referenceId: 's1', snoozeUntil: '2026-08-07' }],
    ['empty alertType', { alertType: '', referenceId: 's1', snoozeUntil: '2026-08-07T23:00:00.000Z' }],
  ])('rejects an invalid body (%s) with 400 and never calls snoozeAlert', async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(snoozeAlert).not.toHaveBeenCalled();
  });
});
