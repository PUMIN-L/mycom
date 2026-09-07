import { query } from "./db";
import type { RowDataPacket } from "mysql2";

// Edit history. Before every update to a product / content / document /
// customer, a snapshot of the PREVIOUS value is written here so an accidental
// overwrite (or an over-aggressive sanitize) can be restored. Generic across
// entity types.
//
// "customer" was added for change `add-customer-note-search`: `customers.note`
// is a call log that accumulates for years, the search-and-replace feature
// rewrites it across many customers at once, and a bulk edit of real business
// history with no way back is not something to build. `revisions.entityType`
// is already a generic VARCHAR(32) (see db.ts), so this is a TypeScript union
// widening and NOTHING ELSE — no migration, and SCHEMA_VERSION stays where it
// is.
//
// READING IT BACK: `GET /api/revisions?entityType=customer&entityId=…` lists a
// customer's history and `POST /api/revisions/[id]/restore` puts an entry back
// — for a customer, by writing ONE column, `note`. `note` is the only field
// the customer-note writers ever overwrite, so it is the only field that ever
// needs undoing; restoring the rest would revert edits nobody asked to revert.
// The whole policy lives in `app/api/revisions/[id]/restore/route.ts`, next to
// the SQL it governs — and because of it a customer snapshot now stores only
// `{ name, note }` rather than the whole row (see `snapshotPayload` below;
// older full-row snapshots still restore unchanged).
//
// Anything that widens this union again must also widen the allowlist in
// `app/api/revisions/route.ts` — it is keyed by this type so the compiler says
// so, because the first time round it was not and the snapshots were written
// into a history no one could list.
export type RevisionEntityType = "product" | "content" | "document" | "customer";

export interface Revision {
  id: string;
  entityType: RevisionEntityType;
  entityId: string;
  data: unknown; // full snapshot of the entity BEFORE the edit
  createdAt: string;
}

function parseData(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToRevision(r: RowDataPacket): Revision {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    data: parseData(r.data),
    createdAt: r.createdAt,
  };
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

// ── What a snapshot actually stores ────────────────────────────────────────
//
// A "customer" snapshot used to be the whole row — `id, companyId, name,
// department, phone, email, note`. Every column but `note` was dead weight:
// `POST /api/revisions/[id]/restore` restores customers with exactly ONE
// statement, `UPDATE customers SET note = ? WHERE id = ?`, and does so
// deliberately (putting a stale `companyId` back could point a customer at a
// deleted company). Bytes that can never be restored are bytes that should
// never have been written — and with ~6,000 customers whose notes run to the
// 2,000-character cap (Thai, so ~5.5 KB each), this history is the largest
// thing in the database.
//
// What is kept, and why exactly this:
//   • `note`  — the only restorable field. Without it there is no undo.
//   • `name`  — so an entry is legible on its own. `revisions.entityId` is a
//               UUID; a history row that says only "some customer" is a row
//               nobody can read back without a second query, and the customer
//               may since have been deleted (in which case the live name is
//               gone for good).
// Dropped: `id` (already the `entityId` column — storing it twice is pure
// duplication), `companyId`, `department`, `phone`, `email` — none is ever
// read by the restore route or by anything else.
//
// ⚠️ OLD FULL-ROW SNAPSHOTS MUST KEEP WORKING. There are already such rows in
// production. The shape is self-describing rather than versioned: the restore
// route keys off the PRESENCE of a `note` key (`Object.hasOwn(data, "note")`),
// which an old full-row snapshot has and a new lean one has too, so both
// restore identically and no migration is needed. That is also why the fields
// are copied only when the source row actually has them — inventing a `note`
// key that was not there would let an empty string be restored over a live
// call log, which is the one thing that check exists to prevent.
//
// Trimming lives HERE, not in each caller, so every writer of a customer
// snapshot gets it — the hand edit in `PUT /api/customers/[id]`, the bulk
// search-and-replace in `customerNoteSearchStore`, and the pre-restore
// snapshot the restore route takes of the value it is about to overwrite.
// product / content / document snapshots are NOT trimmed: their restores
// re-apply the whole object (`updateProduct(rev.entityId, data)`), so every
// field in them is restorable and none of it is waste.
const CUSTOMER_SNAPSHOT_FIELDS = ["name", "note"] as const;

function snapshotPayload(entityType: RevisionEntityType, data: unknown): unknown {
  if (entityType !== "customer") return data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of CUSTOMER_SNAPSHOT_FIELDS) {
    if (Object.hasOwn(src, field)) out[field] = src[field];
  }
  return out;
}

