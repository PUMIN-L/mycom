// @vitest-environment node
//
// The two ownership columns at the API edge (spec: equipment-ownership,
// tasks 16.6 / 16.11). Kept in its own file so the long-standing
// admin-equipments.test.ts stays about CRUD + the delete OTP.
//
// Two rules are load-bearing here and are the reason every case below exists:
//   1. an unknown source is a 400, never a silent fold into "sold_by_us" —
//      "we sold it" is a claim about a real deal, and the column only earns
//      its keep if a confirmed value can be told apart from a guessed one;
//   2. a PARTIAL update that omits these fields must reach the store with them
//      still absent, so `updateEquipment` merges over the row and keeps what is
//      stored. A route that "helpfully" filled in defaults here would silently
//      reclassify machines and re-arm alerts an admin had switched off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/crmStore', () => ({
  listEquipments: vi.fn(),
  getEquipment: vi.fn(),
  addEquipment: vi.fn(),
  updateEquipment: vi.fn(),
  deleteEquipment: vi.fn(),
  listSchedules: vi.fn(),
}));
import { getEquipment, addEquipment, updateEquipment } from '@/app/lib/crmStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const postReq = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/admin/equipments', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: JSON.stringify(body),
  });

const putReq = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/admin/equipments/eq-1', {
    method: 'PUT',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: JSON.stringify(body),
  });

const ctx = { params: Promise.resolve({ id: 'eq-1' }) };

import { POST } from '@/app/api/admin/equipments/route';
import { PUT } from '@/app/api/admin/equipments/[id]/route';

const storedRow = {
  id: 'eq-1',
  customerId: 'c1',
  productId: 'p1',
  note: 'เดิม',
  ownershipSource: 'customer_owned',
  warrantyAlertEnabled: 0,
};

describe('Equipment ownership fields at the API edge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getEquipment).mockResolvedValue(storedRow as any);
    vi.mocked(addEquipment).mockResolvedValue({ id: 'eq-new' } as any);
    vi.mocked(updateEquipment).mockResolvedValue(storedRow as any);
  });

  // ── POST ────────────────────────────────────────────────────────────────

  it.each(['sold_by_us', 'customer_owned'])(
    'POST accepts the known source %s and passes it to the store',
    async (source) => {
      const res = await POST(postReq({ customerId: 'c1', productId: 'p1', ownershipSource: source }));
      expect(res.status).toBe(201);
      expect(addEquipment).toHaveBeenCalledWith(
        expect.objectContaining({ ownershipSource: source })
      );
    }
  );

  it.each([
    ['an unknown word', 'unknown'],
    ['an empty string', ''],
    ['a near-miss of a real value', 'Sold_By_Us'],
    ['a non-string', 3],
    ['null', null],
  ])('POST rejects %s as ownershipSource with a Thai 400 and writes nothing', async (_label, value) => {
    const res = await POST(postReq({ customerId: 'c1', productId: 'p1', ownershipSource: value }));
    expect(res.status).toBe(400);
    // Thai, because an admin reads it — and it names both accepted values.
    const { error } = await res.json();
    expect(error).toContain('ที่มาของเครื่อง');
    expect(error).toContain('sold_by_us');
    expect(error).toContain('customer_owned');
    // The whole point: no row is written with the unknown value, and it is
    // NOT quietly turned into the default either.
    expect(addEquipment).not.toHaveBeenCalled();
  });

  it('POST leaves both fields absent when the caller never mentions them', async () => {
    const res = await POST(postReq({ customerId: 'c1', productId: 'p1', serialNumber: 'X' }));
    expect(res.status).toBe(201);
    const payload = vi.mocked(addEquipment).mock.calls[0][0] as Record<string, unknown>;
    // The store owns the defaults (so the sale-sync path gets the same ones);
    // the route must not invent them.
    expect(payload).not.toHaveProperty('ownershipSource');
    expect(payload).not.toHaveProperty('warrantyAlertEnabled');
  });

  it('POST rejects a non-boolean warrantyAlertEnabled', async () => {
    const res = await POST(
      postReq({ customerId: 'c1', productId: 'p1', warrantyAlertEnabled: 'yes' })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('เตือนประกัน');
    expect(addEquipment).not.toHaveBeenCalled();
  });

  // ── PUT ─────────────────────────────────────────────────────────────────

  it('PUT rejects an unknown ownershipSource without touching the row', async () => {
    const res = await PUT(putReq({ ownershipSource: 'inherited' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ที่มาของเครื่อง');
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it('PUT rejects an empty ownershipSource rather than defaulting it', async () => {
    const res = await PUT(putReq({ ownershipSource: '' }), ctx);
    expect(res.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it('PUT accepts switching the source, and does not clear the document numbers', async () => {
    const res = await PUT(
      putReq({
        ownershipSource: 'customer_owned',
        quotationNumber: 'QT-OTHER-1',
        warrantyCertNumber: 'WR-OTHER-1',
      }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(updateEquipment).toHaveBeenCalledWith('eq-1', {
      ownershipSource: 'customer_owned',
      quotationNumber: 'QT-OTHER-1',
      warrantyCertNumber: 'WR-OTHER-1',
    });
  });

  it.each([true, false, 0, 1])(
    'PUT accepts warrantyAlertEnabled = %s (reads hand the client back a raw TINYINT)',
    async (value) => {
      const res = await PUT(putReq({ warrantyAlertEnabled: value }), ctx);
      expect(res.status).toBe(200);
      expect(updateEquipment).toHaveBeenCalledWith(
        'eq-1',
        expect.objectContaining({ warrantyAlertEnabled: value })
      );
    }
  );

  it('PUT rejects a warrantyAlertEnabled that is neither boolean nor 0/1', async () => {
    const res = await PUT(putReq({ warrantyAlertEnabled: 2 }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('เตือนประกัน');
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it('a partial update of an unrelated field leaves both columns out of the payload', async () => {
    // The data-loss trap: this row is "customer_owned" with its alert OFF. An
    // admin edits only the note. Nothing about ownership may travel with it —
    // updateEquipment merges over the stored row, so an absent field keeps its
    // stored value; a route-supplied default would reset it to "we sold it".
    const res = await PUT(putReq({ note: 'เปลี่ยนแค่โน้ต' }), ctx);
    expect(res.status).toBe(200);
    const [, data] = vi.mocked(updateEquipment).mock.calls[0];
    expect(data).toEqual({ note: 'เปลี่ยนแค่โน้ต' });
    expect(data).not.toHaveProperty('ownershipSource');
    expect(data).not.toHaveProperty('warrantyAlertEnabled');
  });

  it('PUT still 404s for a missing row before any ownership write', async () => {
    vi.mocked(updateEquipment).mockResolvedValue(null);
    const res = await PUT(putReq({ ownershipSource: 'sold_by_us' }), ctx);
    expect(res.status).toBe(404);
  });
});
