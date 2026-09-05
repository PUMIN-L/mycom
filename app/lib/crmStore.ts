import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import { bangkokDateString } from "./dateFormat";
import type {
  CustomerEquipment,
  ServiceSchedule,
  ServiceLog,
  ScheduleType,
  ScheduleStatus,
  CrmAlerts,
  SalesRecord,
} from "./types";
import {
  SCHEDULE_TYPES,
  SCHEDULE_STATUSES,
  CALIBRATION_VALIDITY_MONTHS,
  EQUIPMENT_OWNERSHIP_SOURCES,
} from "./types";
import {
  ALERT_WARRANTY_DAYS,
  ALERT_SCHEDULE_DAYS,
  CALIBRATION_ALERT_LEAD_MONTHS,
  ALERT_LIST_DISPLAY_LIMIT,
  MISSING_DELIVERY_DOC_DAYS,
  MISSING_RECEIPT_DOC_DAYS,
} from "./alertThresholds";

// Re-exported so callers can keep importing from "./crmStore".
export type { CustomerEquipment, ServiceSchedule, ServiceLog, CrmAlerts } from "./types";
export type { ScheduleType, ScheduleStatus } from "./types";
export { SCHEDULE_TYPES, SCHEDULE_STATUSES } from "./types";
// The thresholds this store's queries run on, re-exported so a caller that
// already imports getAlerts() can read the exact numbers behind it from the
// same module (tasks.md 18.14). They are DEFINED in ./alertThresholds so the
// client-side guide panel can import them without pulling mysql2 into the
// browser bundle — never redeclare any of them here.
export {
  ALERT_WARRANTY_DAYS,
  ALERT_SCHEDULE_DAYS,
  CALIBRATION_ALERT_LEAD_MONTHS,
  ALERT_LIST_DISPLAY_LIMIT,
  MISSING_DELIVERY_DOC_DAYS,
  MISSING_RECEIPT_DOC_DAYS,
} from "./alertThresholds";

// CRM: sold-equipment + warranty tracking, service/phone-call schedules, and
// post-action logs. All document "attachments" are TEXT reference numbers —
// never file uploads.

/** Thrown when completing a schedule that is not pending (double-complete). */
export class ScheduleNotPendingError extends Error {
  constructor(public readonly scheduleId: string) {
    super(`schedule ${scheduleId} is not pending`);
    this.name = "ScheduleNotPendingError";
  }
}

/** Thrown by updateSchedule() on any attempt to set status to "completed" —
 * that transition must go through completeScheduleWithLog() so a completed
 * schedule can never exist without its result log. */
export class ScheduleCompletionRequiresLogError extends Error {
  constructor(public readonly scheduleId: string) {
    super(
      `schedule ${scheduleId} cannot be marked completed via updateSchedule — use completeScheduleWithLog`
    );
    this.name = "ScheduleCompletionRequiresLogError";
  }
}

// Joined SELECT used by every equipment read: names for display come from the
// live customers/companies/products rows (LEFT JOIN so a deleted product —
// loose reference by design — degrades to null, not a broken row).
// ownershipSource/warrantyAlertEnabled arrive via e.* but are spelled out so
// cards and modals have a documented, defaulted value even on a row written
// before those columns existed.
const EQUIPMENT_SELECT = `
  SELECT e.*, c.name AS customerName, co.name AS companyName,
         COALESCE(NULLIF(e.productName, ''), p.title_th) AS productName, p.image AS productImage,
         COALESCE(e.ownershipSource, 'sold_by_us') AS ownershipSource,
         COALESCE(e.warrantyAlertEnabled, 1) AS warrantyAlertEnabled
  FROM customer_equipments e
  LEFT JOIN customers c ON e.customerId = c.id
  LEFT JOIN companies co ON c.companyId = co.id
  LEFT JOIN products p ON e.productId = p.id`;

// ── Equipment ─────────────────────────────────────────────────────────────────

export async function listEquipments(
  customerId?: string
): Promise<CustomerEquipment[]> {
  if (customerId) {
    const [rows] = await query<RowDataPacket[]>(
      `${EQUIPMENT_SELECT} WHERE e.customerId = ? ORDER BY e.createdAt DESC`,
      [customerId]
    );
    return rows as CustomerEquipment[];
  }
  const [rows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT} ORDER BY e.createdAt DESC`
  );
  return rows as CustomerEquipment[];
}

export async function getEquipment(
  id: string
): Promise<CustomerEquipment | null> {
  const [rows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT} WHERE e.id = ?`,
    [id]
  );
  return (rows[0] as CustomerEquipment) || null;
}

/** Last line of defence for the ownership column: the API rejects anything
 * outside the two known values with a 400 (never coerces it silently — see
 * app/api/admin/equipments/**), so by the time a value reaches here an unknown
 * one can only come from an internal caller. Storing it would put a value in
 * the DB that no filter, badge or export knows how to render, so it falls back
 * to the documented default instead. */
function normalizeOwnershipSource(
  value: CustomerEquipment["ownershipSource"]
): CustomerEquipment["ownershipSource"] {
  return EQUIPMENT_OWNERSHIP_SOURCES.includes(
    value as (typeof EQUIPMENT_OWNERSHIP_SOURCES)[number]
  )
    ? value
    : "sold_by_us";
}