// ── The ceiling: how many snapshots survive per (entityType, entityId) ─────
//
// Nothing ever deleted a row from `revisions`, so history grew forever. With
// ~6,000 customers about to be imported, "forever" stops being free: 6,000
// customers x 10 note edits is ~350 MB, x 50 is ~1.7 GB, and a single bulk
// "replace all" across every customer writes ~33 MB in one click. These
// numbers turn unbounded growth into a fixed ceiling that no longer depends on
// how long the system runs.
//
//   customer: 10 — a snapshot is ~5.5 KB at the 2,000-character note cap, so
//     the worst case (every customer at the cap, every one edited 10+ times)
//     is ~330 MB and the realistic case is a small fraction of that. Ten is
//     deep enough that a bad bulk replace followed by several corrective hand
//     edits still leaves the pre-replace note reachable; deeper buys undo
//     nobody uses at ~33 MB per extra step across the whole customer base.
//   content: 5 — individually the LARGEST snapshot in the table (a full
//     rich-text showcase document: every block's sanitized HTML, tens to
//     hundreds of KB). Content is also authored iteratively, so it is where a
//     long tail of near-identical drafts accumulates fastest. Five covers the
//     "I broke the layout, put it back" case, which is what this history is
//     for.
//   product: 20 — a product row is a few KB (three languages of title and
//     description plus URLs) and there are hundreds of products, not
//     thousands, so twenty costs single-digit MB in total.
//   document: 20 — the smallest snapshot of the four (title, a description
//     capped at 2,000 characters, two URLs); the ceiling is here for the
//     principle, not for the bytes.
export const REVISION_KEEP: Record<RevisionEntityType, number> = {
  product: 20,
  content: 5,
  document: 20,
  customer: 10,
};

// One trim never deletes more than this many rows. It exists so the first
// write after this change lands on an entity with years of accumulated
// history without issuing one enormous DELETE; anything past it is trimmed by
// the next write, and the ceiling converges.
const TRIM_BATCH_LIMIT = 500;

/**
 * Keep the newest `REVISION_KEEP[entityType]` snapshots for one entity and
 * delete the rest. Called immediately after the INSERT, on the SAME
 * connection, so inside `withTransaction` it commits or rolls back with the
 * snapshot it is trimming for.
 *
 * ⚠️ THIS DELETES REAL HISTORY, so the ordering has to be provably
 * "oldest first, newest kept" and not merely usually right:
 *
 *   • `createdAt` is a VARCHAR ISO-8601 string. It IS lexically sortable
 *     (fixed-width, UTC, zero-padded) — but it is only millisecond-precise, so
 *     two snapshots written in the same millisecond share it exactly, and
 *     `ORDER BY createdAt` alone leaves their relative order to the optimizer.
 *     `id` (a UUID, the primary key) is appended as a tiebreak to make the
 *     order TOTAL and deterministic: the row trimmed is always the same row,
 *     run to run.
 *   • The row just inserted is pinned to the front by `(id = ?) DESC`
 *     regardless of timestamps. Ties are not the only hazard — these ISO
 *     strings come from `new Date()` on whichever serverless instance served
 *     the request, so a clock a few milliseconds behind another instance's
 *     would otherwise let a brand-new snapshot be trimmed the instant it was
 *     written, at exactly the moment its entity is at the ceiling. The write
 *     you just made is never the one thrown away.
 *
 * Two statements (select the ids, then delete them by id) rather than one
 * `DELETE ... WHERE id NOT IN (SELECT ... FROM revisions)`: MySQL restricts
 * reading the table being written in a subquery, the derived-table workaround
 * leaves the result to the optimizer, and the tests can assert on the exact
 * ids being deleted.
 */
