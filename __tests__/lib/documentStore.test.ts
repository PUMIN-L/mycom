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
    it('throws "Document not found" and issues no UPDATE when missing', async () => {
      mockedQuery.mockResolvedValue([[]] as any); // getDocument -> not found

      await expect(updateDocument('nope', { title: 'X' })).rejects.toThrow('Document not found');
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