/** warrantyAlertEnabled is a TINYINT(1): reads hand back 0/1, the client sends
 * a JSON boolean, and "not supplied at all" must mean ON (the pre-existing
 * behaviour — every machine alerted). Returns the 0/1 the column wants. */
function normalizeWarrantyAlertEnabled(value: unknown): number {
  if (value === undefined || value === null) return 1;
  if (value === 0 || value === "0" || value === false || value === "false") return 0;
  return 1;
}

function cleanEquipment(data: Partial<CustomerEquipment>) {
  // "_custom" is a UI-only sentinel (EquipmentEditModal) for "no catalog
  // product selected" — the client already maps it back to "" before sending,
  // but treat it the same way here too in case any other caller forgets to.
  const productId = data.productId === "_custom" ? "" : data.productId || "";
  return {
    salesRecordId: sanitizePlainText(data.salesRecordId || "").substring(0, 255),
    customerId: sanitizePlainText(data.customerId || "").substring(0, 255),
    productId: sanitizePlainText(productId).substring(0, 255),
    productName: sanitizePlainText(data.productName || "").substring(0, 255),
    serialNumber: sanitizePlainText(data.serialNumber || "").substring(0, 255),
    quotationNumber: sanitizePlainText(data.quotationNumber || "").substring(0, 255),
    warrantyCertNumber: sanitizePlainText(data.warrantyCertNumber || "").substring(0, 255),
    warrantyType: sanitizePlainText(data.warrantyType || "").substring(0, 255),
    warrantyStartDate: data.warrantyStartDate
      ? sanitizePlainText(String(data.warrantyStartDate)).substring(0, 10) || null
      : null,
    warrantyEndDate: data.warrantyEndDate
      ? sanitizePlainText(String(data.warrantyEndDate)).substring(0, 10) || null
      : null,
    status: data.status === "Expired" ? "Expired" : "Active",
    note: data.note ? sanitizePlainText(String(data.note)).substring(0, 5000) : null,
    calibrationDate: data.calibrationDate
      ? sanitizePlainText(String(data.calibrationDate)).substring(0, 10) || null
      : null,
    // Both default to the pre-change behaviour ("we sold it", alert on) so a
    // caller that never heard of these fields — the sale form's equipment sync
    // included — writes exactly what the migration wrote for legacy rows.
    ownershipSource: normalizeOwnershipSource(data.ownershipSource),
    warrantyAlertEnabled: normalizeWarrantyAlertEnabled(data.warrantyAlertEnabled),
  };
}

