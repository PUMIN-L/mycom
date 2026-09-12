// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The DB is mocked and the REAL store runs behind the REAL routes, so the
// assertions below are about the SQL that a request actually caused — which is
// the only way to prove that a hand-built request writes nothing.
const conn = { query: vi.fn() };
const topQuery = vi.fn();
const runTransaction = vi.fn();

vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));

// Drive the real requireAuth/withRoute by mocking the session only.
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { GET as searchGET } from '@/app/api/customers/note-search/route';
import { POST as replacePOST } from '@/app/api/customers/note-replace/route';
import {
  NOTE_REPLACE_MAX_ITEMS,
  NOTE_SEARCH_TERM_MAX_LENGTH,
} from '@/app/lib/noteSearch';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
const allSql = () => [...topQuery.mock.calls, ...conn.query.mock.calls].map(sqlOf);
/** Real UPDATE statements only — `/UPDATE/` alone would also match the locking
 *  `SELECT … FOR UPDATE`, which is a read. */
const updates = () => allSql().filter((s) => /^UPDATE\b/i.test(s.trim()));
/** Every statement that could change data. The strongest assertion in this
 *  file is that this list is empty. */
const writes = () =>
  allSql().filter((s) => /^(UPDATE|INSERT|DELETE|REPLACE)\b/i.test(s.trim()));

const searchReq = (qs: string) =>
  new NextRequest(`http://localhost:3000/api/customers/note-search${qs}`, {
    headers: { host: 'localhost:3000' },
  });

