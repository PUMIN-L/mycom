// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/app/lib/crmStore', () => ({
  listSchedules: vi.fn(),
  getSchedule: vi.fn(),
  addSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  getEquipment: vi.fn(),
  listLogs: vi.fn(),
  completeScheduleWithLog: vi.fn(),
  ScheduleNotPendingError: class extends Error {
    name = 'ScheduleNotPendingError';
    constructor(public readonly scheduleId: string) {
      super(`schedule ${scheduleId} is not pending`);
    }
  },
  SCHEDULE_TYPES: ['service', 'phone_call'],
  SCHEDULE_STATUSES: ['pending', 'completed', 'cancelled'],
}));
import {
  listSchedules,
  getSchedule,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  getEquipment,
  listLogs,
  completeScheduleWithLog,
} from '@/app/lib/crmStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const mutReq = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// ── Import handlers ──────────────────────────────────────────────────────────

import { GET as listGET, POST as createPOST } from '@/app/api/admin/schedules/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/admin/schedules/[id]/route';
import { GET as logsGET, POST as logsPOST } from '@/app/api/admin/schedules/[id]/logs/route';

describe('Admin Schedules API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
  });

  // ── Auth ────────────────────────────────────────────────────────────────

  it('all routes return 401 for anonymous', async () => {
    const res1 = await listGET(new NextRequest('http://localhost:3000/api/admin/schedules'));
    expect(res1.status).toBe(401);

    const res2 = await getGET(
      new NextRequest('http://localhost:3000/api/admin/schedules/s1'),
      ctx('s1')
    );
    expect(res2.status).toBe(401);
  });

  // ── GET list ────────────────────────────────────────────────────────────

  it('GET returns all schedules', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const data = [{ id: 's1', scheduleType: 'service' }];
    vi.mocked(listSchedules).mockResolvedValue(data as any);

    const res = await listGET(new NextRequest('http://localhost:3000/api/admin/schedules'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
  });

  // ── POST ────────────────────────────────────────────────────────────────

  it('POST creates schedule with 201', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const equipment = { id: 'eq-1' };
    vi.mocked(getEquipment).mockResolvedValue(equipment as any);
    const created = { id: 's-new', scheduleType: 'service', scheduledDate: '2026-09-01' };
    vi.mocked(addSchedule).mockResolvedValue(created as any);

    const res = await createPOST(
      mutReq('http://localhost:3000/api/admin/schedules', 'POST', {
        equipmentId: 'eq-1',
        scheduleType: 'service',
        scheduledDate: '2026-09-01',
      })
    );
    expect(res.status).toBe(201);
  });

  it('POST returns 400 for invalid scheduleType', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getEquipment).mockResolvedValue({ id: 'eq-1' } as any);

    const res = await createPOST(
      mutReq('http://localhost:3000/api/admin/schedules', 'POST', {
        equipmentId: 'eq-1',
        scheduleType: 'invalid',
        scheduledDate: '2026-09-01',
      })
    );
    expect(res.status).toBe(400);
  });

  it('POST returns 404 for missing equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getEquipment).mockResolvedValue(null);

    const res = await createPOST(
      mutReq('http://localhost:3000/api/admin/schedules', 'POST', {
        equipmentId: 'missing',
        scheduleType: 'service',
        scheduledDate: '2026-09-01',
      })
    );
    expect(res.status).toBe(404);
  });

  // ── PUT [id] ────────────────────────────────────────────────────────────

  it('PUT updates schedule', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const updated = { id: 's1', status: 'cancelled' };
    vi.mocked(updateSchedule).mockResolvedValue(updated as any);

    const res = await PUT(
      mutReq('http://localhost:3000/api/admin/schedules/s1', 'PUT', { status: 'cancelled' }),
      ctx('s1')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
  });

  it('PUT returns 400 for invalid status', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await PUT(
      mutReq('http://localhost:3000/api/admin/schedules/s1', 'PUT', { status: 'nonsense' }),
      ctx('s1')
    );
    expect(res.status).toBe(400);
  });

  it('PUT returns 400 for invalid scheduleType', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await PUT(
      mutReq('http://localhost:3000/api/admin/schedules/s1', 'PUT', { scheduleType: 'hacked' }),
      ctx('s1')
    );
    expect(res.status).toBe(400);
  });

  // ── DELETE [id] ─────────────────────────────────────────────────────────

  it('DELETE removes schedule', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(deleteSchedule).mockResolvedValue(true);

    const res = await DELETE(
      mutReq('http://localhost:3000/api/admin/schedules/s1', 'DELETE'),
      ctx('s1')
    );
    expect(res.status).toBe(200);
  });

  // ── Logs GET ────────────────────────────────────────────────────────────

  it('GET logs returns service history', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const logsData = [{ id: 'l1', resultDetails: 'Fixed' }];
    vi.mocked(listLogs).mockResolvedValue(logsData as any);

    const res = await logsGET(
      new NextRequest('http://localhost:3000/api/admin/schedules/s1/logs'),
      ctx('s1')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(logsData);
  });

  // ── Logs POST (complete) ───────────────────────────────────────────────

  it('POST logs completes schedule with 201', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const log = { id: 'l-new', scheduleId: 's1', resultDetails: 'Done' };
    vi.mocked(completeScheduleWithLog).mockResolvedValue(log as any);

    const res = await logsPOST(
      mutReq('http://localhost:3000/api/admin/schedules/s1/logs', 'POST', {
        resultDetails: 'Done',
      }),
      ctx('s1')
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(log);
  });

  it('POST logs returns 409 for non-pending schedule', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    // Import the ScheduleNotPendingError from the mock
    const { ScheduleNotPendingError } = await import('@/app/lib/crmStore');
    vi.mocked(completeScheduleWithLog).mockRejectedValue(
      new ScheduleNotPendingError('s1')
    );

    const res = await logsPOST(
      mutReq('http://localhost:3000/api/admin/schedules/s1/logs', 'POST', {
        resultDetails: 'Attempt',
      }),
      ctx('s1')
    );
    expect(res.status).toBe(409);
  });
});