export async function addEquipment(
  data: Partial<CustomerEquipment>
): Promise<CustomerEquipment> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanEquipment(data);
  await query(
    `INSERT INTO customer_equipments
       (id, salesRecordId, customerId, productId, productName, serialNumber, quotationNumber,
        warrantyCertNumber, warrantyType, warrantyStartDate, warrantyEndDate,
        status, ownershipSource, warrantyAlertEnabled, calibrationDate, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      v.salesRecordId,
      v.customerId,
      v.productId,
      v.productName,
      v.serialNumber,
      v.quotationNumber,
      v.warrantyCertNumber,
      v.warrantyType,
      v.warrantyStartDate,
      v.warrantyEndDate,
      v.status,
      v.ownershipSource,
      v.warrantyAlertEnabled,
      v.calibrationDate,
      now,
    ]
  );
  return (await getEquipment(id))!;
}

function normalizeSerial(s: string): string {
  return String(s || "").trim().toLowerCase();
}

/** At most this many machines per sales record (guards a runaway qty). */
const MAX_EQUIPMENT_ROWS = 50;

/** One physical machine on a sale. Everything but the serial is optional;
 * whatever a row leaves out falls back to the sale-level `shared` template, so
 * a single-model bill can still be described with bare serials. */
export interface EquipmentRowInput {
  serialNumber: string;
  productId?: string;
  productName?: string;
  /** Free-text warranty arrangement for THIS machine (the sale form's dropdown
   * stores its Thai label verbatim, so EquipmentEditModal keeps showing a
   * meaningful string and hand-typed legacy values stay valid). Optional, and
   * per-machine: two units on one bill can carry different arrangements. */
  warrantyType?: string;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  quotationNumber?: string;
  customerId?: string;
}

/** Structural shape of the mysql2 connection a `withTransaction` callback
 * receives — declared here so callers can pass theirs straight through
 * without importing mysql2 types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxConn = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** Catalog-product identity used to group machines by model. Mirrors
 * cleanEquipment's handling of the UI-only "_custom" sentinel, so a custom
 * machine and one with no product at all share the same ("") group. */
function productGroupKey(productId: string | undefined): string {
  const id = String(productId || "").trim();
  return id === "_custom" ? "" : id;
}

type ResolvedRow = { group: string; data: Partial<CustomerEquipment> };

/** Merge one submitted machine over the sale-level template. A row that names
 * its own model owns BOTH product fields, so a P2 machine in a mixed bill can
 * never be stamped with the sale's (or another line's) P1 name. */
function resolveEquipmentRow(
  row: EquipmentRowInput,
  shared: Partial<CustomerEquipment>,
  salesRecordId: string
): ResolvedRow {
  const ownsProduct = row.productId !== undefined || row.productName !== undefined;
  const productId = ownsProduct ? row.productId || "" : shared.productId || "";
  return {
    group: productGroupKey(productId),
    data: {
      ...shared,
      salesRecordId,
      customerId: row.customerId ?? shared.customerId ?? "",
      productId,
      productName: ownsProduct ? row.productName || "" : shared.productName || "",
      serialNumber: String(row.serialNumber || "").trim(),
      quotationNumber: row.quotationNumber ?? shared.quotationNumber ?? "",
      // Warranty type is per-machine and OPTIONAL, so unlike the dates it falls
      // back on EMPTINESS, not on `undefined`: the sale form submits "" for a
      // machine whose dropdown was left alone, and "" must not mean "erase".
      // Row's own value → sale-level template → blank; a blank that lands on an
      // existing row leaves that row's stored value alone (see the UPDATE).
      warrantyType:
        String(row.warrantyType ?? "").trim() || String(shared.warrantyType ?? "").trim() || "",
      warrantyStartDate:
        row.warrantyStartDate !== undefined
          ? row.warrantyStartDate
          : shared.warrantyStartDate ?? null,
      warrantyEndDate:
        row.warrantyEndDate !== undefined ? row.warrantyEndDate : shared.warrantyEndDate ?? null,
    },
  };
}

async function runEquipmentSync(
  conn: TxConn,
  salesRecordId: string,
  rows: ResolvedRow[]
): Promise<void> {
  const [existingRows] = await conn.query(
    `SELECT id, serialNumber FROM customer_equipments WHERE salesRecordId = ? ORDER BY createdAt ASC`,
    [salesRecordId]
  );
  const existingEqs = (Array.isArray(existingRows) ? existingRows : []) as {
    id: string;
    serialNumber: string;
  }[];

  const existingUsed = new Set<string>();
  const wantedUsed = new Set<number>();
  const pairs: { existingId: string; row: ResolvedRow }[] = [];

  // Pass 1 — identity match: pair a submitted serial to the existing row
  // that already has that exact (normalized) serial. This is what keeps a
  // unit's history attached to the right physical unit when the list is
  // reordered or another entry is added/removed. Identity wins across the
  // whole sale, product groups included — the serial IS the machine.
  for (let i = 0; i < rows.length; i++) {
    const key = normalizeSerial(rows[i].data.serialNumber || "");
    if (!key) continue;
    const match = existingEqs.find(
      (eq) => !existingUsed.has(eq.id) && normalizeSerial(eq.serialNumber) === key
    );
    if (match) {
      existingUsed.add(match.id);
      wantedUsed.add(i);
      pairs.push({ existingId: match.id, row: rows[i] });
    }
  }

  const remainingExisting = existingEqs.filter((eq) => !existingUsed.has(eq.id));
  const unpairedGroups = new Set(
    rows.filter((_, i) => !wantedUsed.has(i)).map((r) => r.group)
  );

  // Positional fallback has to stay INSIDE one product group, or two models in
  // the same bill trade rows while their serials are still blank. Which model
  // each existing row holds is only worth reading when the leftovers actually
  // span more than one group — a single-model bill pairs positionally as it
  // always has.
  let modelById: Map<string, string> | null = null;
  if (unpairedGroups.size > 1 && remainingExisting.length > 0) {
    const [modelRows] = await conn.query(
      `SELECT id, productId FROM customer_equipments WHERE salesRecordId = ? ORDER BY createdAt ASC`,
      [salesRecordId]
    );
    if (Array.isArray(modelRows) && modelRows.every((r) => r && typeof r.id === "string")) {
      modelById = new Map(
        (modelRows as { id: string; productId?: string }[]).map((r) => [
          r.id,
          productGroupKey(r.productId),
        ])
      );
    }
  }

  // Pass 2 — positional fallback for whatever's left (blank serials, or a
  // serial with no existing match): pair remaining submitted slots with
  // remaining existing rows in original order. Preserves the old behavior
  // for equipment that has no serial yet, so unrelated edits don't spawn
  // duplicate rows.
  const queues = new Map<string, { id: string; serialNumber: string }[]>();
  if (modelById) {
    for (const eq of remainingExisting) {
      const g = modelById.get(eq.id) ?? "";
      const q = queues.get(g);
      if (q) q.push(eq);
      else queues.set(g, [eq]);
    }
  }
  let cursor = 0;
  for (let i = 0; i < rows.length; i++) {
    if (wantedUsed.has(i)) continue;
    let eq: { id: string; serialNumber: string } | undefined;
    if (modelById) {
      eq = queues.get(rows[i].group)?.shift();
    } else if (cursor < remainingExisting.length) {
      eq = remainingExisting[cursor++];
    }
    if (!eq) continue;
    existingUsed.add(eq.id);
    wantedUsed.add(i);
    pairs.push({ existingId: eq.id, row: rows[i] });
  }

  // Update every matched row with ITS OWN machine data — never another row's.
  // warrantyType is the one field an update may not blank: it is optional here
  // but free-text-editable in EquipmentEditModal, so a submission that omits it
  // (COALESCE/NULLIF → the column keeps its current value) must never erase a
  // warranty someone typed by hand. Same param count/order as before.
  // ownershipSource/warrantyAlertEnabled are deliberately ABSENT from this
  // UPDATE: re-saving a sale must not reclassify a machine an admin has since
  // marked "customer_owned", nor re-arm a warranty alert they switched off.
  // Those two are only ever set on INSERT (defaults) or from the equipment form.
  for (const { existingId, row } of pairs) {
    const v = cleanEquipment(row.data);
    await conn.query(
      `UPDATE customer_equipments SET
         customerId = ?, productId = ?, productName = ?, serialNumber = ?, quotationNumber = ?,
         warrantyCertNumber = ?, warrantyType = COALESCE(NULLIF(?, ''), warrantyType),
         warrantyStartDate = ?, warrantyEndDate = ?, status = ?
       WHERE id = ?`,
      [
        v.customerId,
        v.productId,
        v.productName,
        v.serialNumber,
        v.quotationNumber,
        v.warrantyCertNumber,
        v.warrantyType,
        v.warrantyStartDate,
        v.warrantyEndDate,
        v.status,
        existingId,
      ]
    );
  }

  // Genuinely new entries (submitted slots with no pairing at all) → insert.
  for (let i = 0; i < rows.length; i++) {
    if (wantedUsed.has(i)) continue;
    // Generated here, inside the caller's transaction body, so a
    // withTransaction retry re-derives fresh ids instead of replaying stale
    // ones onto a rolled-back attempt.
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const v = cleanEquipment({ ...rows[i].data, salesRecordId });
    // A machine born from a sale is by definition one WE sold, and its
    // warranty alert starts on — nobody has to pick either (task 16.10). The
    // sale form never sends these fields, so cleanEquipment's defaults are what
    // land here; if a caller ever does send them, its choice is honoured.
    await conn.query(
      `INSERT INTO customer_equipments
         (id, salesRecordId, customerId, productId, productName, serialNumber, quotationNumber,
          warrantyCertNumber, warrantyType, warrantyStartDate, warrantyEndDate,
          status, ownershipSource, warrantyAlertEnabled, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        v.salesRecordId,
        v.customerId,
        v.productId,
        v.productName,
        v.serialNumber,
        v.quotationNumber,
        v.warrantyCertNumber,
        v.warrantyType,
        v.warrantyStartDate,
        v.warrantyEndDate,
        v.status,
        v.ownershipSource,
        v.warrantyAlertEnabled,
        now,
      ]
    );
  }

  // Excess existing rows (not paired at all, e.g. qty was reduced) are
  // UNLINKED from this sale — never deleted. Their warranty/schedule/log
  // history is preserved intact under the customer.
  const toUnlink = existingEqs.filter((eq) => !existingUsed.has(eq.id));
  for (const eq of toUnlink) {
    await conn.query(
      "UPDATE customer_equipments SET salesRecordId = '' WHERE id = ?",
      [eq.id]
    );
  }
}

