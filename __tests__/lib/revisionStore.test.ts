// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';
import { saveRevision, listRevisions, getRevision, REVISION_KEEP } from '@/app/lib/revisionStore';

beforeEach(() => vi.clearAllMocks());

describe('revisionStore', () => {
  describe('saveRevision', () => {
    it('inserts a snapshot with a generated id, entity keys, and serialized data', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
      await saveRevision('content', 'c1', { title: 'old', n: 1 });

      const [sql, params] = vi.mocked(query).mock.calls[0];
      expect(sql).toContain('INSERT INTO revisions');
      expect(typeof params![0]).toBe('string'); // generated id
      expect(params![1]).toBe('content'); // entityType
      expect(params![2]).toBe('c1'); // entityId
      expect(JSON.parse(params![3] as string)).toEqual({ title: 'old', n: 1 });
      expect(typeof params![4]).toBe('string'); // createdAt ISO
    });

    it('serializes missing data as JSON null', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
      await saveRevision('product', 'p1', undefined);
      expect(vi.mocked(query).mock.calls[0][1]![3]).toBe('null');
    });

    it('runs the INSERT through a passed connection instead of the pool-level query', async () => {
      // Callers inside withTransaction() pass their own conn so the snapshot
      // is genuinely part of that transaction — a retry of the whole callback
      // (withTransaction retries on a transient error) can't leave a
      // duplicate snapshot behind from a rolled-back attempt. The trim that
      // follows the INSERT rides the same connection for the same reason.
      const conn = { query: vi.fn().mockResolvedValue([[]]) };
      await saveRevision('content', 'c1', { title: 'old' }, conn);

      expect(query).not.toHaveBeenCalled();
      const [sql, params] = conn.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO revisions');
      expect(params[2]).toBe('c1');
      // Nothing over the ceiling → the trim reads and then stands down.
      expect(conn.query.mock.calls.every((c: unknown[]) => !/^\s*DELETE/i.test(String(c[0])))).toBe(true);
    });
  });

  // ── What a customer snapshot actually stores ────────────────────────────
  //
  // The restore route puts back ONE column, `note`
  // (`UPDATE customers SET note = ? WHERE id = ?`), deliberately — a stale
  // `companyId` could point a customer at a deleted company. Every other
  // column the old full-row snapshot carried was therefore bytes that could
  // never be restored, in the largest table in the database.
  describe('saveRevision — the customer snapshot payload', () => {
    /** The full row a customer writer reads with SELECT … FOR UPDATE. */
    const customerRow = {
      id: 'cust-1',
      companyId: 'co-1',
      name: 'สมชาย',
      department: 'จัดซื้อ',
      phone: '081-000-0000',
      email: 'somchai@example.com',
      note: '6/9/26 โทรหา QC',
    };
    const storedPayload = () =>
      JSON.parse(vi.mocked(query).mock.calls[0][1]![3] as string);

    it('keeps the note (the only restorable field) and the name (so the entry is legible)', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      await saveRevision('customer', 'cust-1', customerRow);
      expect(storedPayload()).toEqual({ name: 'สมชาย', note: '6/9/26 โทรหา QC' });
    });

    it('drops every column the restore can never write back', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      await saveRevision('customer', 'cust-1', customerRow);
      const payload = storedPayload();
      // `id` is already the entityId column — storing it twice is duplication.
      for (const dead of ['id', 'companyId', 'department', 'phone', 'email']) {
        expect(Object.hasOwn(payload, dead)).toBe(false);
      }
    });

    it('never invents a note key the source row did not have', async () => {
      // The restore route refuses a snapshot with no `note` key rather than
      // writing "" over a live call log. A projection that filled the key in
      // with undefined/"" would defeat exactly that check.
      vi.mocked(query).mockResolvedValue([[]] as any);
      await saveRevision('customer', 'cust-1', { name: 'สมชาย', phone: '081' });
      expect(storedPayload()).toEqual({ name: 'สมชาย' });
    });

    it('leaves product / content / document snapshots whole — their restores re-apply every field', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      const content = { id: 'c1', title: 'เดิม', blocks: [{ type: 'text', html: '<p>x</p>' }] };
      await saveRevision('content', 'c1', content);
      expect(storedPayload()).toEqual(content);
    });

    it('passes a non-object customer payload through untouched instead of turning it into {}', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      await saveRevision('customer', 'cust-1', 'not a row');
      expect(storedPayload()).toBe('not a row');
    });
  });

  // ── The ceiling ────────────────────────────────────────────────────────
  //
  // Nothing ever deleted a row from `revisions`. This is a DELETE against
  // real history, so what it orders by matters more than that it runs.
  describe('saveRevision — the per-entity ceiling', () => {
    /** Script the trim's SELECT to report `ids` as the over-the-ceiling rows. */
    function trimFinds(ids: string[]) {
      vi.mocked(query).mockImplementation(async (sql: string) =>
        /^\s*SELECT/i.test(sql)
          ? ([ids.map((id) => ({ id })), []] as any)
          : ([{ affectedRows: ids.length }, []] as any)
      );
    }
    const callsMatching = (re: RegExp) =>
      vi.mocked(query).mock.calls.filter((c) => re.test(String(c[0])));

    it('deletes exactly the rows the trim SELECT named, and nothing else', async () => {
      trimFinds(['old-3', 'old-2', 'old-1']);
      await saveRevision('customer', 'cust-1', { note: 'ใหม่' });

      const deletes = callsMatching(/^\s*DELETE/i);
      expect(deletes).toHaveLength(1);
      const [sql, params] = deletes[0];
      expect(String(sql).replace(/\s+/g, ' ')).toContain('DELETE FROM revisions');
      // Scoped to the entity as well as to the ids: a DELETE against history
      // must not be able to reach another entity's rows even if the id list
      // were wrong.
      expect(String(sql)).toContain('WHERE entityType = ? AND entityId = ?');
      expect(params).toEqual(['customer', 'cust-1', 'old-3', 'old-2', 'old-1']);
    });

    it('issues NO delete when the entity is still under its ceiling', async () => {
      trimFinds([]);
      await saveRevision('customer', 'cust-1', { note: 'ใหม่' });
      expect(callsMatching(/^\s*DELETE/i)).toHaveLength(0);
    });

    it('asks for the rows PAST the ceiling — newest kept, oldest first out', async () => {
      trimFinds([]);
      await saveRevision('customer', 'cust-1', { note: 'ใหม่' });
      const [sql, params] = callsMatching(/^\s*SELECT/i)[0];
      const flat = String(sql).replace(/\s+/g, ' ');
      // Newest-first ordering + OFFSET <keep> ⇒ every row returned is older
      // than every row kept.
      expect(flat).toContain('ORDER BY (id = ?) DESC, createdAt DESC, id DESC');
      expect(flat).toContain('LIMIT ? OFFSET ?');
      expect(params!.slice(0, 2)).toEqual(['customer', 'cust-1']);
      expect(params![params!.length - 1]).toBe(REVISION_KEEP.customer);
    });

    it('breaks a createdAt tie on the primary key, so the same row is trimmed every run', async () => {
      // `revisions.createdAt` is a VARCHAR ISO string with millisecond
      // precision: two snapshots written in the same millisecond share it
      // exactly. `ORDER BY createdAt DESC` alone would leave which of them is
      // trimmed to the optimizer.
      trimFinds([]);
      await saveRevision('content', 'c1', { title: 'เดิม' });
      const sql = String(callsMatching(/^\s*SELECT/i)[0][0]).replace(/\s+/g, ' ');
      expect(sql).toContain('createdAt DESC, id DESC');
    });

    it('pins the snapshot it just wrote to the front, so a clock skew cannot trim it', async () => {
      // The ISO timestamps come from whichever serverless instance served the
      // request. A clock a few ms behind another instance's would otherwise
      // let a brand-new snapshot be the oldest row in the window and be
      // thrown away the instant it was written.
      trimFinds([]);
      await saveRevision('customer', 'cust-1', { note: 'ใหม่' });
      const insertedId = vi.mocked(query).mock.calls[0][1]![0];
      const [sql, params] = callsMatching(/^\s*SELECT/i)[0];
      expect(String(sql)).toContain('(id = ?) DESC');
      expect(params![2]).toBe(insertedId);
    });

    it('is scoped per (entityType, entityId) — one customer never trims another\'s history', async () => {
      trimFinds(['old-1']);
      await saveRevision('customer', 'cust-A', { note: 'ก' });
      for (const call of vi.mocked(query).mock.calls.slice(1)) {
        expect(call[1]).toContain('customer');
        expect(call[1]).toContain('cust-A');
        expect(call[1]).not.toContain('cust-B');
        expect(call[1]).not.toContain('product');
      }
    });

    it('uses a different ceiling per entity type, largest snapshots kept shallowest', async () => {
      // contents hold full rich-text HTML and are individually the biggest
      // rows in the table; a customer note is capped at 2000 characters.
      expect(REVISION_KEEP.content).toBeLessThan(REVISION_KEEP.customer);
      expect(REVISION_KEEP.customer).toBeLessThan(REVISION_KEEP.product);
      for (const n of Object.values(REVISION_KEEP)) expect(n).toBeGreaterThan(0);
    });

    it('trims through the transaction connection when one is passed', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[{ id: 'old-1' }]]) };
      await saveRevision('customer', 'cust-1', { note: 'ใหม่' }, conn);
      // INSERT, trim SELECT, trim DELETE — all on the transaction, so a
      // rollback takes the deletion of real history with it.
      expect(query).not.toHaveBeenCalled();
      expect(conn.query.mock.calls.map((c: unknown[]) => String(c[0]).trim().split(' ')[0].toUpperCase()))
        .toEqual(['INSERT', 'SELECT', 'DELETE']);
    });
  });

  describe('listRevisions', () => {
    it('maps rows and filters by entity (newest-first via SQL)', async () => {
      vi.mocked(query).mockResolvedValue([
        [{ id: 'r1', entityType: 'content', entityId: 'c1', data: '{"t":1}', createdAt: '2026-01-02' }],
      ] as any);
      const rows = await listRevisions('content', 'c1');
      expect(rows).toEqual([
        { id: 'r1', entityType: 'content', entityId: 'c1', data: { t: 1 }, createdAt: '2026-01-02' },
      ]);
      const [sql, params] = vi.mocked(query).mock.calls[0];
      expect(sql).toContain('WHERE entityType = ? AND entityId = ?');
      expect(sql).toContain('ORDER BY createdAt DESC');
      expect(params).toEqual(['content', 'c1']);
    });

    it('parses data as string OR object, and degrades corrupt JSON to null (no throw)', async () => {
      vi.mocked(query).mockResolvedValue([
        [
          { id: 'r1', entityType: 'product', entityId: 'p1', data: { already: 'object' }, createdAt: 'a' },
          { id: 'r2', entityType: 'product', entityId: 'p1', data: 'not json{', createdAt: 'b' },
          { id: 'r3', entityType: 'product', entityId: 'p1', data: null, createdAt: 'c' },
        ],
      ] as any);
      const rows = await listRevisions('product', 'p1');
      expect(rows[0].data).toEqual({ already: 'object' });
      expect(rows[1].data).toBeNull();
      expect(rows[2].data).toBeNull();
    });
  });

  describe('getRevision', () => {
    it('returns the mapped revision when found', async () => {
      vi.mocked(query).mockResolvedValue([
        [{ id: 'r1', entityType: 'document', entityId: 'd1', data: '{"x":2}', createdAt: 't' }],
      ] as any);
      expect(await getRevision('r1')).toEqual({
        id: 'r1', entityType: 'document', entityId: 'd1', data: { x: 2 }, createdAt: 't',
      });
    });

    it('returns null when not found', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getRevision('nope')).toBeNull();
    });
  });
});
