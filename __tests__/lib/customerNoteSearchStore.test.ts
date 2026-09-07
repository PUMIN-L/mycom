// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The DB is mocked and the assertions are made against the SQL and the params
// actually issued — the same pattern as alertSearchStore.test.ts / crmStore
// .test.ts. `withTransaction` invokes the callback with a scripted connection
// so the REAL transaction body runs; one test below replaces that mock with
// one that retries exactly as db.ts does.
const conn = { query: vi.fn() };
const topQuery = vi.fn();
const runTransaction = vi.fn();

vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));

import {
  NoteReplaceRefusedError,
  replaceInNotes,
  searchNotes,
} from '@/app/lib/customerNoteSearchStore';
import {
  CUSTOMER_NOTE_MAX_LENGTH,
  NOTE_REPLACE_MAX_ITEMS,
  NOTE_SEARCH_MAX_INPUT_LENGTH,
  buildMatcher,
} from '@/app/lib/noteSearch';
import type { NoteMatcher } from '@/app/lib/noteSearch';

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
const connSql = () => conn.query.mock.calls.map(sqlOf);
/** Every statement issued, transaction connection and pool alike. */
const allSql = () => [...topQuery.mock.calls.map(sqlOf), ...connSql()];
/** Real UPDATE statements only. `/UPDATE/` alone would also catch the locking
 *  `SELECT … FOR UPDATE`, which is precisely the read that proves no write
 *  happened — so the verb is anchored to the start of the statement. */
const updates = () => allSql().filter((s) => /^UPDATE\b/i.test(s.trim()));
const revisionInserts = () =>
  conn.query.mock.calls.filter((c) => /INSERT INTO revisions/i.test(sqlOf(c)));

function matcher(term: string, options?: { matchCase?: boolean; useRegex?: boolean }): NoteMatcher {
  const built = buildMatcher({ term, ...options });
  if (!built.ok) throw new Error(`expected a matcher: ${built.reason}`);
  return built.matcher;
}

/** A customers row as the locking SELECT reads it. */
function customer(over: Partial<Record<string, unknown>> & { id: string; note: string }) {
  return {
    companyId: 'co-1',
    name: 'สมชาย',
    department: '',
    phone: '',
    email: '',
    ...over,
  };
}

/** Script the transaction connection: the grouped SELECT on `customers`
 *  returns `rows`, the per-entity revision ceiling finds nothing over its
 *  limit, and every write reports one affected row. */
function scriptTx(rows: unknown[], affectedRows = 1) {
  conn.query.mockReset().mockImplementation((sql: string) =>
    /^\s*SELECT/i.test(sql)
      ? Promise.resolve([/FROM revisions/i.test(sql) ? [] : rows])
      : Promise.resolve([{ affectedRows }])
  );
}

/** Statements against `customers` only — `saveRevision` also reads and trims
 *  `revisions` on this same connection (the ceiling that keeps edit history
 *  from growing without bound), and those are not customer writes. */
const customerSql = () => connSql().filter((s) => !/\brevisions\b/i.test(s));