/**
 * Sync the equipment rows linked to a sales record with a PER-MACHINE list:
 * each row carries its own product, serial, warranty dates, warranty type and
 * quotation number, so one bill can hold several different models — and two
 * machines on one bill can hold two different warranty arrangements. `shared`
 * supplies the sale-level defaults for whatever a row leaves out.
 *
 * `warrantyType` is optional and never blanks an existing value: a row that
 * submits nothing (and a sale template with nothing) leaves whatever the
 * equipment row already stores untouched, because that field is also
 * hand-edited as free text in the equipment modal. Clearing it is that modal's
 * job, not the sale form's.
 *
 * NEVER deletes a row: matching is by SERIAL IDENTITY first (so
 * reordering/editing the list can't silently mix up which physical unit owns
 * which service history — the bug this replaced), falling back to positional
 * pairing only for entries with no serial yet (so records that have never had
 * a serial filled in don't explode into duplicates on every unrelated save),
 * and that fallback pairs only within one product group. A submitted list
 * shorter than before UNLINKS the leftover rows (`salesRecordId = ''`) instead
 * of deleting them — the equipment and all its warranty/schedule/log history
 * stay in the database, just no longer attached to this sale; they remain
 * visible under the customer's equipment list.
 *
 * Pass `conn` to run inside a caller's transaction, so the sale, its line
 * items and its machines commit all-or-nothing; omit it and the sync opens its
 * own transaction as before. Either way the body is idempotent: re-running
 * with the same serials updates the same rows in place.
 */
export async function syncEquipmentRowsForSalesRecord(
  salesRecordId: string,
  rows: EquipmentRowInput[],
  shared: Partial<CustomerEquipment>,
  conn?: TxConn
): Promise<void> {
  if (!salesRecordId) return;

  const resolved = rows
    .slice(0, MAX_EQUIPMENT_ROWS)
    .map((row) => resolveEquipmentRow(row, shared, salesRecordId));

  if (conn) {
    await runEquipmentSync(conn, salesRecordId, resolved);
    return;
  }
  await withTransaction((c) =>
    runEquipmentSync(c as unknown as TxConn, salesRecordId, resolved)
  );
}

/**
 * Serial-list flavour of {@link syncEquipmentRowsForSalesRecord}: every machine
 * on the sale takes the same sale-level template, differing only by serial.
 */
export async function syncEquipmentsForSalesRecord(
  salesRecordId: string,
  serialNumbers: string[],
  baseEquipmentData: Partial<CustomerEquipment>
): Promise<void> {
  await syncEquipmentRowsForSalesRecord(
    salesRecordId,
    serialNumbers.map((sn) => ({ serialNumber: String(sn || "") })),
    baseEquipmentData
  );
}

