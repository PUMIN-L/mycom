import { query } from "./db";
import type { RowDataPacket } from "mysql2";

// Edit history. Before every update to a product / content / document, a
// snapshot of the PREVIOUS value is written here so an accidental overwrite (or
// an over-aggressive sanitize) can be restored. Generic across entity types.
export type RevisionEntityType = "product" | "content" | "document";

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
 * that otherwise failed.
 */
export async function saveRevision(
  entityType: RevisionEntityType,
  entityId: string,
  data: unknown,
  conn?: Queryable
): Promise<void> {
  await (conn ?? { query }).query(
    `INSERT INTO revisions (id, entityType, entityId, data, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      entityType,
      entityId,
      JSON.stringify(data ?? null),
      new Date().toISOString(),
    ]
  );
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
