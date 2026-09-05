import "server-only";
import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import { bangkokDateString, isValidDateString } from "./dateFormat";
import type {
  TaskTopic,
  TaskLink,
  TaskLinkTarget,
  TaskStatus,
  CrmTask,
} from "./types";
import { TASK_TOPIC_COLORS, TASK_LINK_TARGETS, TASK_STATUSES } from "./types";

// The manual task board behind /crm/alerts: post-it notes the admin writes for
// himself ("call this customer", "quote that one"), filed under user-editable
// topics and optionally linked out to customers/machines/quotations/documents.
// Every reference here (crm_tasks.topicId, task_links.taskId, task_links
// .targetId) is a SOFT link with no FK, so a purged quotation can never take a
// task down with it — which is why deletes clean up their own link rows.

// Re-exported so callers can keep importing from "./taskStore".
export type { TaskTopic, TaskLink, TaskLinkTarget, TaskStatus, CrmTask } from "./types";
export { TASK_TOPIC_COLORS, TASK_LINK_TARGETS, TASK_STATUSES } from "./types";

/** Heading shown for a task whose topic row is gone (edited outside the app).
 * The task still loads — it is never hidden and never throws. */
export const UNASSIGNED_TOPIC_NAME = "ไม่ระบุหัวข้อ";
const UNASSIGNED_TOPIC_ICON = "📌";
const UNASSIGNED_TOPIC_COLOR = "slate";

/** Bad input from a caller. Routes turn this into a 400 and show `message`
 * (Thai) as-is, so it must always be user-readable. */
export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

/** deleteTopic() on a topic that still has tasks filed under it. `topicId` is
 * a soft reference with no FK, so deleting would orphan those tasks silently —
 * the caller must tell the admin to hide the topic instead. */
export class TopicInUseError extends Error {
  constructor(public readonly topicId: number, public readonly taskCount: number) {
    super("หัวข้อนี้มีงานอยู่ ไม่สามารถลบได้ กรุณาซ่อนแทน");
    this.name = "TopicInUseError";
  }
}

/** Structural shape of the mysql2 connection a `withTransaction` callback
 * receives — declared here so this module needs no mysql2 connection types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxConn = { query: (sql: string, params?: unknown[]) => Promise<any> };

// ── Validation helpers ───────────────────────────────────────────────────────

function cleanName(value: unknown, field: string): string {
  const name = sanitizePlainText(String(value ?? "")).trim();
  if (!name) throw new TaskValidationError(`กรุณาระบุ${field}`);
  return name.substring(0, 255);
}

/** Emoji are surrogate pairs / ZWJ sequences, so trim by CODE POINT — a plain
 * substring can cut a pair in half and store a lone surrogate. */
function cleanIcon(value: unknown): string {
  const icon = sanitizePlainText(String(value ?? "")).trim();
  return [...icon].slice(0, 8).join("");
}

function cleanColor(value: unknown): string {
  const color = sanitizePlainText(String(value ?? "")).trim();
  if (!color) return TASK_TOPIC_COLORS[0];
  if (!(TASK_TOPIC_COLORS as readonly string[]).includes(color)) {
    throw new TaskValidationError("สีของหัวข้อไม่ถูกต้อง");
  }
  return color;
}

function cleanTopicId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TaskValidationError("กรุณาเลือกหัวข้อของงาน");
  }
  return id;
}

/** null when the caller asked to CLEAR the due date. `dueDate` is compared
 * lexically against a VARCHAR column, so only exact YYYY-MM-DD may be stored. */
function cleanDueDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const due = sanitizePlainText(String(value)).trim();
  if (!due) return null;
  if (!isValidDateString(due)) {
    throw new TaskValidationError("รูปแบบวันครบกำหนดต้องเป็น YYYY-MM-DD");
  }
  return due;
}

function cleanStatus(value: unknown): TaskStatus {
  const status = String(value ?? "").trim();
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    throw new TaskValidationError("สถานะของงานไม่ถูกต้อง");
  }
  return status as TaskStatus;
}

export interface TaskLinkInput {
  targetType: TaskLinkTarget;
  targetId: string;
  /** Snapshot of the target's name AT LINK TIME (see buildLinkLabel). */
  label?: string | null;
}

/** A link whose fields are all validated, sanitized and non-null. */
type CleanLink = { targetType: TaskLinkTarget; targetId: string; label: string };