/**
 * Which existing machines already carry any of these serials — one query for
 * the whole list, normalized exactly the way the sync matching normalizes
 * (trim + case-insensitive). Returns enough to name the clashing machine to
 * the user (which sale, which product, whose).
 *
 * ADVISORY ONLY (D12/D13): duplicate serials are legal, so this feeds a
 * "serial already in use by X" warning the admin can confirm past. It never
 * throws and never blocks a write — a failed lookup degrades to "no duplicates
 * found" rather than failing the save.
 */
export async function findEquipmentsBySerial(serials: string[]): Promise<
  Array<{
    id: string;
    serialNumber: string;
    salesRecordId: string;
    productName: string;
    customerName: string;
  }>
> {
  try {
    const keys = Array.from(
      new Set((serials || []).map((s) => normalizeSerial(String(s ?? ""))))
    )
      .filter(Boolean)
      .slice(0, MAX_EQUIPMENT_ROWS);
    if (keys.length === 0) return [];

    const placeholders = keys.map(() => "?").join(", ");
    // productName falls back to the live catalog title the same way
    // EQUIPMENT_SELECT resolves it, so the warning names the machine even when
    // the row stores no name of its own.
    const [rows] = await query<RowDataPacket[]>(
      `SELECT e.id, e.serialNumber, e.salesRecordId,
              COALESCE(NULLIF(e.productName, ''), p.title_th, '') AS productName,
              COALESCE(c.name, '') AS customerName
       FROM customer_equipments e
       LEFT JOIN customers c ON e.customerId = c.id
       LEFT JOIN products p ON e.productId = p.id
       WHERE LOWER(TRIM(e.serialNumber)) IN (${placeholders})
       ORDER BY e.createdAt DESC
       LIMIT 200`,
      keys
    );
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      id: String(r.id || ""),
      serialNumber: String(r.serialNumber || ""),
      salesRecordId: String(r.salesRecordId || ""),
      productName: String(r.productName || ""),
      customerName: String(r.customerName || ""),
    }));
  } catch (err) {
    console.error("findEquipmentsBySerial failed:", err);
    return [];
  }
}

/**
 * Unlink every equipment row from a sales record (never deletes) — used when
 * a sale changes from "equipment" to "service", or the sales record itself is
 * removed. Equipment and all its warranty/schedule/log history remain in the
 * database, still visible under the customer's equipment list.
 */
export async function cleanupEquipmentsForSalesRecord(salesRecordId: string): Promise<void> {
  if (!salesRecordId) return;
  await query(
    `UPDATE customer_equipments SET salesRecordId = '' WHERE salesRecordId = ?`,
    [salesRecordId]
  );
}

export async function updateEquipment(
  id: string,
  data: Partial<CustomerEquipment>
): Promise<CustomerEquipment | null> {
  const existing = await getEquipment(id);
  if (!existing) return null;
  const merged = { ...existing, ...data };
  // getEquipment()'s productName is resolved live from the catalog (see
  // EQUIPMENT_SELECT's COALESCE) whenever the raw column is empty, and the
  // client always echoes that resolved value back on save (there is no
  // separate "product name" input — only a product picker). Writing it
  // straight through here would freeze that catalog-title snapshot into the
  // raw column, decoupling it from later catalog edits. Only equipment with
  // no linked catalog product keeps its own stored name.
  const hasLinkedProduct = !!merged.productId && merged.productId !== "_custom";
  const v = cleanEquipment({
    ...merged,
    productName: hasLinkedProduct ? "" : merged.productName,
  });
  await query(
    `UPDATE customer_equipments SET
       customerId = ?, productId = ?, productName = ?, serialNumber = ?, quotationNumber = ?,
       warrantyCertNumber = ?, warrantyType = ?, warrantyStartDate = ?,
       warrantyEndDate = ?, status = ?, note = ?, calibrationDate = ?,
       ownershipSource = ?, warrantyAlertEnabled = ?
     WHERE id = ?`,
    [
      v.customerId,
      v.productId,
      v.productName,
      v.serialNumber,
      v.quotationNumber,
      v.warrantyCertNumber,
      v.warrantyType,
      v.warrantyStartDate,
      v.warrantyEndDate,
      v.status,
      v.note,
      v.calibrationDate,
      // `merged` is {...existing, ...data}, so a partial update that omits
      // these two writes the row's CURRENT values straight back — it can never
      // reset a machine to "we sold it / alert on" behind the admin's back.
      v.ownershipSource,
      v.warrantyAlertEnabled,
      id,
    ]
  );
  return getEquipment(id);
}

/**
 * Records that the customer declined to renew the warranty on this
 * equipment: flips status to "Expired" and appends a dated log entry to its
 * note (never overwrites earlier notes). Used by the "ลูกค้าไม่ต่อประกัน"
 * action on the warranty-expiry alert.
 */
export async function declineWarrantyRenewal(id: string): Promise<CustomerEquipment | null> {
  const existing = await getEquipment(id);
  if (!existing) return null;
  const entry = `หมดประกันแล้ว วันที่ ${bangkokDateString(new Date())} - ลูกค้าไม่ต่อประกัน`;
  const note = existing.note ? `${existing.note}\n${entry}` : entry;
  return updateEquipment(id, { status: "Expired", note });
}

/** Deletes the equipment (schedules + logs cascade via FK). */
export async function deleteEquipment(id: string): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "DELETE FROM customer_equipments WHERE id = ?",
    [id]
  );
  return res.affectedRows > 0;
}

