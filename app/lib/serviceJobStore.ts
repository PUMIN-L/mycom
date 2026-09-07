import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { sanitizePlainText } from "./sanitizeHtml";
import { isValidDateString } from "./dateFormat";
import { serviceJobDocNoPrefixes, nextServiceJobDocNo } from "./serviceJobNumber";
import { SERVICE_JOB_STATUSES } from "./types";
import type {
  ServiceJob,
  ServiceJobEquipment,
  ServiceJobStatus,
  ServiceJobSummary,
} from "./types";

// ── ใบ Job — the printed service job sheet ───────────────────────────────────
//
// WHAT THIS IS. A job sheet is a piece of paper. The office fills it in from
// data the system already holds, the technician carries it to the customer's
// site, writes what he did on it BY HAND, and the customer signs it with a pen.
// The signed paper comes back and is filed in a folder. Nothing is scanned,
// uploaded or signed on a screen.
//
// The system therefore owns exactly two moments, and nothing in between:
//
//   ออกใบ  (createJob)   → the data that gets printed, under a job number.
//   ปิดงาน (completeJob) → the record that the visit HAPPENED, under that
//                          number: one `service_logs` row per machine on the
//                          sheet, and the linked appointment closed.
//
// ⚠️ THE RULE THAT IS EASIEST TO BREAK, AND WORST TO BREAK: history is written
//    ONLY by completeJob. A sheet that was printed and never taken is not a
//    visit. If issuing wrote history, the database would claim a machine was
//    serviced on a day nobody went — and NOTHING downstream could ever tell
//    that record apart from a true one. If you are here to "simplify" by
//    writing the logs at creation time: that is the bug, not the simplification.
//
// ⚠️ NOTHING HERE TOUCHES `customer_equipments.calibrationDate`. The work
//    description is handwriting on paper; the system cannot know whether the
//    visit was a calibration or a five-minute lamp check. Guessing would push
//    the next calibration reminder out — i.e. silence an alert that should
//    ring, on a machine nobody has actually calibrated.

export type {
  ServiceJob,
  ServiceJobEquipment,
  ServiceJobStatus,
  ServiceJobSummary,
} from "./types";
export { SERVICE_JOB_STATUSES } from "./types";

/** Anything the admin can fix by changing what he typed. Carries a THAI
 * message, which routes hand straight back as a 400 — the message is the UI. */
export class ServiceJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceJobValidationError";
  }
}

/** A machine that belongs to a DIFFERENT customer. A job sheet is one visit to
 * one site, not a bundle of customers — the printed paper has one company name
 * and one signature block, so a second customer's machine on it is a document
 * that cannot be true. */
export class ServiceJobCustomerMismatchError extends ServiceJobValidationError {
  constructor(public readonly equipmentId: string) {
    super("เครื่องที่เลือกไม่ได้เป็นของลูกค้ารายนี้ ใบ Job หนึ่งใบใช้ได้กับลูกค้ารายเดียว");
    this.name = "ServiceJobCustomerMismatchError";
  }
}

/** The same machine twice on one sheet. `service_job_equipments`' composite
 * PRIMARY KEY (jobId, equipmentId) also refuses this at the database, so this
 * error exists to say WHICH machine in Thai rather than to be the only guard. */
export class ServiceJobDuplicateEquipmentError extends ServiceJobValidationError {
  constructor(public readonly equipmentId: string) {
    super("เครื่องนี้อยู่ในใบงานนี้แล้ว");
    this.name = "ServiceJobDuplicateEquipmentError";
  }
}

/** An edit/close/cancel/delete asked for on a sheet whose status forbids it. */
export class ServiceJobNotEditableError extends ServiceJobValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ServiceJobNotEditableError";
  }
}

/** Every candidate number for the day was already owned by the ledger. Not a
 * validation problem — nothing the admin typed can fix it — so it is NOT a
 * ServiceJobValidationError and surfaces as a 500 the way any other broken
 * invariant does. */
