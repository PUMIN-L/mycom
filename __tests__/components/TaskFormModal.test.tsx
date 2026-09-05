/**
 * Covers the task-board form pair: `TaskFormModal` (tasks 12.1-12.11) and the
 * chips it shares with the board, `TaskLinkChips` (tasks 13.1-13.5, 13.7).
 *
 * The rules worth a test are the ones a refactor would quietly break: the
 * stored id is the STABLE one, the label is a SNAPSHOT taken at pick time, a
 * failed directory load never blocks a save, a dead target is inert rather than
 * a 404, and one click makes exactly one task.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TaskFormModal from "@/app/components/TaskFormModal";
import TaskLinkChips, {
  __resetTaskLinkTargets,
  resolveTaskLinkChip,
  type TaskLinkTargetKindState,
  type TaskLinkTargetsSnapshot,
} from "@/app/components/TaskLinkChips";
import type { CrmTask, TaskLink, TaskTopic } from "@/app/lib/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

const TOPICS: TaskTopic[] = [
  {
    id: 1,
    name: "โทรลูกค้า",
    icon: "📞",
    color: "blue",
    sortOrder: 0,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "ทำใบเสนอราคา",
    icon: "🧾",
    color: "amber",
    sortOrder: 1,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const DIRECTORIES: Record<string, unknown[]> = {
  "/api/customers": [
    { id: "c1", name: "สมชาย", companyName: "บริษัท ก", department: "จัดซื้อ", phone: "02-111" },
    { id: "c2", name: "สมหญิง", companyName: "บริษัท ข" },
  ],
  "/api/admin/equipments": [
    { id: "e1", productName: "เครื่องวัด A", serialNumber: "SN-1", customerName: "สมชาย" },
  ],
  "/api/quotations": [{ id: "q1", docNo: "QT-2026-001", customer: "บริษัท ก" }],
  "/api/documents": [{ id: "d1", title: "คู่มือการใช้งาน" }],
};

function jsonOk(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Answers the four directory endpoints; `overrides` handles the save call and
 * any endpoint a test wants to fail. */
function mockFetch(overrides: (url: string, init?: RequestInit) => Response | Promise<Response> | null) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const override = overrides(url, init);
    if (override) return override;
    const key = Object.keys(DIRECTORIES).find((k) => url.startsWith(k));
    if (key) return jsonOk(DIRECTORIES[key]);
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function readBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  __resetTaskLinkTargets();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── TaskFormModal ───────────────────────────────────────────────────────────

