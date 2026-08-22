// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/salesDashboardStore', () => ({
  getDashboardOverview: vi.fn().mockResolvedValue({ currentMonth: {}, previousMonth: {}, expiringWarranties: 0 }),
  getRevenueByMonth: vi.fn().mockResolvedValue([]),
  getRevenueByQuarter: vi.fn().mockResolvedValue([]),
  getRevenueByCategory: vi.fn().mockResolvedValue([]),
  getTopProducts: vi.fn().mockResolvedValue([]),
  getTopCustomers: vi.fn().mockResolvedValue([]),
  getSalespersonLeaderboard: vi.fn().mockResolvedValue([]),
  getSmartInsights: vi.fn().mockResolvedValue([]),
}));
import {
  getDashboardOverview,
  getRevenueByMonth,
} from '@/app/lib/salesDashboardStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

import { GET } from '@/app/api/admin/dashboard/route';

describe('Admin Dashboard API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
  });

  it('returns 401 if unauthenticated', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/dashboard'));
    expect(res.status).toBe(401);
  });

  it('returns dashboard aggregated data for authenticated user', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await GET(new NextRequest('http://localhost:3000/api/admin/dashboard?year=2026'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('overview');
    expect(json).toHaveProperty('revenueMonthly');
    expect(json).toHaveProperty('revenueQuarterly');
    expect(json).toHaveProperty('revenueByCategory');
    expect(json).toHaveProperty('topProducts');
    expect(json).toHaveProperty('topCustomers');
    expect(json).toHaveProperty('salespersonLeaderboard');
    expect(json).toHaveProperty('insights');
    expect(getRevenueByMonth).toHaveBeenCalledWith(2026);
  });
});
