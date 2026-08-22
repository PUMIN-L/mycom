import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
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

// Joined SELECT used by every equipment read: names for display come from the
// live customers/companies/products rows (LEFT JOIN so a deleted product —
// loose reference by design — degrades to null, not a broken row).
const EQUIPMENT_SELECT = `
  SELECT e.*, c.name AS customerName, co.name AS companyName,
         p.title_th AS productName
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
  return {
    salesRecordId: sanitizePlainText(data.salesRecordId || "").substring(0, 255),
    customerId: sanitizePlainText(data.customerId || "").substring(0, 255),
    productId: sanitizePlainText(data.productId || "").substring(0, 255),
    productName: sanitizePlainText(data.productName || "").substring(0, 255),
    serialNumber: sanitizePlainText(data.serialNumber || "").substring(0, 255),
    quotationNumber: sanitizePlainText(data.quotationNumber || "").substring(0, 255),
    warrantyCertNumber: sanitizePlainText(data.warrantyCertNumber || "").substring(0, 255),
    warrantyType: sanitizePlainText(data.warrantyType || "").substring(0, 255),
    warrantyStartDate: data.warrantyStartDate
      ? sanitizePlainText(data.warrantyStartDate).substring(0, 20)
      : null,
    warrantyEndDate: data.warrantyEndDate
      ? sanitizePlainText(data.warrantyEndDate).substring(0, 20)
      : null,
    status: data.status === "Expired" ? "Expired" : "Active",
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
        status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      now,
    ]
  );
  return (await getEquipment(id))!;
}

export async function syncEquipmentsForSalesRecord(
  salesRecordId: string,
  serialNumbers: string[],
  baseEquipmentData: Partial<CustomerEquipment>
): Promise<void> {
  if (!salesRecordId) return;
  
  // 1. Fetch existing equipments for this sales record
  const [existing] = await query<RowDataPacket[]>(
    `SELECT id, serialNumber FROM customer_equipments WHERE salesRecordId = ? ORDER BY createdAt ASC`,
    [salesRecordId]
  );
  
  const existingEqs = existing as { id: string, serialNumber: string }[];
  
  // 2. Update existing or insert new
  const limit = Math.min(serialNumbers.length, 50);
  for (let i = 0; i < limit; i++) {
    const sn = String(serialNumbers[i] || "").trim();
    if (i < existingEqs.length) {
      // Update existing
      await updateEquipment(existingEqs[i].id, {
        ...baseEquipmentData,
        serialNumber: sn
      });
    } else {
      // Insert new
      await addEquipment({
        ...baseEquipmentData,
        salesRecordId,
        serialNumber: sn
      });
    }
  }
  
  // 3. Delete any excess equipments if qty was reduced
  for (let i = limit; i < existingEqs.length; i++) {
    await deleteEquipment(existingEqs[i].id);
  }
}

export async function updateEquipment(
  id: string,
  data: Partial<CustomerEquipment>
): Promise<CustomerEquipment | null> {
  const existing = await getEquipment(id);
  if (!existing) return null;
  const v = cleanEquipment({ ...existing, ...data });
  await query(
    `UPDATE customer_equipments SET
       customerId = ?, productId = ?, serialNumber = ?, quotationNumber = ?,
       warrantyCertNumber = ?, warrantyType = ?, warrantyStartDate = ?,
       warrantyEndDate = ?, status = ?
     WHERE id = ?`,
    [
      v.customerId,
      v.productId,
      v.serialNumber,
      v.quotationNumber,
      v.warrantyCertNumber,
      v.warrantyType,
      v.warrantyStartDate,
      v.warrantyEndDate,
      v.status,
      id,
    ]
  );
  return getEquipment(id);
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
export async function getAlerts(
  warrantyDays = 30,
  scheduleDays = 7
): Promise<CrmAlerts> {
  const today = new Date().toISOString().slice(0, 10);
  const warrantyCutoff = new Date(Date.now() + warrantyDays * 86400000)
    .toISOString()
    .slice(0, 10);
  const scheduleCutoff = new Date(Date.now() + scheduleDays * 86400000)
    .toISOString()
    .slice(0, 10);

  const [warrantyRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     WHERE e.warrantyEndDate IS NOT NULL
       AND e.warrantyEndDate >= ? AND e.warrantyEndDate <= ?
     ORDER BY e.warrantyEndDate ASC`,
    [today, warrantyCutoff]
  );

  const [incompleteRows] = await query<RowDataPacket[]>(
    `${EQUIPMENT_SELECT}
     WHERE e.serialNumber = '' OR e.serialNumber IS NULL OR e.warrantyStartDate IS NULL
     ORDER BY e.createdAt DESC LIMIT 100`
  );

  const [scheduleRows] = await query<RowDataPacket[]>(
    `SELECT s.*, e.customerId, e.serialNumber, c.name AS customerName,
            co.name AS companyName, p.title_th AS productName
     FROM service_schedules s
     LEFT JOIN customer_equipments e ON s.equipmentId = e.id
     LEFT JOIN customers c ON e.customerId = c.id
     LEFT JOIN companies co ON c.companyId = co.id
     LEFT JOIN products p ON e.productId = p.id
     WHERE s.status = 'pending' AND s.scheduledDate <= ?
     ORDER BY s.scheduledDate ASC`,
    [scheduleCutoff]
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
     WHERE 
       (sr.saleType = 'equipment' AND sr.deliveryRef = '' AND DATEDIFF(?, sr.saleDate) >= 20)
       OR (sr.invoiceRef != '' AND sr.receiptRef = '' AND DATEDIFF(?, sr.saleDate) >= 30)
     ORDER BY sr.saleDate ASC`,
    [today, today]
  );

  return {
    expiringWarranties: warrantyRows as CustomerEquipment[],
    incompleteEquipments: incompleteRows as CustomerEquipment[],
    missingDocuments: missingDocRows as SalesRecord[],
    upcomingSchedules: (scheduleRows as CrmAlerts["upcomingSchedules"]).map(
      (s) => ({ ...s, overdue: s.scheduledDate < today })
    ),
  };
}
