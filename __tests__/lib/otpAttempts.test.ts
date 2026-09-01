// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
import { getSetting, setSetting } from '@/app/lib/settingsStore';

import { resetOtpAttempts, recordOtpFailure, clearOtpAttempts } from '@/app/lib/otpAttempts';

const OTP_KEY = 'contact_email_otp';
const OTP_EXPIRES_KEY = 'contact_email_otp_expires';
const ATTEMPTS_KEY = `${OTP_KEY}_attempts`;

beforeEach(() => vi.clearAllMocks());

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
  it('increments the counter and reports not-locked while under the limit', async () => {
    vi.mocked(getSetting).mockResolvedValue('2'); // 2 prior failures
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(false);
    expect(setSetting).toHaveBeenCalledWith(ATTEMPTS_KEY, '3');
    // The OTP itself must survive while under the limit.
    expect(setSetting).not.toHaveBeenCalledWith(OTP_KEY, '');
  });

  it('treats a missing counter as zero prior failures', async () => {
    vi.mocked(getSetting).mockResolvedValue(null);
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(false);
    expect(setSetting).toHaveBeenCalledWith(ATTEMPTS_KEY, '1');
  });

  it('locks out and wipes the OTP once the failure limit is reached', async () => {
    vi.mocked(getSetting).mockResolvedValue('4'); // this failure is the 5th
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(true);
    expect(setSetting).toHaveBeenCalledWith(ATTEMPTS_KEY, '5');
    // The OTP and its expiry are wiped so a later correct guess can't redeem it.
    expect(setSetting).toHaveBeenCalledWith(OTP_KEY, '');
    expect(setSetting).toHaveBeenCalledWith(OTP_EXPIRES_KEY, '0');
  });

  it('stays locked (does not go below the limit) on further failures past the limit', async () => {
    vi.mocked(getSetting).mockResolvedValue('9');
    const result = await recordOtpFailure(OTP_KEY, OTP_EXPIRES_KEY);
    expect(result.locked).toBe(true);
  });
});
