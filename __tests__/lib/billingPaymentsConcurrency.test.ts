// @vitest-environment node
/**
 * Two changes to ONE invoice's payments at the same moment — two tabs, or a
 * receipt saved while a payment is recorded — must leave paidAmount equal to
 * the sum of its live payments, and must not fail.
 *
 * They did not. recomputePaidAmount summed with a plain SELECT, which reads
 * the transaction's SNAPSHOT: each of two concurrent transactions saw only its
 * own new payment, and the cache kept whichever UPDATE ran last. Receivables
 * and the open-invoice list read that cache. The fix (lock the invoice, then
 * sum FOR UPDATE) locks payment rows — which a void locks in the OPPOSITE
 * order (payment, then invoice), so two such transactions can deadlock;
 * withTransaction now runs the one the database rolled back again.
 *
 * There is no database here, so this runs the REAL billingPayments code and
 * the REAL withTransaction against a stand-in connection pool that models the
 * parts of TiDB's pessimistic transactions (InnoDB's repeatable read behaves
 * the same way here) that decide the outcome:
 *   - a plain SELECT reads the snapshot taken when the transaction began;
 *   - a locking read (FOR UPDATE) and an UPDATE read the LATEST committed rows,
 *     and lock what they read, until commit or rollback;
 *   - waiting for a row another transaction holds blocks — and a wait that
 *     would close a cycle fails with ER_LOCK_DEADLOCK and rolls back;
 *   - another transaction's uncommitted INSERT is invisible and blocks nobody.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Payment = { id: string; docId: string; amount: string; voidedAt: string | null };
type State = { payments: Map<string, Payment>; paid: Map<string, string> };

const { db } = vi.hoisted(() => ({
  db: {
    committed: { payments: new Map(), paid: new Map() } as State,
    owners: new Map<string, number>(), // row key -> transaction holding its lock
    waitsFor: new Map<number, string>(), // transaction -> row key it waits for
    nextTx: 1,
    deadlocks: 0,
  },
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
const copy = (s: State): State => ({
  payments: new Map([...s.payments].map(([k, v]) => [k, { ...v }])),
  paid: new Map(s.paid),
});

function begin() {
  const tx = db.nextTx++;
  const snapshot = copy(db.committed);
  const own: State = { payments: new Map(), paid: new Map() };
  const held = new Set<string>();

  /** Would waiting for `key` close a cycle back to this transaction? */
  function wouldDeadlock(key: string): boolean {
    let owner = db.owners.get(key);
    const seen = new Set<number>();
    while (owner !== undefined && !seen.has(owner)) {
      if (owner === tx) return true;
      seen.add(owner);
      const next = db.waitsFor.get(owner);
      owner = next === undefined ? undefined : db.owners.get(next);
    }
    return false;
  }
  async function lock(key: string) {
    while (db.owners.has(key) && db.owners.get(key) !== tx) {
      if (wouldDeadlock(key)) {
        db.deadlocks++;
        db.waitsFor.delete(tx);
        throw Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), {
          code: 'ER_LOCK_DEADLOCK',
          errno: 1213,
        });
      }
      db.waitsFor.set(tx, key);
      await tick();
    }
    db.waitsFor.delete(tx);
    db.owners.set(key, tx);
    held.add(key);
  }
  const latest = (): Map<string, Payment> => new Map([...db.committed.payments, ...own.payments]);
  const sum = (rows: Iterable<Payment>, docId: string) => {
    let satang = 0;
    for (const p of rows) if (p.docId === docId && p.voidedAt === null) satang += Math.round(Number(p.amount) * 100);
    return (satang / 100).toFixed(2);
  };

  async function query(rawSql: string, params: unknown[] = []): Promise<unknown> {
    await tick(); // every statement is a round trip — this is what interleaves them
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('INSERT INTO billing_payments')) {
      const [id, docId, amount] = params as [string, string, number];
      await lock(`pay:${id}`);
      own.payments.set(id, { id, docId, amount: Number(amount).toFixed(2), voidedAt: null });
      return [{ affectedRows: 1 }];
    }
    if (sql === 'SELECT id FROM billing_documents WHERE id = ? FOR UPDATE') {
      await lock(`doc:${params[0]}`);
      return [[{ id: params[0] }]];
    }
    if (sql.startsWith('SELECT COALESCE(SUM(amount), 0) AS paid FROM billing_payments WHERE billingDocumentId = ? AND voidedAt IS NULL')) {
      const docId = String(params[0]);
      if (!sql.endsWith('FOR UPDATE')) {
        return [[{ paid: sum(new Map([...snapshot.payments, ...own.payments]).values(), docId) }]];
      }
      // A locking read locks every row it reads — the invoice's live payments.
      for (;;) {
        const rows = [...latest().values()].filter((p) => p.docId === docId && p.voidedAt === null);
        for (const p of rows) await lock(`pay:${p.id}`);
        const again = [...latest().values()].filter((p) => p.docId === docId && p.voidedAt === null);
        if (again.length === rows.length) return [[{ paid: sum(again, docId) }]];
      }
    }
    if (sql === 'UPDATE billing_documents SET paidAmount = ? WHERE id = ?') {
      await lock(`doc:${params[1]}`);
      own.paid.set(String(params[1]), Number(params[0]).toFixed(2));
      return [{ affectedRows: 1 }];
    }
    if (sql === 'SELECT billingDocumentId, voidedAt FROM billing_payments WHERE id = ? FOR UPDATE') {
      await lock(`pay:${params[0]}`);
      const p = latest().get(String(params[0]));
      return [p ? [{ billingDocumentId: p.docId, voidedAt: p.voidedAt }] : []];
    }
    if (sql === 'UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?') {
      await lock(`pay:${params[2]}`);
      const p = latest().get(String(params[2]))!;
      own.payments.set(p.id, { ...p, voidedAt: String(params[0]) });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`stand-in has no rule for: ${sql}`);
  }

  function release() {
    for (const key of held) db.owners.delete(key);
    held.clear();
    db.waitsFor.delete(tx);
  }
  return {
    query,
    commit() {
      for (const [k, v] of own.payments) db.committed.payments.set(k, v);
      for (const [k, v] of own.paid) db.committed.paid.set(k, v);
      release();
    },
    rollback: release,
  };
}

