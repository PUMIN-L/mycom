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
}));
import {
  listEquipments,
  getEquipment,
  addEquipment,
  updateEquipment,
  deleteEquipment,
} from '@/app/lib/crmStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

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

describe('Admin Equipments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
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

  // ── DELETE [id] ─────────────────────────────────────────────────────────

  it('DELETE removes equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(deleteEquipment).mockResolvedValue(true);

    const res = await DELETE(mutReqId('DELETE'), ctx('eq-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('DELETE returns 404 for missing equipment', async () => {
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(deleteEquipment).mockResolvedValue(false);

    const res = await DELETE(mutReqId('DELETE'), ctx('nope'));
    expect(res.status).toBe(404);
  });
});
