// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. query() resolves to a tuple [rows, fields] for reads and
// [{ affectedRows, insertId }] for writes — set per-test below.
// updateDocument snapshots the previous value via revisionStore before writing;
// stub it so it doesn't add a query the call-order assertions don't expect.
vi.mock('@/app/lib/revisionStore', () => ({ saveRevision: vi.fn() }));
import { saveRevision } from '@/app/lib/revisionStore';

vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
import { query } from '@/app/lib/db';

// getAllDocuments is wrapped in next/cache's unstable_cache. Make it
// pass-through so each call re-runs the real query against the mock above —
// otherwise the second call in a test would be served the first call's rows.
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));

import {
  getAllDocuments,
  getDocument,
  addDocument,
  updateDocument,
  deleteDocument,
} from '@/app/lib/documentStore';
import type { DocumentData } from '@/app/lib/documentStore';

const mockedQuery = vi.mocked(query);
const callArgs = (i = 0) => mockedQuery.mock.calls[i] as [string, unknown[]];

const fullRow = {
  id: 'd-1',
  title: 'Doc One',
  description: 'A description',
  pdfUrl: 'https://x/one.pdf',
  coverUrl: 'https://x/one.png',
  createdAt: '2026-01-01T00:00:00Z',
  sortOrder: 5,
};

