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
import { SCHEDULE_TYPES, SCHEDULE_STATUSES } from "./types";

// Re-exported so callers can keep importing from "./crmStore".
export type { CustomerEquipment, ServiceSchedule, ServiceLog, CrmAlerts } from "./types";
export type { ScheduleType, ScheduleStatus } from "./types";
export { SCHEDULE_TYPES, SCHEDULE_STATUSES } from "./types";

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
const EQUIPMENT_SELECT = `
  SELECT e.*, c.name AS customerName, co.name AS companyName,
         COALESCE(NULLIF(e.productName, ''), p.title_th) AS productName, p.image AS productImage
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
        status, calibrationDate, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      v.calibrationDate,
      now,
    ]
  );
  return (await getEquipment(id))!;
}

function normalizeSerial(s: string): string {
  return String(s || "").trim().toLowerCase();
}

/**
 * Sync the equipment rows linked to a sales record with the submitted serial
 * list. NEVER deletes a row: matching is by SERIAL IDENTITY first (so
 * reordering/editing the list can't silently mix up which physical unit owns
 * which service history — the bug this replaced), falling back to positional
 * pairing only for entries with no serial yet (so records that have never had
 * a serial filled in don't explode into duplicates on every unrelated save).
 * A submitted list shorter than before UNLINKS the leftover rows
 * (`salesRecordId = ''`) instead of deleting them — the equipment and all its
 * warranty/schedule/log history stay in the database, just no longer
 * attached to this sale; they remain visible under the customer's equipment
 * list. The whole sync runs in one transaction.
 */
export async function syncEquipmentsForSalesRecord(
  salesRecordId: string,
  serialNumbers: string[],
  baseEquipmentData: Partial<CustomerEquipment>
): Promise<void> {
  if (!salesRecordId) return;

  const limit = Math.min(serialNumbers.length, 50);
  const wanted = serialNumbers.slice(0, limit).map((sn) => String(sn || "").trim());

  await withTransaction(async (conn) => {
    const [existingRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, serialNumber FROM customer_equipments WHERE salesRecordId = ? ORDER BY createdAt ASC`,
      [salesRecordId]
    );
    const existingEqs = existingRows as { id: string; serialNumber: string }[];

    const existingUsed = new Set<string>();
    const wantedUsed = new Set<number>();
    const pairs: { existingId: string; serial: string }[] = [];

    // Pass 1 — identity match: pair a submitted serial to the existing row
    // that already has that exact (normalized) serial. This is what keeps a
    // unit's history attached to the right physical unit when the list is
    // reordered or another entry is added/removed.
    for (let i = 0; i < wanted.length; i++) {
      const key = normalizeSerial(wanted[i]);
      if (!key) continue;
      const match = existingEqs.find(
        (eq) => !existingUsed.has(eq.id) && normalizeSerial(eq.serialNumber) === key
      );
      if (match) {
        existingUsed.add(match.id);
        wantedUsed.add(i);
        pairs.push({ existingId: match.id, serial: wanted[i] });
      }
    }

    // Pass 2 — positional fallback for whatever's left (blank serials, or a
    // serial with no existing match): pair remaining submitted slots with
    // remaining existing rows in original order. Preserves the old behavior
    // for equipment that has no serial yet, so unrelated edits don't spawn
    // duplicate rows.
    const remainingExisting = existingEqs.filter((eq) => !existingUsed.has(eq.id));
    let cursor = 0;
    for (let i = 0; i < wanted.length; i++) {
      if (wantedUsed.has(i)) continue;
      if (cursor < remainingExisting.length) {
        const eq = remainingExisting[cursor++];
        existingUsed.add(eq.id);
        wantedUsed.add(i);
        pairs.push({ existingId: eq.id, serial: wanted[i] });
      }
    }

    // Update every matched row (base fields + its resolved serial).
    for (const { existingId, serial } of pairs) {
      const v = cleanEquipment({ ...baseEquipmentData, serialNumber: serial });
      await conn.query(
        `UPDATE customer_equipments SET
           customerId = ?, productId = ?, productName = ?, serialNumber = ?, quotationNumber = ?,
           warrantyCertNumber = ?, warrantyType = ?, warrantyStartDate = ?,
           warrantyEndDate = ?, status = ?
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
    for (let i = 0; i < wanted.length; i++) {
      if (wantedUsed.has(i)) continue;
      const newId = crypto.randomUUID();
      const now = new Date().toISOString();
      const v = cleanEquipment({ ...baseEquipmentData, salesRecordId, serialNumber: wanted[i] });
      await conn.query(
        `INSERT INTO customer_equipments
           (id, salesRecordId, customerId, productId, productName, serialNumber, quotationNumber,
            warrantyCertNumber, warrantyType, warrantyStartDate, warrantyEndDate,
            status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  });
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
       warrantyEndDate = ?, status = ?, note = ?, calibrationDate = ?
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
  equipmentId?: string
): Promise<ServiceSchedule[]> {
  if (equipmentId) {
    const [rows] = await query<RowDataPacket[]>(
      `SELECT * FROM service_schedules WHERE equipmentId = ?
       ORDER BY scheduledDate ASC`,
      [equipmentId]
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
  // Defense-in-depth: whitelist scheduleType (mirrors updateSchedule).
  const scheduleType = SCHEDULE_TYPES.includes(data.scheduleType as ScheduleType)
    ? data.scheduleType
    : "service";
  await query(
    `INSERT INTO service_schedules
       (id, equipmentId, scheduleType, scheduledDate, assignedToAdminId,
        status, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sanitizePlainText(data.equipmentId || "").substring(0, 36),
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
  // can't write arbitrary values. Invalid → keep the existing value.
  const scheduleType = SCHEDULE_TYPES.includes(merged.scheduleType as ScheduleType)
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
 * - equipment whose warranty ends within `warrantyDays` (default 30) and is not
 *   already past — sorted soonest-first;
 * - pending schedules due within `scheduleDays` (default 7) OR already overdue.
 * Date comparison is lexical on YYYY-MM-DD strings (sorts chronologically).
 */
// The server runs at UTC (Vercel) but the team is in Thailand (UTC+7, no
// DST) — shifting the instant forward by the offset before taking the UTC
// calendar date gives Bangkok's wall-clock date instead of the server's.
// Without this, "today" between 00:00-06:59 Thai time is still "yesterday"
// server-side, so an overdue schedule/expired warranty from yesterday goes
// unflagged for up to 7 hours every single day. (bangkokDateString lives in
// dateFormat.ts, shared with salesDashboardStore.ts's identical need.)

export async function getAlerts(
  warrantyDays = 30,
  scheduleDays = 7,
  calibrationDays = 30
): Promise<CrmAlerts> {
  const today = bangkokDateString(new Date());
  const warrantyCutoff = bangkokDateString(new Date(Date.now() + warrantyDays * 86400000));
  const scheduleCutoff = bangkokDateString(new Date(Date.now() + scheduleDays * 86400000));
  const calibrationCutoff = bangkokDateString(new Date(Date.now() + calibrationDays * 86400000));

  const nowIso = new Date().toISOString();

  const [warrantyRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'warranty' AND sno.referenceId = e.id
     WHERE e.warrantyEndDate IS NOT NULL
       AND e.warrantyEndDate >= ? AND e.warrantyEndDate <= ?
       AND e.status != 'Expired'
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY e.warrantyEndDate ASC`,
    [today, warrantyCutoff, nowIso]
  );

  // Calibration is due 10 months after the last calibrationDate — computed in
  // SQL (DATE_ADD) rather than stored, so it always reflects the current
  // calibrationDate value with no separate column to keep in sync.
  const [calibrationRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'calibration' AND sno.referenceId = e.id
     WHERE e.calibrationDate IS NOT NULL
       AND DATE_ADD(e.calibrationDate, INTERVAL 10 MONTH) >= ?
       AND DATE_ADD(e.calibrationDate, INTERVAL 10 MONTH) <= ?
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY e.calibrationDate ASC`,
    [today, calibrationCutoff, nowIso]
  );

  const [incompleteRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'incomplete' AND sno.referenceId = e.id
     WHERE (e.serialNumber = '' OR e.serialNumber IS NULL OR e.warrantyStartDate IS NULL)
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY e.createdAt DESC LIMIT 100`,
    [nowIso]
  );

  // The list above is capped at 100 for display; count the true total
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

  const [scheduleRows] = await query<RowDataPacket[]>(
    `SELECT s.*, e.customerId, e.serialNumber, c.name AS customerName,
            co.name AS companyName, p.title_th AS productName
     FROM service_schedules s
     LEFT JOIN customer_equipments e ON s.equipmentId = e.id
     LEFT JOIN customers c ON e.customerId = c.id
     LEFT JOIN companies co ON c.companyId = co.id
     LEFT JOIN products p ON e.productId = p.id
     LEFT JOIN alert_snoozes sno ON sno.alertType = 'schedule' AND sno.referenceId = s.id
     WHERE s.status = 'pending' AND s.scheduledDate <= ?
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY s.scheduledDate ASC`,
    [scheduleCutoff, nowIso]
  );

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
       ((sr.saleType = 'equipment' AND sr.deliveryRef = '' AND DATEDIFF(?, sr.saleDate) >= 20)
       OR (sr.invoiceRef != '' AND sr.receiptRef = '' AND DATEDIFF(?, sr.saleDate) >= 30))
       AND (sno.snoozeUntil IS NULL OR sno.snoozeUntil <= ?)
     ORDER BY sr.saleDate ASC`,
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
