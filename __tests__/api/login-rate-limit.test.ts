// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
// REAL bcrypt (deliberately NOT mocked here), matching login-credentials.test.ts.
import bcrypt from 'bcryptjs';

// Shared state simulating the `settings` table row(s) the lockout counter
// lives in. Both the plain getSetting/setSetting calls (isLockedOut,
// clearLoginFailures) AND the transactional conn.query calls inside
// recordLoginFailure read/write this SAME state, matching production where
// they're the same table — this is what lets a test drive one and observe
// the other consistently.
let state: Map<string, string>;

const conn = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO settings')) {
      const [key] = params as [string];
      if (!state.has(key)) state.set(key, '0|0');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT value FROM settings')) {
      const [key] = params as [string];
      const v = state.get(key);
      return [v !== undefined ? [{ value: v }] : []];
    }
    if (sql.includes('UPDATE settings')) {
      const [value, key] = params as [string, string];
      state.set(key, value);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled SQL in test: ${sql}`);
  }),
};

vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
  getDbConnection: vi.fn(),
}));
import { query, withTransaction } from '@/app/lib/db';

vi.mock('@/app/lib/session', () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
import { createSession } from '@/app/lib/session';

vi.mock('@/app/lib/settingsStore', () => ({
  getSetting: vi.fn(async (key: string) => state.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    state.set(key, value);
  }),
}));
import { getSetting, setSetting } from '@/app/lib/settingsStore';

import { POST as login } from '@/app/api/auth/login/route';

const req = (body: any) =>
  new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  state = new Map();
});

describe('login rate limiting (settings-table backed, shared across instances)', () => {
  it('locks out a username after 5 failed attempts, persisted via the settings store', async () => {
    const passwordHash = bcrypt.hashSync('correct-horse', 10);
    vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash }]] as any);

    let lastRes;
    for (let i = 0; i < 5; i++) {
      lastRes = await login(req({ username: 'admin', password: 'WRONG' }));
    }
    expect(lastRes!.status).toBe(401);

    // A 6th attempt is blocked even with the CORRECT password — proves the
    // block comes from stored lockout state, not just a failure tally.
    const res = await login(req({ username: 'admin', password: 'correct-horse' }));
    expect(res.status).toBe(429);
    expect(createSession).not.toHaveBeenCalled();
    expect(state.get('login_fail_admin')).toBe('5|' + state.get('login_fail_admin')!.split('|')[1]);
  });

  it('rejects a request before even querying the user row when already locked out', async () => {
    // Simulates a second instance seeing lockout state written by the first.
    state.set('login_fail_admin', `5|${Date.now() + 60_000}`);

    const res = await login(req({ username: 'admin', password: 'correct-horse' }));
    expect(res.status).toBe(429);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not lock out a different username', async () => {
    const passwordHash = bcrypt.hashSync('correct-horse', 10);
    vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash }]] as any);

    for (let i = 0; i < 5; i++) {
      await login(req({ username: 'admin', password: 'WRONG' }));
    }
    expect(state.get('login_fail_admin')?.startsWith('5|')).toBe(true);

    const res = await login(req({ username: 'someone-else', password: 'correct-horse' }));
    expect(res.status).toBe(200);
  });

  it('clears the lockout counter after a successful login', async () => {
    state.set('login_fail_admin', `4|${Date.now() + 60_000}`);
    const passwordHash = bcrypt.hashSync('correct-horse', 10);
    vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash }]] as any);

    const res = await login(req({ username: 'admin', password: 'correct-horse' }));
    expect(res.status).toBe(200);
    expect(state.get('login_fail_admin')).toBe('0|0');
  });

  it('clears the block once the 15-minute window has passed, allowing the next attempt through', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const passwordHash = bcrypt.hashSync('correct-horse', 10);
      vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash }]] as any);

      for (let i = 0; i < 5; i++) {
        await login(req({ username: 'admin', password: 'WRONG' }));
      }
      expect((await login(req({ username: 'admin', password: 'WRONG' }))).status).toBe(429);

      // Advance past the 15-minute block window.
      vi.setSystemTime(new Date('2026-01-01T00:16:00Z'));
      const res = await login(req({ username: 'admin', password: 'correct-horse' }));
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('increments the failure count via a single locked read-modify-write, not separate get/set calls', async () => {
    // Guards against the counter regressing back to the non-atomic
    // getSetting-then-setSetting shape, which let concurrent failed attempts
    // for the same username read the same pre-increment count and collapse
    // into a single +1 (defeating the lockout under a burst of parallel
    // requests). The real atomicity guarantee comes from the DB's row lock
    // on "SELECT ... FOR UPDATE", which a mock can't exercise directly — this
    // asserts the code goes through that path instead of the old one.
    const passwordHash = bcrypt.hashSync('correct-horse', 10);
    vi.mocked(query).mockResolvedValue([[{ id: '1', username: 'admin', passwordHash }]] as any);

    await login(req({ username: 'admin', password: 'WRONG' }));

    expect(withTransaction).toHaveBeenCalledTimes(1);
    const forUpdateCall = conn.query.mock.calls.find(([sql]) => String(sql).includes('FOR UPDATE'));
    expect(forUpdateCall).toBeDefined();
    // setSetting (the old, non-atomic write path) must not be used for the
    // failure counter itself.
    expect(setSetting).not.toHaveBeenCalledWith('login_fail_admin', expect.any(String));
  });
});