export class ServiceJobDocNoExhaustedError extends Error {
  constructor(public readonly jobDate: string) {
    super(`no free job number left for ${jobDate}`);
    this.name = "ServiceJobDocNoExhaustedError";
  }
}

export interface ServiceJobInput {
  companyId?: string;
  customerId?: string;
  jobDate?: string;
  technicianName?: string;
  scheduleId?: string | null;
  workSummary?: string | null;
  /** Client-suggested job number. Used as-is when provided; otherwise the
   *  server mints one from the shared `used_docnos` ledger. */
  jobNo?: string;
  /** In printed order. The first is line 1 on the paper. */
  equipmentIds?: string[];
}

export interface ListServiceJobsOptions {
  status?: string;
  customerId?: string;
  companyId?: string;
  /** Inclusive `YYYY-MM-DD` bounds on jobDate — the column is VARCHAR and
   * compares lexically, which is chronological for this shape. */
  fromDate?: string;
  toDate?: string;
  /** Matched against jobNo. */
  search?: string;
  limit?: number;
}

// One sheet is one site visit. The cap is a sanity bound on a payload, not a
// business rule — nobody services 200 machines in one trip, but a broken client
// can post 200 ids.
const MAX_EQUIPMENTS_PER_JOB = 50;
const LIST_SAFETY_LIMIT = 500;
// How many numbers the mint may step past before giving up (see claimJobNo).
const MAX_DOCNO_ATTEMPTS = 50;

const text = (value: unknown, max: number): string =>
  sanitizePlainText(value == null ? "" : String(value)).trim().substring(0, max);

function clampListLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return LIST_SAFETY_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), LIST_SAFETY_LIMIT);
}

// ── Reads ────────────────────────────────────────────────────────────────────

// `scheduleId` is a plain id with NO foreign key (see db.ts v38), so the linked
// appointment can be deleted out from under a sheet that has already been
// printed. This LEFT JOIN is how that stays a normal state instead of a broken
// page: `linkedScheduleId` simply comes back NULL and the sheet reads, prints
// and closes exactly as before.
const JOB_SELECT = `
  SELECT j.*, c.name AS customerName, co.name AS companyName,
         s.id AS linkedScheduleId
  FROM service_jobs j
  LEFT JOIN customers c ON j.customerId = c.id
  LEFT JOIN companies co ON j.companyId = co.id
  LEFT JOIN service_schedules s ON s.id = j.scheduleId`;

// Names and serials are read LIVE from customer_equipments and never copied
// onto the job rows: the serial number on the paper must be the one the system
// holds for that unit — that is the entire reason the admin is not allowed to
// type it. LEFT JOIN so a machine row that has gone missing degrades to nulls
// instead of silently dropping a line the printed sheet actually had.
const JOB_EQUIPMENT_SELECT = `
  SELECT sje.equipmentId, sje.sortOrder,
         e.serialNumber, e.warrantyEndDate, e.customerId,
         COALESCE(NULLIF(e.productName, ''), p.title_th) AS productName
  FROM service_job_equipments sje
  LEFT JOIN customer_equipments e ON sje.equipmentId = e.id
  LEFT JOIN products p ON e.productId = p.id`;

function rowToJob(row: RowDataPacket, equipments: ServiceJobEquipment[]): ServiceJob {
  return {
    id: String(row.id),
    jobNo: row.jobNo ?? "",
    companyId: row.companyId ?? "",
    customerId: row.customerId ?? "",
    jobDate: row.jobDate ?? "",
    technicianName: row.technicianName ?? "",
    scheduleId: row.scheduleId ?? null,
    status: normalizeStatus(row.status),
    workSummary: row.workSummary ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt ?? "",
    equipments,
    customerName: row.customerName ?? null,
    companyName: row.companyName ?? null,
    scheduleExists: row.linkedScheduleId != null,
  };
}