function cleanLink(link: TaskLinkInput): CleanLink {
  const targetType = String(link?.targetType ?? "").trim();
  if (!(TASK_LINK_TARGETS as readonly string[]).includes(targetType)) {
    throw new TaskValidationError("ชนิดของลิงก์ไม่ถูกต้อง");
  }
  const targetId = sanitizePlainText(String(link?.targetId ?? "")).trim().substring(0, 255);
  if (!targetId) throw new TaskValidationError("ลิงก์ต้องระบุปลายทาง");
  return {
    targetType: targetType as TaskLinkTarget,
    targetId,
    label: sanitizePlainText(String(link?.label ?? "")).trim().substring(0, 255),
  };
}

/** Validate + de-duplicate a submitted link set. The PK is
 * (taskId, targetType, targetId), so picking the same target twice in one form
 * is a no-op rather than a duplicate-key error. */
function cleanLinks(links: TaskLinkInput[] | undefined): CleanLink[] {
  if (!links || links.length === 0) return [];
  const byKey = new Map<string, CleanLink>();
  for (const raw of links) {
    const link = cleanLink(raw);
    const key = `${link.targetType}\u0000${link.targetId}`;
    if (!byKey.has(key)) byKey.set(key, link);
  }
  return [...byKey.values()];
}

export interface LinkLabelSource {
  /** customer */
  name?: string | null;
  companyName?: string | null;
  /** equipment */
  productName?: string | null;
  serialNumber?: string | null;
  /** quotation */
  docNo?: string | null;
  /** document */
  title?: string | null;
}

/**
 * The one place that decides what a link chip's snapshot reads like:
 * customer = name (+ company), equipment = product name + S/N,
 * quotation = docNo, document = title. Computed once, when the link is made —
 * it is deliberately NEVER re-synced, so the chip still says something
 * meaningful after the target has been deleted or purged.
 */
export function buildLinkLabel(targetType: TaskLinkTarget, source: LinkLabelSource): string {
  const text = (value: string | null | undefined) => String(value ?? "").trim();
  let label = "";
  switch (targetType) {
    case "customer": {
      const name = text(source.name);
      const company = text(source.companyName);
      label = company ? (name ? `${name} (${company})` : company) : name;
      break;
    }
    case "equipment": {
      const product = text(source.productName);
      const serial = text(source.serialNumber);
      label = serial ? (product ? `${product} (S/N ${serial})` : `S/N ${serial}`) : product;
      break;
    }
    case "quotation":
      label = text(source.docNo);
      break;
    case "document":
      label = text(source.title);
      break;
  }
  return sanitizePlainText(label).trim().substring(0, 255);
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToTopic(row: RowDataPacket): TaskTopic {
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    icon: String(row.icon ?? ""),
    color: String(row.color ?? ""),
    sortOrder: Number(row.sortOrder ?? 0),
    isActive: Boolean(row.isActive), // TINYINT(1) → boolean
    createdAt: String(row.createdAt ?? ""),
  };
}

function rowToTask(row: RowDataPacket): CrmTask {
  const hasTopic = row.topicName !== null && row.topicName !== undefined;
  return {
    id: String(row.id),
    topicId: Number(row.topicId),
    title: String(row.title ?? ""),
    detail: row.detail ?? null,
    dueDate: row.dueDate || null,
    status: (row.status === "done" ? "done" : "pending") as TaskStatus,
    completedAt: row.completedAt ?? null,
    createdAt: String(row.createdAt ?? ""),
    // A missing topic row (data edited outside the app) degrades to the
    // fallback heading instead of throwing or dropping the task.
    topicName: hasTopic ? String(row.topicName) : UNASSIGNED_TOPIC_NAME,
    topicIcon: hasTopic ? String(row.topicIcon ?? "") : UNASSIGNED_TOPIC_ICON,
    topicColor: hasTopic ? String(row.topicColor ?? "") : UNASSIGNED_TOPIC_COLOR,
    links: [],
  };
}

function rowToLink(row: RowDataPacket): TaskLink {
  return {
    taskId: String(row.taskId),
    targetType: String(row.targetType) as TaskLinkTarget,
    targetId: String(row.targetId),
    label: String(row.label ?? ""),
    createdAt: String(row.createdAt ?? ""),
  };
}

