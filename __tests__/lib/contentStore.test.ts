// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. query() resolves to a tuple [rows, fields] for reads and
// [{ affectedRows, insertId }] for writes — set per-test below.
// updateContent snapshots the previous value via revisionStore before writing;
// stub it so it doesn't add a query the call-order assertions don't expect.
vi.mock('@/app/lib/revisionStore', () => ({ saveRevision: vi.fn() }));
import { saveRevision } from '@/app/lib/revisionStore';

// addContent/updateContent's productId-conflict check runs inside
// withTransaction — a single shared `conn` whose queries are scripted
// per-test (no matching productId row = FOR UPDATE finds nothing = no conflict).
const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
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
  ContentProductConflictError,
} from '@/app/lib/contentStore';
import type { ContentBlock, ContentData } from '@/app/lib/contentStore';

const mockedQuery = vi.mocked(query);

// Helper: last SQL + params passed to query on a given (0-based) call.
const callArgs = (i = 0) => mockedQuery.mock.calls[i] as [string, unknown[]];

// addContent always runs its productId-conflict check first (via conn.query)
// before the INSERT — stub that check to "no conflict" and route conn.query
// calls to the same assertable shape the old tests used against `query`.
function stubNoConflict(insertResult: unknown = [{ affectedRows: 1 }]) {
  conn.query.mockReset();
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id FROM contents WHERE productId')) return [[]];
    return insertResult;
  });
}
const connInsertCall = () =>
  conn.query.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO contents')) as [string, unknown[]];

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
      stubNoConflict();

      const result = await addContent(base);

      const [sql, params] = connInsertCall();
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
      stubNoConflict();

      const result = await addContent({
        ...base,
        blocks: [
          { id: 'b-1', type: 'text', content: '<p>safe</p><script>alert(1)</script>' },
        ],
      });

      const storedJson = connInsertCall()[1][2] as string;
      expect(storedJson).not.toContain('<script>');
      expect(storedJson).not.toContain('alert(1)');
      expect(storedJson).toContain('<p>safe</p>');

      // Returned blocks are the same sanitized ones.
      expect(result.blocks[0].content).not.toContain('script');
      expect(result.blocks[0].content).toContain('<p>safe</p>');
    });

    it('leaves blocks without a `content` field untouched and defaults productId to null', async () => {
      stubNoConflict();

      const imageBlock = { id: 'img', type: 'image' as const, imageUrl: 'https://x/y.png' };
      const result = await addContent({
        id: 'c-2',
        title: 'NoProduct',
        blocks: [imageBlock],
        createdAt: '2026-02-02',
        // productId intentionally omitted
      });

      expect(connInsertCall()[1][4]).toBeNull(); // productId ?? null
      expect(result.blocks[0]).toEqual(imageBlock); // image block passes through unchanged
    });

    it('sanitizes and truncates a youtube block\'s URL instead of storing it raw', async () => {
      stubNoConflict();

      const result = await addContent({
        ...base,
        blocks: [
          { id: 'yt-1', type: 'youtube', youtubeUrl: '<b>https://youtu.be/dQw4w9WgXcQ</b>' + 'x'.repeat(600) },
        ],
      });

      const storedBlocks = JSON.parse(connInsertCall()[1][2] as string);
      expect(storedBlocks[0].youtubeUrl).not.toContain('<b>');
      expect(storedBlocks[0].youtubeUrl.length).toBe(500);
      expect(result.blocks[0].youtubeUrl).not.toContain('<b>');
    });

    it('leaves a youtube block with no youtubeUrl field untouched', async () => {
      stubNoConflict();

      const result = await addContent({
        ...base,
        blocks: [{ id: 'yt-1', type: 'youtube' }],
      });

      expect(result.blocks[0]).toEqual({ id: 'yt-1', type: 'youtube' });
    });

    it('rejects when the product already has a DIFFERENT content linked (race-safe check)', async () => {
      conn.query.mockReset();
      conn.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM contents WHERE productId')) return [[{ id: 'other-content' }]];
        return [{ affectedRows: 1 }];
      });

      await expect(addContent(base)).rejects.toThrow(ContentProductConflictError);
      expect(conn.query.mock.calls.some((c) => (c[0] as string).includes('INSERT INTO contents'))).toBe(false);
    });

    it('skips the conflict check entirely when no productId is given', async () => {
      stubNoConflict();
      await addContent({ ...base, productId: undefined });
      expect(
        conn.query.mock.calls.some((c) => (c[0] as string).includes('SELECT id FROM contents WHERE productId'))
      ).toBe(false);
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

    it('degrades a CORRUPT blocks JSON to an empty list instead of throwing (one bad row must not 500 the page)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedQuery.mockResolvedValue([
        [{ id: 'c1', title: 'T', blocks: 'not-valid-json{', createdAt: 't', productId: null }],
      ] as any);
      const result = await getContent('c1');
      expect(result?.blocks).toEqual([]);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('degrades a non-array parsed blocks value to an empty list', async () => {
      mockedQuery.mockResolvedValue([
        [{ id: 'c1', title: 'T', blocks: '{"not":"an array"}', createdAt: 't', productId: null }],
      ] as any);
      const result = await getContent('c1');
      expect(result?.blocks).toEqual([]);
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
    it('returns lightweight meta and never reads the heavy blocks column', async () => {
      const rows = [
        { id: 'c-1', title: 'T', createdAt: '2026-01-01', productId: 'p-1' },
      ];
      mockedQuery.mockResolvedValue([rows] as any);

      const result = await getAllContentsMeta();

      // The blocks column must stay out of the projection: this query runs on
      // every public /showcase/[id] view and every sitemap fetch, so selecting
      // it means a full-table blob scan per pageview.
      expect(callArgs(0)[0]).toContain('SELECT id, title, createdAt, productId');
      expect(callArgs(0)[0]).not.toContain('blocks');
      expect(callArgs(0)[0]).toContain('ORDER BY createdAt DESC');

      expect(result[0]).toEqual({
        id: 'c-1',
        title: 'T',
        createdAt: '2026-01-01',
        productId: 'p-1',
      });
      expect(result[0]).not.toHaveProperty('blocks');
    });

    it('normalises a missing productId to null', async () => {
      mockedQuery.mockResolvedValue([
        [{ id: 'c-2', title: 'X', createdAt: '2026-01-02', productId: null }],
      ] as any);

      const [meta] = await getAllContentsMeta();
      expect(meta.productId).toBeNull();
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

    it('rejects re-linking to a product another content already owns (race-safe check)', async () => {
      mockedQuery.mockResolvedValueOnce([[existingRow]] as any); // getContent
      conn.query.mockReset();
      conn.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM contents WHERE productId')) return [[{ id: 'other-content' }]];
        return [{ affectedRows: 1 }];
      });

      await expect(updateContent('c-1', { productId: 'p-taken' })).rejects.toThrow(
        ContentProductConflictError
      );
      expect(conn.query.mock.calls.some((c) => (c[0] as string).startsWith('UPDATE contents'))).toBe(false);
      // No UPDATE ran at all (plain query() path is only used for the
      // non-conflicting case) — the plain mockedQuery only saw the SELECT.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('allows re-linking to a product nothing else has claimed', async () => {
      mockedQuery.mockResolvedValueOnce([[existingRow]] as any); // getContent
      conn.query.mockReset();
      conn.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM contents WHERE productId')) return [[]];
        return [{ affectedRows: 1 }];
      });

      const result = await updateContent('c-1', { productId: 'p-free' });
      expect(result?.productId).toBe('p-free');
      const updateCall = conn.query.mock.calls.find((c) => (c[0] as string).startsWith('UPDATE contents'));
      expect(updateCall).toBeDefined();
      // Snapshot runs through the transaction's own connection, not the
      // pool-level query — a retried attempt (withTransaction retries the
      // whole callback on a transient error) can't leave a duplicate behind.
      expect(saveRevision).toHaveBeenCalledWith('content', 'c-1', expect.anything(), conn);
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

  // A revision is only worth writing when the value it snapshots differs from
  // the value about to be written over it. The edit form posts EVERY field on
  // every save, so "which fields were supplied" said "all of them" even for a
  // save that changed nothing — and `contents.blocks` is the biggest thing in
  // `revisions`, with only REVISION_KEEP.content = 5 slots per content before
  // the genuinely older versions are trimmed away.
  describe('updateContent — no change, no snapshot', () => {
    const existingRow = {
      id: 'c-1',
      title: 'Old',
      blocks: JSON.stringify([{ id: 'b', type: 'text', content: '<p>old</p>' }]),
      createdAt: '2026-01-01',
      productId: 'p-old',
    };

    // What "opened the content and pressed save without touching it" posts.
    const unchangedPayload: Partial<ContentData> = {
      title: 'Old',
      blocks: [{ id: 'b', type: 'text', content: '<p>old</p>' }],
      createdAt: '2026-01-01',
      productId: 'p-old',
    };

    const stubUpdate = () => {
      mockedQuery
        .mockResolvedValueOnce([[existingRow]] as any) // getContent SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // UPDATE
    };

    it('writes NO revision when every posted field already matches the row', async () => {
      stubUpdate();

      const result = await updateContent('c-1', unchangedPayload);

      expect(saveRevision).not.toHaveBeenCalled();
      // Only history is skipped — the UPDATE is built exactly as before.
      const [sql, params] = callArgs(1);
      expect(sql).toBe('UPDATE contents SET title = ?, blocks = ?, createdAt = ?, productId = ? WHERE id = ?');
      expect(params[0]).toBe('Old');
      expect(params[3]).toBe('p-old');
      // Same product as before, so no re-link transaction was opened either.
      expect(conn.query).not.toHaveBeenCalled();
      expect(result?.title).toBe('Old');
    });

    const realChanges: Array<[string, Partial<ContentData>]> = [
      ['title', { title: 'New title' }],
      ['blocks', { blocks: [{ id: 'b', type: 'text', content: '<p>rewritten</p>' }] }],
      ['a block added to the end', {
        blocks: [
          { id: 'b', type: 'text', content: '<p>old</p>' },
          { id: 'b2', type: 'image', imageUrl: 'https://x/y.png' },
        ],
      }],
      ['createdAt', { createdAt: '2026-05-05' }],
      ['productId (unlinked)', { productId: null }],
    ];

    it.each(realChanges)(
      'writes exactly ONE revision when %s genuinely changes',
      async (_label, patch) => {
        stubUpdate();

        await updateContent('c-1', { ...unchangedPayload, ...patch });

        expect(saveRevision).toHaveBeenCalledTimes(1);
        // The snapshot is of the PREVIOUS value, so it can restore it.
        expect(saveRevision).toHaveBeenCalledWith(
          'content',
          'c-1',
          expect.objectContaining({ title: 'Old', createdAt: '2026-01-01' })
        );
      }
    );

    it('writes NO revision when the blocks are rebuilt as new objects with the same values', async () => {
      stubUpdate();

      await updateContent('c-1', {
        ...unchangedPayload,
        // Same block, freshly constructed, keys in a different order — what a
        // round-trip through the editor's state produces. Object identity and
        // key order are both meaningless here; the value is what matters.
        blocks: [{ content: '<p>old</p>', type: 'text', id: 'b' } as ContentBlock],
      });

      expect(saveRevision).not.toHaveBeenCalled();
      expect(callArgs(1)[0]).toContain('blocks = ?');
    });

    it('writes NO revision when the only difference is markup the sanitizer strips', async () => {
      stubUpdate();

      await updateContent('c-1', {
        ...unchangedPayload,
        title: 'Old<script>evil()</script>',
        blocks: [{ id: 'b', type: 'text', content: '<p>old</p><script>evil()</script>' }],
      });

      // The value the UPDATE writes is identical to the stored one, so a
      // snapshot of it could restore nothing.
      expect(saveRevision).not.toHaveBeenCalled();
      const params = callArgs(1)[1];
      expect(params[0]).toBe('Old');
      expect(params[1]).toBe(JSON.stringify([{ id: 'b', type: 'text', content: '<p>old</p>' }]));
    });

    it('still snapshots a genuine re-link, and only after the FOR UPDATE conflict check has passed', async () => {
      mockedQuery.mockResolvedValueOnce([[existingRow]] as any); // getContent
      conn.query.mockReset();
      conn.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM contents WHERE productId')) return [[]];
        return [{ affectedRows: 1 }];
      });

      // Everything else identical — only the product link moves.
      await updateContent('c-1', { ...unchangedPayload, productId: 'p-free' });

      expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(saveRevision).toHaveBeenCalledTimes(1);
      // Through the transaction's own connection, as before.
      expect(saveRevision).toHaveBeenCalledWith('content', 'c-1', expect.anything(), conn);
      // Conflict check FIRST, then the snapshot — the dirty check must not
      // have reordered them.
      expect(conn.query.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(saveRevision).mock.invocationCallOrder[0]
      );
      expect(conn.query.mock.calls.some((c) => (c[0] as string).startsWith('UPDATE contents'))).toBe(true);
    });

    it('still rejects a re-link to a product another content owns, even when nothing else changed', async () => {
      mockedQuery.mockResolvedValueOnce([[existingRow]] as any); // getContent
      conn.query.mockReset();
      conn.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM contents WHERE productId')) return [[{ id: 'other-content' }]];
        return [{ affectedRows: 1 }];
      });

      await expect(
        updateContent('c-1', { ...unchangedPayload, productId: 'p-taken' })
      ).rejects.toThrow(ContentProductConflictError);

      expect(saveRevision).not.toHaveBeenCalled();
      expect(conn.query.mock.calls.some((c) => (c[0] as string).startsWith('UPDATE contents'))).toBe(false);
    });
  });
});