// ── Schedules ─────────────────────────────────────────────────────────────────

export async function listSchedules(
  equipmentId?: string,
  customerId?: string
): Promise<ServiceSchedule[]> {
  if (equipmentId) {
    const [rows] = await query<RowDataPacket[]>(
      `SELECT * FROM service_schedules WHERE equipmentId = ?
       ORDER BY scheduledDate ASC`,
      [equipmentId]
    );
    return rows as ServiceSchedule[];
  }
  if (customerId) {
    const [rows] = await query<RowDataPacket[]>(
      `SELECT * FROM service_schedules WHERE customerId = ?
       ORDER BY scheduledDate ASC`,
      [customerId]
    );
    return rows as ServiceSchedule[];
  }
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM service_schedules ORDER BY scheduledDate ASC"
  );
  return rows as ServiceSchedule[];
}

export async function getSchedule(id: string): Promise<ServiceSchedule | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM service_schedules WHERE id = ?",
    [id]
  );
  return (rows[0] as ServiceSchedule) || null;
}

export async function addSchedule(
  data: Partial<ServiceSchedule>
): Promise<ServiceSchedule> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Exactly one of equipmentId/customerId — equipmentId wins if a caller
  // (incorrectly) supplies both, since that's the pre-existing, more
  // specific relationship.
  const equipmentId = sanitizePlainText(data.equipmentId || "").substring(0, 36) || null;
  const customerId = equipmentId
    ? null
    : sanitizePlainText(data.customerId || "").substring(0, 255) || null;
  // A customer-scoped schedule (no linked equipment) is always a phone-call
  // follow-up — there's no equipment context for a "service" visit. For an
  // equipment-scoped schedule, defense-in-depth whitelist scheduleType
  // (mirrors updateSchedule).
  const scheduleType = customerId
    ? "phone_call"
    : SCHEDULE_TYPES.includes(data.scheduleType as ScheduleType)
      ? data.scheduleType
      : "service";
  await query(
    `INSERT INTO service_schedules
       (id, equipmentId, customerId, scheduleType, scheduledDate, assignedToAdminId,
        status, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      equipmentId,
      customerId,
      scheduleType,
      sanitizePlainText(data.scheduledDate || "").substring(0, 20),
      sanitizePlainText(data.assignedToAdminId || "").substring(0, 255),
      "pending",
      sanitizePlainText(data.notes || "").substring(0, 5000),
      now,
    ]
  );
  return (await getSchedule(id))!;
}

export async function updateSchedule(
  id: string,
  data: Partial<ServiceSchedule>
): Promise<ServiceSchedule | null> {
  const existing = await getSchedule(id);
  if (!existing) return null;
  if (data.status === "completed") {
    throw new ScheduleCompletionRequiresLogError(id);
  }
  const merged = { ...existing, ...data };
  // Defense-in-depth: whitelist enum fields so even a direct store caller
  // can't write arbitrary values. Invalid → keep the existing value. A
  // customer-scoped schedule (no linked equipment) stays "phone_call" no
  // matter what's requested — there's no equipment context for "service".
  const scheduleType = existing.customerId
    ? "phone_call"
    : SCHEDULE_TYPES.includes(merged.scheduleType as ScheduleType)
      ? merged.scheduleType
      : existing.scheduleType;
  const status = SCHEDULE_STATUSES.includes(merged.status as ScheduleStatus)
    ? merged.status
    : existing.status;
  await query(
    `UPDATE service_schedules SET
       scheduleType = ?, scheduledDate = ?, assignedToAdminId = ?, status = ?,
       notes = ?
     WHERE id = ?`,
    [
      scheduleType,
      sanitizePlainText(merged.scheduledDate || "").substring(0, 20),
      sanitizePlainText(merged.assignedToAdminId || "").substring(0, 255),
      status,
      sanitizePlainText(merged.notes || "").substring(0, 5000),
      id,
    ]
  );
  return getSchedule(id);
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "DELETE FROM service_schedules WHERE id = ?",
    [id]
  );
  return res.affectedRows > 0;
}

// ── Logs / complete ───────────────────────────────────────────────────────────

export async function listLogs(scheduleId: string): Promise<ServiceLog[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM service_logs WHERE scheduleId = ? ORDER BY createdAt DESC",
    [scheduleId]
  );
  return rows as ServiceLog[];
}

/**
 * Complete a schedule: insert the result log AND mark the schedule `completed`
 * in ONE transaction — the log is the sales-history record, so it must never
 * exist without the status flip (or vice versa). Only a `pending` schedule can
 * be completed; anything else throws ScheduleNotPendingError (→ 409), which
 * also prevents double-completion (the status row is locked FOR UPDATE).
 */
export async function completeScheduleWithLog(
  scheduleId: string,
  log: Partial<ServiceLog>
): Promise<ServiceLog> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT status FROM service_schedules WHERE id = ? FOR UPDATE",
      [scheduleId]
    );
    if (rows.length === 0 || rows[0].status !== "pending") {
      throw new ScheduleNotPendingError(scheduleId);
    }
    await conn.query(
      `INSERT INTO service_logs
         (id, scheduleId, serviceReportNumber, actionDate, resultDetails,
          customerFeedback, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        scheduleId,
        sanitizePlainText(log.serviceReportNumber || "").substring(0, 255),
        sanitizePlainText(log.actionDate || "").substring(0, 255) || now,
        sanitizePlainText(log.resultDetails || "").substring(0, 10000),
        sanitizePlainText(log.customerFeedback || "").substring(0, 10000),
        now,
      ]
    );
    await conn.query(
      "UPDATE service_schedules SET status = 'completed' WHERE id = ?",
      [scheduleId]
    );
  });
  // Return the actual persisted row (matches what was sanitized+inserted)
  // instead of echoing back the raw unsanitized input.
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM service_logs WHERE id = ?",
    [id]
  );
  return rows[0] as ServiceLog;
}