// ── Topics ───────────────────────────────────────────────────────────────────

export async function listTopics(includeHidden = false): Promise<TaskTopic[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM task_topics
     ${includeHidden ? "" : "WHERE isActive = 1"}
     ORDER BY sortOrder ASC, id ASC`
  );
  return rows.map(rowToTopic);
}

export async function getTopic(id: number): Promise<TaskTopic | null> {
  const [rows] = await query<RowDataPacket[]>("SELECT * FROM task_topics WHERE id = ?", [
    Number(id),
  ]);
  return rows[0] ? rowToTopic(rows[0]) : null;
}

export async function addTopic(topic: {
  name: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
}): Promise<TaskTopic> {
  const name = cleanName(topic?.name, "ชื่อหัวข้อ");
  const icon = cleanIcon(topic?.icon);
  const color = cleanColor(topic?.color);
  const createdAt = new Date().toISOString();

  // Allocate id = MAX(id)+1 and insert it. Under concurrency two callers can
  // compute the same next id; the loser hits a duplicate-key error and simply
  // retries with a freshly-read max, instead of failing the request. Same
  // pattern as addCategory in productStore.ts.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [maxRows] = await query<RowDataPacket[]>("SELECT MAX(id) AS maxId FROM task_topics");
    const nextId = Number(maxRows[0]?.maxId ?? 0) + 1;
    const sortOrder = Number.isFinite(Number(topic?.sortOrder))
      ? Number(topic?.sortOrder)
      : nextId;
    try {
      await query(
        `INSERT INTO task_topics (id, name, icon, color, sortOrder, isActive, createdAt)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [nextId, name, icon, color, sortOrder, createdAt]
      );
      return { id: nextId, name, icon, color, sortOrder, isActive: true, createdAt };
    } catch (error) {
      const isDup = (error as { code?: string })?.code === "ER_DUP_ENTRY";
      if (isDup && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
  }
  throw new Error("Failed to allocate a task topic id after multiple attempts");
}

/** Renames / recolours a topic. Never touches crm_tasks: tasks reference
 * `topicId`, not the name, so every existing task (open or done) shows the new
 * heading immediately without a single row being rewritten. */
