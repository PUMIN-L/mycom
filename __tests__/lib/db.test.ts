// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// db.ts talks to a real MySQL pool (mysql2/promise) and hashes the seed admin
// password with bcryptjs. Both are mocked here so we can exercise the retry
// wrapper, the lazy bootstrap and the connectivity probe without a database.
//
// db.ts caches the pool + init promise on globalThis, so each scenario re-imports
// the module through `freshImport()` (which resets the module registry AND wipes
// the cached globals) to get an un-initialised copy.
const { mockConnection, mockPool, createPoolMock, bcryptHash } = vi.hoisted(() => {
  const mockConnection = {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    query: vi.fn(),
    getConnection: vi.fn(),
    end: vi.fn(),
  };
  return {
    mockConnection,
    mockPool,
    createPoolMock: vi.fn(() => mockPool),
    bcryptHash: vi.fn(async () => 'hashed-pw'),
  };
});

vi.mock('mysql2/promise', () => ({ default: { createPool: createPoolMock } }));
vi.mock('bcryptjs', () => ({ default: { hash: bcryptHash } }));

// Required DB_* env vars (the real createPool reads them; the mock ignores them,
// but set them so nothing along the way sees `undefined`).
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '4000';
process.env.DB_USER = 'tester';
process.env.DB_PASSWORD = 'pw';
process.env.DB_NAME = 'testdb';

// A version SELECT result that MATCHES SCHEMA_VERSION (2) → bootstrap fast-path,
// i.e. skip the whole CREATE TABLE / seed block.
const SCHEMA_MATCH: [Array<{ value: string }>, unknown[]] = [[{ value: '2' }], []];
// An empty result → no schema_version row / no admin row → full bootstrap.
const EMPTY: [unknown[], unknown[]] = [[], []];

type DbModule = typeof import('@/app/lib/db');

