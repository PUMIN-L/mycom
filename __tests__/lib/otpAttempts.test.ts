// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The guess counter must be a locked read-modify-write taken BEFORE the code
// is compared (same class of fix as the login lockout), so takeOtpAttempt
// goes through withTransaction + a real connection instead of settingsStore's
// plain getSetting/setSetting.
const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
import { getSetting, setSetting } from '@/app/lib/settingsStore';

import { resetOtpAttempts, takeOtpAttempt, clearOtpAttempts, claimOtpIssue, otpIssueRefused } from '@/app/lib/otpAttempts';
import { withTransaction } from '@/app/lib/db';

const OTP_KEY = 'contact_email_otp';
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

// The guess is TAKEN before the code is compared — see takeOtpAttempt. Run
// against a stand-in table that executes its statements.
describe('takeOtpAttempt', () => {
  let table: Map<string, string>;

  beforeEach(() => {
    table = new Map();
    conn.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO settings (name, value) VALUES (?, '0') ON DUPLICATE KEY UPDATE name = name")) {
        const [key] = params as [string];
        if (!table.has(key)) table.set(key, '0');
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT value FROM settings WHERE name = ? FOR UPDATE')) {
        const v = table.get((params as [string])[0]);
        return [v === undefined ? [] : [{ value: v }]];
      }
      if (sql.startsWith('UPDATE settings SET value = ? WHERE name = ?')) {
        const [value, key] = params as [string, string];
        table.set(key, value);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL in test: ${sql}`);
    });
  });

  it('gives five guesses at a code, the fifth marked as the last', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await takeOtpAttempt(OTP_KEY));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true]);
    expect(results.map((r) => r.last)).toEqual([false, false, false, false, true]);
    expect(table.get(ATTEMPTS_KEY)).toBe('5');
  });

  it('refuses a sixth, without counting it', async () => {
    table.set(ATTEMPTS_KEY, '5');
    expect(await takeOtpAttempt(OTP_KEY)).toEqual({ allowed: false, last: false });
    expect(table.get(ATTEMPTS_KEY)).toBe('5');
  });

  it('starts from zero when no row exists, and creates it so FOR UPDATE has a row to lock', async () => {
    expect(await takeOtpAttempt(OTP_KEY)).toEqual({ allowed: true, last: false });
    expect(table.get(ATTEMPTS_KEY)).toBe('1');
    expect(String(conn.query.mock.calls[0][0])).toContain('ON DUPLICATE KEY UPDATE name = name');
    expect(String(conn.query.mock.calls[1][0])).toContain('FOR UPDATE');
  });

  it('a new code (resetOtpAttempts) gives five fresh guesses', async () => {
    table.set(ATTEMPTS_KEY, '5');
    vi.mocked(setSetting).mockImplementation(async (key: string, value: string) => void table.set(key, value));
    await resetOtpAttempts(OTP_KEY);
    expect((await takeOtpAttempt(OTP_KEY)).allowed).toBe(true);
  });

  it('counts inside one transaction, never through the unlocked settingsStore read', async () => {
    await takeOtpAttempt(OTP_KEY);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(getSetting).not.toHaveBeenCalled();
  });
});

// ── Issuing ──────────────────────────────────────────────────────────────────
// Against a stand-in settings table that runs the three statements
// claimOtpIssue sends, so what is asserted is what the next request sees.
describe('claimOtpIssue', () => {
  const ISSUED_KEY = `${OTP_KEY}_issued`;
  const T0 = 1_800_000_000_000;
  const MIN = 60_000;
  let table: Map<string, string>;

  beforeEach(() => {
    table = new Map();
    conn.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO settings (name, value) VALUES (?, '') ON DUPLICATE KEY UPDATE name = name")) {
        const [key] = params as [string];
        if (!table.has(key)) table.set(key, '');
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT value FROM settings WHERE name = ? FOR UPDATE')) {
        const v = table.get((params as [string])[0]);
        return [v === undefined ? [] : [{ value: v }]];
      }
      if (sql.startsWith('UPDATE settings SET value = ? WHERE name = ?')) {
        const [value, key] = params as [string, string];
        table.set(key, value);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL in test: ${sql}`);
    });
  });

  it('issues a first code, inside a locked transaction', async () => {
    expect(await claimOtpIssue(OTP_KEY, T0)).toEqual({ allowed: true });
    expect(table.get(ISSUED_KEY)).toBe(String(T0));
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes('FOR UPDATE'))).toBe(true);
  });

  it('refuses another within a minute and says how long to wait, without recording it', async () => {
    await claimOtpIssue(OTP_KEY, T0);
    expect(await claimOtpIssue(OTP_KEY, T0 + 15_000)).toEqual({ allowed: false, retryAfterSeconds: 45 });
    expect(table.get(ISSUED_KEY)).toBe(String(T0));
    expect(await claimOtpIssue(OTP_KEY, T0 + MIN)).toEqual({ allowed: true });
  });

  it('allows 5 an hour, then waits for the oldest to leave the hour', async () => {
    for (let i = 0; i < 5; i++) expect((await claimOtpIssue(OTP_KEY, T0 + i * 2 * MIN)).allowed).toBe(true);
    // 6th, well past the cooldown but inside the hour of the first
    expect(await claimOtpIssue(OTP_KEY, T0 + 30 * MIN)).toEqual({ allowed: false, retryAfterSeconds: 30 * 60 });
    expect(await claimOtpIssue(OTP_KEY, T0 + 60 * MIN - 1)).toMatchObject({ allowed: false });
    expect(await claimOtpIssue(OTP_KEY, T0 + 60 * MIN)).toEqual({ allowed: true });
    // the stored list only keeps what is still inside the hour
    expect(table.get(ISSUED_KEY)!.split(',')).toHaveLength(5);
  });

  it('keeps each otpKey separate', async () => {
    await claimOtpIssue(OTP_KEY, T0);
    expect(await claimOtpIssue('maintenance_otp', T0 + 1_000)).toEqual({ allowed: true });
  });

  it('a garbled or far-future value cannot lock issuing for good', async () => {
    table.set(ISSUED_KEY, 'junk,,NaN');
    expect((await claimOtpIssue(OTP_KEY, T0)).allowed).toBe(true);
    table.set(ISSUED_KEY, String(T0 + 365 * 24 * 60 * MIN));
    expect((await claimOtpIssue(OTP_KEY, T0 + 2 * MIN)).allowed).toBe(true);
  });
});

describe('otpIssueRefused', () => {
  it('is a 429 with Retry-After, in seconds under a minute', async () => {
    const res = otpIssueRefused(45);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    expect((await res.json()).error).toBe('ขอรหัส OTP ถี่เกินไป กรุณารออีก 45 วินาที แล้วลองใหม่');
  });

  it('in minutes beyond that', async () => {
    expect((await otpIssueRefused(1790).json()).error).toContain('ประมาณ 30 นาที');
  });
});