export async function updateTopic(
  id: number,
  updates: { name?: string; icon?: string; color?: string }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates?.name !== undefined) {
    sets.push("name = ?");
    params.push(cleanName(updates.name, "ชื่อหัวข้อ"));
  }
  if (updates?.icon !== undefined) {
    sets.push("icon = ?");
    params.push(cleanIcon(updates.icon));
  }
  if (updates?.color !== undefined) {
    sets.push("color = ?");
    params.push(cleanColor(updates.color));
  }
  if (sets.length === 0) return false;

  params.push(Number(id));
  const [result] = await query<ResultSetHeader>(
    `UPDATE task_topics SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
  return result.affectedRows > 0;
}

/**
 * Retiring a topic is a flag flip and NOTHING else: no row is deleted, and no
 * task under it is deleted or moved. A hidden topic simply stops being offered
 * when creating a task — its tasks keep loading and keep showing their badge.
 */
export async function setTopicActive(id: number, isActive: boolean): Promise<boolean> {
  const [result] = await query<ResultSetHeader>(
    "UPDATE task_topics SET isActive = ? WHERE id = ?",
    [isActive ? 1 : 0, Number(id)]
  );
  return result.affectedRows > 0;
}

/** Writes the whole new order in ONE transaction (all-or-nothing). Ids that no
 * longer exist are ignored rather than failing the batch — a stale tab must not
 * be able to break a reorder for every other topic. */
export async function reorderTopics(ids: number[]): Promise<boolean> {
  const orderedIds = (ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id));
  if (orderedIds.length === 0) return true;

  await withTransaction(async (conn: TxConn) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.query("UPDATE task_topics SET sortOrder = ? WHERE id = ?", [
        i + 1,
        orderedIds[i],
      ]);
    }
  });
  return true;
}

/**
 * Deletes a topic ONLY when no task references it — pending or done. Otherwise
 * throws TopicInUseError so the caller can tell the admin to hide it instead:
 * `topicId` is a soft reference with no FK, so deleting a topic still in use
 * would silently orphan those tasks and lose the history behind them.
 * Returns false when the topic does not exist.
 */
export async function deleteTopic(id: number): Promise<boolean> {
  const topicId = Number(id);
  const [countRows] = await query<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM crm_tasks WHERE topicId = ?",
    [topicId]
  );
  const taskCount = Number(countRows[0]?.cnt) || 0;
  if (taskCount > 0) throw new TopicInUseError(topicId, taskCount);

  const [result] = await query<ResultSetHeader>("DELETE FROM task_topics WHERE id = ?", [
    topicId,
  ]);
  return result.affectedRows > 0;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

const DEFAULT_TASK_LIMIT = 200;
const MAX_TASK_LIMIT = 500;

export interface ListTasksOptions {
  topicId?: number;
  status?: TaskStatus;
  limit?: number;
}

/** Loads the links for a whole page of tasks in ONE query and hangs them off
 * their tasks — never one query per task. */
async function attachLinks(tasks: CrmTask[]): Promise<CrmTask[]> {
  if (tasks.length === 0) return tasks;
  const placeholders = tasks.map(() => "?").join(", ");
  const [linkRows] = await query<RowDataPacket[]>(
    `SELECT * FROM task_links WHERE taskId IN (${placeholders})
     ORDER BY createdAt ASC, targetType ASC, targetId ASC`,
    tasks.map((t) => t.id)
  );
  const byTask = new Map<string, TaskLink[]>();
  for (const row of linkRows) {
    const link = rowToLink(row);
    const list = byTask.get(link.taskId);
    if (list) list.push(link);
    else byTask.set(link.taskId, [link]);
  }
  for (const task of tasks) task.links = byTask.get(task.id) ?? [];
  return tasks;
}

/**
 * Board listing. Default order is overdue → due today → due later → no due date
 * (newest first inside that last group), which is the order the admin actually
 * works in. The "done" view is ordered by most recently completed instead.
 */
export async function listTasks(options: ListTasksOptions = {}): Promise<CrmTask[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.topicId !== undefined && options.topicId !== null) {
    where.push("t.topicId = ?");
    params.push(Number(options.topicId));
  }
  if (options.status) {
    where.push("t.status = ?");
    params.push(cleanStatus(options.status));
  }

  const today = bangkokDateString(new Date());
  let orderBy: string;
  if (options.status === "done") {
    orderBy = "ORDER BY t.completedAt DESC, t.createdAt DESC";
  } else {
    // Bucket 0/1/2/3 = overdue / today / future / undated. Undated rows are
    // normalised to '' so they compare equal and fall through to createdAt.
    orderBy = `ORDER BY
       CASE
         WHEN t.dueDate IS NULL OR t.dueDate = '' THEN 3
         WHEN t.dueDate < ? THEN 0
         WHEN t.dueDate = ? THEN 1
         ELSE 2
       END ASC,
       COALESCE(NULLIF(t.dueDate, ''), '') ASC,
       t.createdAt DESC`;
    params.push(today, today);
  }

  const limit = Math.min(
    MAX_TASK_LIMIT,
    Math.max(1, Math.floor(Number(options.limit) || DEFAULT_TASK_LIMIT))
  );

  // LEFT JOIN so a task whose topic row is gone still comes back (with the
  // fallback heading) instead of being filtered away.
  const [rows] = await query<RowDataPacket[]>(
    `SELECT t.*, tp.name AS topicName, tp.icon AS topicIcon, tp.color AS topicColor
     FROM crm_tasks t
     LEFT JOIN task_topics tp ON tp.id = t.topicId
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ${orderBy}
     LIMIT ${limit}`,
    params
  );

  return attachLinks(rows.map(rowToTask));
}

export async function getTask(id: string): Promise<CrmTask | null> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT t.*, tp.name AS topicName, tp.icon AS topicIcon, tp.color AS topicColor
     FROM crm_tasks t
     LEFT JOIN task_topics tp ON tp.id = t.topicId
     WHERE t.id = ?`,
    [String(id)]
  );
  if (!rows[0]) return null;
  const [task] = await attachLinks([rowToTask(rows[0])]);
  return task;
}

// Re-linking the same (taskId, targetType, targetId) is a no-op: the row keeps
// its ORIGINAL label snapshot and createdAt, because a snapshot is never
// re-synced. Duplicate picks must not surface as a PK error.
const INSERT_LINK_SQL = `INSERT INTO task_links (taskId, targetType, targetId, label, createdAt)
   VALUES (?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE label = label`;