const replaceReq = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/customers/note-replace', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function customerRow(id: string, note: string, name = 'สมชาย') {
  return { id, companyId: 'co-1', name, department: '', phone: '', email: '', note };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  conn.query.mockReset().mockImplementation((sql: string) =>
    /^\s*SELECT/i.test(sql) ? Promise.resolve([[]]) : Promise.resolve([{ affectedRows: 1 }])
  );
  topQuery.mockReset().mockImplementation(() => Promise.resolve([[]]));
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/customers/note-search
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/customers/note-search', () => {
  it('401s an anonymous request before touching the database', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const res = await searchGET(searchReq('?term=เวอร์เนีย'));
    expect(res.status).toBe(401);
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('returns the matching customers with counts and context', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'c1', name: 'สมชาย', companyName: 'บริษัท ก', note: '10/9/26 ตามเรื่องเวอร์เนีย' },
        { id: 'c2', name: 'สมหญิง', companyName: 'บริษัท ข', note: 'ไม่มีคำนั้น' },
      ],
    ]);
    const res = await searchGET(searchReq('?term=' + encodeURIComponent('เวอร์เนีย')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.term).toBe('เวอร์เนีย');
    expect(body.matchCase).toBe(false);
    expect(body.useRegex).toBe(false);
    expect(body.total).toBe(1);
    expect(body.rows[0].customerId).toBe('c1');
    expect(body.rows[0].matchCount).toBe(1);
    expect(body.rows[0].matches[0].snippet).toContain('10/9/26');
  });

  it('SEARCHING NEVER WRITES — one SELECT, and nothing else', async () => {
    topQuery.mockResolvedValueOnce([[{ id: 'c1', name: 'a', companyName: '', note: 'เวอร์เนีย' }]]);
    await searchGET(searchReq('?term=' + encodeURIComponent('เวอร์เนีย')));
    expect(writes()).toEqual([]);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('reads the Aa and .* switches, and treats anything else as off', async () => {
    const rows = [[{ id: 'c1', name: 'a', companyName: '', note: 'ส่ง company ตัวเล็ก' }]];
    topQuery.mockResolvedValueOnce(rows as never);
    expect((await (await searchGET(searchReq('?term=Company&matchCase=1'))).json()).total).toBe(0);

    topQuery.mockResolvedValueOnce(rows as never);
    const body = await (await searchGET(searchReq('?term=Company&matchCase=maybe'))).json();
    expect(body.matchCase).toBe(false);
    expect(body.total).toBe(1);
  });

  it('refuses an empty term with a Thai reason and issues no query', async () => {
    const res = await searchGET(searchReq('?term=%20%20'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('คำว่าง');
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('refuses `.*` in regex mode — the click that would erase every note', async () => {
    const res = await searchGET(searchReq('?term=' + encodeURIComponent('.*') + '&useRegex=1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ข้อความว่าง');
    // Not even a read: no results are shown for a pattern that will not be
    // allowed to replace anything either.
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('runs `.*` as a literal search when regex mode is off', async () => {
    topQuery.mockResolvedValueOnce([[{ id: 'c1', name: 'a', companyName: '', note: 'ราคา .* บาท' }]]);
    const res = await searchGET(searchReq('?term=' + encodeURIComponent('.*')));
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(1);
  });

  it('refuses a broken regular expression', async () => {
    const res = await searchGET(searchReq('?term=' + encodeURIComponent('[ก-') + '&useRegex=1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ไม่ถูกต้อง');
    expect(topQuery).not.toHaveBeenCalled();
  });

  // ── THE TERM IS A NEEDLE, NOT STORED TEXT ────────────────────────────────
  //
  // This route used to run the term through `sanitizePlainText`, which DELETES
  // tag-like substrings. The screen validated one term with `buildMatcher` and
  // the route then searched for — and ECHOED BACK — a different one, which
  // "แทนที่ทั้งหมด" was built on. Every case below is a term that used to be
  // silently rewritten or wrongly refused.

  it('searches for `a<b` VERBATIM and echoes it back unchanged', async () => {
    const term = 'a<b';
    topQuery.mockResolvedValueOnce([
      [
        { id: 'c1', name: 'สมชาย', companyName: '', note: 'สูตร a<b ที่ลูกค้าถาม' },
        // The row that made this dangerous: it holds `a` but not `a<b`. When
        // the term was sanitised to `a`, this customer matched, and pressing
        // แทนที่ทั้งหมด rewrote every letter `a` in his call log.
        { id: 'c2', name: 'สมหญิง', companyName: '', note: 'ราคา a b c' },
      ],
    ]);
    const res = await searchGET(searchReq('?term=' + encodeURIComponent(term)));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The echo IS the term the replace will be built from, so it has to be the
    // needle that ran and not a cleaned-up cousin of it.
    expect(body.term).toBe(term);
    expect(body.total).toBe(1);
    expect(body.rows[0].customerId).toBe('c1');
    expect(body.rows[0].matchCount).toBe(1);
  });

  it('a term made only of markup is SEARCHED as text, not refused as empty', async () => {
    // `sanitizePlainText('<test')` is '', so the route answered "กรุณาพิมพ์คำ
    // ที่ต้องการค้นหาก่อน" while the search box plainly contained text.
    topQuery.mockResolvedValueOnce([
      [{ id: 'c1', name: 'สมชาย', companyName: '', note: 'ลูกค้าเขียนมาว่า <test ในอีเมล' }],
    ]);
    const res = await searchGET(searchReq('?term=' + encodeURIComponent('<test')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.term).toBe('<test');
    expect(body.total).toBe(1);
    expect(writes()).toEqual([]);
  });

  it('a 200-character term of ampersands is searched, not refused as too long', async () => {
    // `sanitizePlainText` turns each `&` into `&amp;`, so a term exactly at the
    // cap arrived five times over it: the screen accepted it and the server
    // answered "คำค้นยาวเกินไป" about a term of the documented maximum length.
    const amps = '&'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH);
    topQuery.mockResolvedValueOnce([[{ id: 'c1', name: 'a', companyName: '', note: amps }]]);
    const res = await searchGET(searchReq('?term=' + encodeURIComponent(amps)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.term).toBe(amps);
    expect(body.total).toBe(1);
  });

  it('refuses a term carrying a newline, with the control-character reason', async () => {
    // Refused, never stripped: the confirm dialog quotes the term inside a
    // line-oriented message, so an embedded newline reads there as a different
    // sentence from the one that would run.
    const res = await searchGET(searchReq('?term=' + encodeURIComponent('เวอร์เนีย\nดิจิตอล')));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('อักขระควบคุม');
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('a term past the cap is still refused, never trimmed and run', async () => {
    const res = await searchGET(
      searchReq('?term=' + encodeURIComponent('ก'.repeat(NOTE_SEARCH_TERM_MAX_LENGTH + 5)))
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ยาวเกินไป');
    expect(topQuery).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/customers/note-replace
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/customers/note-replace — the happy path still keeps history', () => {
  it('snapshots into revisions and writes only the note column', async () => {
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', '10/9/26 ตามเรื่องเวอร์เนีย')]])
        : Promise.resolve([{ affectedRows: 1 }])
    );

    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'คาลิปเปอร์',
        items: [{ customerId: 'c1', expectedNote: '10/9/26 ตามเรื่องเวอร์เนีย' }],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replacedCount).toBe(1);
    expect(body.results[0].customerName).toBe('สมชาย');

    const revision = conn.query.mock.calls.find((c) => /INSERT INTO revisions/i.test(sqlOf(c)))!;
    expect(revision[1][1]).toBe('customer');
    expect(JSON.parse(revision[1][3]).note).toBe('10/9/26 ตามเรื่องเวอร์เนีย');

    expect(updates()).toEqual(['UPDATE customers SET note = ? WHERE id = ? AND note = ?']);
  });

  it('401s an anonymous request before any statement is issued', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const res = await replacePOST(
      replaceReq({ term: 'เวอร์เนีย', replacement: 'x', items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }] })
    );
    expect(res.status).toBe(401);
    expect(writes()).toEqual([]);
  });

  it('refuses a cross-origin POST (the CSRF guard) with no statement issued', async () => {
    const res = await replacePOST(
      new NextRequest('http://localhost:3000/api/customers/note-replace', {
        method: 'POST',
        headers: {
          origin: 'http://evil.example',
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          term: 'เวอร์เนีย',
          replacement: 'x',
          items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
        }),
      })
    );
    expect(res.status).toBe(403);
    expect(writes()).toEqual([]);
  });
});

describe('POST /api/customers/note-replace — a request built by hand, bypassing the screen', () => {
  // Every case in this block asserts the same thing: ZERO UPDATE statements.
  // The confirm dialog in the browser is a courtesy; this is the control.
  const cases: Array<[string, unknown, string]> = [
    ['an empty search term', { term: '', replacement: 'x', items: [{ customerId: 'c1', expectedNote: 'a' }] }, 'คำว่าง'],
    [
      'a whitespace-only term',
      { term: '   ', replacement: 'x', items: [{ customerId: 'c1', expectedNote: 'a' }] },
      'คำว่าง',
    ],
    [
      '`.*` with regex mode on — "erase every customer note in one click"',
      { term: '.*', useRegex: true, replacement: '', items: [{ customerId: 'c1', expectedNote: 'a' }] },
      'ข้อความว่าง',
    ],
    [
      'a zero-width lookahead, which matches at every position',
      { term: '(?=.)', useRegex: true, replacement: 'x', items: [{ customerId: 'c1', expectedNote: 'a' }] },
      'ข้อความว่าง',
    ],
    [
      '`\\b`, which is empty-string-safe but still zero-width',
      { term: '\\b', useRegex: true, replacement: 'x', items: [{ customerId: 'c1', expectedNote: 'a' }] },
      'ข้อความว่าง',
    ],
    [
      'a broken pattern',
      { term: '(', useRegex: true, replacement: 'x', items: [{ customerId: 'c1', expectedNote: 'a' }] },
      'ไม่ถูกต้อง',
    ],
    ['no items at all', { term: 'เวอร์เนีย', replacement: 'x', items: [] }, 'อย่างน้อย 1 ราย'],
    ['items that is not an array', { term: 'เวอร์เนีย', replacement: 'x', items: 'c1' }, 'อย่างน้อย 1 ราย'],
    ['no items key', { term: 'เวอร์เนีย', replacement: 'x' }, 'อย่างน้อย 1 ราย'],
  ];

  it.each(cases)('refuses %s, and issues no UPDATE', async (_label, body, expected) => {
    const res = await replacePOST(replaceReq(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(expected);
    expect(writes()).toEqual([]);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('refuses a batch over the cap — a refusal, never the first 100 of 140', async () => {
    const items = Array.from({ length: NOTE_REPLACE_MAX_ITEMS + 1 }, (_, i) => ({
      customerId: `c${i}`,
      expectedNote: 'เวอร์เนีย',
    }));
    const res = await replacePOST(replaceReq({ term: 'เวอร์เนีย', replacement: 'x', items }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ไม่ตัดส่วนเกินทิ้ง');
    expect(writes()).toEqual([]);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('refuses an over-long replacement', async () => {
    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'ก'.repeat(5000),
        items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
      })
    );
    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it('refuses a body that is not JSON', async () => {
    const res = await replacePOST(replaceReq('{not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('รูปแบบข้อมูล');
    expect(writes()).toEqual([]);
  });

  it('a client-supplied note is never trusted: the server re-reads and refuses', async () => {
    // The request claims the note is one thing; the database says another.
    // Writing anyway would swallow whoever made that edit.
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', 'มีคนแก้ไปแล้วเมื่อกี้')]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'x',
        items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
      })
    );
    // Every item refused → 400 with the SAME body shape, so the screen renders
    // the reasons instead of a success toast.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.results[0].code).toBe('stale');
    expect(body.results[0].reason).toContain('ถูกแก้ไขไปแล้ว');
    expect(updates()).toEqual([]);
  });

  it('reports 400 with the reasons when the 2000-character ceiling refuses everybody', async () => {
    const note = `${'ก'.repeat(1995)}เวอร์เนีย`;
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', note)]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'เวอร์เนียดิจิตอลรุ่นใหม่',
        items: [{ customerId: 'c1', expectedNote: note }],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.results[0].code).toBe('too_long');
    // Refused, never truncated: the tail of a years-long call log is not
    // something to lose quietly.
    expect(updates()).toEqual([]);
  });

  it('a partly-refused batch is a 200 with the per-customer report', async () => {
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([
            [customerRow('c1', 'เวอร์เนีย ก'), customerRow('c2', 'มีคนแก้ไปแล้ว', 'สมหญิง')],
          ])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'คาลิปเปอร์',
        items: [
          { customerId: 'c1', expectedNote: 'เวอร์เนีย ก' },
          { customerId: 'c2', expectedNote: 'เวอร์เนีย ข' },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replacedCount).toBe(1);
    expect(body.refusedCount).toBe(1);
    expect(body.results.map((r: { customerId: string }) => r.customerId)).toEqual(['c1', 'c2']);
    expect(updates()).toHaveLength(1);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// The two values that used to be TRANSFORMED at one boundary and COMPARED at
// another
//
// `sanitizePlainText` guards STORED TEXT that will be rendered as markup. The
// search TERM is a needle and `expectedNote` is a concurrency token; running
// either through it made the server act on a value the screen never saw. Both
// blocks below fail against the old code.
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/customers/note-replace — the term is the needle the screen showed', () => {
  it('replaces `a<b` and leaves every OTHER letter `a` in the call log alone', async () => {
    const note = '6/9/26 สูตร a<b ที่ลูกค้าถาม a b c';
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', note)]])
        : Promise.resolve([{ affectedRows: 1 }])
    );

    const res = await replacePOST(
      replaceReq({ term: 'a<b', replacement: 'สูตรใหม่', items: [{ customerId: 'c1', expectedNote: note }] })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).replacedCount).toBe(1);

    // The written value is the proof. Sanitised to `a`, the term matched five
    // times in this one note and the stored result was unrecognisable.
    const update = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))!;
    expect(update[1][0]).toBe('6/9/26 สูตร สูตรใหม่ ที่ลูกค้าถาม a b c');
    expect(update[1][2]).toBe(note);
  });

  it('refuses a term with a control character before opening a transaction', async () => {
    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย\nดิจิตอล',
        replacement: 'x',
        items: [{ customerId: 'c1', expectedNote: 'เวอร์เนีย' }],
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('อักขระควบคุม');
    expect(writes()).toEqual([]);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/customers/note-replace — expectedNote is an identity check, not text', () => {
  /** A note carrying a RAW `&` — exactly what the coming 6,000-customer import
   *  will write, and what `substring(0, 2000)` produces when it cuts a note
   *  after `sanitizePlainText` has already expanded its entities. Nobody has
   *  edited it; it is simply not a fixed point of the sanitiser. */
  const RAW_AMP_NOTE = '6/9/26 ส่งของให้ บริษัท A & B จำกัด เรื่องเวอร์เนีย';

  it('replaces in a note holding a raw `&` — it is NOT "somebody else edited this"', async () => {
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', RAW_AMP_NOTE)]])
        : Promise.resolve([{ affectedRows: 1 }])
    );

    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'คาลิปเปอร์',
        // Byte for byte what `searchNotes` handed the screen.
        items: [{ customerId: 'c1', expectedNote: RAW_AMP_NOTE }],
      })
    );

    // Under the old code `sanitizePlainText(expectedNote)` was
    // "…A &amp; B…" while `current` stayed "…A & B…", so this customer was
    // refused as `stale` for ever — re-searching and retrying reproduced it
    // every time, and the admin was told about a concurrent edit that never
    // happened.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replacedCount).toBe(1);
    expect(body.results[0].status).toBe('replaced');
    expect(body.results[0].code).toBeNull();

    const update = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))!;
    // The `&` survives untouched — the replace rewrote the term and nothing
    // else, and did not quietly entity-encode the rest of the call log.
    expect(update[1][0]).toBe('6/9/26 ส่งของให้ บริษัท A & B จำกัด เรื่องคาลิปเปอร์');
    expect(update[1][2]).toBe(RAW_AMP_NOTE);
  });

  it('still REFUSES a note that really was edited between the search and the replace', async () => {
    // The guard has to stay a guard. A comparison that always passes would let
    // a bulk replace swallow somebody else's work — worse than the bug above.
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', RAW_AMP_NOTE + '\n7/9/26 มีคนพิมพ์บรรทัดนี้เพิ่มเมื่อกี้')]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    const res = await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'คาลิปเปอร์',
        items: [{ customerId: 'c1', expectedNote: RAW_AMP_NOTE }],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.results[0].code).toBe('stale');
    expect(body.results[0].reason).toContain('ถูกแก้ไขไปแล้ว');
    expect(updates()).toEqual([]);
  });

  it('a replaced note can be re-searched and replaced AGAIN — no permanent stale', async () => {
    // `replaceInNotes` writes `next` without re-sanitising it, so the row it
    // leaves behind is no more a fixed point of the sanitiser than the one it
    // read. Under the old code the second pass over its own output was refused.
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', RAW_AMP_NOTE)]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    await replacePOST(
      replaceReq({
        term: 'เวอร์เนีย',
        replacement: 'คาลิปเปอร์',
        items: [{ customerId: 'c1', expectedNote: RAW_AMP_NOTE }],
      })
    );
    const firstUpdate = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))!;
    const stored = String(firstUpdate[1][0]);

    // Round two, against what round one actually stored.
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(admin);
    runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c1', stored)]])
        : Promise.resolve([{ affectedRows: 1 }])
    );

    const res = await replacePOST(
      replaceReq({
        term: 'คาลิปเปอร์',
        replacement: 'คาลิปเปอร์ดิจิตอล',
        items: [{ customerId: 'c1', expectedNote: stored }],
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).replacedCount).toBe(1);
    const secondUpdate = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))!;
    expect(secondUpdate[1][0]).toBe(
      '6/9/26 ส่งของให้ บริษัท A & B จำกัด เรื่องคาลิปเปอร์ดิจิตอล'
    );
  });

  it('a customerId is matched verbatim too, so an id is never reshaped into not_found', async () => {
    conn.query.mockImplementation((sql: string) =>
      /^\s*SELECT/i.test(sql)
        ? Promise.resolve([[customerRow('c&1', 'เวอร์เนีย')]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    const res = await replacePOST(
      replaceReq({ term: 'เวอร์เนีย', replacement: 'x', items: [{ customerId: 'c&1', expectedNote: 'เวอร์เนีย' }] })
    );
    expect(res.status).toBe(200);
    // The id reaches the locking SELECT exactly as sent — `sanitizePlainText`
    // would have turned it into "c&amp;1" and the row would have come back
    // "ไม่พบลูกค้ารายนี้แล้ว".
    const select = conn.query.mock.calls.find((c) => /FOR UPDATE/i.test(sqlOf(c)))!;
    expect(select[1]).toEqual(['c&1']);
    expect((await res.json()).replacedCount).toBe(1);
  });
});