beforeEach(() => {
  vi.clearAllMocks();
  scriptTx([]);
  topQuery.mockReset().mockImplementation(() => Promise.resolve([[]]));
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

// ════════════════════════════════════════════════════════════════════════════
// searchNotes — the read path
// ════════════════════════════════════════════════════════════════════════════

describe('searchNotes — reads only what the table needs, and never writes', () => {
  it('selects the four display columns, skips empty notes, and issues no write', async () => {
    await searchNotes(matcher('เวอร์เนีย'));
    expect(topQuery).toHaveBeenCalledTimes(1);
    const sql = sqlOf(topQuery.mock.calls[0]);
    expect(sql).toContain('SELECT c.id, c.name, c.note, co.name AS companyName');
    expect(sql).toContain('FROM customers c');
    expect(sql).toContain('LEFT JOIN companies co ON c.companyId = co.id');
    // Rows with nothing in the note are where the volume is, and they can
    // never match.
    expect(sql).toContain("WHERE c.note IS NOT NULL AND c.note <> ''");
    expect(updates()).toEqual([]);
    expect(allSql().some((s) => /\b(INSERT|DELETE)\b/i.test(s))).toBe(false);
  });

  it('does NOT push the match into SQL as a LIKE', async () => {
    // `%term%` cannot use an index, so it buys no speed — and it is evaluated
    // in the column's collation, which on TiDB defaults to utf8mb4_bin. A
    // case-insensitive search would then silently lose rows. The one matcher
    // in noteSearch.ts decides what a match is, for search and replace alike.
    await searchNotes(matcher('Company'));
    const sql = sqlOf(topQuery.mock.calls[0]);
    expect(sql).not.toMatch(/LIKE/i);
    expect(topQuery.mock.calls[0][1]).toBeUndefined();
  });

  it('filters in JavaScript: Thai, mixed Latin, and the ones that do not match', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'c1', name: 'สมชาย', companyName: 'บริษัท ก', note: '10/9/26 ตามเรื่องเวอร์เนีย' },
        { id: 'c2', name: 'สมหญิง', companyName: 'บริษัท ข', note: 'ส่ง Company ให้แล้ว' },
        { id: 'c3', name: 'สมปอง', companyName: null, note: 'เวอร์เนีย ครั้งที่ 1\nเวอร์เนีย ครั้งที่ 2' },
      ],
    ]);
    const result = await searchNotes(matcher('เวอร์เนีย'));

    expect(result.rows.map((r) => r.customerId)).toEqual(['c1', 'c3']);
    expect(result.total).toBe(2);
    expect(result.totalMatches).toBe(3);
    expect(result.hidden).toBe(0);
    // A missing company name becomes an empty string, never the text "null".
    expect(result.rows[1].companyName).toBe('');
    expect(result.rows[1].matchCount).toBe(2);
    // The note travels back whole: it is the preview material AND the value
    // the replace request sends as `expectedNote`.
    expect(result.rows[0].note).toBe('10/9/26 ตามเรื่องเวอร์เนีย');
    expect(result.rows[0].matches[0].snippet).toContain('10/9/26');
  });

  it('honours Aa the same way the pure matcher does', async () => {
    const rows = [
      [{ id: 'c1', name: 'a', companyName: '', note: 'ส่ง company ตัวเล็ก' }],
    ];
    topQuery.mockResolvedValueOnce(rows as never);
    expect((await searchNotes(matcher('Company'))).total).toBe(1);

    topQuery.mockResolvedValueOnce(rows as never);
    expect((await searchNotes(matcher('Company', { matchCase: true }))).total).toBe(0);
  });

  it('caps the rows but reports how many are hidden — never a silent trim', async () => {
    topQuery.mockResolvedValueOnce([
      Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        name: `ลูกค้า ${i}`,
        companyName: '',
        note: 'เวอร์เนีย',
      })),
    ]);
    const result = await searchNotes(matcher('เวอร์เนีย'), { cap: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result.total).toBe(7);
    expect(result.hidden).toBe(4);
    expect(result.cap).toBe(3);
  });

  it('counts an over-long note as skipped instead of as "no match"', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'c1', name: 'a', companyName: '', note: 'เวอร์เนีย' },
        {
          id: 'c2',
          name: 'b',
          companyName: '',
          note: `เวอร์เนีย${'ก'.repeat(NOTE_SEARCH_MAX_INPUT_LENGTH)}`,
        },
      ],
    ]);
    const result = await searchNotes(matcher('เวอร์เนีย'));
    expect(result.rows.map((r) => r.customerId)).toEqual(['c1']);
    // Reported, so the screen can say so. A customer whose note was never
    // examined must not look identical to one with nothing in it.
    expect(result.skippedOversize).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// replaceInNotes — the write path
// ════════════════════════════════════════════════════════════════════════════