export interface AddTaskInput {
  topicId: number;
  title: string;
  detail?: string | null;
  dueDate?: string | null;
  links?: TaskLinkInput[];
}

/** Writes the task and every one of its links in ONE transaction — all of it
 * lands or none of it does. */
export async function addTask(input: AddTaskInput): Promise<CrmTask> {
  const topicId = cleanTopicId(input?.topicId);
  const title = cleanName(input?.title, "ชื่องาน");
  const detail = sanitizePlainText(String(input?.detail ?? "")).trim().substring(0, 5000) || null;
  const dueDate = cleanDueDate(input?.dueDate);
  const links = cleanLinks(input?.links);

  return withTransaction(async (conn: TxConn) => {
    // Minted INSIDE the callback: withTransaction retries the whole body on a
    // transient connection loss, and a rolled-back attempt must not leave its
    // id (or its link rows) behind to be replayed.
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await conn.query(
      `INSERT INTO crm_tasks (id, topicId, title, detail, dueDate, status, completedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?)`,
      [id, topicId, title, detail, dueDate, createdAt]
    );
    for (const link of links) {
      await conn.query(INSERT_LINK_SQL, [
        id,
        link.targetType,
        link.targetId,
        link.label,
        createdAt,
      ]);
    }

    return {
      id,
      topicId,
      title,
      detail,
      dueDate,
      status: "pending" as TaskStatus,
      completedAt: null,
      createdAt,
      links: links.map((link) => ({ ...link, taskId: id, createdAt })),
    };
  });
}

export interface UpdateTaskInput {
  topicId?: number;
  title?: string;
  detail?: string | null;
  /** Explicitly null/"" CLEARS the due date; omitting the field entirely
   * leaves the stored value untouched. Those are different requests. */
  dueDate?: string | null;
  status?: TaskStatus;
  /** When present, REPLACES the whole link set of this task. */
  links?: TaskLinkInput[];
}

export async function updateTask(id: string, updates: UpdateTaskInput): Promise<CrmTask | null> {
  const taskId = String(id);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates?.topicId !== undefined) {
    sets.push("topicId = ?");
    params.push(cleanTopicId(updates.topicId));
  }
  if (updates?.title !== undefined) {
    sets.push("title = ?");
    params.push(cleanName(updates.title, "ชื่องาน"));
  }
  if (updates?.detail !== undefined) {
    sets.push("detail = ?");
    params.push(
      sanitizePlainText(String(updates.detail ?? "")).trim().substring(0, 5000) || null
    );
  }
  // Present-but-empty means "clear it"; absent means "leave it alone".
  if ("dueDate" in (updates ?? {})) {
    sets.push("dueDate = ?");
    params.push(cleanDueDate(updates.dueDate));
  }
  if (updates?.status !== undefined) {
    const status = cleanStatus(updates.status);
    if (status === "done") {
      // completedAt is assigned BEFORE status, so it still sees the OLD status:
      // re-closing an already-done task keeps the original completion time.
      sets.push("completedAt = CASE WHEN status = 'done' THEN completedAt ELSE ? END");
      params.push(new Date().toISOString());
      sets.push("status = 'done'");
    } else {
      sets.push("status = 'pending'", "completedAt = NULL");
    }
  }

  const links = updates?.links !== undefined ? cleanLinks(updates.links) : null;
  if (sets.length === 0 && links === null) return getTask(taskId);

  if (links !== null) {
    // Row + link set change together or not at all.
    await withTransaction(async (conn: TxConn) => {
      if (sets.length > 0) {
        await conn.query(`UPDATE crm_tasks SET ${sets.join(", ")} WHERE id = ?`, [
          ...params,
          taskId,
        ]);
      }
      await conn.query("DELETE FROM task_links WHERE taskId = ?", [taskId]);
      const createdAt = new Date().toISOString();
      for (const link of links) {
        await conn.query(INSERT_LINK_SQL, [
          taskId,
          link.targetType,
          link.targetId,
          link.label,
          createdAt,
        ]);
      }
    });
  } else {
    await query(`UPDATE crm_tasks SET ${sets.join(", ")} WHERE id = ?`, [...params, taskId]);
  }

  return getTask(taskId);
}