function normalizeStatus(value: unknown): ServiceJobStatus {
  const s = String(value ?? "");
  return (SERVICE_JOB_STATUSES as readonly string[]).includes(s)
    ? (s as ServiceJobStatus)
    : "issued";
}

function rowToEquipment(row: RowDataPacket): ServiceJobEquipment {
  return {
    equipmentId: String(row.equipmentId),
    sortOrder: Number(row.sortOrder ?? 0),
    productName: row.productName ?? null,
    serialNumber: row.serialNumber ?? null,
    warrantyEndDate: row.warrantyEndDate ?? null,
  };
}

function rowToSummary(row: RowDataPacket): ServiceJobSummary {
  return {
    id: String(row.id),
    jobNo: row.jobNo ?? "",
    companyId: row.companyId ?? "",
    customerId: row.customerId ?? "",
    jobDate: row.jobDate ?? "",
    technicianName: row.technicianName ?? "",
    status: normalizeStatus(row.status),
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt ?? "",
    equipmentCount: Number(row.equipmentCount ?? 0),
    customerName: row.customerName ?? null,
    companyName: row.companyName ?? null,
  };
}

/** Machines on a sheet, in printed order — so a reprint next year lists them
 * exactly as the copy the customer signed. */
async function readEquipments(jobId: string): Promise<ServiceJobEquipment[]> {
  const [rows] = await query<RowDataPacket[]>(
    `${JOB_EQUIPMENT_SELECT} WHERE sje.jobId = ? ORDER BY sje.sortOrder ASC, sje.equipmentId ASC`,
    [jobId]
  );
  return rows.map(rowToEquipment);
}

export async function getJob(id: string): Promise<ServiceJob | null> {
  const [rows] = await query<RowDataPacket[]>(`${JOB_SELECT} WHERE j.id = ?`, [id]);
  if (rows.length === 0) return null;
  return rowToJob(rows[0], await readEquipments(String(rows[0].id)));
}

// `equipmentCount` as a correlated subquery keeps this ONE statement with no
// GROUP BY, so adding a filter below can never silently change the count.
const JOB_SUMMARY_SELECT = `
  SELECT j.id, j.jobNo, j.companyId, j.customerId, j.jobDate, j.technicianName,
         j.status, j.completedAt, j.createdAt,
         c.name AS customerName, co.name AS companyName,
         (SELECT COUNT(*) FROM service_job_equipments sje WHERE sje.jobId = j.id)
           AS equipmentCount
  FROM service_jobs j
  LEFT JOIN customers c ON j.customerId = c.id
  LEFT JOIN companies co ON j.companyId = co.id`;

/**
 * Issued sheets, newest first.
 *
 * ⚠️ ORDER BY createdAt, NEVER by jobNo. A job number embeds the date as DDMMYY,
 * which does not sort chronologically as text ("050926" < "060826"). The same
 * warning governs quotation and billing numbers — see quotationNumber.ts.
 */
