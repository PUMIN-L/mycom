// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, DELETE } from '@/app/api/cloudinary/orphans/route';
import { POST as otpPOST } from '@/app/api/cloudinary/orphans/otp/route';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

vi.mock('@/app/lib/cloudinaryHelper', () => ({
  listAllCloudinaryAssets: vi.fn(),
  extractPublicId: vi.fn(() => null),
}));
import { listAllCloudinaryAssets } from '@/app/lib/cloudinaryHelper';

vi.mock('@/app/lib/imageUsageHelper', () => ({
  getAllUsedImageUrls: vi.fn(),
}));
import { getAllUsedImageUrls } from '@/app/lib/imageUsageHelper';

vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getContactEmail: vi.fn().mockResolvedValue('admin@example.com'),
}));
import { getSetting, setSetting } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn().mockReturnValue(true),
  sendOrphanDeleteOtpEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('cloudinary', () => ({
  v2: { uploader: { destroy: vi.fn().mockResolvedValue({ result: 'ok' }) } },
}));

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const req = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

// A fresh, mutable settings-table simulation per test so the persistent
// attempt counter behaves the way it would across real requests.
function mockSettingsState(initial: Record<string, string> = {}) {
  const state = new Map(Object.entries(initial));
  vi.mocked(getSetting).mockImplementation(async (key: string) => state.get(key) ?? null);
  vi.mocked(setSetting).mockImplementation(async (key: string, value: string) => {
    state.set(key, value);
  });
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(listAllCloudinaryAssets).mockResolvedValue([]);
  vi.mocked(getAllUsedImageUrls).mockResolvedValue(new Set());
});

describe('GET /api/cloudinary/orphans', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('reports orphaned assets not referenced anywhere in the DB', async () => {
    vi.mocked(listAllCloudinaryAssets).mockResolvedValue([
      { publicId: 'a', secureUrl: 'https://res.cloudinary.com/x/a.jpg' } as any,
    ]);
    vi.mocked(getAllUsedImageUrls).mockResolvedValue(new Set());
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orphanCount).toBe(1);
  });
});

describe('POST /api/cloudinary/orphans/otp', () => {
  it('resets the failed-attempt counter for the freshly issued OTP', async () => {
    mockSettingsState();
    const res = await otpPOST(req('http://localhost:3000/api/cloudinary/orphans/otp', 'POST', { imageCount: 3 }));
    expect(res.status).toBe(200);
    expect(setSetting).toHaveBeenCalledWith('orphan_delete_otp_attempts', '0');
  });
});

describe('DELETE /api/cloudinary/orphans', () => {
  it('rejects a malformed (wrong-length) OTP without touching the counter', async () => {
    mockSettingsState();
    const res = await DELETE(
      req('http://localhost:3000/api/cloudinary/orphans', 'DELETE', { items: [], otp: '1' })
    );
    expect(res.status).toBe(400);
  });

  it('rejects a wrong OTP (403) while attempts remain', async () => {
    mockSettingsState({
      orphan_delete_otp: '12345',
      orphan_delete_otp_expires: String(Date.now() + 100000),
    });
    const res = await DELETE(
      req('http://localhost:3000/api/cloudinary/orphans', 'DELETE', { items: [], otp: '99999' })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('รหัสยืนยันไม่ถูกต้อง');
  });

  it('locks out the OTP after 5 wrong attempts, even for the right code afterward', async () => {
    mockSettingsState({
      orphan_delete_otp: '12345',
      orphan_delete_otp_expires: String(Date.now() + 100000),
    });

    let lastRes;
    for (let i = 0; i < 5; i++) {
      lastRes = await DELETE(
        req('http://localhost:3000/api/cloudinary/orphans', 'DELETE', { items: [], otp: '00000' })
      );
    }
    expect(lastRes!.status).toBe(403);
    expect((await lastRes!.json()).error).toContain('เกินจำนวนที่กำหนด');

    const afterLockout = await DELETE(
      req('http://localhost:3000/api/cloudinary/orphans', 'DELETE', { items: [], otp: '12345' })
    );
    expect(afterLockout.status).toBe(403);
  });

  it('deletes orphaned assets with a correct, unexpired OTP', async () => {
    mockSettingsState({
      orphan_delete_otp: '12345',
      orphan_delete_otp_expires: String(Date.now() + 100000),
    });
    vi.mocked(getAllUsedImageUrls).mockResolvedValue(new Set());
    const res = await DELETE(
      req('http://localhost:3000/api/cloudinary/orphans', 'DELETE', {
        items: [{ publicId: 'orphan-1', resourceType: 'image' }],
        otp: '12345',
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(1);
  });
});
