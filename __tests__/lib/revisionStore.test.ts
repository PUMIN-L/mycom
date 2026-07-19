// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';
import { saveRevision, listRevisions, getRevision } from '@/app/lib/revisionStore';

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