describe("TaskFormModal", () => {
  /** Fill the two required fields the way the admin would. */
  async function fillRequired(title = "โทรหาคุณสมชาย") {
    fireEvent.click(screen.getByText("เลือกหัวข้อของงาน..."));
    fireEvent.click(await screen.findByText("📞 โทรลูกค้า"));
    fireEvent.change(screen.getByPlaceholderText(/เช่น โทรหาคุณสมชาย/), {
      target: { value: title },
    });
  }

  /** Open the target picker and pick one row of the current kind. */
  async function pickTarget(optionText: string | RegExp) {
    fireEvent.click(await screen.findByText(/^ค้นหา/));
    fireEvent.click(await screen.findByText(optionText));
  }

  it("refuses to save without a topic or a title, and never calls the API", async () => {
    const fetchMock = mockFetch(() => null);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <TaskFormModal topics={TOPICS} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "สร้างงาน" }));

    expect(await screen.findByText("กรุณาเลือกหัวข้อของงาน")).toBeInTheDocument();
    expect(screen.getByText("กรุณาระบุชื่องาน")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/admin/tasks"))
    ).toHaveLength(0);
  });

  it("stores the stable id and the label snapshot taken at pick time", async () => {
    const fetchMock = mockFetch((url, init) =>
      url === "/api/admin/tasks" && init?.method === "POST"
        ? jsonOk({ id: "t9" }, 201)
        : null
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<TaskFormModal topics={TOPICS} onClose={vi.fn()} onSaved={onSaved} />);

    await fillRequired();
    await pickTarget("สมชาย (บริษัท ก)");

    // Switch kind and add a quotation too — links cross kinds in one task (D4).
    fireEvent.click(screen.getByText("🏢 ลูกค้า"));
    fireEvent.click(await screen.findByText("🧾 ใบเสนอราคา"));
    await pickTarget("QT-2026-001");

    fireEvent.click(screen.getByRole("button", { name: "สร้างงาน" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "t9" }));
    const body = readBody(
      fetchMock.mock.calls.find((c) => c[0] === "/api/admin/tasks") as unknown[]
    );
    expect(body.topicId).toBe(1);
    expect(body.dueDate).toBeNull();
    expect(body.links).toEqual([
      { targetType: "customer", targetId: "c1", label: "สมชาย (บริษัท ก)" },
      // quotations.id, NEVER docNo — docNo is editable and changes on clone.
      { targetType: "quotation", targetId: "q1", label: "QT-2026-001" },
    ]);
  });

  it("picking the same target twice adds nothing", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch((url, init) =>
        url === "/api/admin/tasks" && init?.method === "POST" ? jsonOk({ id: "t9" }, 201) : null
      )
    );
    render(<TaskFormModal topics={TOPICS} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillRequired();
    await pickTarget("สมชาย (บริษัท ก)");

    // Re-opening the picker: the row it already holds is marked and inert, so a
    // second pick cannot add a duplicate row.
    fireEvent.click(await screen.findByText(/^ค้นหา/));
    const already = await screen.findByText("ผูกไว้กับงานนี้แล้ว");
    const option = already.closest("button") as HTMLButtonElement;
    expect(option).toBeDisabled();
    fireEvent.click(option);

    expect(screen.getAllByTitle(/^ลูกค้า: สมชาย \(บริษัท ก\)/)).toHaveLength(1);
  });

  it("still saves a task with no links when the directories fail to load", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/admin/tasks" && init?.method === "POST") return jsonOk({ id: "t9" }, 201);
      if (url.startsWith("/api/customers")) return jsonOk({ error: "boom" }, 500);
      return null;
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<TaskFormModal topics={TOPICS} onClose={vi.fn()} onSaved={onSaved} />);

    expect(await screen.findByText("โหลดรายการลูกค้าไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    // The form is not blocked on that failure (task 12.10).
    await fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "สร้างงาน" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = readBody(
      fetchMock.mock.calls.find((c) => c[0] === "/api/admin/tasks") as unknown[]
    );
    expect(body.links).toEqual([]);
  });

  it("edit mode pre-fills every field, clears the due date, and removes one link", async () => {
    const task: CrmTask = {
      id: "t1",
      topicId: 2,
      title: "ทำใบเสนอราคาให้บริษัท ก",
      detail: "รายละเอียดเดิม",
      dueDate: "2026-03-01",
      status: "pending",
      completedAt: null,
      createdAt: "2026-02-01T00:00:00.000Z",
      topicName: "ทำใบเสนอราคา",
      topicIcon: "🧾",
      links: [
        {
          taskId: "t1",
          targetType: "quotation",
          targetId: "q1",
          label: "QT-2026-001",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
        {
          taskId: "t1",
          targetType: "customer",
          targetId: "c1",
          label: "สมชาย (บริษัท ก)",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    };
    const fetchMock = mockFetch((url, init) =>
      url === "/api/admin/tasks/t1" && init?.method === "PATCH" ? jsonOk({ ...task }) : null
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskFormModal task={task} topics={TOPICS} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByDisplayValue("ทำใบเสนอราคาให้บริษัท ก")).toBeInTheDocument();
    expect(screen.getByDisplayValue("รายละเอียดเดิม")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-03-01")).toBeInTheDocument();
    expect(screen.getByText("🧾 ทำใบเสนอราคา")).toBeInTheDocument();
    expect(await screen.findByTitle(/^ใบเสนอราคา: QT-2026-001/)).toBeInTheDocument();

    // Back to "no deadline" (task 12.3) …
    fireEvent.click(screen.getByRole("button", { name: "ล้างวันที่" }));
    // … and drop one of the two links (task 12.9).
    fireEvent.click(screen.getByRole("button", { name: /เอาลิงก์ QT-2026-001 ออกจากงานนี้/ }));

    fireEvent.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/admin/tasks/t1")).toBe(true)
    );
    const body = readBody(
      fetchMock.mock.calls.find((c) => c[0] === "/api/admin/tasks/t1") as unknown[]
    );
    expect(body.dueDate).toBeNull();
    expect(body.links).toEqual([
      { targetType: "customer", targetId: "c1", label: "สมชาย (บริษัท ก)" },
    ]);
  });

  it("a double click creates exactly one task", async () => {
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = mockFetch((url, init) =>
      url === "/api/admin/tasks" && init?.method === "POST" ? pending : null
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskFormModal topics={TOPICS} onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillRequired();
    const save = screen.getByRole("button", { name: "สร้างงาน" });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /กำลังบันทึก/ })).toBeDisabled()
    );
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === "/api/admin/tasks")
    ).toHaveLength(1);

    release(jsonOk({ id: "t9" }, 201));
  });
});