/** Closing a task sets two columns and deletes nothing. `status <> 'done'`
 * makes a second click (e.g. from a stale tab) a no-op that cannot overwrite
 * the original completedAt. */
export async function completeTask(id: string): Promise<CrmTask | null> {
  await query(
    "UPDATE crm_tasks SET status = 'done', completedAt = ? WHERE id = ? AND status <> 'done'",
    [new Date().toISOString(), String(id)]
  );
  return getTask(String(id));
}

export async function reopenTask(id: string): Promise<CrmTask | null> {
  await query("UPDATE crm_tasks SET status = 'pending', completedAt = NULL WHERE id = ?", [
    String(id),
  ]);
  return getTask(String(id));
}

/**
 * Permanent delete, only ever on an explicit admin command. task_links has no
 * FK and therefore no ON DELETE CASCADE, so this removes the task's own link
 * rows in the SAME transaction. The link TARGETS (customers, machines,
 * quotations, documents) are never touched.
 */
export async function deleteTask(id: string): Promise<boolean> {
  const taskId = String(id);
  return withTransaction(async (conn: TxConn) => {
    await conn.query("DELETE FROM task_links WHERE taskId = ?", [taskId]);
    const [result] = await conn.query("DELETE FROM crm_tasks WHERE id = ?", [taskId]);
    return Number(result?.affectedRows ?? 0) > 0;
  });
}

// ── Links ────────────────────────────────────────────────────────────────────

/** `label` must already be the snapshot for this target (see buildLinkLabel).
 * Linking the same target again is a no-op, not a duplicate-key error. */
export async function addTaskLink(taskId: string, link: TaskLinkInput): Promise<TaskLink> {
  const clean = cleanLink(link);
  const createdAt = new Date().toISOString();
  await query(INSERT_LINK_SQL, [
    String(taskId),
    clean.targetType,
    clean.targetId,
    clean.label,
    createdAt,
  ]);
  return { taskId: String(taskId), ...clean, createdAt };
}

/** Removes one link row and nothing else — the target it pointed at is never
 * touched. */
export async function removeTaskLink(
  taskId: string,
  targetType: TaskLinkTarget,
  targetId: string
): Promise<boolean> {
  const clean = cleanLink({ targetType, targetId });
  const [result] = await query<ResultSetHeader>(
    "DELETE FROM task_links WHERE taskId = ? AND targetType = ? AND targetId = ?",
    [String(taskId), clean.targetType, clean.targetId]
  );
  return result.affectedRows > 0;
}

/** Replaces a task's whole link set in one transaction (what the edit form
 * submits). Only task_links rows are affected. */
export async function replaceTaskLinks(
  taskId: string,
  links: TaskLinkInput[]
): Promise<TaskLink[]> {
  const clean = cleanLinks(links);
  const id = String(taskId);
  return withTransaction(async (conn: TxConn) => {
    await conn.query("DELETE FROM task_links WHERE taskId = ?", [id]);
    const createdAt = new Date().toISOString();
    for (const link of clean) {
      await conn.query(INSERT_LINK_SQL, [
        id,
        link.targetType,
        link.targetId,
        link.label,
        createdAt,
      ]);
    }
    return clean.map((link) => ({ ...link, taskId: id, createdAt }));
  });
}

// ── Bell counter ─────────────────────────────────────────────────────────────

/**
 * Tasks the bell should shout about: pending AND already due.
 *
 * Tasks with NO due date, and tasks due in the FUTURE, are excluded on
 * purpose — the bell means "act now", and a to-do list must not be allowed to
 * inflate it into a number nobody trusts. "Today" is the Asia/Bangkok calendar
 * day (the same bangkokDateString getAlerts() uses), never the server's UTC
 * date: Vercel runs at UTC, so between 00:00 and 06:59 Thai time a UTC "today"
 * would still be yesterday and a due task would go uncounted for 7 hours every
 * single day. The comparison is lexical on YYYY-MM-DD strings.
 */
export async function countDueTasks(): Promise<number> {
  const today = bangkokDateString(new Date());
  const [rows] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM crm_tasks
     WHERE status = 'pending' AND dueDate IS NOT NULL AND dueDate <> '' AND dueDate <= ?`,
    [today]
  );
  return Number(rows[0]?.cnt) || 0;
}
