// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The failure counter must be a locked read-modify-write (same class of fix
// as the login rate-limiter), so recordOtpFailure now goes through
// withTransaction + a real connection instead of settingsStore's plain
// getSetting/setSetting.
const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
import { getSetting, setSetting } from '@/app/lib/settingsStore';

import { resetOtpAttempts, recordOtpFailure, clearOtpAttempts } from '@/app/lib/otpAttempts';
import { withTransaction } from '@/app/lib/db';

const OTP_KEY = 'contact_email_otp';
const OTP_EXPIRES_KEY = 'contact_email_otp_expires';
const ATTEMPTS_KEY = `${OTP_KEY}_attempts`;

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
});

describe('resetOtpAttempts', () => {
  it('zeroes the persistent counter for a freshly issued OTP', async () => {
    await resetOtpAttempts(OTP_KEY);
    expect(setSetting).toHaveBeenCalledWith(ATTEMPTS_KEY, '0');
  });
});

describe('clearOtpAttempts', () => {
  it('zeroes the counter once an OTP is consumed', async () => {
    await clearOtpAttempts(OTP_KEY);
    expect(setSetting).toHaveBeenCalledWith(ATTEMPTS_KEY, '0');
  });
});

describe('recordOtpFailure', () => {
  it('increments the counter via a locked read-modify-write and reports not-locked while under the limit', async () => {
    conn.query.mockResolvedValueOnce([[{ value: '2' }]]); // SELECT ... FOR UPDATE: 2 prior failures
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // the counter upsert

    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);

    expect(result.locked).toBe(false);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(conn.query.mock.calls[1][1]).toEqual([ATTEMPTS_KEY, '3']);
    expect(setSetting).not.toHaveBeenCalledWith(OTP_KEY, '');
  });

  it('treats a missing counter row as zero prior failures', async () => {
    conn.query.mockResolvedValueOnce([[]]); // no row yet
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(false);
    expect(conn.query.mock.calls[1][1]).toEqual([ATTEMPTS_KEY, '1']);
  });

  it('locks out and wipes the OTP once the failure limit is reached', async () => {
    conn.query.mockResolvedValueOnce([[{ value: '4' }]]); // this failure is the 5th
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(true);
    expect(setSetting).toHaveBeenCalledWith(OTP_KEY, '');
    expect(setSetting).toHaveBeenCalledWith(OTP_EXPIRES_KEY, '0');
  });

  it('stays locked (does not go below the limit) on further failures past the limit', async () => {
    conn.query.mockResolvedValueOnce([[{ value: '9' }]]);
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(true);
  });

  it('reads/writes the counter through the locked connection, not settingsStore (guards against the race regressing)', async () => {
    conn.query.mockResolvedValueOnce([[{ value: '0' }]]);
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(getSetting).not.toHaveBeenCalled();
  });
});