async function freshImport(): Promise<DbModule> {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>)._pool;
  delete (globalThis as Record<string, unknown>)._initPromise;
  return import('@/app/lib/db');
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Reset implementations so per-test `mockResolvedValueOnce` queues never leak.
  mockConnection.query.mockReset();
  mockConnection.beginTransaction.mockReset().mockResolvedValue(undefined);
  mockConnection.commit.mockReset().mockResolvedValue(undefined);
  mockConnection.rollback.mockReset().mockResolvedValue(undefined);
  mockConnection.release.mockReset();
  mockPool.query.mockReset();
  mockPool.getConnection.mockReset().mockResolvedValue(mockConnection);
  mockPool.end.mockReset();
  createPoolMock.mockClear().mockReturnValue(mockPool);
  bcryptHash.mockClear().mockResolvedValue('hashed-pw');

  // Bootstrap admin seed is opt-in via ADMIN_PASSWORD — default it OFF.
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_USERNAME;

  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('db.ts', () => {
  // ── getDbConnection ─────────────────────────────────────────────────────────
  describe('getDbConnection', () => {
    it('returns the pool (schema already current → bootstrap fast-path)', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);

      const pool = await db.getDbConnection();

      expect(pool).toBe(mockPool);
      // Fast-path: exactly one query (the schema_version SELECT), no seed, no hash.
      expect(mockConnection.query).toHaveBeenCalledTimes(1);
      expect(bcryptHash).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it('memoizes initialization across concurrent + repeat calls', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);

      const [a, b] = await Promise.all([db.getDbConnection(), db.getDbConnection()]);
      await db.getDbConnection();

      expect(a).toBe(mockPool);
      expect(b).toBe(mockPool);
      // One shared init promise → bootstrap acquires a connection only once.
      expect(mockPool.getConnection).toHaveBeenCalledTimes(1);
    });
  });

  // ── bootstrap / ensureInitialized (lazy, driven by first getDbConnection) ─────
  describe('bootstrap', () => {
    it('runs the full idempotent seed when the schema_version row is missing', async () => {
      process.env.ADMIN_PASSWORD = 'super-secret';
      process.env.ADMIN_USERNAME = 'root';
      const db = await freshImport();
      // Empty result for BOTH the schema_version SELECT and the admin-exists SELECT
      // → no fast-path, admin row absent → hash + insert.
      mockConnection.query.mockResolvedValue(EMPTY);

      await db.getDbConnection();

      expect(bcryptHash).toHaveBeenCalledWith('super-secret', 12);
      // The CREATE TABLE / seed statements ran on the pooled connection.
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS contents'),
      );
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO users'),
        expect.arrayContaining(['admin-001', 'root', 'hashed-pw']),
      );
      // Schema version is recorded so future cold instances take the fast-path.
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO settings"),
        ['2'],
      );
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it('falls through to full bootstrap when the settings table is absent (SELECT throws)', async () => {
      process.env.ADMIN_PASSWORD = 'pw';
      const db = await freshImport();
      mockConnection.query.mockImplementation((sql: string) => {
        // Only the version-probe SELECT rejects (settings table missing); the
        // later `INSERT INTO settings ... 'schema_version'` must still succeed.
        if (/SELECT value FROM settings/.test(sql)) {
          return Promise.reject(new Error("Table 'settings' doesn't exist"));
        }
        return Promise.resolve(EMPTY);
      });

      await db.getDbConnection();

      // The rejected version probe is swallowed and the seed still runs.
      expect(bcryptHash).toHaveBeenCalled();
    });

    it('skips the admin seed and warns when ADMIN_PASSWORD is unset', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(EMPTY);

      await db.getDbConnection();

      expect(bcryptHash).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ADMIN_PASSWORD not set'),
      );
    });

    it('does not re-hash when the admin row already exists', async () => {
      process.env.ADMIN_PASSWORD = 'pw';
      const db = await freshImport();
      mockConnection.query.mockImplementation((sql: string) => {
        // Version stale → run bootstrap; admin row present → skip hash + insert.
        if (/schema_version/.test(sql)) return Promise.resolve(EMPTY);
        if (/FROM users WHERE id = 'admin-001'/.test(sql)) {
          return Promise.resolve([[{ id: 'admin-001' }], []]);
        }
        return Promise.resolve(EMPTY);
      });

      await db.getDbConnection();

      expect(bcryptHash).not.toHaveBeenCalled();
    });

    it('retries the bootstrap on a transient error then succeeds', async () => {
      process.env.ADMIN_PASSWORD = 'pw';
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      mockPool.getConnection
        .mockRejectedValueOnce({ code: 'ECONNRESET' }) // attempt 1: transient
        .mockResolvedValue(mockConnection); // attempt 2: fresh connection

      await db.getDbConnection();

      expect(mockPool.getConnection).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DB init transient error'),
        'ECONNRESET',
      );
    });

    it('propagates a non-transient bootstrap error and clears the init promise so a later call retries', async () => {
      process.env.ADMIN_PASSWORD = 'pw';
      const db = await freshImport();
      const fatal = { code: 'ER_ACCESS_DENIED_ERROR', message: 'denied' };
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      mockPool.getConnection.mockRejectedValueOnce(fatal);

      await expect(db.getDbConnection()).rejects.toBe(fatal);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to initialize database table:',
        fatal,
      );

      // _initPromise was cleared on failure → the next call re-inits successfully.
      const pool = await db.getDbConnection();
      expect(pool).toBe(mockPool);
    });
  });

  // ── query() retry wrapper ─────────────────────────────────────────────────────
  describe('query', () => {
    it('resolves on the first attempt', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH); // init fast-path
      mockPool.query.mockResolvedValue([[{ id: 1 }], []]);

      const [rows] = await db.query('SELECT * FROM contents');

      expect(rows).toEqual([{ id: 1 }]);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM contents', undefined);
    });

    it('retries a transient error then succeeds', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      mockPool.query
        .mockRejectedValueOnce({ code: 'PROTOCOL_CONNECTION_LOST' })
        .mockResolvedValueOnce([[{ ok: 1 }], []]);

      const [rows] = await db.query('SELECT 1');

      expect(rows).toEqual([{ ok: 1 }]);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('DB transient error'),
        'PROTOCOL_CONNECTION_LOST',
      );
    });

    it('rethrows a non-transient error immediately (no retry)', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      const err = { code: 'ER_PARSE_ERROR', message: 'bad sql' };
      mockPool.query.mockRejectedValue(err);

      await expect(db.query('SELECT bad')).rejects.toBe(err);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('gives up and rethrows after MAX_ATTEMPTS on a persistent transient error', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      const err = { code: 'ETIMEDOUT' };
      mockPool.query.mockRejectedValue(err);

      await expect(db.query('SELECT 1')).rejects.toBe(err);
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    it('treats a duplicate-key error on an INSERT RETRY as a (synthetic) success', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      mockPool.query
        .mockRejectedValueOnce({ code: 'ECONNRESET' }) // attempt 1: transient → retry
        .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' }); // attempt 2: dup key → treated as ok

      const [result] = await db.query('INSERT INTO products (id) VALUES (?)', ['p1']);

      expect(result).toMatchObject({ affectedRows: 0, insertId: 0, warningStatus: 0 });
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('does NOT swallow a duplicate-key error on the FIRST attempt', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      const dup = { code: 'ER_DUP_ENTRY', message: 'dup' };
      mockPool.query.mockRejectedValue(dup);

      // attempt === 1 so the synthetic-success shortcut does not apply, and
      // ER_DUP_ENTRY is not transient → surfaced immediately.
      await expect(db.query('INSERT INTO products (id) VALUES (?)', ['p1'])).rejects.toBe(dup);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  // ── pingDb() connectivity probe ───────────────────────────────────────────────
  describe('pingDb', () => {
    it('returns latencyMs on a successful SELECT 1 (no bootstrap)', async () => {
      const db = await freshImport();
      mockPool.query.mockResolvedValue([[{ '1': 1 }], []]);

      const res = await db.pingDb();

      expect(typeof res.latencyMs).toBe('number');
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
      // Probe must NOT trigger the bootstrap.
      expect(mockPool.getConnection).not.toHaveBeenCalled();
    });

    it('absorbs one transient error via a single retry', async () => {
      const db = await freshImport();
      mockPool.query
        .mockRejectedValueOnce({ code: 'ECONNRESET' })
        .mockResolvedValueOnce([[{ '1': 1 }], []]);

      const res = await db.pingDb();

      expect(res).toHaveProperty('latencyMs');
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on a non-transient error', async () => {
      const db = await freshImport();
      const err = { code: 'ER_ACCESS_DENIED_ERROR' };
      mockPool.query.mockRejectedValue(err);

      await expect(db.pingDb()).rejects.toBe(err);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('throws after the second attempt on a persistent transient error', async () => {
      const db = await freshImport();
      const err = { code: 'EPIPE' };
      mockPool.query.mockRejectedValue(err);

      await expect(db.pingDb()).rejects.toBe(err);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });
  });

  // ── withTransaction ───────────────────────────────────────────────────────────
  describe('withTransaction', () => {
    it('commits and returns the callback result', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);

      const result = await db.withTransaction(async (conn) => {
        expect(conn).toBe(mockConnection);
        return 'done';
      });

      expect(result).toBe('done');
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(mockConnection.rollback).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    it('rolls back and rethrows when the callback throws', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      const boom = new Error('boom');

      await expect(
        db.withTransaction(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);

      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    it('swallows a rollback failure and still rethrows the original error', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      mockConnection.rollback.mockRejectedValueOnce(new Error('rollback failed'));
      const boom = new Error('original');

      await expect(
        db.withTransaction(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);

      expect(mockConnection.release).toHaveBeenCalled();
    });
  });
});
