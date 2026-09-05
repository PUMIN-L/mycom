import { describe, it, expect } from "vitest";
import {
  ALL_CHIP_KEY,
  DELETED_TARGET_LABEL,
  DUE_BUCKET,
  NO_DUE_DATE_LABEL,
  UNASSIGNED_CHIP_KEY,
  UNASSIGNED_TOPIC_LABEL,
  buildTopicChips,
  chipKeyForTask,
  countDueTasks,
  daysBetweenDateStrings,
  dueBucketOf,
  dueMarkerOf,
  filterTasksByChip,
  formatDueDate,
  groupTasksByTopic,
  hasDueDate,
  isTaskDue,
  linkLiveness,
  resolveTaskLink,
  resolveTaskLinks,
  resolveTaskTopic,
  sortTasksByCompletion,
  sortTasksForBoard,
  taskLinkHref,
  topicChipKey,
} from "@/app/lib/taskBoard";
import type { CrmTask, TaskLink, TaskTopic } from "@/app/lib/types";

const TODAY = "2026-09-05";

function makeTask(overrides: Partial<CrmTask> = {}): CrmTask {
  return {
    id: overrides.id ?? "t1",
    topicId: overrides.topicId ?? 1,
    title: overrides.title ?? "โทรหาลูกค้า",
    detail: overrides.detail ?? null,
    dueDate: overrides.dueDate ?? null,
    status: overrides.status ?? "pending",
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-09-01T00:00:00.000Z",
    topicName: overrides.topicName,
    topicIcon: overrides.topicIcon,
    topicColor: overrides.topicColor,
    links: overrides.links ?? [],
  };
}