/** A pooled connection: outside a transaction it only answers the schema
 *  check db.ts makes on first use (always "up to date": no bootstrap). */
function connection() {
  let tx: ReturnType<typeof begin> | null = null;
  return {
    beginTransaction: async () => {
      tx = begin();
    },
    query: async (sql: string, params?: unknown[]) => {
      if (tx) return tx.query(sql, params);
      if (sql.includes("name = 'schema_version'")) return [[{ value: '9999' }], []];
      throw new Error(`stand-in: statement outside a transaction: ${sql}`);
    },
    commit: async () => {
      tx?.commit();
      tx = null;
    },
    rollback: async () => {
      tx?.rollback();
      tx = null;
    },
    release: () => {},
  };
}

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: () => ({
      getConnection: async () => connection(),
      query: async () => [[], []],
      end: async () => {},
    }),
  },
}));

import { addBillingPayment, voidBillingPayment } from '@/app/lib/billingPayments';

const pay = (id: string, amount: number) => ({
  id,
  billingDocumentId: 'inv-1',
  amount,
  paidDate: '2026-10-02',
  method: 'โอนเงิน',
  createdAt: '2026-10-02T03:00:00.000Z',
});
const livePaid = () =>
  [...db.committed.payments.values()]
    .filter((p) => p.docId === 'inv-1' && p.voidedAt === null)
    .reduce((s, p) => s + Number(p.amount), 0);
const seed = (id: string, amount: string) =>
  db.committed.payments.set(id, { id, docId: 'inv-1', amount, voidedAt: null });

beforeEach(() => {
  db.committed = { payments: new Map(), paid: new Map([['inv-1', '0.00']]) };
  db.owners.clear();
  db.waitsFor.clear();
  db.deadlocks = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // withTransaction's retry notice
});

describe('paidAmount under concurrent changes to one invoice', () => {
  it('two payments recorded at once: the cache holds BOTH', async () => {
    await Promise.all([addBillingPayment(pay('p-a', 30_000)), addBillingPayment(pay('p-b', 12_500.5))]);
    expect(livePaid()).toBe(42_500.5);
    expect(db.committed.paid.get('inv-1')).toBe('42500.50');
  });

  it('five at once, still exact to the satang', async () => {
    await Promise.all([0.1, 0.2, 0.3, 1000, 2500.25].map((a, i) => addBillingPayment(pay(`p-${i}`, a))));
    expect(db.committed.paid.get('inv-1')).toBe('3500.85');
  });

  it('a payment voided while another is recorded: the cache holds only the live one', async () => {
    seed('p-old', '5000.00');
    db.committed.paid.set('inv-1', '5000.00');
    await Promise.all([
      voidBillingPayment('p-old', 'พิมพ์ยอดผิด', '2026-10-02T04:00:00.000Z'),
      addBillingPayment(pay('p-new', 7_000)),
    ]);
    expect(livePaid()).toBe(7_000);
    expect(db.committed.paid.get('inv-1')).toBe('7000.00');
  });

  // Each void locks its payment, then the invoice; each re-sum then wants the
  // OTHER's payment too. That is a deadlock — the database rolls one back, and
  // withTransaction must run it again rather than answer with an error.
  it('two payments voided at once: both voided, neither request fails, the cache is right', async () => {
    seed('p-1', '1000.00');
    seed('p-2', '2000.00');
    seed('p-3', '4000.00');
    db.committed.paid.set('inv-1', '7000.00');
    const results = await Promise.all([
      voidBillingPayment('p-1', 'ซ้ำ', '2026-10-02T04:00:00.000Z'),
      voidBillingPayment('p-2', 'ซ้ำ', '2026-10-02T04:00:00.000Z'),
    ]);
    expect(db.deadlocks).toBeGreaterThan(0); // the stand-in really did deadlock…
    expect(results.map((r) => r.billingDocumentId)).toEqual(['inv-1', 'inv-1']); // …and nobody saw it
    expect(livePaid()).toBe(4_000);
    expect(db.committed.paid.get('inv-1')).toBe('4000.00');
  });

  it('what each caller is told is what was true when it committed', async () => {
    const [first, second] = await Promise.all([addBillingPayment(pay('p-a', 100)), addBillingPayment(pay('p-b', 200))]);
    // One of them committed first and saw only itself; the other saw both.
    expect([first.paidAmount, second.paidAmount].sort((x, y) => x - y)).toEqual([100, 300]);
  });
});
