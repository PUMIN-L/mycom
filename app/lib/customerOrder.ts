import type { Customer } from "./types";

type NoteActivityFields = Pick<Customer, "id" | "note" | "createdAt" | "noteUpdatedAt">;

/** A whitespace-only note is no note — it has nothing to read. */
export function hasCustomerNote(c: Pick<Customer, "note">): boolean {
  return (c.note ?? "").trim() !== "";
}

/**
 * When this customer's note last changed, or null when there is no note.
 * A note-bearing row with no stamp yet (the migration backfill failed, or an
 * old instance wrote it mid-deploy) falls back to createdAt — the same
 * fallback the backfill itself uses for a note that was never edited.
 */
export function customerNoteActivityAt(c: NoteActivityFields): string | null {
  if (!hasCustomerNote(c)) return null;
  return c.noteUpdatedAt || c.createdAt || null;
}

// Parsed rather than compared as strings: createdAt of imported rows is not
// guaranteed to share toISOString()'s exact shape, and a lexical compare of
// two different shapes is silently wrong rather than loudly so. Unparseable
// sorts as oldest.
function timeOf(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return isNaN(t) ? -Infinity : t;
}

interface NoteActivityKey {
  has: boolean;
  activity: number;
  created: number;
  id: string;
}

function keyOf(c: NoteActivityFields): NoteActivityKey {
  return {
    has: hasCustomerNote(c),
    activity: timeOf(customerNoteActivityAt(c)),
    created: timeOf(c.createdAt),
    id: c.id,
  };
}

function compareKeys(a: NoteActivityKey, b: NoteActivityKey): number {
  if (a.has !== b.has) return a.has ? -1 : 1;

  if (a.has) {
    const diff = b.activity - a.activity;
    if (diff !== 0 && !isNaN(diff)) return diff;
  }

  const created = b.created - a.created;
  if (created !== 0 && !isNaN(created)) return created;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Order for the /customers list: customers WITH a note first, most recently
 * updated note first; customers with an empty note last, newest-created first
 * among themselves (the order the list had before). Ties fall through to
 * createdAt and then id, so the order is total and stable across reloads.
 *
 * Applied client-side on that page only — GET /api/customers keeps its own
 * createdAt order because several dropdowns elsewhere read the same list.
 */
export function compareCustomersByNoteActivity(
  a: NoteActivityFields,
  b: NoteActivityFields
): number {
  return compareKeys(keyOf(a), keyOf(b));
}

/**
 * `rows` in compareCustomersByNoteActivity order, as a new array. Use this
 * rather than `.sort(compareCustomersByNoteActivity)` on a big list: that
 * re-parses both timestamps on every one of the ~n·log n comparisons (~37 ms
 * for 6,000 customers), where this parses each row once and then compares
 * numbers. Same keys, same comparison, so the two can never disagree.
 */
export function sortCustomersByNoteActivity<T extends NoteActivityFields>(rows: readonly T[]): T[] {
  return rows
    .map((row) => ({ row, key: keyOf(row) }))
    .sort((x, y) => compareKeys(x.key, y.key))
    .map((x) => x.row);
}