function makeTopic(overrides: Partial<TaskTopic> = {}): TaskTopic {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "โทรหาลูกค้า",
    icon: overrides.icon ?? "📞",
    color: overrides.color ?? "blue",
    sortOrder: overrides.sortOrder ?? 1,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function makeLink(overrides: Partial<TaskLink> = {}): TaskLink {
  return {
    taskId: overrides.taskId ?? "t1",
    targetType: overrides.targetType ?? "quotation",
    targetId: overrides.targetId ?? "q1",
    label: overrides.label ?? "QT-2568-001",
    createdAt: overrides.createdAt ?? "2026-09-01T00:00:00.000Z",
  };
}

// ── Due-date buckets ─────────────────────────────────────────────────────────

describe("hasDueDate / dueBucketOf", () => {
  it("treats null, empty and malformed values as having no due date", () => {
    for (const value of [null, undefined, "", "   ", "2026-13-40", "tomorrow", "2026/09/05"]) {
      expect(hasDueDate(value as string | null)).toBe(false);
      expect(dueBucketOf(value as string | null, TODAY)).toBe(DUE_BUCKET.NONE);
    }
  });

  it("buckets a real date as overdue / today / future", () => {
    expect(dueBucketOf("2026-09-04", TODAY)).toBe(DUE_BUCKET.OVERDUE);
    expect(dueBucketOf("2025-12-31", TODAY)).toBe(DUE_BUCKET.OVERDUE);
    expect(dueBucketOf(TODAY, TODAY)).toBe(DUE_BUCKET.TODAY);
    expect(dueBucketOf("2026-09-06", TODAY)).toBe(DUE_BUCKET.FUTURE);
  });
});

describe("daysBetweenDateStrings", () => {
  it("counts whole days in both directions and across a month boundary", () => {
    expect(daysBetweenDateStrings("2026-09-01", "2026-09-05")).toBe(4);
    expect(daysBetweenDateStrings("2026-09-05", "2026-09-01")).toBe(-4);
    expect(daysBetweenDateStrings("2026-08-30", "2026-09-02")).toBe(3);
  });

  it("returns null rather than NaN for a malformed side", () => {
    expect(daysBetweenDateStrings(null, TODAY)).toBeNull();
    expect(daysBetweenDateStrings("nope", TODAY)).toBeNull();
  });
});

// ── Task 17.2: the ordering of task 4.2 ──────────────────────────────────────

describe("sortTasksForBoard", () => {
  it("orders overdue → due today → future → no due date", () => {
    const undated = makeTask({ id: "undated", dueDate: null });
    const future = makeTask({ id: "future", dueDate: "2026-09-20" });
    const today = makeTask({ id: "today", dueDate: TODAY });
    const overdue = makeTask({ id: "overdue", dueDate: "2026-08-01" });

    const sorted = sortTasksForBoard([undated, future, today, overdue], TODAY);

    expect(sorted.map((t) => t.id)).toEqual(["overdue", "today", "future", "undated"]);
  });

  it("puts the most overdue first and the soonest future date first", () => {
    const tasks = [
      makeTask({ id: "late-1", dueDate: "2026-09-03" }),
      makeTask({ id: "late-2", dueDate: "2026-08-20" }),
      makeTask({ id: "soon-2", dueDate: "2026-10-01" }),
      makeTask({ id: "soon-1", dueDate: "2026-09-09" }),
    ];

    expect(sortTasksForBoard(tasks, TODAY).map((t) => t.id)).toEqual([
      "late-2",
      "late-1",
      "soon-1",
      "soon-2",
    ]);
  });

  it("orders the undated group by createdAt DESC (newest post-it first)", () => {
    const tasks = [
      makeTask({ id: "old", dueDate: null, createdAt: "2026-01-01T00:00:00.000Z" }),
      makeTask({ id: "newest", dueDate: null, createdAt: "2026-09-04T09:00:00.000Z" }),
      makeTask({ id: "middle", dueDate: null, createdAt: "2026-05-05T00:00:00.000Z" }),
    ];

    expect(sortTasksForBoard(tasks, TODAY).map((t) => t.id)).toEqual([
      "newest",
      "middle",
      "old",
    ]);
  });

  it("falls back to createdAt DESC for two tasks sharing one due date", () => {
    const tasks = [
      makeTask({ id: "a", dueDate: TODAY, createdAt: "2026-09-01T00:00:00.000Z" }),
      makeTask({ id: "b", dueDate: TODAY, createdAt: "2026-09-04T00:00:00.000Z" }),
    ];

    expect(sortTasksForBoard(tasks, TODAY).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("sorts a task with a malformed due date into the undated group, not first", () => {
    const tasks = [
      makeTask({ id: "junk", dueDate: "not-a-date" }),
      makeTask({ id: "overdue", dueDate: "2026-01-01" }),
    ];

    expect(sortTasksForBoard(tasks, TODAY).map((t) => t.id)).toEqual(["overdue", "junk"]);
  });

  it("does not mutate the array it was given", () => {
    const tasks = [
      makeTask({ id: "undated", dueDate: null }),
      makeTask({ id: "overdue", dueDate: "2026-01-01" }),
    ];
    sortTasksForBoard(tasks, TODAY);
    expect(tasks.map((t) => t.id)).toEqual(["undated", "overdue"]);
  });
});

describe("sortTasksByCompletion", () => {
  it("shows the most recently completed task first", () => {
    const tasks = [
      makeTask({ id: "first", status: "done", completedAt: "2026-09-01T10:00:00.000Z" }),
      makeTask({ id: "last", status: "done", completedAt: "2026-09-04T10:00:00.000Z" }),
    ];

    expect(sortTasksByCompletion(tasks).map((t) => t.id)).toEqual(["last", "first"]);
  });
});

// ── Task 17.4: the bell rule ─────────────────────────────────────────────────

describe("countDueTasks (the bell)", () => {
  it("counts a pending task that is overdue or due today", () => {
    const tasks = [
      makeTask({ id: "overdue", dueDate: "2026-08-01" }),
      makeTask({ id: "today", dueDate: TODAY }),
    ];

    expect(countDueTasks(tasks, TODAY)).toBe(2);
  });

  it("never counts a task with no due date", () => {
    const tasks = [makeTask({ id: "undated", dueDate: null })];

    expect(isTaskDue(tasks[0], TODAY)).toBe(false);
    expect(countDueTasks(tasks, TODAY)).toBe(0);
  });

  it("never counts a task due in the future", () => {
    const tasks = [
      makeTask({ id: "tomorrow", dueDate: "2026-09-06" }),
      makeTask({ id: "next-year", dueDate: "2027-01-01" }),
    ];

    expect(countDueTasks(tasks, TODAY)).toBe(0);
  });

  it("never counts a completed task, however overdue it was", () => {
    const tasks = [
      makeTask({
        id: "done",
        dueDate: "2026-01-01",
        status: "done",
        completedAt: "2026-01-02T00:00:00.000Z",
      }),
    ];

    expect(countDueTasks(tasks, TODAY)).toBe(0);
  });

  it("ignores a malformed due date instead of counting it as due", () => {
    expect(countDueTasks([makeTask({ dueDate: "31/12/2026" })], TODAY)).toBe(0);
  });

  it("is 0, not a crash, for an empty board", () => {
    expect(countDueTasks([], TODAY)).toBe(0);
  });
});

// ── Due-date display ─────────────────────────────────────────────────────────

describe("formatDueDate", () => {
  it("renders a Thai short date with a Buddhist year", () => {
    expect(formatDueDate("2026-09-05")).toBe("5 ก.ย. 2569");
    expect(formatDueDate("2026-01-31")).toBe("31 ม.ค. 2569");
  });

  it('never returns an empty string or "Invalid Date"', () => {
    for (const value of [null, undefined, "", "Invalid Date", "2026-99-99"]) {
      expect(formatDueDate(value as string | null)).toBe(NO_DUE_DATE_LABEL);
    }
  });
});

describe("dueMarkerOf", () => {
  it("marks overdue and due-today as urgent, and nothing else", () => {
    expect(dueMarkerOf("2026-09-02", TODAY)).toMatchObject({
      tone: "overdue",
      label: "เลยกำหนด 3 วัน",
      isUrgent: true,
    });
    expect(dueMarkerOf(TODAY, TODAY)).toMatchObject({ tone: "today", isUrgent: true });
    expect(dueMarkerOf("2026-09-08", TODAY)).toMatchObject({
      tone: "future",
      label: "อีก 3 วัน",
      isUrgent: false,
    });
    expect(dueMarkerOf(null, TODAY)).toMatchObject({
      tone: "none",
      dateLabel: NO_DUE_DATE_LABEL,
      isUrgent: false,
    });
  });
});

// ── Topic resolution (task 11.15) ────────────────────────────────────────────

describe("resolveTaskTopic", () => {
  const topics = [makeTopic({ id: 1, name: "โทรหาลูกค้า", icon: "📞", color: "blue" })];

  it("prefers the live topic row, so a rename shows without refetching tasks", () => {
    const task = makeTask({ topicId: 1, topicName: "ชื่อเก่า", topicIcon: "☎️" });

    expect(resolveTaskTopic(task, topics)).toMatchObject({
      id: 1,
      name: "โทรหาลูกค้า",
      icon: "📞",
      isKnown: true,
      isActive: true,
    });
  });

  it('falls back to "ไม่ระบุหัวข้อ" when no topic row matches, without throwing', () => {
    const task = makeTask({ topicId: 99, topicName: UNASSIGNED_TOPIC_LABEL });

    expect(resolveTaskTopic(task, topics)).toMatchObject({
      id: null,
      name: UNASSIGNED_TOPIC_LABEL,
      isKnown: false,
    });
  });

  it("keeps a hidden topic's own name when only the active topics were passed", () => {
    const task = makeTask({ topicId: 7, topicName: "หัวข้อที่ซ่อนไว้", topicIcon: "🗄️" });

    expect(resolveTaskTopic(task, topics)).toMatchObject({
      name: "หัวข้อที่ซ่อนไว้",
      isKnown: true,
      isActive: false,
    });
  });

  it("survives an empty or missing topic list", () => {
    expect(resolveTaskTopic(makeTask(), [])).toMatchObject({ isKnown: false });
    expect(resolveTaskTopic(makeTask(), null)).toMatchObject({ isKnown: false });
  });
});

// ── Task 17.3: filter chips and their counts ─────────────────────────────────

describe("buildTopicChips", () => {
  const topics = [
    makeTopic({ id: 1, name: "โทรหาลูกค้า", sortOrder: 2 }),
    makeTopic({ id: 2, name: "ทำใบเสนอราคา", sortOrder: 1, icon: "🧾", color: "amber" }),
    makeTopic({ id: 3, name: "หัวข้อเก่า", sortOrder: 3, isActive: false }),
  ];
  const tasks = [
    makeTask({ id: "a", topicId: 1 }),
    makeTask({ id: "b", topicId: 1 }),
    makeTask({ id: "c", topicId: 2 }),
    makeTask({ id: "d", topicId: 3 }), // under the hidden topic
    makeTask({ id: "e", topicId: 404 }), // topic row is gone
  ];

  it('leads with "ทั้งหมด" counting every displayed task', () => {
    const chips = buildTopicChips(tasks, topics);

    expect(chips[0]).toMatchObject({ key: ALL_CHIP_KEY, kind: "all", count: 5 });
  });

  it('the "ทั้งหมด" count equals the sum of every other chip', () => {
    const chips = buildTopicChips(tasks, topics);
    const rest = chips.slice(1).reduce((sum, chip) => sum + chip.count, 0);

    expect(rest).toBe(chips[0].count);
    expect(rest).toBe(tasks.length);
  });

  it("counts per topic exactly what filtering by that chip would show", () => {
    for (const chip of buildTopicChips(tasks, topics)) {
      expect(filterTasksByChip(tasks, chip.key, topics)).toHaveLength(chip.count);
    }
  });

  it("orders topic chips by the admin's sortOrder", () => {
    const chips = buildTopicChips(tasks, topics);

    expect(chips.slice(1, 3).map((c) => c.label)).toEqual(["ทำใบเสนอราคา", "โทรหาลูกค้า"]);
  });

  it("shows an active topic that currently holds no work, at zero", () => {
    const chips = buildTopicChips([makeTask({ topicId: 1 })], topics);
    const empty = chips.find((c) => c.key === topicChipKey(2));

    expect(empty).toMatchObject({ kind: "topic", count: 0 });
  });

  it("keeps a hidden topic reachable while it still holds work", () => {
    const chips = buildTopicChips(tasks, topics);
    const hidden = chips.find((c) => c.key === topicChipKey(3));

    expect(hidden).toMatchObject({ kind: "hidden", count: 1 });
    expect(hidden?.label).toContain("ซ่อนอยู่");
  });

  it("drops a hidden topic once nothing is filed under it", () => {
    const chips = buildTopicChips([makeTask({ topicId: 1 })], topics);

    expect(chips.find((c) => c.key === topicChipKey(3))).toBeUndefined();
  });

  it('collects tasks with a missing topic under one "ไม่ระบุหัวข้อ" chip', () => {
    const chips = buildTopicChips(tasks, topics);
    const unassigned = chips.find((c) => c.key === UNASSIGNED_CHIP_KEY);

    expect(unassigned).toMatchObject({ label: UNASSIGNED_TOPIC_LABEL, count: 1 });
  });

  it("omits the unassigned chip when every task has a real topic", () => {
    const chips = buildTopicChips([makeTask({ topicId: 1 })], topics);

    expect(chips.find((c) => c.key === UNASSIGNED_CHIP_KEY)).toBeUndefined();
  });

  it("still returns the ทั้งหมด chip at 0 for an empty board", () => {
    expect(buildTopicChips([], topics)[0]).toMatchObject({ key: ALL_CHIP_KEY, count: 0 });
  });
});

describe("filterTasksByChip", () => {
  const topics = [makeTopic({ id: 1 }), makeTopic({ id: 2, isActive: false })];
  const tasks = [
    makeTask({ id: "a", topicId: 1 }),
    makeTask({ id: "b", topicId: 2 }),
    makeTask({ id: "c", topicId: 99 }),
  ];

  it('"ทั้งหมด" shows every task, including hidden-topic and orphaned ones', () => {
    expect(filterTasksByChip(tasks, ALL_CHIP_KEY, topics).map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("a topic chip shows only that topic", () => {
    expect(filterTasksByChip(tasks, topicChipKey(2), topics).map((t) => t.id)).toEqual(["b"]);
  });

  it("the unassigned chip shows only tasks whose topic row is gone", () => {
    expect(filterTasksByChip(tasks, UNASSIGNED_CHIP_KEY, topics).map((t) => t.id)).toEqual([
      "c",
    ]);
  });

  it("falls back to showing everything for a stale/unknown chip key", () => {
    expect(filterTasksByChip(tasks, "topic:12345", topics)).toHaveLength(0);
    expect(filterTasksByChip(tasks, "garbage", topics)).toHaveLength(3);
  });
});

describe("chipKeyForTask", () => {
  const topics = [makeTopic({ id: 1 })];

  it("names the chip a freshly saved task will appear under", () => {
    expect(chipKeyForTask(makeTask({ topicId: 1 }), topics)).toBe(topicChipKey(1));
    expect(chipKeyForTask(makeTask({ topicId: 42 }), topics)).toBe(UNASSIGNED_CHIP_KEY);
  });
});

describe("groupTasksByTopic", () => {
  it("keys orphaned tasks under null and keeps the given order", () => {
    const topics = [makeTopic({ id: 1 })];
    const groups = groupTasksByTopic(
      [
        makeTask({ id: "a", topicId: 1 }),
        makeTask({ id: "b", topicId: 9 }),
        makeTask({ id: "c", topicId: 1 }),
      ],
      topics
    );

    expect(groups.get(1)?.map((t) => t.id)).toEqual(["a", "c"]);
    expect(groups.get(null)?.map((t) => t.id)).toEqual(["b"]);
  });
});

// ── Link targets: is this chip dead? ─────────────────────────────────────────

describe("taskLinkHref", () => {
  it("opens a quotation read-only and a document by id", () => {
    expect(taskLinkHref("quotation", "q1")).toBe("/quotation?id=q1&view=1");
    expect(taskLinkHref("document", "d1")).toBe("/document/d1");
  });

  it("deep-links customers and equipment into the right tab", () => {
    expect(taskLinkHref("customer", "c1")).toBe("/customers?tab=customers&customerId=c1");
    expect(taskLinkHref("equipment", "e1")).toBe("/customers?tab=equipments&equipmentId=e1");
  });

  it("encodes an id that would otherwise break the query string", () => {
    expect(taskLinkHref("quotation", "a b&c")).toBe("/quotation?id=a%20b%26c&view=1");
  });

  it("returns null for an empty id instead of a half-built URL", () => {
    expect(taskLinkHref("customer", "")).toBeNull();
  });
});

describe("linkLiveness / resolveTaskLink", () => {
  it('calls a target "dead" only when its type WAS looked up and missed', () => {
    const link = makeLink({ targetType: "quotation", targetId: "q1" });

    expect(linkLiveness(link, { quotation: {} })).toBe("dead");
    expect(linkLiveness(link, { quotation: { q1: "QT-2568-001" } })).toBe("live");
  });

  it("never libels a link as deleted when the lookup was skipped or failed", () => {
    const link = makeLink({ targetType: "quotation", targetId: "q1" });

    expect(linkLiveness(link, undefined)).toBe("unknown");
    expect(linkLiveness(link, {})).toBe("unknown");
    expect(linkLiveness(link, { quotation: null })).toBe("unknown");
    // ...and a link of an unchecked type stays clickable.
    expect(resolveTaskLink(link, { customer: {} })).toMatchObject({
      isDead: false,
      href: "/quotation?id=q1&view=1",
    });
  });

  it("shows the target's CURRENT name while it is alive", () => {
    const link = makeLink({ targetId: "q1", label: "QT-2568-001" });

    expect(resolveTaskLink(link, { quotation: { q1: "QT-2569-042" } })).toMatchObject({
      label: "QT-2569-042",
      isDead: false,
    });
  });

  it("keeps the snapshot label and refuses to navigate once purged", () => {
    const link = makeLink({ targetId: "q1", label: "QT-2568-001" });
    const resolved = resolveTaskLink(link, { quotation: {} });

    expect(resolved).toMatchObject({ label: "QT-2568-001", isDead: true, href: null });
    // The card renders `${label} (${DELETED_TARGET_LABEL})` from these fields.
    expect(DELETED_TARGET_LABEL).toBe("ถูกลบแล้ว");
  });

  it("accepts a Map index as well as a plain object", () => {
    const link = makeLink({ targetType: "customer", targetId: "c1", label: "ร้านเก่า" });

    expect(resolveTaskLink(link, { customer: new Map([["c1", "ร้านใหม่"]]) })).toMatchObject({
      label: "ร้านใหม่",
      isDead: false,
    });
    expect(resolveTaskLink(link, { customer: new Map() })).toMatchObject({ isDead: true });
  });

  it("still shows something when the snapshot label is empty", () => {
    const link = makeLink({ targetId: "q9", label: "" });

    expect(resolveTaskLink(link, { quotation: {} }).label).toBe("q9");
  });

  it("resolves a whole task's links, dead ones included, without throwing", () => {
    const links = [
      makeLink({ targetType: "customer", targetId: "c1", label: "ลูกค้า ก" }),
      makeLink({ targetType: "quotation", targetId: "q1", label: "QT-1" }),
    ];
    const resolved = resolveTaskLinks(links, { customer: {}, quotation: {} });

    expect(resolved.every((link) => link.isDead && link.href === null)).toBe(true);
    expect(resolveTaskLinks(null, {})).toEqual([]);
  });
});
