// @vitest-environment node
/**
 * POST /api/settings/maintenance/otp — issuing the code that switches
 * maintenance mode. The verifying PUT is settings-maintenance.test.ts; how
 * often a code may be issued is claimOtpIssue's (lib/otpAttempts.test.ts).
 * Here: what the route does with that answer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/settingsStore', () => ({
  getContactEmail: vi.fn(),
  setSetting: vi.fn(),
  isMaintenanceMode: vi.fn(),
}));
import { getContactEmail, setSetting, isMaintenanceMode } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn(),
  sendMaintenanceOtpEmail: vi.fn(),
}));
import { isMailConfigured, sendMaintenanceOtpEmail } from '@/app/lib/mailer';

vi.mock('@/app/lib/otpAttempts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/otpAttempts')>()),
  claimOtpIssue: vi.fn(),
}));
import { claimOtpIssue } from '@/app/lib/otpAttempts';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { POST } from '@/app/api/settings/maintenance/otp/route';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as never;

const postRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/settings/maintenance/otp', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(adminSession);
  vi.mocked(isMailConfigured).mockReturnValue(true);
  vi.mocked(isMaintenanceMode).mockResolvedValue(false);
  vi.mocked(getContactEmail).mockResolvedValue('owner@example.com');
  vi.mocked(claimOtpIssue).mockResolvedValue({ allowed: true });
});

describe('POST /api/settings/maintenance/otp', () => {
  it('rejects anonymous callers and issues nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(postRequest({ enable: true }))).status).toBe(401);
    expect(claimOtpIssue).not.toHaveBeenCalled();
  });

  it('stores a 6-digit code with its target state and emails it', async () => {
    const res = await POST(postRequest({ enable: true }));
    expect(res.status).toBe(200);
    expect(claimOtpIssue).toHaveBeenCalledWith('maintenance_otp');
    const [key, raw] = vi.mocked(setSetting).mock.calls.find(([k]) => k === 'maintenance_otp_state')!;
    expect(key).toBe('maintenance_otp_state');
    const state = JSON.parse(raw);
    expect(state.otp).toMatch(/^\d{6}$/);
    expect(state.enable).toBe(true);
    expect(sendMaintenanceOtpEmail).toHaveBeenCalledWith('owner@example.com', state.otp, true);
  });

  it('asks for a code too soon: 429, nothing stored, no email', async () => {
    vi.mocked(claimOtpIssue).mockResolvedValue({ allowed: false, retryAfterSeconds: 1500 });
    const res = await POST(postRequest({ enable: true }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1500');
    expect((await res.json()).error).toContain('ประมาณ 25 นาที');
    expect(setSetting).not.toHaveBeenCalled();
    expect(sendMaintenanceOtpEmail).not.toHaveBeenCalled();
  });

  it('asking for the state that is already on uses no allowance', async () => {
    vi.mocked(isMaintenanceMode).mockResolvedValue(true);
    expect((await POST(postRequest({ enable: true }))).status).toBe(400);
    expect(claimOtpIssue).not.toHaveBeenCalled();
  });
});
