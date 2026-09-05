/**
 * Pure helpers behind the manual task board on /crm/alerts.
 *
 * Everything in here is deliberately React-free and DB-free so it can be unit
 * tested (see __tests__/lib/taskBoard.test.ts) and imported from a CLIENT
 * component. `taskStore.ts` is `server-only`, so anything the board needs on
 * the client — the ordering, the chip counts, the bell rule, the "is this link
 * target dead?" decision — lives here instead, mirroring the SQL in
 * `listTasks()` / `countDueTasks()` rather than re-deriving it by hand.
 *
 * Spec: openspec/changes/add-crm-task-board (tasks 4.2, 11.4-11.15, 17.1-17.4).
 */

import { isValidDateString } from "./dateFormat";
import type { CrmTask, TaskLink, TaskLinkTarget, TaskTopic } from "./types";

// ── Labels ───────────────────────────────────────────────────────────────────

/** Heading for a task whose topic row is gone. Mirrors
 * `taskStore.UNASSIGNED_TOPIC_NAME`, which cannot be imported here because
 * that module is `server-only`. */
export const UNASSIGNED_TOPIC_LABEL = "ไม่ระบุหัวข้อ";
export const UNASSIGNED_TOPIC_ICON = "📌";
export const UNASSIGNED_TOPIC_COLOR = "slate";

/** A task with no due date is a perfectly valid post-it (D5). It shows THIS —
 * never an empty cell and never "Invalid Date". */
export const NO_DUE_DATE_LABEL = "ไม่มีกำหนด";

/** Suffix on a link chip whose target has been deleted or purged. */
export const DELETED_TARGET_LABEL = "ถูกลบแล้ว";

export const ALL_CHIP_LABEL = "ทั้งหมด";

// ── Due-date buckets (the ordering of task 4.2) ──────────────────────────────

/** Bucket numbers match the CASE expression in `listTasks()` so the client and
 * the server agree on what "first" means. */
export const DUE_BUCKET = {
  OVERDUE: 0,
  TODAY: 1,
  FUTURE: 2,
  NONE: 3,
} as const;

export type DueBucket = (typeof DUE_BUCKET)[keyof typeof DUE_BUCKET];

/** True only for an exact, real "YYYY-MM-DD". Anything else (null, "", a
 * timestamp, garbage left by a hand-edited row) is treated as "no due date" —
 * a lexical comparison against a malformed string would silently sort wrong. */
export function hasDueDate(dueDate: string | null | undefined): dueDate is string {
  return typeof dueDate === "string" && dueDate !== "" && isValidDateString(dueDate);
}

/**
 * Which of the four groups a task falls in, given today's calendar day
 * (pass the SAME "today" the bell uses — `bangkokDateString(new Date())` — so
 * a machine in another timezone cannot disagree with the server, D6).
 */
export function dueBucketOf(dueDate: string | null | undefined, today: string): DueBucket {
  if (!hasDueDate(dueDate)) return DUE_BUCKET.NONE;
  if (dueDate < today) return DUE_BUCKET.OVERDUE;
  if (dueDate === today) return DUE_BUCKET.TODAY;
  return DUE_BUCKET.FUTURE;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). null when
 * either side is not a real YYYY-MM-DD. */
