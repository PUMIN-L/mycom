// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/app/lib/crmStore', () => ({
  getAlerts: vi.fn(),
}));
import { getAlerts } from '@/app/lib/crmStore';

// v35: the route composes the computed feed with the manual task board's
// due-task count, so this store has to be mocked too or the handler reaches
// for a real database.
vi.mock('@/app/lib/taskStore', () => ({
  countDueTasks: vi.fn(),
}));
import { countDueTasks } from '@/app/lib/taskStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

import { GET } from '@/app/api/admin/alerts/route';

describe('Admin Alerts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(countDueTasks).mockResolvedValue(0);
  });

  it('returns 401 for anonymous', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/alerts'));
    expect(res.status).toBe(401);
  });

  it('returns alerts with default day windows', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const data = { expiringWarranties: [], upcomingSchedules: [] };
    vi.mocked(getAlerts).mockResolvedValue(data as any);
    vi.mocked(countDueTasks).mockResolvedValue(3);

    const res = await GET(new NextRequest('http://localhost:3000/api/admin/alerts'));
    expect(res.status).toBe(200);
    // Everything getAlerts() computed, plus the board's due-task count.
    expect(await res.json()).toEqual({ ...data, dueTaskCount: 3 });
    expect(getAlerts).toHaveBeenCalledWith(30, 7);
  });

  it('accepts custom warrantyDays and scheduleDays', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getAlerts).mockResolvedValue({ expiringWarranties: [], upcomingSchedules: [] } as any);

    await GET(
      new NextRequest('http://localhost:3000/api/admin/alerts?warrantyDays=60&scheduleDays=14')
    );
    expect(getAlerts).toHaveBeenCalledWith(60, 14);
  });

  it('clamps day windows to [1, 365]', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getAlerts).mockResolvedValue({ expiringWarranties: [], upcomingSchedules: [] } as any);

    // -5 → parseInt gives -5 (truthy), Math.max(-5, 1) = 1; 999 → Math.min(999, 365) = 365
    await GET(
      new NextRequest('http://localhost:3000/api/admin/alerts?warrantyDays=-5&scheduleDays=999')
    );
    expect(getAlerts).toHaveBeenCalledWith(1, 365);
  });
});
