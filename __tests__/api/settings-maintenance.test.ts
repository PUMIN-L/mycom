// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT } from '@/app/api/settings/maintenance/route';
import { MAINTENANCE_BLOCKED_PATHS } from '@/app/lib/maintenanceConfig';

vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  isMaintenanceMode: vi.fn(),
  MAINTENANCE_MODE_SETTING: 'maintenance_mode',
}));
import { getSetting, setSetting, MAINTENANCE_MODE_SETTING } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/otpAttempts', () => ({
  recordOtpFailure: vi.fn(),
  clearOtpAttempts: vi.fn(),
}));
import { recordOtpFailure } from '@/app/lib/otpAttempts';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
import { revalidateTag, revalidatePath } from 'next/cache';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const putRequest = (body: any) =>
  new NextRequest('http://localhost/api/settings/maintenance', {
    method: 'PUT',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

/** A pending, non-expired OTP request for the given target state. */
const pendingOtp = (enable: boolean, otp = '123456') =>
  JSON.stringify({ otp, expiresAt: Date.now() + 60_000, enable });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(adminSession);
  vi.mocked(recordOtpFailure).mockResolvedValue({ locked: false } as any);
});

describe('PUT /api/settings/maintenance', () => {
  it('rejects anonymous callers without touching the flag', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await PUT(putRequest({ otp: '123456' }));
    expect(res.status).toBe(401);
    expect(setSetting).not.toHaveBeenCalled();
  });

  // The flag is read during SERVER render now, so writing the row is only half
  // the job — every prerendered page holds a copy of it in its HTML.
  //
  // It must be the ROOT LAYOUT, not the overlay's blocked paths. Footer takes
  // the flag on every page it appears on, which is deliberately wider than the
  // two paths the overlay covers, and /about and /catalog/layout are statically
  // prerendered: scoping this to MAINTENANCE_BLOCKED_PATHS left them serving the
  // phone number and LINE id after maintenance was switched on, until the next
  // deploy. That is worse than the render flash this whole change replaced, and
  // it fails silently — hence this test.
  it.each([true, false])('revalidates the tag and the whole root layout (enable=%s)', async (enable) => {
    vi.mocked(getSetting).mockResolvedValue(pendingOtp(enable));

    const res = await PUT(putRequest({ otp: '123456' }));

    expect(res.status).toBe(200);
    expect(setSetting).toHaveBeenCalledWith(MAINTENANCE_MODE_SETTING, String(enable));
    expect(revalidateTag).toHaveBeenCalledWith('maintenance', { expire: 0 });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('covers every page that renders Footer, not just the overlay-blocked paths', () => {
    // Guards the reasoning rather than the call: if someone narrows the
    // revalidation back to this list, the pages below keep a stale footer.
    // Listing them here makes that trade explicit instead of invisible.
    const footerPages = ['/', '/contact', '/about', '/catalog', '/showcase/[id]'];
    const notCoveredByBlockedPaths = footerPages.filter(
      (p) => !(MAINTENANCE_BLOCKED_PATHS as readonly string[]).includes(p)
    );
    expect(notCoveredByBlockedPaths).not.toHaveLength(0);
  });

  it('does not revalidate anything when the OTP is wrong', async () => {
    // A failed attempt must not hand out cache invalidations — otherwise anyone
    // who can reach the route can make the site re-render on demand.
    vi.mocked(getSetting).mockResolvedValue(pendingOtp(true, '999999'));

    const res = await PUT(putRequest({ otp: '123456' }));

    expect(res.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalledWith(MAINTENANCE_MODE_SETTING, expect.anything());
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('does not revalidate anything when the OTP has expired', async () => {
    vi.mocked(getSetting).mockResolvedValue(
      JSON.stringify({ otp: '123456', expiresAt: Date.now() - 1, enable: true })
    );

    const res = await PUT(putRequest({ otp: '123456' }));

    expect(res.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
