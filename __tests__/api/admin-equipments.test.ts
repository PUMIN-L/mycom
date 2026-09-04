// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/app/lib/crmStore', () => ({
  listEquipments: vi.fn(),
  getEquipment: vi.fn(),
  addEquipment: vi.fn(),
  updateEquipment: vi.fn(),
  deleteEquipment: vi.fn(),
  listSchedules: vi.fn(),
  declineWarrantyRenewal: vi.fn(),
}));
import {
  listEquipments,
  getEquipment,
  addEquipment,
  updateEquipment,
  deleteEquipment,
  listSchedules,
  declineWarrantyRenewal,
} from '@/app/lib/crmStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

// Not mocking otpAttempts.ts — it's real code backed by the mocked
// settingsStore getSetting/setSetting and db.ts withTransaction below (same
// pattern as admin-schedules.test.ts).
vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getContactEmail: vi.fn().mockResolvedValue('admin@example.com'),
}));
import { getSetting, setSetting } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn().mockReturnValue(true),
  sendEquipmentDeleteOtpEmail: vi.fn().mockResolvedValue(undefined),
}));
import { isMailConfigured, sendEquipmentDeleteOtpEmail } from '@/app/lib/mailer';

let sharedState = new Map<string, string>();
const conn = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT value FROM settings')) {
      const [key] = params as [string];
      const v = sharedState.get(key);
      return [v !== undefined ? [{ value: v }] : []];
    }
    if (sql.includes('INSERT INTO settings')) {
      const [key, value] = params as [string, string];
      sharedState.set(key, value);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled SQL in test: ${sql}`);
  }),
};
vi.mock('@/app/lib/db', () => ({
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

function mockSettingsState(initial: Record<string, string> = {}) {
  sharedState = new Map(Object.entries(initial));
  vi.mocked(getSetting).mockImplementation(async (key: string) => sharedState.get(key) ?? null);
  vi.mocked(setSetting).mockImplementation(async (key: string, value: string) => {
    sharedState.set(key, value);
  });
  return sharedState;
}

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const mutReq = (method: string, body?: any) =>
  new NextRequest('http://localhost:3000/api/admin/equipments', {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const mutReqId = (method: string, body?: any) =>
  new NextRequest('http://localhost:3000/api/admin/equipments/eq-1', {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// ── Import handlers ──────────────────────────────────────────────────────────

import { GET as listGET, POST } from '@/app/api/admin/equipments/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/admin/equipments/[id]/route';
import { POST as deleteOtpPOST } from '@/app/api/admin/equipments/[id]/delete-otp/route';
import { POST as declineRenewalPOST } from '@/app/api/admin/equipments/[id]/decline-renewal/route';

const equipmentNoSchedule = { id: 'eq-1', serialNumber: 'ABC', productName: 'Scale A' };

describe('Admin Equipments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(getEquipment).mockResolvedValue(equipmentNoSchedule as any);
    vi.mocked(listSchedules).mockResolvedValue([]);
  });

  // ── Auth ────────────────────────────────────────────────────────────────

  it('GET /api/admin/equipments returns 401 for anonymous', async () => {
    const res = await listGET(new NextRequest('http://localhost:3000/api/admin/equipments'));
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/equipments returns 401 for anonymous', async () => {
    const res = await POST(
      mutReq('POST', { customerId: 'c1', productId: 'p1' })
    );
    expect(res.status).toBe(401);
  });

  // ── GET list ────────────────────────────────────────────────────────────

  it('GET returns all equipments when authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const eqs = [{ id: 'eq-1', serialNumber: 'ABC' }];
    vi.mocked(listEquipments).mockResolvedValue(eqs as any);

    const res = await listGET(new NextRequest('http://localhost:3000/api/admin/equipments'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(eqs);
  });

  it('GET passes customerId filter', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(listEquipments).mockResolvedValue([]);

    await listGET(
      new NextRequest('http://localhost:3000/api/admin/equipments?customerId=c-1')
    );
    expect(listEquipments).toHaveBeenCalledWith('c-1');
  });

  // ── POST ────────────────────────────────────────────────────────────────

  it('POST creates equipment with 201', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const created = { id: 'eq-new', customerId: 'c1', productId: 'p1' };
    vi.mocked(addEquipment).mockResolvedValue(created as any);

    const res = await POST(
      mutReq('POST', { customerId: 'c1', productId: 'p1', serialNumber: 'X' })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
  });

  it('POST returns 400 when customerId is missing', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await POST(mutReq('POST', { productId: 'p1' }));
    expect(res.status).toBe(400);
  });

  it('POST returns 400 when productId is missing', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await POST(mutReq('POST', { customerId: 'c1' }));
    expect(res.status).toBe(400);
  });

  it('POST returns 400 for a malformed warrantyStartDate instead of truncating it into the DB', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await POST(
      mutReq('POST', { customerId: 'c1', productId: 'p1', warrantyStartDate: 'not-a-date' })
    );
    expect(res.status).toBe(400);
    expect(addEquipment).not.toHaveBeenCalled();
  });

  it('POST returns 400 for a malformed warrantyEndDate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await POST(
      mutReq('POST', { customerId: 'c1', productId: 'p1', warrantyEndDate: '2026/01/01' })
    );
    expect(res.status).toBe(400);
    expect(addEquipment).not.toHaveBeenCalled();
  });

  it('POST returns 400 for a malformed calibrationDate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await POST(
      mutReq('POST', { customerId: 'c1', productId: 'p1', calibrationDate: 'nope' })
    );
    expect(res.status).toBe(400);
    expect(addEquipment).not.toHaveBeenCalled();
  });

  // ── GET [id] ────────────────────────────────────────────────────────────

  it('GET [id] returns equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const eq = { id: 'eq-1', serialNumber: 'ABC' };
    vi.mocked(getEquipment).mockResolvedValue(eq as any);

    const res = await getGET(
      new NextRequest('http://localhost:3000/api/admin/equipments/eq-1'),
      ctx('eq-1')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(eq);
  });

  it('GET [id] returns 404 for missing equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getEquipment).mockResolvedValue(null);

    const res = await getGET(
      new NextRequest('http://localhost:3000/api/admin/equipments/nope'),
      ctx('nope')
    );
    expect(res.status).toBe(404);
  });

  // ── PUT [id] ────────────────────────────────────────────────────────────

  it('PUT updates equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const updated = { id: 'eq-1', serialNumber: 'XYZ' };
    vi.mocked(updateEquipment).mockResolvedValue(updated as any);

    const res = await PUT(
      mutReqId('PUT', { serialNumber: 'XYZ' }),
      ctx('eq-1')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(updateEquipment).toHaveBeenCalledWith('eq-1', { serialNumber: 'XYZ' });
  });

  it('PUT returns 404 for missing equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(updateEquipment).mockResolvedValue(null);

    const res = await PUT(mutReqId('PUT', { serialNumber: 'XYZ' }), ctx('nope'));
    expect(res.status).toBe(404);
  });

  it('PUT returns 400 for a malformed warrantyStartDate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await PUT(mutReqId('PUT', { warrantyStartDate: 'not-a-date' }), ctx('eq-1'));
    expect(res.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it('PUT returns 400 for a malformed warrantyEndDate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await PUT(mutReqId('PUT', { warrantyEndDate: '2026-13-40' }), ctx('eq-1'));
    expect(res.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it('PUT returns 400 for a malformed calibrationDate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await PUT(mutReqId('PUT', { calibrationDate: 'not-a-date' }), ctx('eq-1'));
    expect(res.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it('PUT accepts a valid calibrationDate', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(updateEquipment).mockResolvedValue({ id: 'eq-1', calibrationDate: '2026-01-15' } as any);

    const res = await PUT(mutReqId('PUT', { calibrationDate: '2026-01-15' }), ctx('eq-1'));
    expect(res.status).toBe(200);
    expect(updateEquipment).toHaveBeenCalledWith('eq-1', { calibrationDate: '2026-01-15' });
  });

  // ── POST /decline-renewal ───────────────────────────────────────────────

  it('POST /decline-renewal returns 401 for anonymous', async () => {
    const res = await declineRenewalPOST(mutReqId('POST'), ctx('eq-1'));
    expect(res.status).toBe(401);
    expect(declineWarrantyRenewal).not.toHaveBeenCalled();
  });

  it('POST /decline-renewal returns 404 for a missing equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(declineWarrantyRenewal).mockResolvedValue(null);

    const res = await declineRenewalPOST(mutReqId('POST'), ctx('nope'));
    expect(res.status).toBe(404);
  });

  it('POST /decline-renewal records the decline and returns the updated equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    const updated = { id: 'eq-1', status: 'Expired', note: 'หมดประกันแล้ว วันที่ 2026-09-04 - ลูกค้าไม่ต่อประกัน' };
    vi.mocked(declineWarrantyRenewal).mockResolvedValue(updated as any);

    const res = await declineRenewalPOST(mutReqId('POST'), ctx('eq-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(declineWarrantyRenewal).toHaveBeenCalledWith('eq-1');
  });

  // ── DELETE [id] ─────────────────────────────────────────────────────────

  it('DELETE removes equipment with no completed schedules, no OTP needed', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(deleteEquipment).mockResolvedValue(true);

    const res = await DELETE(mutReqId('DELETE'), ctx('eq-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('DELETE returns 404 for missing equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getEquipment).mockResolvedValue(null);

    const res = await DELETE(mutReqId('DELETE'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(deleteEquipment).not.toHaveBeenCalled();
  });

  it('DELETE returns 404 when the underlying delete affects nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(deleteEquipment).mockResolvedValue(false);

    const res = await DELETE(mutReqId('DELETE'), ctx('eq-1'));
    expect(res.status).toBe(404);
  });

  // ── DELETE [id] — OTP gate when a completed schedule is attached ────────

  it('DELETE requires an OTP when the equipment has a completed schedule', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(listSchedules).mockResolvedValue([{ id: 's1', status: 'completed' }] as any);

    const res = await DELETE(mutReqId('DELETE'), ctx('eq-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).needOtp).toBe(true);
    expect(deleteEquipment).not.toHaveBeenCalled();
  });

  it('DELETE succeeds with a correct OTP when a completed schedule is attached', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(listSchedules).mockResolvedValue([{ id: 's1', status: 'completed' }] as any);
    vi.mocked(deleteEquipment).mockResolvedValue(true);
    mockSettingsState({
      'equipment_delete_otp_eq-1': '123456',
      'equipment_delete_otp_expires_eq-1': String(Date.now() + 100000),
    });

    const res = await DELETE(mutReqId('DELETE', { otp: '123456' }), ctx('eq-1'));
    expect(res.status).toBe(200);
    expect(deleteEquipment).toHaveBeenCalledWith('eq-1');
  });

  it('DELETE rejects a wrong OTP without deleting', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(listSchedules).mockResolvedValue([{ id: 's1', status: 'completed' }] as any);
    mockSettingsState({
      'equipment_delete_otp_eq-1': '123456',
      'equipment_delete_otp_expires_eq-1': String(Date.now() + 100000),
    });

    const res = await DELETE(mutReqId('DELETE', { otp: '000000' }), ctx('eq-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).needOtp).toBe(true);
    expect(deleteEquipment).not.toHaveBeenCalled();
  });

  it('DELETE rejects an expired OTP without deleting', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(listSchedules).mockResolvedValue([{ id: 's1', status: 'completed' }] as any);
    mockSettingsState({
      'equipment_delete_otp_eq-1': '123456',
      'equipment_delete_otp_expires_eq-1': String(Date.now() - 1000),
    });

    const res = await DELETE(mutReqId('DELETE', { otp: '123456' }), ctx('eq-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('หมดอายุ');
    expect(deleteEquipment).not.toHaveBeenCalled();
  });

  // ── POST [id]/delete-otp ──────────────────────────────────────────────────

  describe('POST /api/admin/equipments/[id]/delete-otp', () => {
    it('returns 401 for anonymous', async () => {
      const res = await deleteOtpPOST(mutReqId('POST'), ctx('eq-1'));
      expect(res.status).toBe(401);
    });

    it('reports needOtp:false when the equipment has no completed schedule', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      const res = await deleteOtpPOST(mutReqId('POST'), ctx('eq-1'));
      expect(res.status).toBe(200);
      expect((await res.json()).needOtp).toBe(false);
      expect(sendEquipmentDeleteOtpEmail).not.toHaveBeenCalled();
    });

    it('sends an OTP naming the completed-schedule count when one exists', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(listSchedules).mockResolvedValue([
        { id: 's1', status: 'completed' },
        { id: 's2', status: 'completed' },
        { id: 's3', status: 'pending' },
      ] as any);

      const res = await deleteOtpPOST(mutReqId('POST'), ctx('eq-1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sendEquipmentDeleteOtpEmail).toHaveBeenCalledWith(
        'admin@example.com',
        expect.stringMatching(/^\d{6}$/),
        expect.objectContaining({ completedScheduleCount: 2 })
      );
    });

    it('returns 503 when SMTP is not configured', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(listSchedules).mockResolvedValue([{ id: 's1', status: 'completed' }] as any);
      vi.mocked(isMailConfigured).mockReturnValue(false);

      const res = await deleteOtpPOST(mutReqId('POST'), ctx('eq-1'));
      expect(res.status).toBe(503);
    });

    it('returns 404 for a missing equipment', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(getEquipment).mockResolvedValue(null);

      const res = await deleteOtpPOST(mutReqId('POST'), ctx('nope'));
      expect(res.status).toBe(404);
    });
  });
});