// ── TaskLinkChips ───────────────────────────────────────────────────────────

function kindState(over: Partial<TaskLinkTargetKindState> = {}): TaskLinkTargetKindState {
  const options = over.options ?? [];
  return {
    status: "ready",
    truncated: false,
    error: null,
    ...over,
    options,
    byId: over.byId ?? new Map(options.map((o) => [o.id, o])),
  };
}

function snapshot(over: Partial<TaskLinkTargetsSnapshot> = {}): TaskLinkTargetsSnapshot {
  const empty = kindState();
  return { customer: empty, equipment: empty, quotation: empty, document: empty, ...over };
}

const link = (over: Partial<TaskLink> = {}): TaskLink => ({
  taskId: "t1",
  targetType: "quotation",
  targetId: "q1",
  label: "QT-2026-001",
  createdAt: "2026-02-01T00:00:00.000Z",
  ...over,
});

describe("resolveTaskLinkChip", () => {
  it("prefers the target's CURRENT name over the stored snapshot", () => {
    const chip = resolveTaskLinkChip(
      link({ targetType: "customer", targetId: "c1", label: "ชื่อเก่า" }),
      kindState({ options: [{ id: "c1", label: "ชื่อใหม่" }] })
    );
    expect(chip).toMatchObject({
      status: "live",
      label: "ชื่อใหม่",
      href: "/customers?tab=customers&customerId=c1",
    });
  });

  it("falls back to the snapshot and refuses to navigate once the target is gone", () => {
    const chip = resolveTaskLinkChip(link(), kindState({ options: [{ id: "other", label: "x" }] }));
    expect(chip.status).toBe("missing");
    expect(chip.label).toBe("QT-2026-001");
    expect(chip.href).toBeNull();
  });

  it("opens a live quotation READ-ONLY", () => {
    expect(
      resolveTaskLinkChip(link(), kindState({ options: [{ id: "q1", label: "QT-2026-001" }] })).href
    ).toBe("/quotation?id=q1&view=1");
  });

  it("never claims a deletion it could not verify", () => {
    // Still loading …
    expect(resolveTaskLinkChip(link(), kindState({ status: "loading" })).status).toBe("checking");
    // … capped response: an absent id proves nothing …
    expect(
      resolveTaskLinkChip(link(), kindState({ truncated: true, options: [] })).status
    ).toBe("unverified");
    // … load failed and this id was never seen.
    expect(
      resolveTaskLinkChip(link(), kindState({ status: "error", error: "boom" })).status
    ).toBe("unverified");
  });

  it("keeps a chip clickable when only the REFRESH failed", () => {
    const chip = resolveTaskLinkChip(
      link(),
      kindState({ status: "error", error: "boom", options: [{ id: "q1", label: "QT-2026-001" }] })
    );
    expect(chip.status).toBe("live");
    expect(chip.href).toBe("/quotation?id=q1&view=1");
  });
});

describe("TaskLinkChips", () => {
  it("renders a dead target as dimmed, non-clickable text — never a link", () => {
    const { container } = render(
      <TaskLinkChips
        links={[link(), link({ targetType: "document", targetId: "d1", label: "คู่มือ" })]}
        targets={snapshot({
          document: kindState({ options: [{ id: "d1", label: "คู่มือการใช้งาน" }] }),
        })}
      />
    );

    // The purged quotation: label + (ถูกลบแล้ว), and no anchor at all.
    const dead = screen.getByTitle(/^ใบเสนอราคา: QT-2026-001/);
    expect(within(dead).getByText("(ถูกลบแล้ว)")).toBeInTheDocument();
    expect(dead.tagName).not.toBe("A");
    // The live document alongside it still works — one bad link must not break
    // the card around it.
    expect(container.querySelector('a[href="/document/d1"]')).toBeTruthy();
  });

  it("resolves every chip from one shared lookup per kind, not one per chip", async () => {
    const fetchMock = mockFetch(() => null);
    vi.stubGlobal("fetch", fetchMock);
    const many = Array.from({ length: 5 }, (_, i) =>
      link({ targetType: "customer", targetId: `c${i}`, label: `ลูกค้า ${i}` })
    );

    render(
      <>
        <TaskLinkChips links={many} />
        <TaskLinkChips links={many} />
      </>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/customers"))
    ).toHaveLength(1);
    // Nothing else was fetched: a card with no equipment chip never asks for the
    // equipment directory.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});