export async function listJobs(
  options: ListServiceJobsOptions = {}
): Promise<ServiceJobSummary[]> {
  const where: string[] = [];
  const params: string[] = [];

  const status = String(options.status ?? "").trim();
  if (status && (SERVICE_JOB_STATUSES as readonly string[]).includes(status)) {
    where.push("j.status = ?");
    params.push(status);
  }
  const customerId = String(options.customerId ?? "").trim();
  if (customerId) {
    where.push("j.customerId = ?");
    params.push(customerId);
  }
  const companyId = String(options.companyId ?? "").trim();
  if (companyId) {
    where.push("j.companyId = ?");
    params.push(companyId);
  }
  // Lexical comparison on a VARCHAR "YYYY-MM-DD" column IS chronological —
  // which is exactly why every date in this app is stored in that shape.
  const fromDate = String(options.fromDate ?? "").trim();
  if (fromDate && isValidDateString(fromDate)) {
    where.push("j.jobDate >= ?");
    params.push(fromDate);
  }
  const toDate = String(options.toDate ?? "").trim();
  if (toDate && isValidDateString(toDate)) {
    where.push("j.jobDate <= ?");
    params.push(toDate);
  }
  const search = String(options.search ?? "").trim().slice(0, 100);
  if (search) {
    // `!` as the LIKE escape char, not the default backslash, whose meaning
    // depends on the NO_BACKSLASH_ESCAPES sql_mode.
    where.push("LOWER(j.jobNo) LIKE ? ESCAPE '!'");
    params.push(`%${search.toLowerCase().replace(/[!%_]/g, (ch) => `!${ch}`)}%`);
  }

  const sql =
    `${JOB_SUMMARY_SELECT}` +
    (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY j.createdAt DESC LIMIT ${clampListLimit(options.limit)}`;
  const [rows] =
    params.length > 0
      ? await query<RowDataPacket[]>(sql, params)
      : await query<RowDataPacket[]>(sql);
  return rows.map(rowToSummary);
}

/**
 * Every job sheet this machine has ever been on, newest first — the service
 * history of one unit, which is the whole reason the sheet exists.
 *
 * Includes sheets that are still `issued`. They are NOT evidence of a visit
 * (only `completed` is), so a caller rendering history must show the status
 * beside each row rather than treating the list as "times we went".
 */
export async function listJobsForEquipment(
  equipmentId: string
): Promise<ServiceJobSummary[]> {
  const [rows] = await query<RowDataPacket[]>(
    `${JOB_SUMMARY_SELECT}
     JOIN service_job_equipments sjel ON sjel.jobId = j.id
     WHERE sjel.equipmentId = ?
     ORDER BY j.createdAt DESC
     LIMIT ${LIST_SAFETY_LIMIT}`,
    [equipmentId]
  );
  return rows.map(rowToSummary);
}

// ── Validation ───────────────────────────────────────────────────────────────

interface NormalizedInput {
  companyId: string;
  customerId: string;
  jobDate: string;
  technicianName: string;
  scheduleId: string | null;
  workSummary: string | null;
  jobNo: string;
  equipmentIds: string[];
}

function normalizeInput(input: ServiceJobInput): NormalizedInput {
  const companyId = text(input.companyId, 255);
  const customerId = text(input.customerId, 255);
  const jobDate = text(input.jobDate, 20);

  if (!companyId) throw new ServiceJobValidationError("กรุณาเลือกบริษัทลูกค้า");
  if (!customerId) throw new ServiceJobValidationError("กรุณาเลือกผู้ติดต่อ");
  if (!jobDate || !isValidDateString(jobDate)) {
    throw new ServiceJobValidationError("กรุณาระบุวันที่ให้ถูกต้อง (YYYY-MM-DD)");
  }

  const rawIds = Array.isArray(input.equipmentIds) ? input.equipmentIds : [];
  const equipmentIds: string[] = [];
  for (const raw of rawIds) {
    const equipmentId = text(raw, 36);
    if (!equipmentId) continue;
    // The composite PRIMARY KEY would refuse this anyway; saying so in Thai,
    // naming the machine, is friendlier than a duplicate-key 500.
    if (equipmentIds.includes(equipmentId)) {
      throw new ServiceJobDuplicateEquipmentError(equipmentId);
    }
    equipmentIds.push(equipmentId);
  }
  if (equipmentIds.length === 0) {
    throw new ServiceJobValidationError("กรุณาเลือกเครื่องอย่างน้อย 1 เครื่อง");
  }
  if (equipmentIds.length > MAX_EQUIPMENTS_PER_JOB) {
    throw new ServiceJobValidationError(
      `ใบ Job หนึ่งใบใส่เครื่องได้ไม่เกิน ${MAX_EQUIPMENTS_PER_JOB} เครื่อง`
    );
  }

  return {
    companyId,
    customerId,
    jobDate,
    // Empty on purpose is a VALID, complete sheet: the printed paper then
    // carries a ruled blank line for the technician to write his own name on.
    technicianName: text(input.technicianName, 255),
    scheduleId: text(input.scheduleId, 36) || null,
    workSummary:
      input.workSummary === undefined || input.workSummary === null
        ? null
        : text(input.workSummary, 10000),
    jobNo: text(input.jobNo, 255),
    equipmentIds,
  };
}

/**
 * Every machine on the sheet must exist and belong to the sheet's customer.
 *
 * Runs on the TRANSACTION's connection, so the check and the rows it authorises
 * are one atomic read-then-write rather than a check against a snapshot some
 * other statement may already have moved on from.
 */
async function assertEquipmentsBelongToCustomer(
  conn: PoolConnection,
  customerId: string,
  equipmentIds: string[]
): Promise<void> {
  const placeholders = equipmentIds.map(() => "?").join(", ");
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, customerId FROM customer_equipments WHERE id IN (${placeholders})`,
    equipmentIds
  );
  const owners = new Map<string, string>();
  for (const row of rows) owners.set(String(row.id), String(row.customerId ?? ""));
  for (const equipmentId of equipmentIds) {
    const owner = owners.get(equipmentId);
    if (owner === undefined) {
      throw new ServiceJobValidationError("ไม่พบเครื่องที่เลือกในระบบ");
    }
    if (owner !== customerId) throw new ServiceJobCustomerMismatchError(equipmentId);
  }
}

