// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. query() resolves to a tuple [rows, fields] for reads and
// [{ affectedRows, insertId }] for writes — set per-test below.
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
import { query } from '@/app/lib/db';

// NOTE: sanitizeHtml is deliberately NOT mocked. It is `server-only` (mocked to
// {} in setup.ts) but otherwise pure JS (sanitize-html), so we let the REAL
// sanitizer run and assert it strips <script> from stored/returned block HTML.
import {
  addContent,
  getContent,
  getAllContents,
  getAllContentsMeta,
  getContentByProductId,
  deleteContent,
  updateContent,
} from '@/app/lib/contentStore';
import type { ContentData } from '@/app/lib/contentStore';

const mockedQuery = vi.mocked(query);

// Helper: last SQL + params passed to query on a given (0-based) call.
const callArgs = (i = 0) => mockedQuery.mock.calls[i] as [string, unknown[]];

describe('contentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addContent', () => {
    const base: ContentData = {
      id: 'c-1',
      title: 'Hello',
      blocks: [{ id: 'b-1', type: 'text', content: '<p>ok</p>' }],
      createdAt: '2026-01-01T00:00:00Z',
      productId: 'p-9',
    };

    it('inserts with the correct SQL and params and returns sanitized content', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 1, insertId: 0 }] as any);

      const result = await addContent(base);

      const [sql, params] = callArgs(0);
      expect(sql).toContain('INSERT INTO contents');
      // Positional params: id, title, JSON(blocks), createdAt, productId.
      expect(params[0]).toBe('c-1');
      expect(params[1]).toBe('Hello');
      expect(typeof params[2]).toBe('string'); // blocks are JSON-stringified
      expect(params[3]).toBe('2026-01-01T00:00:00Z');
      expect(params[4]).toBe('p-9');

      // Returns the content with (sanitized) blocks.
      expect(result.id).toBe('c-1');
      expect(result.blocks[0].content).toContain('<p>ok</p>');
    });

    it('sanitizes rich-text HTML (strips <script>) before storing and returning', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 1 }] as any);

      const result = await addContent({
        ...base,
        blocks: [
          { id: 'b-1', type: 'text', content: '<p>safe</p><script>alert(1)</script>' },
        ],
      });

      const storedJson = callArgs(0)[1][2] as string;
      expect(storedJson).not.toContain('<script>');
      expect(storedJson).not.toContain('alert(1)');
      expect(storedJson).toContain('<p>safe</p>');

      // Returned blocks are the same sanitized ones.
      expect(result.blocks[0].content).not.toContain('script');
      expect(result.blocks[0].content).toContain('<p>safe</p>');
    });

    it('leaves blocks without a `content` field untouched and defaults productId to null', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 1 }] as any);

      const imageBlock = { id: 'img', type: 'image' as const, imageUrl: 'https://x/y.png' };
      const result = await addContent({
        id: 'c-2',
        title: 'NoProduct',
        blocks: [imageBlock],
        createdAt: '2026-02-02',
        // productId intentionally omitted
      });

      expect(callArgs(0)[1][4]).toBeNull(); // productId ?? null
      expect(result.blocks[0]).toEqual(imageBlock); // image block passes through unchanged
    });
  });

  describe('getContent', () => {
    it('returns the mapped content, parsing blocks from a JSON string', async () => {
      const row = {
        id: 'c-1',
        title: 'T',
        blocks: JSON.stringify([{ id: 'b', type: 'text', content: '<p>hi</p>' }]),
        createdAt: '2026-01-01',
        productId: 'p-1',
      };
      mockedQuery.mockResolvedValue([[row]] as any);

      const result = await getContent('c-1');

      expect(callArgs(0)[0]).toContain('SELECT * FROM contents WHERE id = ?');
      expect(callArgs(0)[1]).toEqual(['c-1']);
      expect(result).toEqual({
        id: 'c-1',
        title: 'T',
        blocks: [{ id: 'b', type: 'text', content: '<p>hi</p>' }],
        createdAt: '2026-01-01',
        productId: 'p-1',
      });
    });

    it('parses blocks when the driver returns an already-parsed object', async () => {
      const row = {
        id: 'c-1',
        title: 'T',
        blocks: [{ id: 'b', type: 'image', imageUrl: 'u' }], // already an array/object
        createdAt: '2026-01-01',
        productId: null,
      };
      mockedQuery.mockResolvedValue([[row]] as any);

      const result = await getContent('c-1');
      expect(result?.blocks).toEqual([{ id: 'b', type: 'image', imageUrl: 'u' }]);
      expect(result?.productId).toBeNull(); // productId ?? null
    });

    it('treats a falsy blocks column as an empty array', async () => {
      mockedQuery.mockResolvedValue([[{ id: 'c', title: 'x', blocks: null, createdAt: 'd' }]] as any);
      const result = await getContent('c');
      expect(result?.blocks).toEqual([]);
      expect(result?.productId).toBeNull(); // missing productId -> null
    });

    it('returns undefined when no row matches', async () => {
      mockedQuery.mockResolvedValue([[]] as any);
      expect(await getContent('missing')).toBeUndefined();
    });
  });

  describe('getAllContents', () => {
    it('maps every row (ordered by createdAt DESC)', async () => {
      const rows = [
        { id: 'a', title: 'A', blocks: JSON.stringify([{ id: '1', type: 'text' }]), createdAt: '2', productId: null },
        { id: 'b', title: 'B', blocks: [{ id: '2', type: 'image' }], createdAt: '1', productId: 'p' },
      ];
      mockedQuery.mockResolvedValue([rows] as any);

      const result = await getAllContents();
      expect(callArgs(0)[0]).toContain('ORDER BY createdAt DESC');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a');
      expect(result[0].blocks).toEqual([{ id: '1', type: 'text' }]);
      expect(result[1].blocks).toEqual([{ id: '2', type: 'image' }]);
    });

    it('returns an empty array when there are no rows', async () => {
      mockedQuery.mockResolvedValue([[]] as any);
      expect(await getAllContents()).toEqual([]);
    });
  });

  describe('getAllContentsMeta', () => {
    it('returns lightweight meta with block COUNTS and does NOT ship full blocks', async () => {
      const blocks = [
        { id: '1', type: 'text', content: '<p>a</p>' },
        { id: '2', type: 'text', content: '<p>b</p>' },
        { id: '3', type: 'image', imageUrl: 'u' },
      ];
      const rows = [
        { id: 'c-1', title: 'T', blocks: JSON.stringify(blocks), createdAt: '2026-01-01', productId: 'p-1' },
      ];
      mockedQuery.mockResolvedValue([rows] as any);

      const result = await getAllContentsMeta();

      // Reads only the meta columns, not SELECT * (blocks still read to count).
      expect(callArgs(0)[0]).toContain('SELECT id, title, blocks, createdAt, productId');
      expect(callArgs(0)[0]).toContain('ORDER BY createdAt DESC');

      expect(result[0]).toEqual({
        id: 'c-1',
        title: 'T',
        createdAt: '2026-01-01',
        productId: 'p-1',
        textCount: 2,
        imageCount: 1,
      });
      // The heavy blocks payload is NOT included in the projection.
      expect(result[0]).not.toHaveProperty('blocks');
    });

    it('counts blocks when the driver hands back an already-parsed array', async () => {
      const rows = [
        {
          id: 'c-2',
          title: 'X',
          blocks: [
            { id: '1', type: 'image' },
            { id: '2', type: 'image' },
            { id: '3', type: 'text' },
          ],
          createdAt: '2026-01-02',
          productId: null,
        },
      ];
      mockedQuery.mockResolvedValue([rows] as any);

      const [meta] = await getAllContentsMeta();
      expect(meta.textCount).toBe(1);
      expect(meta.imageCount).toBe(2);
      expect(meta.productId).toBeNull();
    });

    it('treats a null blocks column as zero counts', async () => {
      mockedQuery.mockResolvedValue([[{ id: 'c', title: 't', blocks: null, createdAt: 'd', productId: null }]] as any);
      const [meta] = await getAllContentsMeta();
      expect(meta.textCount).toBe(0);
      expect(meta.imageCount).toBe(0);
    });
  });

  describe('getContentByProductId', () => {
    it('returns the mapped content for a product', async () => {
      const row = { id: 'c', title: 't', blocks: '[]', createdAt: 'd', productId: 'p-1' };
      mockedQuery.mockResolvedValue([[row]] as any);

      const result = await getContentByProductId('p-1');
      expect(callArgs(0)[0]).toContain('WHERE productId = ?');
      expect(callArgs(0)[0]).toContain('LIMIT 1');
      expect(callArgs(0)[1]).toEqual(['p-1']);
      expect(result?.id).toBe('c');
      expect(result?.blocks).toEqual([]);
    });

    it('returns undefined when the product has no content', async () => {
      mockedQuery.mockResolvedValue([[]] as any);
      expect(await getContentByProductId('none')).toBeUndefined();
    });
  });

  describe('deleteContent', () => {
    it('returns true when a row was deleted', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 1 }] as any);
      const ok = await deleteContent('c-1');
      expect(callArgs(0)[0]).toContain('DELETE FROM contents WHERE id = ?');
      expect(callArgs(0)[1]).toEqual(['c-1']);
      expect(ok).toBe(true);
    });

    it('returns false when nothing matched', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 0 }] as any);
      expect(await deleteContent('missing')).toBe(false);
    });
  });

  describe('updateContent', () => {
    const existingRow = {
      id: 'c-1',
      title: 'Old',
      blocks: JSON.stringify([{ id: 'b', type: 'text', content: '<p>old</p>' }]),
      createdAt: '2026-01-01',
      productId: 'p-old',
    };

    it('returns undefined and issues no UPDATE when the content is missing', async () => {
      mockedQuery.mockResolvedValue([[]] as any); // getContent -> not found

      const result = await updateContent('nope', { title: 'X' });
      expect(result).toBeUndefined();
      // Only the SELECT from getContent ran; no UPDATE.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('updates only the supplied columns and returns the merged content', async () => {
      mockedQuery
        .mockResolvedValueOnce([[existingRow]] as any) // getContent SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // UPDATE

      const result = await updateContent('c-1', { title: 'New Title' });

      // 2nd call is the UPDATE, touching ONLY the title column.
      const [sql, params] = callArgs(1);
      expect(sql).toContain('UPDATE contents SET title = ? WHERE id = ?');
      expect(sql).not.toContain('blocks =');
      expect(params).toEqual(['New Title', 'c-1']);

      expect(result).toEqual({
        id: 'c-1',
        title: 'New Title',
        blocks: [{ id: 'b', type: 'text', content: '<p>old</p>' }], // kept + re-sanitized
        createdAt: '2026-01-01',
        productId: 'p-old',
      });
    });

    it('sanitizes updated block HTML (strips <script>) in both the UPDATE and the return value', async () => {
      mockedQuery
        .mockResolvedValueOnce([[existingRow]] as any)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any);

      const result = await updateContent('c-1', {
        blocks: [{ id: 'b', type: 'text', content: '<p>keep</p><script>evil()</script>' }],
      });

      const storedJson = callArgs(1)[1][0] as string; // first SET value = blocks JSON
      expect(callArgs(1)[0]).toContain('blocks = ?');
      expect(storedJson).not.toContain('script');
      expect(storedJson).not.toContain('evil()');
      expect(result?.blocks[0].content).toContain('<p>keep</p>');
      expect(result?.blocks[0].content).not.toContain('script');
    });

    it('unlinks the product when productId is explicitly null', async () => {
      mockedQuery
        .mockResolvedValueOnce([[existingRow]] as any)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any);

      const result = await updateContent('c-1', { productId: null });
      const [sql, params] = callArgs(1);
      expect(sql).toContain('productId = ?');
      expect(params).toEqual([null, 'c-1']);
      expect(result?.productId).toBeNull();
    });

    it('issues no UPDATE when the partial is empty but still returns existing values', async () => {
      mockedQuery.mockResolvedValueOnce([[existingRow]] as any); // getContent only

      const result = await updateContent('c-1', {});
      expect(mockedQuery).toHaveBeenCalledTimes(1); // no UPDATE query
      expect(result).toEqual({
        id: 'c-1',
        title: 'Old',
        blocks: [{ id: 'b', type: 'text', content: '<p>old</p>' }],
        createdAt: '2026-01-01',
        productId: 'p-old',
      });
    });
  });
});
