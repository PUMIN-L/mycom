// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
// REAL bcrypt (deliberately NOT mocked here) so the actual credential-check
// path is exercised end to end.
import bcrypt from 'bcryptjs';

vi.mock('@/app/lib/db', () => ({ query: vi.fn(), getDbConnection: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/session', () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
import { createSession } from '@/app/lib/session';

import { POST as login } from '@/app/api/auth/login/route';

const req = (body: any) =>
  new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) });

describe('login credential verification (real bcrypt)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts the correct password and creates a session', async () => {
    const passwordHash = bcrypt.hashSync('correct-horse', 10);
    vi.mocked(query).mockResolvedValue([
      [{ id: '1', username: 'realadmin', passwordHash }],
    ] as any);

    const res = await login(req({ username: 'realadmin', password: 'correct-horse' }));
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith('1', 'realadmin');
  });

  it('rejects a wrong password with 401 and issues no session', async () => {
    const passwordHash = bcrypt.hashSync('correct-horse', 10);
    vi.mocked(query).mockResolvedValue([
      [{ id: '1', username: 'realadmin2', passwordHash }],
    ] as any);

    const res = await login(req({ username: 'realadmin2', password: 'WRONG' }));
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });
});