// ── Document number ──────────────────────────────────────────────────────────

/**
 * Claim `JOB<DDMMYY>-NN` from the SHARED `used_docnos` ledger — the same
 * register quotations and billing documents use, so all three document families
 * are kept apart by one PRIMARY KEY instead of three hopeful conventions.
 * (`quotationId` is that ledger's owner column whatever kind of document owns
 * the number; billing already stores its own ids there.)
 *
 * THE NUMBER IS DECIDED BY AN INSERT, NEVER BY A SELECT. Reading the ledger and
 * trusting what it said lets two admins clicking บันทึก at the same instant both
 * "win" the same number: TiDB takes no gap lock on a row that does not exist
 * yet, so even `SELECT … FOR UPDATE` before the insert is a no-op for a brand
 * new number. The PRIMARY KEY is the only arbiter that always holds — so the
 * loser here gets `ER_DUP_ENTRY`, steps PAST that number and tries the next
 * one, and comes away with a number of his own instead of an error telling him
 * to go and invent one himself. Identical reasoning to saveQuotationAtomic.
 */
async function claimJobNo(
  conn: PoolConnection,
  jobId: string,
  jobDate: string,
  now: string
): Promise<string> {
  const prefixes = serviceJobDocNoPrefixes(jobDate);
  const taken = new Set<string>();
  for (const prefix of prefixes) {
    // NOT windowed by date. `used_docnos` is never purged, so it still owns
    // every number ever issued, and a 7-day window cannot see a number a
    // colliding date shape parked under this prefix in another year — minting
    // from one hands back a number the PRIMARY KEY then refuses. Read on the
    // transaction's own connection (listDocNosByBase runs on the pool).
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT docNo FROM used_docnos WHERE docNo LIKE ? ESCAPE '\\\\'",
      [`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]
    );
    for (const row of rows) taken.add(String(row.docNo));
  }

  for (let attempt = 0; attempt < MAX_DOCNO_ATTEMPTS; attempt++) {
    // nextServiceJobDocNo already refuses to return anything in `taken`, so
    // each pass proposes a number strictly further along the day's sequence.
    const candidate = nextServiceJobDocNo(jobDate, Array.from(taken));
    try {
      await conn.query(
        "INSERT INTO used_docnos (docNo, quotationId, createdAt) VALUES (?, ?, ?)",
        [candidate, jobId, now]
      );
      return candidate;
    } catch (err) {
      if ((err as { code?: string })?.code !== "ER_DUP_ENTRY") throw err;
      // Someone claimed it between our read and our insert. Their number, not
      // ours — remember it and take the next free one.
      taken.add(candidate);
    }
  }
  throw new ServiceJobDocNoExhaustedError(jobDate);
}

// ── Writes ───────────────────────────────────────────────────────────────────

const INSERT_JOB_EQUIPMENTS_SQL = `
  INSERT INTO service_job_equipments (jobId, equipmentId, sortOrder)
  VALUES {VALUES}
  ON DUPLICATE KEY UPDATE sortOrder = VALUES(sortOrder)`;

/** One multi-row INSERT, so the machine list can never land half-written.
 * `ON DUPLICATE KEY UPDATE` keeps it re-runnable: withTransaction may replay
 * this whole callback after a dropped connection. */
async function writeEquipments(
  conn: PoolConnection,
  jobId: string,
  equipmentIds: string[]
): Promise<void> {
  const values = equipmentIds.map(() => "(?, ?, ?)").join(", ");
  const params: (string | number)[] = [];
  equipmentIds.forEach((equipmentId, index) => {
    params.push(jobId, equipmentId, index);
  });
  await conn.query(INSERT_JOB_EQUIPMENTS_SQL.replace("{VALUES}", values), params);
}

/**
 * Issue a sheet: reserve its number and write it with its machines, atomically.
 *
 * ⚠️ The id and timestamp are minted INSIDE the callback. `withTransaction`
 * replays its callback up to 3 times after a transient connection loss, and an
 * id minted outside would make the replay claim a SECOND number for what the
 * caller sees as one save.
 *
 * Writes NO history — see the header. Status starts `issued`.
 */
export async function createJob(input: ServiceJobInput): Promise<ServiceJob> {
  const data = normalizeInput(input);

  const jobId = await withTransaction(async (conn) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await assertEquipmentsBelongToCustomer(conn, data.customerId, data.equipmentIds);

    // Use client-provided jobNo if present, otherwise mint one.
    let jobNo: string;
    if (data.jobNo) {
      // Attempt to claim the client-suggested number. If it's already taken,
      // fall back to the auto-mint logic.
      try {
        await conn.query(
          "INSERT INTO used_docnos (docNo, quotationId, createdAt) VALUES (?, ?, ?)",
          [data.jobNo, id, now]
        );
        jobNo = data.jobNo;
      } catch (err) {
        if ((err as { code?: string })?.code === "ER_DUP_ENTRY") {
          // Client's number is taken — fall back to auto-mint.
          jobNo = await claimJobNo(conn, id, data.jobDate, now);
        } else {
          throw err;
        }
      }
    } else {
      jobNo = await claimJobNo(conn, id, data.jobDate, now);
    }

    await conn.query(
      `INSERT INTO service_jobs
         (id, jobNo, companyId, customerId, jobDate, technicianName, scheduleId,
          status, workSummary, completedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, NULL, ?)`,
      [
        id,
        jobNo,
        data.companyId,
        data.customerId,
        data.jobDate,
        data.technicianName,
        data.scheduleId,
        data.workSummary,
        now,
      ]
    );
    await writeEquipments(conn, id, data.equipmentIds);
    return id;
  });

  // Read back what was actually persisted (joined names, live serials) instead
  // of echoing the caller's input back at him.
  return (await getJob(jobId))!;
}

/**
 * Edit a sheet that has NOT been closed yet.
 *
 * `jobNo` is never rewritten: the number is on paper that may already be in a
 * technician's bag, and it is the handle the office uses when that paper comes
 * back. A `completed` sheet is history and a `cancelled` one is closed — both
 * refuse edits in Thai rather than quietly rewriting a record of the past.
 */
export async function updateJob(
  id: string,
  input: ServiceJobInput
): Promise<ServiceJob | null> {
  const data = normalizeInput(input);

  const found = await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM service_jobs WHERE id = ? FOR UPDATE",
      [id]
    );
    if (rows.length === 0) return false;
    const status = normalizeStatus(rows[0].status);
    if (status !== "issued") {
      throw new ServiceJobNotEditableError(
        status === "completed"
          ? "ใบงานที่ปิดแล้วแก้ไขไม่ได้ เพราะถูกบันทึกเป็นประวัติการเข้าบริการแล้ว"
          : "ใบงานที่ยกเลิกแล้วแก้ไขไม่ได้"
      );
    }

    await assertEquipmentsBelongToCustomer(conn, data.customerId, data.equipmentIds);

    await conn.query(
      `UPDATE service_jobs SET
         companyId = ?, customerId = ?, jobDate = ?, technicianName = ?,
         scheduleId = ?, workSummary = ?
       WHERE id = ?`,
      [
        data.companyId,
        data.customerId,
        data.jobDate,
        data.technicianName,
        data.scheduleId,
        data.workSummary,
        id,
      ]
    );
    // Drop the machines that are no longer on the sheet, then upsert the rest
    // with their new print order. Both halves are idempotent, so a replayed
    // callback lands on the same final list.
    const placeholders = data.equipmentIds.map(() => "?").join(", ");
    await conn.query(
      `DELETE FROM service_job_equipments
       WHERE jobId = ? AND equipmentId NOT IN (${placeholders})`,
      [id, ...data.equipmentIds]
    );
    await writeEquipments(conn, id, data.equipmentIds);
    return true;
  });

  return found ? getJob(id) : null;
}

/**
 * ปิดงาน — the signed paper is back in the office.
 *
 * THIS IS THE ONLY FUNCTION THAT WRITES SERVICE HISTORY, and it does the whole
 * thing in ONE transaction:
 *   • `status` → `completed` + `completedAt`
 *   • one `service_logs` row PER MACHINE on the sheet, with
 *     `serviceReportNumber` = `jobNo` — the meaning that column has been
 *     waiting for since add-crm-service-tracking created it
 *   • the linked appointment closed, IF it still exists
 *
 * CLOSING TWICE WRITES NOTHING THE SECOND TIME. Three independent guards, in
 * order: the row is read `FOR UPDATE`; the status flip is `WHERE status =
 * 'issued'` and a zero-row result means someone else already closed it, so the
 * logs are skipped; and `service_logs` carries a UNIQUE (jobId, equipmentId).
 * The first two also make the callback safe to REPLAY, which withTransaction
 * does up to 3 times on a dropped connection — and every UUID here is minted
 * inside the callback for the same reason.
 */
export async function completeJob(
  id: string,
  options: { workSummary?: string | null } = {}
): Promise<ServiceJob | null> {
  const workSummary =
    options.workSummary === undefined || options.workSummary === null
      ? null
      : text(options.workSummary, 10000);

  const outcome = await withTransaction(async (conn) => {
    const now = new Date().toISOString();

    const [jobRows] = await conn.query<RowDataPacket[]>(
      "SELECT id, jobNo, jobDate, status, scheduleId FROM service_jobs WHERE id = ? FOR UPDATE",
      [id]
    );
    if (jobRows.length === 0) return "missing";
    const job = jobRows[0];
    const status = normalizeStatus(job.status);
    if (status === "cancelled") {
      throw new ServiceJobNotEditableError("ใบงานที่ยกเลิกแล้วปิดงานไม่ได้");
    }
    // Already closed: return WITHOUT touching service_logs. A second set of
    // logs would be a second visit that never happened.
    if (status === "completed") return "already";

    const [equipmentRows] = await conn.query<RowDataPacket[]>(
      "SELECT equipmentId FROM service_job_equipments WHERE jobId = ? ORDER BY sortOrder ASC, equipmentId ASC",
      [id]
    );

    // The appointment may have been deleted since the sheet was issued — that
    // is an ordinary state (no FK, on purpose). `service_logs.scheduleId` DOES
    // carry a foreign key, so writing a dangling id here would make the whole
    // close fail on a sheet whose only sin is that its appointment is gone.
    // Resolve it first: still there → link the logs and close it; gone → the
    // logs simply carry NULL, which v38 made legal for exactly this case.
    let scheduleId: string | null = null;
    if (job.scheduleId) {
      const [scheduleRows] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM service_schedules WHERE id = ? FOR UPDATE",
        [String(job.scheduleId)]
      );
      if (scheduleRows.length > 0) scheduleId = String(job.scheduleId);
    }

    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE service_jobs
         SET status = 'completed', completedAt = ?, workSummary = COALESCE(?, workSummary)
       WHERE id = ? AND status = 'issued'`,
      [now, workSummary, id]
    );
    // Zero rows = another writer closed it between the read and here. Standing
    // down leaves exactly one set of logs, written by whoever won.
    if ((res?.affectedRows ?? 0) === 0) return "already";

    const jobNo = String(job.jobNo ?? "");
    const actionDate = String(job.jobDate ?? "") || now;
    for (const row of equipmentRows) {
      await conn.query(
        `INSERT INTO service_logs
           (id, scheduleId, equipmentId, jobId, serviceReportNumber, actionDate,
            resultDetails, customerFeedback, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`,
        [
          crypto.randomUUID(),
          scheduleId,
          String(row.equipmentId),
          id,
          jobNo,
          actionDate,
          workSummary ?? "",
          now,
        ]
      );
    }

    if (scheduleId) {
      // `completed`, not `done`: SCHEDULE_STATUSES is
      // pending | completed | cancelled, and a value outside it would be
      // invisible to every existing filter and label in the CRM. The
      // "a completed schedule always has a result log" invariant that
      // updateSchedule() enforces holds here — the logs above ARE that log.
      await conn.query(
        "UPDATE service_schedules SET status = 'completed' WHERE id = ? AND status <> 'completed'",
        [scheduleId]
      );
    }
    return "completed";
  });

  if (outcome === "missing") return null;
  return getJob(id);
}