describe('replaceInNotes — one transaction, history first, one column', () => {
  it('reads the full row FOR UPDATE, snapshots it, then writes only `note`', async () => {
    scriptTx([customer({ id: 'c1', note: '10/9/26 ตามเรื่องเวอร์เนีย' })]);

    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'เวอร์เนียดิจิตอล',
      items: [{ customerId: 'c1', expectedNote: '10/9/26 ตามเรื่องเวอร์เนีย' }],
    });

    expect(report.replacedCount).toBe(1);
    expect(runTransaction).toHaveBeenCalledTimes(1);

    const [selectSql, selectParams] = conn.query.mock.calls[0];
    expect(sqlOf(conn.query.mock.calls[0])).toContain(
      'SELECT id, companyId, name, department, phone, email, note FROM customers WHERE id IN (?) FOR UPDATE'
    );
    expect(selectParams).toEqual(['c1']);
    expect(String(selectSql)).not.toMatch(/JOIN/i);

    // History BEFORE the overwrite, through the transaction's own connection.
    const [revisionSql, revisionParams] = revisionInserts()[0];
    expect(String(revisionSql)).toContain('INSERT INTO revisions');
    expect(revisionParams[1]).toBe('customer');
    expect(revisionParams[2]).toBe('c1');
    expect(JSON.parse(revisionParams[3]).note).toBe('10/9/26 ตามเรื่องเวอร์เนีย');
    expect(topQuery).not.toHaveBeenCalled(); // never the pool-level query()

    // The narrowest possible write: one column, and the note we read repeated
    // in the WHERE.
    const updateCall = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))!;
    expect(sqlOf(updateCall)).toBe('UPDATE customers SET note = ? WHERE id = ? AND note = ?');
    expect(updateCall[1]).toEqual([
      '10/9/26 ตามเรื่องเวอร์เนียดิจิตอล',
      'c1',
      '10/9/26 ตามเรื่องเวอร์เนีย',
    ]);
  });

  it('the snapshot is issued BEFORE the UPDATE, not after it', async () => {
    scriptTx([customer({ id: 'c1', note: 'เวอร์เนีย' })]);
    await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
    });
    const order = connSql().map((s) =>
      /INSERT INTO revisions/i.test(s) ? 'revision'
        : /\brevisions\b/i.test(s) ? 'trim'
        : /^UPDATE\b/i.test(s) ? 'update'
        : 'select'
    );
    // The ceiling trim that follows the snapshot rides the same transaction,
    // so a rollback takes the deletion of old history with it too.
    expect(order).toEqual(['select', 'revision', 'trim', 'update']);
  });

  it('a failed snapshot means NO overwrite — the error leaves the transaction', async () => {
    // No history, no destructive write. withTransaction rolls the whole thing
    // back, so nobody in the batch is touched.
    conn.query.mockReset().mockImplementation((sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve([[customer({ id: 'c1', note: 'เวอร์เนีย' })]]);
      if (/INSERT INTO revisions/i.test(sql)) return Promise.reject(new Error('revisions is full'));
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    await expect(
      replaceInNotes({
        matcher: matcher('เวอร์เนีย'),
        replacement: 'x',
        items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
      })
    ).rejects.toThrow('revisions is full');
    expect(updates()).toEqual([]);
  });

  it('never writes any customer column other than note', async () => {
    scriptTx([customer({ id: 'c1', note: 'เวอร์เนีย' })]);
    await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
    });
    for (const sql of updates()) {
      for (const column of ['companyId', 'name', 'department', 'phone', 'email']) {
        expect(sql).not.toContain(`${column} =`);
      }
    }
    // Nothing is ever deleted from `customers` — the only DELETE this path can
    // issue belongs to the revision ceiling, against `revisions`.
    expect(allSql().some((s) => /DELETE/i.test(s) && !/\brevisions\b/i.test(s))).toBe(false);
  });

  it('replaces several customers in ONE transaction', async () => {
    scriptTx([
      customer({ id: 'c1', name: 'สมชาย', note: 'เวอร์เนีย ก' }),
      customer({ id: 'c2', name: 'สมหญิง', note: 'เวอร์เนีย ข' }),
    ]);
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'คาลิปเปอร์',
      items: [
        { customerId: 'c1', expectedNote: 'เวอร์เนีย ก' },
        { customerId: 'c2', expectedNote: 'เวอร์เนีย ข' },
      ],
    });
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(report.replacedCount).toBe(2);
    expect(updates()).toHaveLength(2);
    // One grouped read of `customers`, never one query per customer.
    expect(customerSql().filter((s) => /^SELECT/i.test(s))).toHaveLength(1);
    expect(conn.query.mock.calls[0][1]).toEqual(['c1', 'c2']);
  });
});

