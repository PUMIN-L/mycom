/**
 * The "จัดการหัวข้องาน" modal (tasks.md §14), driven exactly the way the admin
 * drives it: open it, pick an emoji, type a name, press "เพิ่มหัวข้อ" — twice.
 *
 * The bug report this file was written for was "the topic I add never shows up,
 * only one could ever be created, and the emoji came out wrong", so the tests
 * assert the three things that report is about: the new row is rendered, a
 * SECOND and THIRD add are accepted, and the emoji that reaches the API is the
 * one that was clicked.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import TaskTopicManagerModal from "@/app/components/TaskTopicManagerModal";
import type { TaskTopic } from "@/app/lib/types";

function jsonOk(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/** A stand-in for task_topics + the real addTopic id allocation (MAX(id)+1). */
function fakeServer(seed: TaskTopic[] = []) {
  const rows: TaskTopic[] = seed.map((t) => ({ ...t }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/admin/tasks")) return jsonOk([]);
    if (url.startsWith("/api/admin/task-topics") && method === "GET") {
      return jsonOk(rows.map((t) => ({ ...t })));
    }
    if (url === "/api/admin/task-topics" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Partial<TaskTopic>;
      const nextId = rows.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      const created: TaskTopic = {
        id: nextId,
        name: String(body.name ?? ""),
        icon: [...String(body.icon ?? "")].slice(0, 8).join(""),
        color: String(body.color ?? "blue"),
        sortOrder: nextId,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      rows.push(created);
      return jsonOk(created, 201);
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  return { rows, fetchMock };
}

/** The ADD form's emoji toggle (the edit rows have their own, keyed by id). */
const emojiToggle = (): HTMLElement =>
  document.querySelector('[aria-controls="emoji-panel-new"]') as HTMLElement;

/** Open the emoji panel of the ADD form and click one of the curated choices. */
function pickEmoji(emoji: string) {
  fireEvent.click(emojiToggle());
  fireEvent.click(screen.getByRole("button", { name: `ใช้อีโมจิ ${emoji}` }));
}

async function addTopic(name: string, emoji?: string) {
  if (emoji) pickEmoji(emoji);
  fireEvent.change(screen.getByPlaceholderText("เช่น รอเอกสารจากลูกค้า"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มหัวข้อ" }));
}

const postCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]) === "/api/admin/task-topics" && (c[1] as RequestInit)?.method === "POST"
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskTopicManagerModal — adding topics", () => {
  it("shows a newly added topic in the list straight away, with the emoji that was clicked", async () => {
    const { fetchMock } = fakeServer([]);
    vi.stubGlobal("fetch", fetchMock);
    const onTopicsChanged = vi.fn();

    render(<TaskTopicManagerModal onClose={vi.fn()} onTopicsChanged={onTopicsChanged} />);
    await screen.findByText("ยังไม่มีหัวข้องาน — เพิ่มหัวข้อแรกได้จากช่องด้านบน");

    await addTopic("รอเอกสารจากลูกค้า", "🚩");

    const row = await screen.findByRole("listitem");
    expect(within(row).getByText("รอเอกสารจากลูกค้า")).toBeInTheDocument();
    // The emoji is the one the admin clicked, never the 📌 default.
    expect(within(row).getByText("🚩")).toBeInTheDocument();
    // ...and that is what was actually sent to the API.
    expect(JSON.parse(String((postCalls(fetchMock)[0][1] as RequestInit).body))).toMatchObject({
      name: "รอเอกสารจากลูกค้า",
      icon: "🚩",
    });
    expect(onTopicsChanged).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
  });

  it("accepts a second and a third topic — every add posts and every row is rendered", async () => {
    const { rows, fetchMock } = fakeServer([]);
    vi.stubGlobal("fetch", fetchMock);

    render(<TaskTopicManagerModal onClose={vi.fn()} />);
    await screen.findByText("ยังไม่มีหัวข้องาน — เพิ่มหัวข้อแรกได้จากช่องด้านบน");

    await addTopic("หนึ่ง", "📞");
    await screen.findByText("หนึ่ง");
    await addTopic("สอง", "🚗");
    await screen.findByText("สอง");
    await addTopic("สาม", "🔧");
    await screen.findByText("สาม");

    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(3));
    expect(rows.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(rows.map((t) => t.icon)).toEqual(["📞", "🚗", "🔧"]);
  });

  it("resets the add form to the defaults after a successful add", async () => {
    const { fetchMock } = fakeServer([]);
    vi.stubGlobal("fetch", fetchMock);

    render(<TaskTopicManagerModal onClose={vi.fn()} />);
    await screen.findByText("ยังไม่มีหัวข้องาน — เพิ่มหัวข้อแรกได้จากช่องด้านบน");

    await addTopic("หนึ่ง", "🚗");
    await screen.findByText("หนึ่ง");

    expect((screen.getByPlaceholderText("เช่น รอเอกสารจากลูกค้า") as HTMLInputElement).value).toBe("");
    // The picker button shows the icon the NEXT add would use — back to 📌.
    expect(emojiToggle().textContent).toBe("📌");
  });

  it("keeps the admin's own emoji when he types one instead of using the grid", async () => {
    const { rows, fetchMock } = fakeServer([]);
    vi.stubGlobal("fetch", fetchMock);

    render(<TaskTopicManagerModal onClose={vi.fn()} />);
    await screen.findByText("ยังไม่มีหัวข้องาน — เพิ่มหัวข้อแรกได้จากช่องด้านบน");

    fireEvent.click(emojiToggle());
    fireEvent.change(screen.getByLabelText("หรือพิมพ์/วางอีโมจิเอง"), {
      target: { value: "🦺" },
    });
    fireEvent.change(screen.getByPlaceholderText("เช่น รอเอกสารจากลูกค้า"), {
      target: { value: "ความปลอดภัย" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มหัวข้อ" }));

    await waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0].icon).toBe("🦺");
  });

  it("surfaces the server's message and adds nothing when the POST fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/admin/tasks")) return jsonOk([]);
      if ((init?.method ?? "GET") === "GET") return jsonOk([]);
      return jsonOk({ error: "บันทึกหัวข้องานไม่สำเร็จ" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TaskTopicManagerModal onClose={vi.fn()} />);
    await screen.findByText("ยังไม่มีหัวข้องาน — เพิ่มหัวข้อแรกได้จากช่องด้านบน");

    await addTopic("ล้มเหลว", "🚩");

    expect(await screen.findByText("บันทึกหัวข้องานไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