/**
 * The trip never happened. Only an `issued` sheet can be cancelled: a
 * `completed` one has already written service history, and cancelling it would
 * leave logs describing a visit the sheet denies.
 *
 * The number stays claimed in `used_docnos` forever — that ledger is never
 * purged, and a number that was printed on paper must never be handed to a
 * second document.
 */
export async function cancelJob(id: string): Promise<ServiceJob | null> {
  const found = await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM service_jobs WHERE id = ? FOR UPDATE",
      [id]
    );
    if (rows.length === 0) return false;
    const status = normalizeStatus(rows[0].status);
    if (status === "completed") {
      throw new ServiceJobNotEditableError(
        "ใบงานที่ปิดแล้วยกเลิกไม่ได้ เพราะถูกบันทึกเป็นประวัติการเข้าบริการแล้ว"
      );
    }
    if (status === "issued") {
      await conn.query(
        "UPDATE service_jobs SET status = 'cancelled' WHERE id = ? AND status = 'issued'",
        [id]
      );
    }
    return true;
  });
  return found ? getJob(id) : null;
}

/**
 * Delete a sheet that was never closed (a mistake caught before it mattered).
 *
 * A `completed` sheet is REFUSED: its `service_logs` rows are the service
 * history of real machines, and deleting the sheet they name would leave that
 * history pointing at nothing. Its number is kept in `used_docnos` either way.
 */
export async function deleteJob(id: string): Promise<boolean> {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, status FROM service_jobs WHERE id = ? FOR UPDATE",
      [id]
    );
    if (rows.length === 0) return false;
    if (normalizeStatus(rows[0].status) === "completed") {
      throw new ServiceJobNotEditableError(
        "ใบงานที่ปิดแล้วลบไม่ได้ เพราะเป็นประวัติการเข้าบริการของเครื่อง"
      );
    }
    await conn.query("DELETE FROM service_job_equipments WHERE jobId = ?", [id]);
    await conn.query("DELETE FROM service_jobs WHERE id = ?", [id]);
    return true;
  });
}