describe('replaceInNotes — refuses per customer, with a Thai reason', () => {
  it('refuses a customer whose note changed since the screen read it', async () => {
    scriptTx([customer({ id: 'c1', note: 'มีคนแก้ไปแล้ว' })]);
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'c1', expectedNote: '10/9/26 ตามเรื่องเวอร์เนีย' }],
    });
    expect(report.results[0].status).toBe('refused');
    expect(report.results[0].code).toBe('stale');
    expect(report.results[0].reason).toContain('ถูกแก้ไขไปแล้ว');
    // The whole point: somebody else's edit is not swallowed.
    expect(updates()).toEqual([]);
    expect(revisionInserts()).toHaveLength(0);
  });

  it('refuses a customer whose replaced note would pass 2000 characters', async () => {
    // The customer write routes do `substring(0, 2000)`, which cuts the tail
    // off a years-long call log and tells nobody. Measured, then refused.
    const note = `${'ก'.repeat(CUSTOMER_NOTE_MAX_LENGTH - 5)}เวอร์เนีย`;
    expect(note.length).toBeGreaterThan(CUSTOMER_NOTE_MAX_LENGTH - 6);
    scriptTx([customer({ id: 'c1', note })]);

    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'เวอร์เนียดิจิตอลรุ่นใหม่',
      items: [{ customerId: 'c1', expectedNote: note }],
    });

    expect(report.results[0].code).toBe('too_long');
    expect(report.results[0].reason).toContain('หายไปโดยไม่มีใครรู้');
    expect(updates()).toEqual([]);
    expect(revisionInserts()).toHaveLength(0);
  });

  it('refuses a customer that no longer exists', async () => {
    scriptTx([]);
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'ghost', expectedNote: 'เวอร์เนีย' }],
    });
    expect(report.results[0].code).toBe('not_found');
    expect(report.refusedCount).toBe(1);
    expect(updates()).toEqual([]);
  });

  it('reports "unchanged" with NO update when the word is already gone', async () => {
    scriptTx([customer({ id: 'c1', note: 'ไม่มีคำนั้นแล้ว' })]);
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'c1', expectedNote: 'ไม่มีคำนั้นแล้ว' }],
    });
    expect(report.results[0].status).toBe('unchanged');
    expect(report.unchangedCount).toBe(1);
    // A summary must never claim "แก้ไขแล้ว" for a row nothing happened to.
    expect(updates()).toEqual([]);
    expect(revisionInserts()).toHaveLength(0);
  });

  it('refuses one customer without rolling the others back', async () => {
    scriptTx([
      customer({ id: 'c1', note: 'เวอร์เนีย ก' }),
      customer({ id: 'c2', note: 'มีคนแก้ไปแล้ว' }),
      customer({ id: 'c3', note: 'เวอร์เนีย ค' }),
    ]);
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'คาลิปเปอร์',
      items: [
        { customerId: 'c1', expectedNote: 'เวอร์เนีย ก' },
        { customerId: 'c2', expectedNote: 'เวอร์เนีย ข' },
        { customerId: 'c3', expectedNote: 'เวอร์เนีย ค' },
      ],
    });
    expect(report.replacedCount).toBe(2);
    expect(report.refusedCount).toBe(1);
    // One entry per submitted customer, in submission order. Never short.
    expect(report.results.map((r) => r.customerId)).toEqual(['c1', 'c2', 'c3']);
    expect(updates()).toHaveLength(2);
  });

  it('refuses the second mention of the same customer instead of replacing twice', async () => {
    scriptTx([customer({ id: 'c1', note: 'เวอร์เนีย' })]);
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'คาลิปเปอร์',
      items: [
        { customerId: 'c1', expectedNote: 'เวอร์เนีย' },
        { customerId: 'c1', expectedNote: 'เวอร์เนีย' },
      ],
    });
    expect(report.replacedCount).toBe(1);
    expect(report.results[1].code).toBe('stale');
    expect(updates()).toHaveLength(1);
  });

  it('refuses when the UPDATE matched nothing (changed between read and write)', async () => {
    conn.query.mockReset().mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customer({ id: 'c1', note: 'เวอร์เนีย' })]])
        : Promise.resolve([{ affectedRows: /^\s*UPDATE\b/i.test(sql) ? 0 : 1 }])
    );
    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
    });
    expect(report.results[0].code).toBe('stale');
    expect(report.replacedCount).toBe(0);
  });

  it('refuses the whole batch, before opening a transaction, when it is too big', async () => {
    const items = Array.from({ length: NOTE_REPLACE_MAX_ITEMS + 1 }, (_, i) => ({
      customerId: `c${i}`,
      expectedNote: 'เวอร์เนีย',
    }));
    await expect(
      replaceInNotes({ matcher: matcher('เวอร์เนีย'), replacement: 'x', items })
    ).rejects.toBeInstanceOf(NoteReplaceRefusedError);
    // A refusal, not a trim: no transaction, no statement of any kind.
    expect(runTransaction).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('refuses an empty batch the same way', async () => {
    await expect(
      replaceInNotes({ matcher: matcher('เวอร์เนีย'), replacement: 'x', items: [] })
    ).rejects.toBeInstanceOf(NoteReplaceRefusedError);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('replaceInNotes — line structure, deletion, and the retry', () => {
  it('does not touch the newlines of a multi-line call log', async () => {
    const note = [
      '6/9/26  โทรหา QC ส่งข้อมูล Company',
      '7/9/26  ติดตามใบเสนอราคา',
      '10/9/26 ตามใบเสนอราคา เวอร์เนีย',
    ].join('\n');
    scriptTx([customer({ id: 'c1', note })]);

    await replaceInNotes({
      matcher: matcher('ใบเสนอราคา'),
      replacement: 'QT',
      items: [{ customerId: 'c1', expectedNote: note }],
    });

    const written = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))![1][0] as string;
    expect(written.split('\n')).toHaveLength(3);
    expect(written).toBe(
      '6/9/26  โทรหา QC ส่งข้อมูล Company\n7/9/26  ติดตามQT\n10/9/26 ตามQT เวอร์เนีย'
    );
  });

  it('an empty replacement deletes the word', async () => {
    scriptTx([customer({ id: 'c1', note: 'ตามเรื่องเวอร์เนียอีกครั้ง' })]);
    await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: '',
      items: [{ customerId: 'c1', expectedNote: 'ตามเรื่องเวอร์เนียอีกครั้ง' }],
    });
    const written = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))![1][0];
    expect(written).toBe('ตามเรื่องอีกครั้ง');
  });

  it('a retried transaction re-reads and mints a new snapshot id — never doubles up', async () => {
    // withTransaction retries the whole callback up to 3 times on a transient
    // connection loss. Everything is computed inside the callback, so a replay
    // starts from scratch instead of appending to the previous attempt.
    const seen: string[] = [];
    conn.query.mockReset().mockImplementation((sql: string, params?: unknown[]) => {
      if (/^\s*SELECT/i.test(sql)) {
        return Promise.resolve([[customer({ id: 'c1', note: 'เวอร์เนีย' })]]);
      }
      if (/INSERT INTO revisions/i.test(sql)) {
        seen.push(String((params as unknown[])[0]));
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    let attempts = 0;
    runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
      attempts++;
      if (attempts === 1) {
        await fn(conn).catch(() => undefined);
        // The first attempt "lost its connection" after doing its work; the
        // rollback discarded it and db.ts retries with a fresh connection.
        return fn(conn);
      }
      return fn(conn);
    });

    const report = await replaceInNotes({
      matcher: matcher('เวอร์เนีย'),
      replacement: 'x',
      items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
    });

    // One entry, not two: `results` lives inside the callback.
    expect(report.results).toHaveLength(1);
    expect(report.replacedCount).toBe(1);
    // A fresh UUID per attempt, minted inside the callback — the rolled-back
    // attempt's snapshot went away with it.
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
