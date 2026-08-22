// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/health/route';

// health probes the DB via pingDb — mock the whole db module so no real
// connection is attempted (and importing db.ts has no side effects).
vi.mock('@/app/lib/db', () => ({ pingDb: vi.fn() }));
import { pingDb } from '@/app/lib/db';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

// Env the route treats as required. Presence (not values) drives "healthy".
const REQUIRED_ENV = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'SESSION_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const stubAllRequiredEnv = () => {
  for (const k of REQUIRED_ENV) vi.stubEnv(k, 'present');
};

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

describe('Health API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Anonymous callers get minimal response ──────────────────────────────

  it('returns minimal {status, timestamp} for anonymous callers (200)', async () => {
    stubAllRequiredEnv();
    vi.mocked(pingDb).mockResolvedValue({ latencyMs: 7 } as any);
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    // Should NOT expose db details or env var names
    expect(body.db).toBeUndefined();
    expect(body.env).toBeUndefined();
  });

  it('returns minimal 503 for anonymous callers when unhealthy', async () => {
    stubAllRequiredEnv();
    vi.mocked(pingDb).mockRejectedValue({ code: 'ETIMEDOUT' });
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    // Should NOT expose error details
    expect(body.db).toBeUndefined();
    expect(body.env).toBeUndefined();
  });

  // ── Authenticated admin gets full diagnostics ────────────────────────────

  it('reports ok + DB latency + env details for admin (200)', async () => {
    stubAllRequiredEnv();
    vi.mocked(pingDb).mockResolvedValue({ latencyMs: 7 } as any);
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toEqual({ connected: true, latencyMs: 7 });
    expect(body.env.missingRequired).toEqual([]);
    expect(typeof body.timestamp).toBe('string');
  });

  it('reports the driver error code and 503 for admin when DB ping fails', async () => {
    stubAllRequiredEnv();
    vi.mocked(pingDb).mockRejectedValue({ code: 'ETIMEDOUT' });
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.db).toEqual({ connected: false, error: 'ETIMEDOUT' });
  });

  it('falls back to CONNECTION_FAILED when the DB error carries no code', async () => {
    stubAllRequiredEnv();
    vi.mocked(pingDb).mockRejectedValue(new Error('boom'));
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.db).toEqual({ connected: false, error: 'CONNECTION_FAILED' });
  });

  it('reports error (503) for admin when a required env var is missing', async () => {
    stubAllRequiredEnv();
    vi.stubEnv('DB_HOST', ''); // empty === missing
    vi.mocked(pingDb).mockResolvedValue({ latencyMs: 2 } as any);
    vi.mocked(getSession).mockResolvedValue(admin);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.db.connected).toBe(true);
    expect(body.env.missingRequired).toContain('DB_HOST');
  });
});
