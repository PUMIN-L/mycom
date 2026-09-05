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

// A version SELECT result that MATCHES SCHEMA_VERSION (33) → bootstrap fast-path,
// skipping DDL. Value is a string because settings stores VARCHAR values.
const SCHEMA_VERSION = '33';
const SCHEMA_MATCH: [Array<{ value: string }>, unknown[]] = [[{ value: SCHEMA_VERSION }], []];
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
  // The preview-deploy guard skips bootstrap when VERCEL_ENV==="preview"; keep it
  // unset so these tests deterministically exercise the real bootstrap.
  delete process.env.VERCEL_ENV;

  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

// ── v33 backfill simulator ────────────────────────────────────────────────────
// There is no database here, so "one line item per pre-existing sale, and a
// second run inserts nothing" is exercised by executing the backfill's REAL SQL
// against a tiny in-memory stand-in for the three tables it touches. The
// simulator interrogates the statement it was handed — does it carry the
// NOT EXISTS guard? does it key the new row off sr.id? does it exclude legacy
// product_cost rows? — instead of assuming any of it, so a backfill that lost
// one of those guards produces visibly wrong rows here instead of passing.
type FakeSale = {
  id: string;
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  costAmount: number;
  createdAt: string;
};
type FakeCostItem = { salesRecordId: string; costType: string; amount: number };
type FakeLineItem = {
  id: string;
  salesRecordId: string;
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  costAmount: number;
  quotationItemId: string | null;
  sortOrder: number;
  createdAt: string;
};
type FakeDb = { sales: FakeSale[]; costItems: FakeCostItem[]; lineItems: FakeLineItem[] };

const BACKFILL_INSERT = /INSERT INTO\s+sales_record_items/i;

let syntheticIdCounter = 0;

function applyBackfill(sql: string, db: FakeDb): void {
  const guarded =
    /WHERE NOT EXISTS\s*\(\s*SELECT 1 FROM sales_record_items sri WHERE sri\.salesRecordId = sr\.id\s*\)/i.test(sql);
  // `id` and `salesRecordId` both selected as sr.id → deterministic per sale, so
  // a racing second writer collides on the PRIMARY KEY instead of duplicating.
  const keyedOnSaleId = /SELECT\s+sr\.id\s*,\s*sr\.id\s*,/i.test(sql);
  const excludesProductCost = /costType\s*<>\s*'product_cost'/i.test(sql);

  for (const sale of db.sales) {
    if (guarded && db.lineItems.some((li) => li.salesRecordId === sale.id)) continue;
    const id = keyedOnSaleId ? sale.id : `synthetic-${++syntheticIdCounter}`;
    if (db.lineItems.some((li) => li.id === id)) {
      throw { code: 'ER_DUP_ENTRY', message: `Duplicate entry '${id}' for key 'PRIMARY'` };
    }
    const billLevelCost = db.costItems
      .filter(
        (ci) =>
          ci.salesRecordId === sale.id &&
          (!excludesProductCost || ci.costType !== 'product_cost'),
      )
      .reduce((sum, ci) => sum + ci.amount, 0);
    db.lineItems.push({
      id,
      salesRecordId: sale.id,
      productId: sale.productId,
      productName: sale.productName,
      categoryId: sale.categoryId,
      qty: sale.qty,
      unitPrice: sale.unitPrice,
      totalAmount: sale.totalAmount,
      costAmount: Math.max(0, sale.costAmount - billLevelCost),
      quotationItemId: null,
      sortOrder: 0,
      createdAt: sale.createdAt,
    });
  }
}

// Full-bootstrap mock (no schema_version row) where the backfill statement
// actually mutates `db`; every other statement is a no-op returning no rows.
function mockBootstrapAgainst(db: FakeDb): void {
  mockConnection.query.mockImplementation((sql: string) => {
    if (BACKFILL_INSERT.test(sql)) {
      applyBackfill(String(sql), db);
      return Promise.resolve([{ affectedRows: 0 }, []]);
    }
    return Promise.resolve(EMPTY);
  });
}