describe('documentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllDocuments', () => {
    it('maps every row and orders by sortOrder ASC then createdAt DESC', async () => {
      mockedQuery.mockResolvedValue([[fullRow]] as any);

      const result = await getAllDocuments();

      expect(callArgs(0)[0]).toContain('SELECT * FROM documents');
      expect(callArgs(0)[0]).toContain('ORDER BY sortOrder ASC, createdAt DESC');
      expect(result).toEqual([
        {
          id: 'd-1',
          title: 'Doc One',
          description: 'A description',
          pdfUrl: 'https://x/one.pdf',
          coverUrl: 'https://x/one.png',
          createdAt: '2026-01-01T00:00:00Z',
          sortOrder: 5,
        } satisfies DocumentData,
      ]);
    });

    it('applies defaults for a null description and missing sortOrder', async () => {
      const row = { ...fullRow, description: null, sortOrder: undefined };
      mockedQuery.mockResolvedValue([[row]] as any);

      const [doc] = await getAllDocuments();
      expect(doc.description).toBe(''); // row.description || ""
      expect(doc.sortOrder).toBe(0); // row.sortOrder || 0
    });

    it('returns an empty array when there are no documents', async () => {
      mockedQuery.mockResolvedValue([[]] as any);
      expect(await getAllDocuments()).toEqual([]);
    });
  });

  describe('getDocument', () => {
    it('returns the mapped document when found', async () => {
      mockedQuery.mockResolvedValue([[fullRow]] as any);

      const result = await getDocument('d-1');
      expect(callArgs(0)[0]).toContain('SELECT * FROM documents WHERE id = ?');
      expect(callArgs(0)[1]).toEqual(['d-1']);
      expect(result?.id).toBe('d-1');
      expect(result?.title).toBe('Doc One');
    });

    it('returns null when no row matches', async () => {
      mockedQuery.mockResolvedValue([[]] as any);
      expect(await getDocument('missing')).toBeNull();
    });
  });

  describe('addDocument', () => {
    it('inserts with the correct SQL and positional params', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 1, insertId: 0 }] as any);

      const doc: DocumentData = {
        id: 'd-2',
        title: 'New Doc',
        description: 'desc',
        pdfUrl: 'https://x/new.pdf',
        coverUrl: 'https://x/new.png',
        createdAt: '2026-03-03',
        sortOrder: 2,
      };
      await addDocument(doc);

      const [sql, params] = callArgs(0);
      expect(sql).toContain('INSERT INTO documents');
      // Column order: id, title, description, pdfUrl, coverUrl, createdAt, sortOrder.
      expect(params).toEqual([
        'd-2',
        'New Doc',
        'desc',
        'https://x/new.pdf',
        'https://x/new.png',
        '2026-03-03',
        2,
      ]);
    });
  });

  describe('updateDocument', () => {
    it('throws "ไม่พบเอกสารนี้" and issues no UPDATE when missing', async () => {
      mockedQuery.mockResolvedValue([[]] as any); // getDocument -> not found

      await expect(updateDocument('nope', { title: 'X' })).rejects.toThrow('ไม่พบเอกสารนี้');
      expect(mockedQuery).toHaveBeenCalledTimes(1); // only the SELECT ran
    });

    it('updates only the supplied columns with params in declaration order + id last', async () => {
      mockedQuery
        .mockResolvedValueOnce([[fullRow]] as any) // getDocument SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // UPDATE

      await updateDocument('d-1', { title: 'Renamed', sortOrder: 9 });

      const [sql, params] = callArgs(1);
      expect(sql).toContain('UPDATE documents SET');
      expect(sql).toContain('title = ?');
      expect(sql).toContain('sortOrder = ?');
      expect(sql).not.toContain('description = ?');
      expect(sql).not.toContain('pdfUrl = ?');
      // sets are pushed in source order (title before sortOrder), id appended last.
      expect(params).toEqual(['Renamed', 9, 'd-1']);
    });

    it('can update every column at once in the documented order', async () => {
      mockedQuery
        .mockResolvedValueOnce([[fullRow]] as any)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any);

      await updateDocument('d-1', {
        title: 't',
        description: 'd',
        pdfUrl: 'p',
        coverUrl: 'c',
        sortOrder: 3,
      });

      const [sql, params] = callArgs(1);
      expect(sql).toContain('title = ?, description = ?, pdfUrl = ?, coverUrl = ?, sortOrder = ?');
      expect(params).toEqual(['t', 'd', 'p', 'c', 3, 'd-1']);
    });

    it('issues no UPDATE when the partial has no known columns', async () => {
      mockedQuery.mockResolvedValueOnce([[fullRow]] as any); // getDocument only

      await updateDocument('d-1', {});
      expect(mockedQuery).toHaveBeenCalledTimes(1); // no UPDATE query
    });
  });

  // A revision is only worth writing when the value it snapshots differs from
  // the value about to be written over it. The edit form posts title AND
  // description on every save, so `sets.length > 0` — the old condition — was
  // true even for a save that changed nothing, and each of those spent one of
  // the REVISION_KEEP.document = 20 slots this document's history has.
  describe('updateDocument — no change, no snapshot', () => {
    const stubUpdate = (row: Record<string, unknown> = fullRow) => {
      mockedQuery
        .mockResolvedValueOnce([[row]] as any) // getDocument SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // UPDATE
    };

    // What "opened the document and pressed save without touching it" posts.
    const unchangedPayload = { title: 'Doc One', description: 'A description' };

    it('writes NO revision when every posted field already matches the row', async () => {
      stubUpdate();

      await updateDocument('d-1', unchangedPayload);

      expect(saveRevision).not.toHaveBeenCalled();
      // Only history is skipped — the UPDATE is built exactly as before.
      const [sql, params] = callArgs(1);
      expect(sql).toContain('UPDATE documents SET title = ?, description = ? WHERE id = ?');
      expect(params).toEqual(['Doc One', 'A description', 'd-1']);
    });

    const realChanges: Array<[string, Partial<DocumentData>]> = [
      ['title', { title: 'Renamed' }],
      ['description', { description: 'A different description' }],
      ['pdfUrl', { pdfUrl: 'https://x/two.pdf' }],
      ['coverUrl', { coverUrl: 'https://x/two.png' }],
      ['sortOrder', { sortOrder: 9 }],
    ];

    it.each(realChanges)(
      'writes exactly ONE revision when %s genuinely changes',
      async (_label, patch) => {
        stubUpdate();

        await updateDocument('d-1', { ...unchangedPayload, ...patch });

        expect(saveRevision).toHaveBeenCalledTimes(1);
        // The snapshot is of the PREVIOUS value, so it can restore it.
        expect(saveRevision).toHaveBeenCalledWith(
          'document',
          'd-1',
          expect.objectContaining({ title: 'Doc One', description: 'A description' })
        );
      }
    );

    it('writes NO revision when the only difference is markup the sanitizer strips', async () => {
      stubUpdate();

      await updateDocument('d-1', {
        title: 'Doc One<script>evil()</script>',
        description: '<b>A description</b>',
      });

      // What the UPDATE writes is identical to what is stored, so a snapshot
      // of it could restore nothing.
      expect(saveRevision).not.toHaveBeenCalled();
      expect(callArgs(1)[1]).toEqual(['Doc One', 'A description', 'd-1']);
    });

    it('treats a stored NULL description and an incoming empty string as the same value', async () => {
      stubUpdate({ ...fullRow, description: null });

      await updateDocument('d-1', { title: 'Doc One', description: '' });

      // mapDocumentRow reads a NULL description back as "", so writing "" over
      // it changes nothing any reader of this row can see.
      expect(saveRevision).not.toHaveBeenCalled();
      expect(callArgs(1)[0]).toContain('description = ?');
    });
  });

  describe('deleteDocument', () => {
    it('runs a DELETE with the id as the sole param', async () => {
      mockedQuery.mockResolvedValue([{ affectedRows: 1 }] as any);

      await deleteDocument('d-1');
      const [sql, params] = callArgs(0);
      expect(sql).toContain('DELETE FROM documents WHERE id = ?');
      expect(params).toEqual(['d-1']);
    });
  });
});