// ── Alerts ────────────────────────────────────────────────────────────────────

/**
 * Alert feed for /admin/alerts:
 * - equipment whose warranty ends within `warrantyDays` (default 30), is not
 *   already past, and still has its per-machine warranty alert switched on —
 *   sorted soonest-first;
 * - pending EQUIPMENT-scoped schedules due within `scheduleDays` (default 7) OR
 *   already overdue (`upcomingSchedules`);
 * - pending CUSTOMER-scoped follow-up calls, with no date window at all
 *   (`customerCallFollowUps`) — see the query below for why.
 * Date comparison is lexical on YYYY-MM-DD strings (sorts chronologically).
 */
// The server runs at UTC (Vercel) but the team is in Thailand (UTC+7, no
// DST) — shifting the instant forward by the offset before taking the UTC
// calendar date gives Bangkok's wall-clock date instead of the server's.
// Without this, "today" between 00:00-06:59 Thai time is still "yesterday"
// server-side, so an overdue schedule/expired warranty from yesterday goes
// unflagged for up to 7 hours every single day. (bangkokDateString lives in
// dateFormat.ts, shared with salesDashboardStore.ts's identical need.)

// The alert starts CALIBRATION_ALERT_LEAD_MONTHS before the 1-year
// (CALIBRATION_VALIDITY_MONTHS) calibration anniversary — i.e. once 10
// months (12 - 2) have passed since the last calibrationDate. Both constants
// are imported, never literals: the in-page guide renders the same values.

// Both schedule feeds read the same joined shape — one source for the SELECT
// and JOIN block so the equipment-scoped feed keeps returning exactly the
// columns it has always returned, and the customer-scoped one resolves its
// customer/company through the same COALESCE(c2/co2) path. The two categories
// differ ONLY in their WHERE clause.
const SCHEDULE_ALERT_SELECT = `
  SELECT s.*, COALESCE(e.customerId, s.customerId) AS customerId, e.serialNumber,
         COALESCE(c.name, c2.name) AS customerName,
         COALESCE(co.name, co2.name) AS companyName,
         p.title_th AS productName
  FROM service_schedules s
  LEFT JOIN customer_equipments e ON s.equipmentId = e.id
  LEFT JOIN customers c ON e.customerId = c.id
  LEFT JOIN companies co ON c.companyId = co.id
  LEFT JOIN products p ON e.productId = p.id
  LEFT JOIN customers c2 ON s.customerId = c2.id
  LEFT JOIN companies co2 ON c2.companyId = co2.id
  LEFT JOIN alert_snoozes sno ON sno.alertType = 'schedule' AND sno.referenceId = s.id`;

