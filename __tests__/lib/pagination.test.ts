// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pageList } from '@/app/lib/pagination';

describe('pageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('total <= 1', () => {
    it('returns an empty array when there are no pages', () => {
      expect(pageList(1, 0)).toEqual([]);
    });

    it('returns a single page', () => {
      expect(pageList(1, 1)).toEqual([1]);
    });
  });

  describe('small totals (no ellipsis)', () => {
    it('shows every page up to the 7-page threshold', () => {
      expect(pageList(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('shows every page for a mid-size small total regardless of current', () => {
      expect(pageList(4, 5)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('ellipsis / gap insertion (total > 7)', () => {
    it('current near the start collapses only the trailing gap', () => {
      expect(pageList(1, 10)).toEqual([1, 2, 3, '…', 8, 9, 10]);
    });

    it('current in the middle collapses both gaps into a window', () => {
      // keep = {1,2,3, 4,5,6, 8,9,10} → gap between 6 and 8
      expect(pageList(5, 10)).toEqual([1, 2, 3, 4, 5, 6, '…', 8, 9, 10]);
    });

    it('current near the end collapses only the leading gap', () => {
      // current+1 = 11 is out of range and filtered out
      expect(pageList(10, 10)).toEqual([1, 2, 3, '…', 8, 9, 10]);
    });

    it('inserts two "…" gaps: first-3 + window + last-3', () => {
      // total 12, current 6 → keep {1,2,3, 5,6,7, 10,11,12}
      expect(pageList(6, 12)).toEqual([1, 2, 3, '…', 5, 6, 7, '…', 10, 11, 12]);
    });
  });

  describe('no duplicate page numbers', () => {
    it('dedupes overlap between the leading block and the window', () => {
      // current 3 → window {2,3,4} overlaps leading {1,2,3}
      const result = pageList(3, 10);
      expect(result).toEqual([1, 2, 3, 4, '…', 8, 9, 10]);
      const numbers = result.filter((p): p is number => typeof p === 'number');
      expect(new Set(numbers).size).toBe(numbers.length);
    });
  });

  describe('no "…" when the kept pages are contiguous', () => {
    it('emits every page with no ellipsis when the window bridges the gap', () => {
      // total 8 (> 7), current 4 → keep {1..8} contiguous, no gap
      const result = pageList(4, 8);
      expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(result).not.toContain('…');
    });
  });
});
