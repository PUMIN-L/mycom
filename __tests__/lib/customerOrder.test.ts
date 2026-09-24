/**
 * /customers order (add-customer-note-updated-at): customers whose บันทึกลูกค้า
 * changed most recently first; customers with no note at all at the bottom.
 */
import { describe, it, expect } from 'vitest';
import {
  compareCustomersByNoteActivity,
  customerNoteActivityAt,
  hasCustomerNote,
  isNoteRecentlyUpdated,
  sortCustomersByNoteActivity,
} from '@/app/lib/customerOrder';

type Row = { id: string; note: string; createdAt?: string; noteUpdatedAt?: string | null };

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  note: 'มีบันทึก',
  createdAt: '2026-01-01T00:00:00.000Z',
  noteUpdatedAt: null,
  ...over,
});

const order = (rows: Row[]) => [...rows].sort(compareCustomersByNoteActivity).map((r) => r.id);

describe('compareCustomersByNoteActivity', () => {
  it('puts the most recently updated note first', () => {
    expect(
      order([
        row('old', { noteUpdatedAt: '2026-09-01T00:00:00.000Z' }),
        row('newest', { noteUpdatedAt: '2026-09-23T07:30:00.000Z' }),
        row('mid', { noteUpdatedAt: '2026-09-10T00:00:00.000Z' }),
      ])
    ).toEqual(['newest', 'mid', 'old']);
  });

  it('ranks by the NOTE update, not by when the customer was created', () => {
    // Created long ago but called yesterday beats created today, never called.
    expect(
      order([
        row('brand-new', {
          createdAt: '2026-09-23T00:00:00.000Z',
          noteUpdatedAt: '2026-09-23T00:00:00.000Z',
        }),
        row('long-time-customer', {
          createdAt: '2024-01-01T00:00:00.000Z',
          noteUpdatedAt: '2026-09-23T09:00:00.000Z',
        }),
      ])
    ).toEqual(['long-time-customer', 'brand-new']);
  });

  it('sends every customer with an empty note to the bottom, newest-created first among them', () => {
    expect(
      order([
        row('empty-old', { note: '', createdAt: '2026-01-01T00:00:00.000Z' }),
        row('noted', { noteUpdatedAt: '2020-01-01T00:00:00.000Z' }),
        row('empty-new', { note: '', createdAt: '2026-09-01T00:00:00.000Z' }),
      ])
    ).toEqual(['noted', 'empty-new', 'empty-old']);
  });

  it('treats a whitespace-only note as no note', () => {
    expect(order([row('blank', { note: '   \n ' }), row('noted')])).toEqual(['noted', 'blank']);
  });

  it('falls back to createdAt for a note with no stamp yet', () => {
    expect(
      order([
        row('stamped', { noteUpdatedAt: '2026-05-01T00:00:00.000Z' }),
        row('unstamped', { createdAt: '2026-06-01T00:00:00.000Z', noteUpdatedAt: null }),
      ])
    ).toEqual(['unstamped', 'stamped']);
  });

  it('is total and stable: an exact tie falls through to id', () => {
    const t = '2026-09-01T00:00:00.000Z';
    expect(order([row('b', { noteUpdatedAt: t }), row('a', { noteUpdatedAt: t })])).toEqual(['a', 'b']);
  });

  it('sorts an unparseable timestamp as oldest rather than throwing the order off', () => {
    expect(
      order([
        row('garbage', { noteUpdatedAt: 'not-a-date', createdAt: 'nope' }),
        row('real', { noteUpdatedAt: '2026-01-01T00:00:00.000Z' }),
      ])
    ).toEqual(['real', 'garbage']);
  });
});

// The page sorts through sortCustomersByNoteActivity (parse once per row) —
// the comparator re-parses on every comparison and cost ~40–70 ms for 6,000
// customers on each render. The two must never disagree about the order.
describe('sortCustomersByNoteActivity', () => {
  const mixed: Row[] = [
    row('empty-a', { note: '', createdAt: '2026-03-01T00:00:00.000Z' }),
    row('stamped-old', { noteUpdatedAt: '2025-01-01T00:00:00.000Z' }),
    row('unstamped', { createdAt: '2026-06-01T00:00:00.000Z', noteUpdatedAt: null }),
    row('blank', { note: '  ', createdAt: '2026-08-01T00:00:00.000Z' }),
    row('tie-b', { noteUpdatedAt: '2026-09-01T00:00:00.000Z' }),
    row('garbage', { noteUpdatedAt: 'x', createdAt: 'y' }),
    row('tie-a', { noteUpdatedAt: '2026-09-01T00:00:00.000Z' }),
    row('newest', { noteUpdatedAt: '2026-09-24T07:30:00.000Z' }),
  ];

  it('gives exactly the order the comparator gives', () => {
    expect(sortCustomersByNoteActivity(mixed).map((r) => r.id)).toEqual(order(mixed));
  });

  it('returns a new array and leaves the input (React state) untouched', () => {
    const before = mixed.map((r) => r.id);
    const sorted = sortCustomersByNoteActivity(mixed);
    expect(sorted).not.toBe(mixed);
    expect(mixed.map((r) => r.id)).toEqual(before);
  });
});

// The pastel-green row on /customers: note changed within the last 12 hours.
describe('isNoteRecentlyUpdated', () => {
  const NOW = Date.parse('2026-09-24T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

  it('is true inside 12 hours and false from 12 hours on', () => {
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: hoursAgo(0.5) }), NOW)).toBe(true);
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: hoursAgo(11.99) }), NOW)).toBe(true);
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: hoursAgo(12) }), NOW)).toBe(false);
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: hoursAgo(30) }), NOW)).toBe(false);
  });

  it('counts a stamp slightly ahead of the page clock — a note saved a moment ago', () => {
    // Server clock vs browser clock, and a `now` that only ticks each minute.
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: hoursAgo(-0.02) }), NOW)).toBe(true);
  });

  it('is false with no note, however recent the stamp', () => {
    expect(isNoteRecentlyUpdated(row('x', { note: '', noteUpdatedAt: hoursAgo(1) }), NOW)).toBe(false);
  });

  it('is false for an unparseable stamp rather than highlighting garbage', () => {
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: 'x', createdAt: 'y' }), NOW)).toBe(false);
  });

  it('falls back to createdAt like the column does', () => {
    expect(isNoteRecentlyUpdated(row('x', { noteUpdatedAt: null, createdAt: hoursAgo(2) }), NOW)).toBe(true);
  });
});

describe('customerNoteActivityAt / hasCustomerNote', () => {
  it('is null when there is no note, whatever the stamp says', () => {
    expect(customerNoteActivityAt(row('x', { note: '', noteUpdatedAt: '2026-01-01T00:00:00.000Z' }))).toBeNull();
    expect(hasCustomerNote({ note: '' })).toBe(false);
  });

  it('prefers the stamp, then createdAt', () => {
    expect(customerNoteActivityAt(row('x', { noteUpdatedAt: '2026-09-01T00:00:00.000Z' }))).toBe(
      '2026-09-01T00:00:00.000Z'
    );
    expect(customerNoteActivityAt(row('x', { noteUpdatedAt: null }))).toBe('2026-01-01T00:00:00.000Z');
  });
});