// `dueTaskCount` is composed by GET /api/admin/alerts from taskStore's
// countDueTasks() — the manual task board is not part of the computed alert
// feed and must not couple this store to it.
export async function getAlerts(
  warrantyDays = ALERT_WARRANTY_DAYS,
  scheduleDays = ALERT_SCHEDULE_DAYS
): Promise<Omit<CrmAlerts, "dueTaskCount">> {
  const today = bangkokDateString(new Date());
  const warrantyCutoff = bangkokDateString(new Date(Date.now() + warrantyDays * 86400000));
  const scheduleCutoff = bangkokDateString(new Date(Date.now() + scheduleDays * 86400000));

  const nowIso = new Date().toISOString();

  // warrantyAlertEnabled silences THIS alert only — the calibration and
  // incomplete-data queries below deliberately ignore it, so switching off a
  // machine's warranty reminder never hides the machine itself.
  const [warrantyRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'warranty' AND sno.referenceId = e.id
     WHERE e.warrantyEndDate IS NOT NULL
       AND e.warrantyEndDate >= ? AND e.warrantyEndDate <= ?
       AND e.status != 'Expired'
       AND e.warrantyAlertEnabled = 1
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY e.warrantyEndDate ASC`,
    [today, warrantyCutoff, nowIso]
  );

  // Fires once today is within CALIBRATION_ALERT_LEAD_MONTHS of the 1-year
  // due date, i.e. calibrationDate + (12 - 2) months <= today. No upper bound:
  // unlike warranty (silenced by status='Expired'), nothing marks a
  // calibration "done" except recording a NEW calibrationDate, so an already
  // overdue one must keep alerting indefinitely, not just while approaching.
  const [calibrationRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'calibration' AND sno.referenceId = e.id
     WHERE e.calibrationDate IS NOT NULL
       AND DATE_ADD(e.calibrationDate, INTERVAL ? MONTH) <= ?
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY e.calibrationDate ASC`,
    [CALIBRATION_VALIDITY_MONTHS - CALIBRATION_ALERT_LEAD_MONTHS, today, nowIso]
  );

  const [incompleteRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'incomplete' AND sno.referenceId = e.id
     WHERE (e.serialNumber = '' OR e.serialNumber IS NULL OR e.warrantyStartDate IS NULL)
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY e.createdAt DESC LIMIT ${ALERT_LIST_DISPLAY_LIMIT}`,
    [nowIso]
  );

  // The list above is capped for display; count the true total
  // (same filter, no cap) so callers can show "and N more" instead of
  // silently hiding a backlog beyond the cap.
  const [incompleteCountRows] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM customer_equipments e
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'incomplete' AND sno.referenceId = e.id
     WHERE (e.serialNumber = '' OR e.serialNumber IS NULL OR e.warrantyStartDate IS NULL)
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)`,
    [nowIso]
  );
  const incompleteEquipmentsTotal = Number(incompleteCountRows[0]?.cnt) || 0;

  // A schedule's customer/company come from its linked equipment's customer
  // when equipment-scoped, or straight from s.customerId when customer-scoped
  // (no equipment) — COALESCE picks whichever join path actually matched.
  //
  // Equipment-scoped feed: unchanged behaviour — pending and due within the
  // scheduleDays window (or already overdue). Splitting the categories is done
  // by SCOPE, not by scheduleType: a phone_call booked against a machine stays
  // here, on the same window it has always used.
  const [scheduleRows] = await query<RowDataPacket[]>(
    `${SCHEDULE_ALERT_SELECT}
     WHERE s.equipmentId IS NOT NULL
       AND s.status = 'pending' AND s.scheduledDate <= ?
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY s.scheduledDate ASC`,
    [scheduleCutoff, nowIso]
  );

  // Customer-scoped follow-up calls: NO date window at all. A call booked six
  // months out has to be visible the moment it is booked (booking it used to
  // look like it did nothing until it came within scheduleDays), and stays
  // until it is completed or cancelled. Snoozes still read the SAME
  // alertType = 'schedule' rows, so calls an admin already snoozed under the
  // single-query version stay snoozed.
  const [customerCallRows] = await query<RowDataPacket[]>(
    `${SCHEDULE_ALERT_SELECT}
     WHERE s.equipmentId IS NULL AND s.customerId IS NOT NULL
       AND s.status = 'pending'
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY s.scheduledDate ASC LIMIT ${ALERT_LIST_DISPLAY_LIMIT}`,
    [nowIso]
  );

  // Unbounded by date, so the list above is capped for display; count
  // the true total (same filter, no cap) so callers can show "and N more" and
  // the notification bell counts the backlog rather than the truncated array.
  const [customerCallCountRows] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM service_schedules s
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'schedule' AND sno.referenceId = s.id
     WHERE s.equipmentId IS NULL AND s.customerId IS NOT NULL
       AND s.status = 'pending'
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)`,
    [nowIso]
  );
  const customerCallFollowUpsTotal = Number(customerCallCountRows[0]?.cnt) || 0;

  const [missingDocRows] = await query<RowDataPacket[]>(
    `SELECT sr.*,
            DATE_FORMAT(sr.saleDate, '%Y-%m-%d') AS saleDate,
            sp.name AS salespersonName,
            c.name AS customerName,
            co.name AS companyName
     FROM sales_records sr
     LEFT JOIN salespeople sp ON sr.salespersonId = sp.id
     LEFT JOIN customers c ON sr.customerId = c.id
     LEFT JOIN companies co ON sr.companyId = co.id
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'missing_doc' AND sno.referenceId = sr.id
     WHERE
       ((sr.saleType = 'equipment' AND sr.deliveryRef = ''
         AND DATEDIFF(?, sr.saleDate) >= ${MISSING_DELIVERY_DOC_DAYS})
       OR (sr.invoiceRef != '' AND sr.receiptRef = ''
         AND DATEDIFF(?, sr.saleDate) >= ${MISSING_RECEIPT_DOC_DAYS}))
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY sr.saleDate ASC`,
    // The two day thresholds are module constants interpolated into the SQL
    // (never user input) so the guide panel can quote the same numbers; the
    // bound params stay exactly what they were: today, today, now.
    [today, today, nowIso]
  );

  return {
    expiringWarranties: warrantyRows as CustomerEquipment[],
    nearingCalibration: calibrationRows as CustomerEquipment[],
    incompleteEquipments: incompleteRows as CustomerEquipment[],
    incompleteEquipmentsTotal,
    missingDocuments: missingDocRows as SalesRecord[],
    upcomingSchedules: (scheduleRows as CrmAlerts["upcomingSchedules"]).map(
      (s) => ({ ...s, overdue: s.scheduledDate < today })
    ),
    // Same overdue rule as above: a future call is shown but is NOT overdue.
    customerCallFollowUps: (customerCallRows as CrmAlerts["customerCallFollowUps"]).map(
      (s) => ({ ...s, overdue: s.scheduledDate < today })
    ),
    customerCallFollowUpsTotal,
  };
}

/**
 * Snoozes an alert until the specified ISO timestamp.
 */
export async function snoozeAlert(
  alertType: string,
  referenceId: string,
  snoozeUntil: string
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO alert_snoozes (alertType, referenceId, snoozeUntil, createdAt)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE snoozeUntil = ?, createdAt = ?`,
    [alertType, referenceId, snoozeUntil, now, snoozeUntil, now]
  );
}
