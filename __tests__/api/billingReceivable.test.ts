// @vitest-environment node
/**
 * PATCH /api/billing/[id]/receivable — the admin's three decisions about one
 * document. Every field is checked before any is written (a bad second field
 * used to answer 400 after the first was already saved), `cancelled` must be
 * a real true/false (the string "false" used to cancel), and a document that
 * does not exist is a 404.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/billingStore', () => ({
  setBillingDueDate: vi.fn(),
  setReceivableOverride: vi.fn(),
  cancelBillingDocument: vi.fn(),
}));
import { setBillingDueDate, setReceivableOverride, cancelBillingDocument } from '@/app/lib/billingStore';
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { PATCH } from '@/app/api/billing/[id]/receivable/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;
const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost:3000/api/billing/b1/receivable', {
      method: 'PATCH',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'b1' }) }
  );

const nothingWritten = () => {
  expect(setBillingDueDate).not.toHaveBeenCalled();
  expect(setReceivableOverride).not.toHaveBeenCalled();
  expect(cancelBillingDocument).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(setBillingDueDate).mockResolvedValue(true);
  vi.mocked(setReceivableOverride).mockResolvedValue(true);
  vi.mocked(cancelBillingDocument).mockResolvedValue(true);
});

describe('PATCH /api/billing/[id]/receivable', () => {
  it('applies each decision it is given', async () => {
    expect((await patch({ dueDate: '2026-10-31' })).status).toBe(200);
    expect(setBillingDueDate).toHaveBeenCalledWith('b1', '2026-10-31');

    expect((await patch({ dueDate: '' })).status).toBe(200);
    expect(setBillingDueDate).toHaveBeenLastCalledWith('b1', null);

    expect((await patch({ receivableOverride: 0 })).status).toBe(200);
    expect(setReceivableOverride).toHaveBeenCalledWith('b1', 0);

    expect((await patch({ cancelled: true })).status).toBe(200);
    expect(vi.mocked(cancelBillingDocument).mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await patch({ cancelled: false })).status).toBe(200);
    expect(cancelBillingDocument).toHaveBeenLastCalledWith('b1', null);
  });

  it('writes NOTHING when a later field is invalid — not even the valid one before it', async () => {
    const res = await patch({ dueDate: '2026-10-31', receivableOverride: 2 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ค่าการนับเป็นลูกหนี้ไม่ถูกต้อง');
    nothingWritten();
  });

  it('refuses a cancelled that is not a real true/false — the string "false" used to cancel', async () => {
    for (const value of ['false', 'true', 1, 0, null]) {
      const res = await patch({ cancelled: value });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('ค่าการยกเลิกเอกสารไม่ถูกต้อง');
    }
    nothingWritten();
  });

  it('refuses a due date that is not a real day, or not text', async () => {
    for (const value of ['2026-02-31', '31/10/2026', 20261031, { d: 1 }]) {
      expect((await patch({ dueDate: value })).status).toBe(400);
    }
    nothingWritten();
  });

  it('answers 404 for a document that does not exist, and writes nothing more', async () => {
    vi.mocked(setBillingDueDate).mockResolvedValue(false);
    const res = await patch({ dueDate: '2026-10-31', receivableOverride: 1, cancelled: true });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ไม่พบเอกสารนี้');
    expect(setReceivableOverride).not.toHaveBeenCalled();
    expect(cancelBillingDocument).not.toHaveBeenCalled();
  });

  it('answers 404 when only the cancel was asked for and there is no such document', async () => {
    vi.mocked(cancelBillingDocument).mockResolvedValue(false);
    expect((await patch({ cancelled: true })).status).toBe(404);
  });

  it.each([
    ['JSON null', 'null'],
    ['not JSON', '{oops'],
    ['a JSON string', '"dueDate"'],
    ['a JSON array', '[1]'],
    ['an empty object', '{}'],
  ])('answers 400 "nothing to update", not 500, for %s', async (_label, raw) => {
    const res = await patch(raw);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ไม่มีข้อมูลที่จะอัปเดต');
    nothingWritten();
  });

  it('requires a login', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await patch({ cancelled: true })).status).toBe(401);
    nothingWritten();
  });
});