export function daysBetweenDateStrings(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  if (!hasDueDate(from) || !hasDueDate(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// ── Ordering (task 4.2) ──────────────────────────────────────────────────────

/**
 * overdue → due today → due later → undated, with the soonest due date first
 * inside the dated groups and `createdAt` DESC (newest post-it first) as the
 * tie-break — which is the only ordering inside the undated group. `id` is the
 * final tie-break purely so the result is deterministic.
 */
export function compareTasksForBoard(a: CrmTask, b: CrmTask, today: string): number {
  const bucketA = dueBucketOf(a.dueDate, today);
  const bucketB = dueBucketOf(b.dueDate, today);
  if (bucketA !== bucketB) return bucketA - bucketB;

  if (bucketA !== DUE_BUCKET.NONE) {
    const dueA = String(a.dueDate);
    const dueB = String(b.dueDate);
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  }

  const createdA = String(a.createdAt ?? "");
  const createdB = String(b.createdAt ?? "");
  if (createdA !== createdB) return createdA < createdB ? 1 : -1; // DESC

  return String(a.id).localeCompare(String(b.id));
}

/** Board order for the "ที่ต้องทำ" view. Returns a new array. */
export function sortTasksForBoard(tasks: CrmTask[], today: string): CrmTask[] {
  return [...(tasks ?? [])].sort((a, b) => compareTasksForBoard(a, b, today));
}

/** The "เสร็จแล้ว" view reads as a history, so it is ordered by most recently
 * completed instead — matching `listTasks({ status: "done" })`. */
export function sortTasksByCompletion(tasks: CrmTask[]): CrmTask[] {
  const key = (task: CrmTask) => `${task.completedAt ?? ""}\u0000${task.createdAt ?? ""}`;
  return [...(tasks ?? [])].sort((a, b) => {
    const keyA = key(a);
    const keyB = key(b);
    if (keyA !== keyB) return keyA < keyB ? 1 : -1; // DESC
    return String(a.id).localeCompare(String(b.id));
  });
}

// ── The bell (task 4.13 / 17.4) ──────────────────────────────────────────────

/**
 * The bell counts work the owner has to do NOW. A task counts only when it is
 * still `pending` AND its due date has arrived (today or earlier).
 *
 * A task with NO due date is never counted, and neither is one due in the
 * future — deliberately, and it is the single most misread rule on this board:
 * the bell means "there is something to do", not "there are tasks".
 */
export function isTaskDue(task: CrmTask, today: string): boolean {
  if (!task || task.status !== "pending") return false;
  if (!hasDueDate(task.dueDate)) return false;
  return task.dueDate <= today;
}

/** Client-side mirror of `taskStore.countDueTasks()` for a loaded task list. */
export function countDueTasks(tasks: CrmTask[], today: string): number {
  return (tasks ?? []).reduce((total, task) => (isTaskDue(task, today) ? total + 1 : total), 0);
}

// ── Due-date display (task 11.5) ─────────────────────────────────────────────

const THAI_SHORT_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/**
 * "2026-09-05" → "5 ก.ย. 2569". Formatted from the string's own parts (no
 * `new Date().toLocaleDateString`), so it cannot drift by a day in another
 * timezone and cannot print "Invalid Date": anything unparseable — including
 * null — comes back as "ไม่มีกำหนด".
 */
export function formatDueDate(dueDate: string | null | undefined): string {
  if (!hasDueDate(dueDate)) return NO_DUE_DATE_LABEL;
  const [year, month, day] = dueDate.split("-").map(Number);
  const monthName = THAI_SHORT_MONTHS[month - 1];
  if (!monthName) return NO_DUE_DATE_LABEL;
  return `${day} ${monthName} ${year + 543}`;
}

export type DueTone = "overdue" | "today" | "future" | "none";

export interface DueMarker {
  tone: DueTone;
  /** Short Thai badge text, e.g. "เลยกำหนด 3 วัน". */
  label: string;
  /** The formatted due date, or "ไม่มีกำหนด". */
  dateLabel: string;
  /** Overdue and due-today both get the prominent treatment (task 11.5). */
  isUrgent: boolean;
}

/** Everything the card needs to render its due-date line and its marker. */
export function dueMarkerOf(dueDate: string | null | undefined, today: string): DueMarker {
  const bucket = dueBucketOf(dueDate, today);
  const dateLabel = formatDueDate(dueDate);

  if (bucket === DUE_BUCKET.OVERDUE) {
    const days = daysBetweenDateStrings(dueDate, today);
    return {
      tone: "overdue",
      label: days && days > 0 ? `เลยกำหนด ${days} วัน` : "เลยกำหนด",
      dateLabel,
      isUrgent: true,
    };
  }
  if (bucket === DUE_BUCKET.TODAY) {
    return { tone: "today", label: "ถึงกำหนดวันนี้", dateLabel, isUrgent: true };
  }
  if (bucket === DUE_BUCKET.FUTURE) {
    const days = daysBetweenDateStrings(today, dueDate);
    return {
      tone: "future",
      label: days && days > 0 ? `อีก ${days} วัน` : "มีกำหนด",
      dateLabel,
      isUrgent: false,
    };
  }
  return { tone: "none", label: NO_DUE_DATE_LABEL, dateLabel, isUrgent: false };
}

// ── Topics: resolution, grouping, filter chips (tasks 11.7, 11.8, 11.15) ─────

export interface ResolvedTopic {
  id: number | null;
  name: string;
  icon: string;
  color: string;
  /** false = the topic exists but the admin hid it. Its tasks stay on the
   * board; hiding never deletes or moves work. */
  isActive: boolean;
  /** false = no topic row matched `task.topicId`. The task still renders,
   * under "ไม่ระบุหัวข้อ", and stays completable and movable (task 11.15). */
  isKnown: boolean;
}

export function indexTopics(topics: TaskTopic[] | null | undefined): Map<number, TaskTopic> {
  const index = new Map<number, TaskTopic>();
  for (const topic of topics ?? []) {
    if (topic && Number.isFinite(Number(topic.id))) index.set(Number(topic.id), topic);
  }
  return index;
}

/**
 * The topic to DISPLAY for a task. The live `task_topics` row wins (so a rename
 * or recolour shows up without refetching the tasks); the fields the API joined
 * onto the row are the fallback; and a topic that cannot be found at all
 * degrades to "ไม่ระบุหัวข้อ" instead of throwing — a missing topic must never
 * white-screen the board.
 */
export function resolveTaskTopic(
  task: CrmTask,
  topics: Map<number, TaskTopic> | TaskTopic[] | null | undefined
): ResolvedTopic {
  const index = topics instanceof Map ? topics : indexTopics(topics);
  const topic = index.get(Number(task?.topicId));
  if (topic) {
    return {
      id: Number(topic.id),
      name: topic.name || UNASSIGNED_TOPIC_LABEL,
      icon: topic.icon || UNASSIGNED_TOPIC_ICON,
      color: topic.color || UNASSIGNED_TOPIC_COLOR,
      isActive: topic.isActive !== false,
      isKnown: true,
    };
  }
  // The parent may pass only the active topics. In that case the joined
  // columns from the API still describe the row, so prefer them over the
  // fallback heading — but a task whose topic row is really gone comes back
  // from the store already carrying UNASSIGNED_TOPIC_LABEL.
  const joinedName = String(task?.topicName ?? "").trim();
  if (joinedName && joinedName !== UNASSIGNED_TOPIC_LABEL) {
    return {
      id: Number(task.topicId),
      name: joinedName,
      icon: task.topicIcon || UNASSIGNED_TOPIC_ICON,
      color: task.topicColor || UNASSIGNED_TOPIC_COLOR,
      isActive: false, // not in the list handed to us → treat as hidden
      isKnown: true,
    };
  }
  return {
    id: null,
    name: UNASSIGNED_TOPIC_LABEL,
    icon: UNASSIGNED_TOPIC_ICON,
    color: UNASSIGNED_TOPIC_COLOR,
    isActive: false,
    isKnown: false,
  };
}

export type TopicChipKind = "all" | "topic" | "hidden" | "unassigned";

export interface TopicChip {
  /** Stable selection value and React key. */
  key: string;
  kind: TopicChipKind;
  /** null for "ทั้งหมด" and for "ไม่ระบุหัวข้อ". */
  topicId: number | null;
  label: string;
  icon: string;
  color: string;
  /** How many of the CURRENTLY DISPLAYED tasks this chip would show. */
  count: number;
}

export const ALL_CHIP_KEY = "all";
export const UNASSIGNED_CHIP_KEY = "unassigned";

export function topicChipKey(topicId: number): string {
  return `topic:${topicId}`;
}

/** Which chip a given task lives under — used to reveal a task the admin just
 * saved into a topic the open filter would hide (task 11.14). */
export function chipKeyForTask(
  task: CrmTask,
  topics: Map<number, TaskTopic> | TaskTopic[] | null | undefined
): string {
  const index = topics instanceof Map ? topics : indexTopics(topics);
  return index.has(Number(task?.topicId))
    ? topicChipKey(Number(task.topicId))
    : UNASSIGNED_CHIP_KEY;
}

function sortTopics(topics: TaskTopic[]): TaskTopic[] {
  return [...topics].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.id) - Number(b.id)
  );
}

/**
 * The filter chip strip for one view's tasks.
 *
 * - "ทั้งหมด" always leads, and its count is the total of every other chip:
 *   every displayed task belongs to exactly one chip, so no task can be
 *   filtered into oblivion.
 * - Every ACTIVE topic gets a chip, even at zero, because it is a filter the
 *   admin may want to switch to.
 * - A HIDDEN topic gets a chip only while it still holds work — hiding a topic
 *   must not strand its tasks behind a filter that no longer exists (11.8).
 * - Tasks whose topic row is gone collect under one "ไม่ระบุหัวข้อ" chip
 *   (11.15).
 *
 * Pass EVERY topic (including hidden ones, i.e. `listTopics(true)`); with only
 * the active ones the hidden work still shows up, under "ไม่ระบุหัวข้อ".
 */
export function buildTopicChips(
  tasks: CrmTask[],
  topics: TaskTopic[] | null | undefined
): TopicChip[] {
  const list = tasks ?? [];
  const index = indexTopics(topics);

  const counts = new Map<number, number>();
  let unassignedCount = 0;
  for (const task of list) {
    const topicId = Number(task?.topicId);
    if (index.has(topicId)) counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
    else unassignedCount++;
  }

  const chips: TopicChip[] = [
    {
      key: ALL_CHIP_KEY,
      kind: "all",
      topicId: null,
      label: ALL_CHIP_LABEL,
      icon: "🗂️",
      color: "slate",
      count: list.length,
    },
  ];

  for (const topic of sortTopics([...index.values()])) {
    const count = counts.get(Number(topic.id)) ?? 0;
    const isActive = topic.isActive !== false;
    if (!isActive && count === 0) continue; // retired and empty — stay out of the way
    chips.push({
      key: topicChipKey(Number(topic.id)),
      kind: isActive ? "topic" : "hidden",
      topicId: Number(topic.id),
      label: isActive ? topic.name : `${topic.name} (ซ่อนอยู่)`,
      icon: topic.icon || UNASSIGNED_TOPIC_ICON,
      color: topic.color || UNASSIGNED_TOPIC_COLOR,
      count,
    });
  }

  if (unassignedCount > 0) {
    chips.push({
      key: UNASSIGNED_CHIP_KEY,
      kind: "unassigned",
      topicId: null,
      label: UNASSIGNED_TOPIC_LABEL,
      icon: UNASSIGNED_TOPIC_ICON,
      color: UNASSIGNED_TOPIC_COLOR,
      count: unassignedCount,
    });
  }

  return chips;
}

/** Tasks a chip shows. An unrecognised key falls back to showing everything —
 * a stale selection must never leave the admin staring at an empty board. */
export function filterTasksByChip(
  tasks: CrmTask[],
  chipKey: string,
  topics: TaskTopic[] | null | undefined
): CrmTask[] {
  const list = tasks ?? [];
  if (!chipKey || chipKey === ALL_CHIP_KEY) return list;
  const index = indexTopics(topics);
  if (chipKey === UNASSIGNED_CHIP_KEY) {
    return list.filter((task) => !index.has(Number(task?.topicId)));
  }
  if (chipKey.startsWith("topic:")) {
    const topicId = Number(chipKey.slice("topic:".length));
    if (Number.isFinite(topicId)) return list.filter((task) => Number(task?.topicId) === topicId);
  }
  return list;
}

/** Tasks grouped by their display topic id (null = "ไม่ระบุหัวข้อ"), keeping
 * the order they were given in. */
export function groupTasksByTopic(
  tasks: CrmTask[],
  topics: TaskTopic[] | null | undefined
): Map<number | null, CrmTask[]> {
  const index = indexTopics(topics);
  const groups = new Map<number | null, CrmTask[]>();
  for (const task of tasks ?? []) {
    const topicId = Number(task?.topicId);
    const key = index.has(topicId) ? topicId : null;
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }
  return groups;
}

// ── Link chips (tasks 13.1-13.5) ─────────────────────────────────────────────

export const TASK_LINK_TARGET_META: Record<
  TaskLinkTarget,
  { icon: string; label: string }
> = {
  customer: { icon: "🏢", label: "ลูกค้า" },
  equipment: { icon: "🔧", label: "เครื่องจักร" },
  quotation: { icon: "🧾", label: "ใบเสนอราคา" },
  document: { icon: "📄", label: "เอกสาร" },
};

/**
 * Live targets, one entry per type, as `targetId -> current label`.
 *
 * A type that is ABSENT (or null) means "we did not check" — its chips render
 * as normal, clickable links. Only a type that is present and does NOT contain
 * the id proves the target is gone. That asymmetry is the point: a failed or
 * skipped lookup must never libel a live quotation as "ถูกลบแล้ว".
 */
export type LinkTargetIndex = Partial<
  Record<TaskLinkTarget, Record<string, string> | Map<string, string> | null>
>;

export type LinkLiveness = "live" | "dead" | "unknown";

function lookupTarget(
  index: LinkTargetIndex | null | undefined,
  targetType: TaskLinkTarget,
  targetId: string
): { known: boolean; found: boolean; label: string } {
  const bucket = index?.[targetType];
  if (bucket === undefined || bucket === null) return { known: false, found: false, label: "" };
  if (bucket instanceof Map) {
    return {
      known: true,
      found: bucket.has(targetId),
      label: String(bucket.get(targetId) ?? ""),
    };
  }
  const found = Object.prototype.hasOwnProperty.call(bucket, targetId);
  return { known: true, found, label: found ? String(bucket[targetId] ?? "") : "" };
}

/** "dead" only when the target's type WAS looked up and the id was not in it. */
export function linkLiveness(
  link: Pick<TaskLink, "targetType" | "targetId">,
  index?: LinkTargetIndex | null
): LinkLiveness {
  const { known, found } = lookupTarget(index, link.targetType, String(link.targetId));
  if (!known) return "unknown";
  return found ? "live" : "dead";
}

/** Where a chip navigates to. `/customers` takes deep-link params added for
 * this change (task 13.6); a quotation always opens READ-ONLY (`view=1`). */
export function taskLinkHref(targetType: TaskLinkTarget, targetId: string): string | null {
  const id = encodeURIComponent(String(targetId ?? ""));
  if (!id) return null;
  switch (targetType) {
    case "customer":
      return `/customers?tab=customers&customerId=${id}`;
    case "equipment":
      return `/customers?tab=equipments&equipmentId=${id}`;
    case "quotation":
      return `/quotation?id=${id}&view=1`;
    case "document":
      return `/document/${id}`;
    default:
      return null;
  }
}

export interface ResolvedTaskLink {
  targetType: TaskLinkTarget;
  targetId: string;
  /** The target's CURRENT name while it is alive and known; the snapshot taken
   * at link time otherwise — which, for a purged row, is the only evidence
   * left of what this task pointed at, so it is never discarded. */
  label: string;
  liveness: LinkLiveness;
  isDead: boolean;
  /** null for a dead target: the chip is rendered disabled and must not
   * navigate anywhere, least of all to a 404 or a blank page. */
  href: string | null;
  icon: string;
  typeLabel: string;
}

export function resolveTaskLink(
  link: TaskLink,
  index?: LinkTargetIndex | null
): ResolvedTaskLink {
  const targetType = link.targetType;
  const targetId = String(link?.targetId ?? "");
  const snapshot = String(link?.label ?? "").trim();
  const { known, found, label } = lookupTarget(index, targetType, targetId);
  const liveness: LinkLiveness = !known ? "unknown" : found ? "live" : "dead";
  const isDead = liveness === "dead";
  const meta = TASK_LINK_TARGET_META[targetType] ?? { icon: "🔗", label: "ลิงก์" };

  return {
    targetType,
    targetId,
    label: (found && label.trim()) || snapshot || targetId || meta.label,
    liveness,
    isDead,
    href: isDead ? null : taskLinkHref(targetType, targetId),
    icon: meta.icon,
    typeLabel: meta.label,
  };
}

export function resolveTaskLinks(
  links: TaskLink[] | null | undefined,
  index?: LinkTargetIndex | null
): ResolvedTaskLink[] {
  return (links ?? []).map((link) => resolveTaskLink(link, index));
}