const sqlOfCall = (call: unknown[]) => String(call[0]);
const bootstrapSql = () => mockConnection.query.mock.calls.map(sqlOfCall);
const indexOfSql = (needle: string | RegExp) =>
  mockConnection.query.mock.calls.findIndex((c) =>
    typeof needle === 'string' ? sqlOfCall(c).includes(needle) : needle.test(sqlOfCall(c)),
  );

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
      // Schema version is recorded so future cold instances take the fast path.
      // Stamping anything but the current SCHEMA_VERSION means every instance
      // re-runs the whole DDL forever (or skips a migration it never applied).
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO settings"),
        [SCHEMA_VERSION],
      );
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });

    it('creates `products` BEFORE anything with a foreign key referencing it (fresh-DB bootstrap must not throw ER_FK_CANNOT_OPEN_PARENT)', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(EMPTY);

      await db.getDbConnection();

      const sqlOf = (call: unknown[]) => String(call[0]);
      const indexOfMatch = (needle: string) =>
        mockConnection.query.mock.calls.findIndex((c) => sqlOf(c).includes(needle));

      const productsIdx = indexOfMatch('CREATE TABLE IF NOT EXISTS products');
      const contentFkIdx = indexOfMatch('fk_content_product');
      const productSpecsIdx = indexOfMatch('CREATE TABLE IF NOT EXISTS product_specs');

      expect(productsIdx).toBeGreaterThanOrEqual(0);
      expect(contentFkIdx).toBeGreaterThanOrEqual(0);
      expect(productSpecsIdx).toBeGreaterThanOrEqual(0);
      // Both statements reference products(id) via a foreign key, so `products`
      // must exist first — on a real (FK-enforcing) database, creating either
      // of these before `products` throws ER_FK_CANNOT_OPEN_PARENT and bootstrap
      // never completes for a fresh install.
      expect(productsIdx).toBeLessThan(contentFkIdx);
      expect(productsIdx).toBeLessThan(productSpecsIdx);
    });

    it('creates `recurring_expenses` BEFORE the expenses.recurringExpenseId FK referencing it', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(EMPTY);

      await db.getDbConnection();

      const sqlOf = (call: unknown[]) => String(call[0]);
      const indexOfMatch = (needle: string) =>
        mockConnection.query.mock.calls.findIndex((c) => sqlOf(c).includes(needle));

      const recurringTableIdx = indexOfMatch('CREATE TABLE IF NOT EXISTS recurring_expenses');
      const fkIdx = indexOfMatch('fk_exp_recurring');

      expect(recurringTableIdx).toBeGreaterThanOrEqual(0);
      expect(fkIdx).toBeGreaterThanOrEqual(0);
      expect(recurringTableIdx).toBeLessThan(fkIdx);
    });

    it('propagates a REAL failure adding customer_equipments.salesRecordId instead of swallowing it', async () => {
      const db = await freshImport();
      const fatal = { code: 'ER_LOCK_WAIT_TIMEOUT', message: 'Lock wait timeout exceeded' };
      mockConnection.query.mockImplementation((sql: string) => {
        if (sql.includes('ADD COLUMN salesRecordId')) return Promise.reject(fatal);
        return Promise.resolve(EMPTY);
      });

      // A genuine DDL failure must propagate — not be console.warn'd away — so
      // schema_version is never stamped over a half-applied migration.
      await expect(db.getDbConnection()).rejects.toBe(fatal);
      const settingsCalls = mockConnection.query.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO settings')
      );
      expect(settingsCalls).toHaveLength(0);
    });

    it('still swallows the benign "column already exists" case for salesRecordId/productName', async () => {
      process.env.ADMIN_PASSWORD = 'pw';
      const db = await freshImport();
      const dup = { code: 'ER_DUP_FIELDNAME', message: 'Duplicate column name' };
      mockConnection.query.mockImplementation((sql: string) => {
        if (sql.includes('ADD COLUMN salesRecordId') || sql.includes('ADD COLUMN productName')) {
          return Promise.reject(dup);
        }
        return Promise.resolve(EMPTY);
      });

      // Should complete normally — the benign duplicate-column error is not
      // rethrown, and bootstrap still reaches the schema_version stamp.
      await db.getDbConnection();
      const settingsCalls = mockConnection.query.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO settings')
      );
      expect(settingsCalls).toHaveLength(1);
    });

    it('adds every v23 sales_records column independently, so a partial prior run does not block the rest', async () => {
      // Simulates a database where an earlier interrupted bootstrap already
      // added poRef and deliveryRef, but not the other four v23 columns. A
      // single multi-column ALTER would hit ER_DUP_FIELDNAME on poRef and
      // abort before ever reaching invoiceRef/receiptRef/warranty* — this
      // must add each column with its own statement so the rest still land.
      const db = await freshImport();
      const dupColumn = { code: 'ER_DUP_FIELDNAME', message: 'Duplicate column name' };
      const v23Columns = ['poRef', 'deliveryRef', 'invoiceRef', 'receiptRef', 'warrantyStartDate', 'warrantyEndDate'];
      const addedColumns: string[] = [];
      mockConnection.query.mockImplementation((sql: string) => {
        const m = /ALTER TABLE sales_records ADD COLUMN(?: IF NOT EXISTS)? (\w+)/.exec(sql);
        const column = m?.[1];
        if (column && v23Columns.includes(column)) {
          if (column === 'poRef' || column === 'deliveryRef') return Promise.reject(dupColumn);
          addedColumns.push(column);
        }
        return Promise.resolve(EMPTY);
      });

      await db.getDbConnection();

      expect(addedColumns).toEqual([
        'invoiceRef',
        'receiptRef',
        'warrantyStartDate',
        'warrantyEndDate',
      ]);
      const settingsCalls = mockConnection.query.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO settings')
      );
      expect(settingsCalls).toHaveLength(1); // bootstrap still completes
    });

    it('still swallows ER_CANT_CREATE_TABLE when the message confirms a duplicate constraint name', async () => {
      process.env.ADMIN_PASSWORD = 'pw';
      const db = await freshImport();
      const dupFk = {
        code: 'ER_CANT_CREATE_TABLE',
        message: "Can't create table `db`.`#sql-1` (errno: 121 \"Duplicate key on write or update\")",
      };
      mockConnection.query.mockImplementation((sql: string) => {
        if (sql.includes('fk_content_product')) return Promise.reject(dupFk);
        return Promise.resolve(EMPTY);
      });

      await db.getDbConnection();
      const settingsCalls = mockConnection.query.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO settings')
      );
      expect(settingsCalls).toHaveLength(1);
    });

    it('propagates ER_CANT_CREATE_TABLE when the message does NOT confirm a duplicate — a real FK failure, not "already exists"', async () => {
      const db = await freshImport();
      const realFailure = {
        code: 'ER_CANT_CREATE_TABLE',
        message: "Can't create table `db`.`#sql-1` (errno: 150 \"Foreign key constraint is incorrectly formed\")",
      };
      mockConnection.query.mockImplementation((sql: string) => {
        if (sql.includes('fk_content_product')) return Promise.reject(realFailure);
        return Promise.resolve(EMPTY);
      });

      // Must NOT be swallowed — a genuinely broken FK means ON DELETE CASCADE
      // never actually exists, which several stores rely on silently.
      await expect(db.getDbConnection()).rejects.toBe(realFailure);
      const settingsCalls = mockConnection.query.mock.calls.filter((c) =>
        String(c[0]).includes('INSERT INTO settings')
      );
      expect(settingsCalls).toHaveLength(0);
    });

    it('SKIPS bootstrap entirely on a Vercel preview deploy (never mutates the shared prod DB)', async () => {
      process.env.VERCEL_ENV = 'preview';
      try {
        const db = await freshImport();
        await db.getDbConnection();
        // Guard returns before acquiring a connection or running any statement.
        expect(mockPool.getConnection).not.toHaveBeenCalled();
        expect(mockConnection.query).not.toHaveBeenCalled();
      } finally {
        delete process.env.VERCEL_ENV;
      }
    });

    it('DOES bootstrap on preview when ALLOW_DB_BOOTSTRAP=1 (opt-in for a dedicated preview DB)', async () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.ALLOW_DB_BOOTSTRAP = '1';
      try {
        const db = await freshImport();
        mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
        await db.getDbConnection();
        expect(mockPool.getConnection).toHaveBeenCalledTimes(1);
      } finally {
        delete process.env.VERCEL_ENV;
        delete process.env.ALLOW_DB_BOOTSTRAP;
      }
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

  // ── v33: sales_record_items DDL + backfill ───────────────────────────────────
  describe('v33 sale line items', () => {
    it('issues the whole v33 DDL: the table, its four indexes, the CASCADE FK and the soft quotation link', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(EMPTY);

      await db.getDbConnection();
      const sql = bootstrapSql();
      const hasSql = (re: RegExp) => sql.some((s) => re.test(s));

      expect(hasSql(/CREATE TABLE IF NOT EXISTS sales_record_items/)).toBe(true);
      // Each index is also created standalone: a database whose table predates
      // one of them never gets it from CREATE TABLE IF NOT EXISTS.
      for (const index of [
        'idx_sri_salesRecord',
        'idx_sri_product',
        'idx_sri_category',
        'idx_sri_quotationItem',
      ]) {
        expect(
          hasSql(new RegExp(`CREATE INDEX ${index} ON sales_record_items`)),
        ).toBe(true);
      }
      // The CASCADE is what stops a deleted sale from leaving orphan revenue
      // lines behind that every report would keep counting.
      expect(
        hasSql(
          /ADD CONSTRAINT fk_sri_sales FOREIGN KEY \(salesRecordId\) REFERENCES sales_records\(id\) ON DELETE CASCADE/,
        ),
      ).toBe(true);

      // Soft link on the parent: column + index, and deliberately NO foreign key
      // to `quotations` — those are hard-purged by retention, and an FK would
      // either block the purge or cascade it into revenue rows.
      expect(hasSql(/ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS quotationId VARCHAR\(36\) DEFAULT NULL/)).toBe(true);
      expect(hasSql(/CREATE INDEX idx_sr_quotation ON sales_records \(quotationId\)/)).toBe(true);
      expect(hasSql(/REFERENCES quotations/)).toBe(false);
    });

    it('creates sales_records (and sale_cost_items) before the line-item table, FK and backfill', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(EMPTY);

      await db.getDbConnection();

      const salesRecordsIdx = indexOfSql('CREATE TABLE IF NOT EXISTS sales_records');
      const costItemsIdx = indexOfSql('CREATE TABLE IF NOT EXISTS sale_cost_items');
      const lineItemsIdx = indexOfSql('CREATE TABLE IF NOT EXISTS sales_record_items');
      const fkIdx = indexOfSql('fk_sri_sales');
      const backfillIdx = indexOfSql(BACKFILL_INSERT);

      expect(salesRecordsIdx).toBeGreaterThanOrEqual(0);
      // FK parent first, or a fresh install dies on ER_FK_CANNOT_OPEN_PARENT.
      expect(salesRecordsIdx).toBeLessThan(lineItemsIdx);
      expect(lineItemsIdx).toBeLessThan(fkIdx);
      // The backfill reads sale_cost_items and writes sales_record_items, so
      // both must already exist when it runs.
      expect(costItemsIdx).toBeLessThan(backfillIdx);
      expect(lineItemsIdx).toBeLessThan(backfillIdx);
    });

    it('re-runs cleanly on a database where every v33 object already exists', async () => {
      const dupKey = { code: 'ER_DUP_KEYNAME', message: 'Duplicate key name' };
      const dupColumn = { code: 'ER_DUP_FIELDNAME', message: 'Duplicate column name' };
      const dupConstraint = {
        code: 'ER_CANT_CREATE_TABLE',
        message: "Can't create table `db`.`#sql-2` (errno: 121 \"Duplicate key on write or update\")",
      };
      const db = await freshImport();
      mockConnection.query.mockImplementation((sql: string) => {
        if (/CREATE INDEX idx_sri_/.test(sql) || /CREATE INDEX idx_sr_quotation/.test(sql)) {
          return Promise.reject(dupKey);
        }
        if (/ADD COLUMN IF NOT EXISTS quotationId/.test(sql)) return Promise.reject(dupColumn);
        if (/fk_sri_sales/.test(sql)) return Promise.reject(dupConstraint);
        return Promise.resolve(EMPTY);
      });

      await db.getDbConnection();

      // Second deploy against the same DB must still finish and stamp v33 —
      // "already exists" is the normal case on every redeploy, not a failure.
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO settings'),
        [SCHEMA_VERSION],
      );
    });

    it('backfills exactly one line item per pre-existing sale, and a second bootstrap adds none', async () => {
      const fake: FakeDb = {
        sales: [
          { id: 's1', productId: 'p1', productName: 'Microscope', categoryId: 3, qty: 2, unitPrice: 500, totalAmount: 1000, costAmount: 600, createdAt: '2025-01-05T00:00:00.000Z' },
          // Legacy product_cost row stays as history but is NOT subtracted, so
          // the line keeps the product share of the old cached total.
          { id: 's2', productId: 'p2', productName: 'Centrifuge', categoryId: 4, qty: 1, unitPrice: 2000, totalAmount: 2000, costAmount: 1000, createdAt: '2025-02-05T00:00:00.000Z' },
          // saleType='service' style row: no product, no category — still gets a
          // line item, or its revenue vanishes from the reports.
          { id: 's3', productId: '', productName: '', categoryId: null, qty: 1, unitPrice: 300, totalAmount: 300, costAmount: 50, createdAt: '2025-03-05T00:00:00.000Z' },
        ],
        costItems: [
          { salesRecordId: 's2', costType: 'product_cost', amount: 700 },
          { salesRecordId: 's2', costType: 'transport', amount: 120 },
          { salesRecordId: 's3', costType: 'commission', amount: 200 },
        ],
        lineItems: [],
      };

      const first = await freshImport();
      mockBootstrapAgainst(fake);
      await first.getDbConnection();

      expect(fake.lineItems).toHaveLength(fake.sales.length);
      expect(fake.lineItems.map((li) => li.salesRecordId)).toEqual(['s1', 's2', 's3']);
      expect(fake.lineItems[0]).toMatchObject({
        id: 's1',
        productId: 'p1',
        productName: 'Microscope',
        categoryId: 3,
        qty: 2,
        unitPrice: 500,
        totalAmount: 1000,
        costAmount: 600, // no cost items → whole cached cost is product cost
        quotationItemId: null,
        sortOrder: 0,
        createdAt: '2025-01-05T00:00:00.000Z',
      });
      // 1000 cached − 120 transport = 880 on the line; 880 + 120 reproduces the
      // very same total under the new composition rule. The 700 product_cost row
      // is neither subtracted nor deleted (it is simply no longer summed).
      expect(fake.lineItems[1].costAmount).toBe(880);
      // GREATEST(0, …): bill-level costs exceeding the cached total must not
      // write a negative product cost.
      expect(fake.lineItems[2].costAmount).toBe(0);

      // A second cold start (new instance, same database) re-runs the whole
      // bootstrap — the backfill must be a no-op, not a second set of rows that
      // would silently double every historical sale.
      const second = await freshImport();
      mockConnection.query.mockReset();
      mockBootstrapAgainst(fake);
      await second.getDbConnection();

      expect(fake.lineItems).toHaveLength(fake.sales.length);
      expect(fake.lineItems.map((li) => li.id)).toEqual(['s1', 's2', 's3']);
    });

    it('leaves a sale that already has line items untouched, and issues no UPDATE/DELETE at all', async () => {
      const existing: FakeLineItem = {
        id: 'li-existing',
        salesRecordId: 's1',
        productId: 'p9',
        productName: 'Hand-entered line',
        categoryId: 7,
        qty: 3,
        unitPrice: 100,
        totalAmount: 300,
        costAmount: 111,
        quotationItemId: 'qi-1',
        sortOrder: 2,
        createdAt: '2025-04-01T00:00:00.000Z',
      };
      const fake: FakeDb = {
        sales: [
          { id: 's1', productId: 'p1', productName: 'Microscope', categoryId: 3, qty: 2, unitPrice: 500, totalAmount: 1000, costAmount: 600, createdAt: '2025-01-05T00:00:00.000Z' },
          { id: 's2', productId: 'p2', productName: 'Centrifuge', categoryId: 4, qty: 1, unitPrice: 2000, totalAmount: 2000, costAmount: 1000, createdAt: '2025-02-05T00:00:00.000Z' },
        ],
        costItems: [],
        lineItems: [existing],
      };
      const snapshot = { ...existing };

      const db = await freshImport();
      mockBootstrapAgainst(fake);
      await db.getDbConnection();

      // s1 already had a line → skipped entirely; only s2 is backfilled.
      expect(fake.lineItems).toHaveLength(2);
      expect(fake.lineItems[0]).toEqual(snapshot);
      expect(fake.lineItems[1]).toMatchObject({ id: 's2', salesRecordId: 's2' });

      // The migration is purely additive: nothing in this bootstrap may rewrite
      // or remove a sale or a line item (sales_records.totalAmount/costAmount and
      // sale_cost_items must survive byte-for-byte).
      const mutations = bootstrapSql().filter(
        (s) =>
          /^\s*(UPDATE|DELETE)\b/i.test(s) &&
          /sales_records?|sales_record_items|sale_cost_items/i.test(s),
      );
      expect(mutations).toEqual([]);
    });

    it('stands down when a concurrent bootstrap wins the backfill race, but still stamps the version', async () => {
      const db = await freshImport();
      const dupEntry = { code: 'ER_DUP_ENTRY', message: "Duplicate entry 's1' for key 'PRIMARY'" };
      mockConnection.query.mockImplementation((sql: string) => {
        if (BACKFILL_INSERT.test(sql)) return Promise.reject(dupEntry);
        return Promise.resolve(EMPTY);
      });

      await db.getDbConnection();

      // The other instance wrote exactly these rows — taking the app down over
      // it would be worse than useless.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('backfill lost a race'),
        'ER_DUP_ENTRY',
      );
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO settings'),
        [SCHEMA_VERSION],
      );
    });

    it('propagates a real backfill failure and never stamps the version over it', async () => {
      const db = await freshImport();
      const fatal = { code: 'ER_BAD_FIELD_ERROR', message: "Unknown column 'sr.categoryId'" };
      mockConnection.query.mockImplementation((sql: string) => {
        if (BACKFILL_INSERT.test(sql)) return Promise.reject(fatal);
        return Promise.resolve(EMPTY);
      });

      // Stamping v33 here would mark the migration done on a database whose
      // sales have no line items — every report would read zero for them, and
      // no later boot would ever retry.
      await expect(db.getDbConnection()).rejects.toBe(fatal);
      const settingsCalls = mockConnection.query.mock.calls.filter((c) =>
        sqlOfCall(c).includes('INSERT INTO settings'),
      );
      expect(settingsCalls).toHaveLength(0);
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

    it('retries the whole transaction on a transient connection error, then commits', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      // A stale TiDB socket surfaces on beginTransaction; the second attempt (a
      // fresh connection) succeeds — the save must not spuriously 500.
      mockConnection.beginTransaction
        .mockRejectedValueOnce(
          Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' })
        )
        .mockResolvedValue(undefined);
      const fn = vi.fn().mockResolvedValue('ok');

      const result = await db.withTransaction(fn);

      expect(result).toBe('ok');
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(2); // retried once
      expect(mockConnection.commit).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledTimes(1); // body ran only once (2nd attempt)
      expect(mockConnection.rollback).toHaveBeenCalledTimes(1); // rolled back the failed attempt
    });

    it('does NOT retry a non-transient (business) error — propagates immediately', async () => {
      const db = await freshImport();
      mockConnection.query.mockResolvedValue(SCHEMA_MATCH);
      const conflict = new Error('DocNoConflict'); // no transient .code
      await expect(
        db.withTransaction(async () => {
          throw conflict;
        }),
      ).rejects.toBe(conflict);
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1); // no retry
      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
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