async function trimRevisions(
  entityType: RevisionEntityType,
  entityId: string,
  keepId: string,
  q: Queryable
): Promise<void> {
  const keep = REVISION_KEEP[entityType];

  const result = (await q.query(
    `SELECT id FROM revisions
      WHERE entityType = ? AND entityId = ?
      ORDER BY (id = ?) DESC, createdAt DESC, id DESC
      LIMIT ? OFFSET ?`,
    [entityType, entityId, keepId, TRIM_BATCH_LIMIT, keep]
  )) as [RowDataPacket[], unknown];

  const rows = result?.[0];
  if (!Array.isArray(rows) || rows.length === 0) return;
  const ids = rows.map((r) => String(r.id));

  // `entityType`/`entityId` are repeated in the DELETE even though the ids are
  // already unique: a DELETE against history should not be able to reach
  // another entity's rows even if the id list were somehow wrong.
  await q.query(
    `DELETE FROM revisions
      WHERE entityType = ? AND entityId = ?
        AND id IN (${ids.map(() => "?").join(", ")})`,
    [entityType, entityId, ...ids]
  );
}

/**
 * Snapshot the previous value of an entity. Call this BEFORE applying an update
 * so a failed snapshot aborts before the overwrite (no history → no destructive
 * write). A snapshot that commits without the update is harmless (extra entry).
 *
 * Pass `conn` when called from inside `withTransaction()` — that runs the
 * INSERT through the transaction's own connection instead of the pool-level
 * `query()`, so it actually rolls back with everything else, and a retried
 * attempt (withTransaction retries the whole callback on a transient
 * connection error) can't leave a duplicate snapshot behind from an attempt
 * that otherwise failed. The trim below runs on the same connection for the
 * same reason. Callers with no transaction (documentStore, the non-relinking
 * contentStore path) get INSERT-then-trim as two separate pool queries, so
 * they are not atomic with each other — a trim that fails there leaves the
 * history one entry over its ceiling until the next write brings it back down.
 *
 * A failing trim is allowed to throw, and the caller's save then fails with
 * it. That is deliberate: inside a transaction the rollback leaves the
 * snapshot and the entity exactly as they were (nothing is half-done, and
 * withTransaction retries a transient error), and outside one the caller's
 * update simply never runs. Swallowing the error would be worse — a trim can
 * only fail for a real reason, and a housekeeping DELETE that quietly stops
 * working is how the unbounded growth this exists to fix comes back.
 */
export async function saveRevision(
  entityType: RevisionEntityType,
  entityId: string,
  data: unknown,
  conn?: Queryable
): Promise<void> {
  const q: Queryable = conn ?? { query: (sql, params) => query(sql, params) };
  const id = crypto.randomUUID();

  await q.query(
    `INSERT INTO revisions (id, entityType, entityId, data, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      entityType,
      entityId,
      JSON.stringify(snapshotPayload(entityType, data) ?? null),
      new Date().toISOString(),
    ]
  );

  await trimRevisions(entityType, entityId, id, q);
}

/** History for one entity, newest first. */
export async function listRevisions(
  entityType: RevisionEntityType,
  entityId: string
): Promise<Revision[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM revisions WHERE entityType = ? AND entityId = ?
     ORDER BY createdAt DESC`,
    [entityType, entityId]
  );
  return rows.map(rowToRevision);
}

/** A single revision by id (for restore). */
export async function getRevision(id: string): Promise<Revision | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM revisions WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rowToRevision(rows[0]) : null;
}
