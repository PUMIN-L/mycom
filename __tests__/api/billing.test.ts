// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/billing/route';

vi.mock('@/app/lib/billingStore', () => ({
  saveBillingDocumentAtomic: vi.fn(),
  listBillingDocuments: vi.fn(),
  BillingDocNoConflictError: class BillingDocNoConflictError extends Error {
    constructor(public docNo: string) {
      super(`docNo ${docNo} conflict`);
      this.name = 'BillingDocNoConflictError';
    }
  },
}));
import { saveBillingDocumentAtomic, listBillingDocuments, BillingDocNoConflictError } from '@/app/lib/billingStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const postReq = (body: any) =>
  new NextRequest('http://localhost/api/billing', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(adminSession);
});

describe('GET /api/billing', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/billing'));
    expect(res.status).toBe(401);
    expect(listBillingDocuments).not.toHaveBeenCalled();
  });

  it('passes a valid docType filter through, ignoring an invalid one', async () => {
    vi.mocked(listBillingDocuments).mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/billing?docType=receipt'));
    expect(listBillingDocuments).toHaveBeenCalledWith('receipt');

    vi.mocked(listBillingDocuments).mockClear();
    await GET(new NextRequest('http://localhost/api/billing?docType=not-a-type'));
    expect(listBillingDocuments).toHaveBeenCalledWith(undefined);
  });
});

describe('POST /api/billing', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(postReq({ id: 'b1' }));
    expect(res.status).toBe(401);
    expect(saveBillingDocumentAtomic).not.toHaveBeenCalled();
  });

  it('rejects a missing id', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(saveBillingDocumentAtomic).not.toHaveBeenCalled();
  });

  it('rejects a payload larger than 200KB', async () => {
    const res = await POST(postReq({ id: 'b1', data: { note: 'x'.repeat(210_000) } }));
    expect(res.status).toBe(413);
    expect(saveBillingDocumentAtomic).not.toHaveBeenCalled();
  });

  it('defaults an invalid docType to "invoice"', async () => {
    vi.mocked(saveBillingDocumentAtomic).mockResolvedValue(undefined);
    await POST(postReq({ id: 'b1', docType: 'not-a-type' }));
    expect(saveBillingDocumentAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ docType: 'invoice' })
    );
  });

  it('sanitizes and truncates payment fields instead of storing them raw', async () => {
    vi.mocked(saveBillingDocumentAtomic).mockResolvedValue(undefined);
    await POST(
      postReq({
        id: 'b1',
        paymentMethod: '<script>alert(1)</script>' + 'a'.repeat(100),
        paymentDate: '<b>2026-09-10</b>' + '0'.repeat(50),
        paymentRef: '<i>REF</i>' + 'r'.repeat(300),
      })
    );

    const saved = vi.mocked(saveBillingDocumentAtomic).mock.calls[0][0];
    expect(saved.paymentMethod).not.toContain('<script>');
    expect(saved.paymentMethod!.length).toBeLessThanOrEqual(50);
    expect(saved.paymentDate).not.toContain('<b>');
    expect(saved.paymentDate!.length).toBeLessThanOrEqual(20);
    expect(saved.paymentRef).not.toContain('<i>');
    expect(saved.paymentRef!.length).toBeLessThanOrEqual(255);
  });

  it('keeps payment fields null when not provided', async () => {
    vi.mocked(saveBillingDocumentAtomic).mockResolvedValue(undefined);
    await POST(postReq({ id: 'b1' }));
    const saved = vi.mocked(saveBillingDocumentAtomic).mock.calls[0][0];
    expect(saved.paymentMethod).toBeNull();
    expect(saved.paymentDate).toBeNull();
    expect(saved.paymentRef).toBeNull();
  });

  it('returns 400 and never saves when the line items compute a negative grand total', async () => {
    const res = await POST(
      postReq({ id: 'b1', data: { items: [{ qty: -5, unitPrice: 1000 }] } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า'
    );
    expect(saveBillingDocumentAtomic).not.toHaveBeenCalled();
  });

  it('returns 409 on a docNo conflict', async () => {
    vi.mocked(saveBillingDocumentAtomic).mockRejectedValue(new BillingDocNoConflictError('INV-1'));
    const res = await POST(postReq({ id: 'b1', docNo: 'INV-1' }));
    expect(res.status).toBe(409);
  });
});
