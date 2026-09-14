/**
 * Bug the user originally reported (with screenshots, back when the board
 * lived on `/crm/alerts`): creating a task from the "สร้างสิ่งที่ต้องทำ"
 * quick-create button INSIDE `CustomerDetailsModal`/`EquipmentDetailsModal`
 * never showed up on the board below — a manual page refresh was required.
 *
 * Root cause was each modal's own nested `TaskFormModal.onSaved` never
 * telling the page's `TaskBoardSection` a new task existed. The fix wired
 * the same `revealTask` mechanism the board's own "สร้างงานใหม่" button
 * already used through a new `onTaskCreated` prop on both detail modals.
 *
 * The board is now its own page at `/crm/tasks` (spec:
 * move-task-board-to-own-page) — moved here (adjusted for how a detail modal
 * is reached on THIS page: via a task chip, since the นัดโทรลูกค้า "แก้ไข"
 * button this test used on `/crm/alerts` doesn't exist here) from
 * alertsQuickCreateRevealsBoard.test.tsx. Still proves the effect end-to-end:
 * no `TaskFormModal` unmount trick, no manual re-render — the created task
 * appears on the board because the app itself reloaded it.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __resetTaskTopics } from "@/app/components/useTaskTopics";

const pushMock = vi.fn();
// STABLE object — a fresh literal per call breaks `handleUnauthorized`'s
// `useCallback([router])` and sends this page into a real infinite
// re-render loop (see alertsCustomerCallEditRoute.test.tsx).
const routerMock = { push: pushMock, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({
  usePathname: () => "/crm/tasks",
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));
vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({
  default: () => <div data-testid="call-schedule" />,
}));

import TasksPage from "@/app/crm/tasks/page";

const TOPICS = [
  { id: 1, name: "โทรหาลูกค้า", icon: "📞", color: "blue", sortOrder: 0, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 2, name: "อื่นๆ", icon: "📌", color: "slate", sortOrder: 1, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

const CUSTOMER = {
  id: "cus-42",
  companyId: "co1",
  companyName: "บ.ทดสอบ",
  name: "คุณสมชาย",
  department: "ฝ่ายจัดซื้อ",
  phone: "020000000",
  email: "somchai@example.com",
  note: "",
};

const EXISTING_TASK = {
  id: "t-existing",
  topicId: 2,
  title: "ติดตามงานลูกค้า",
  detail: null,
  dueDate: null,
  status: "pending",
  completedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  topicName: "อื่นๆ",
  topicIcon: "📌",
  topicColor: "slate",
  links: [{ taskId: "t-existing", targetType: "customer", targetId: "cus-42", label: "คุณสมชาย (บ.ทดสอบ)", createdAt: "" }],
};

/** Emulates the real board: the new task exists only once the create-task
 *  POST lands, and every GET after that includes it alongside the existing
 *  one — proving a real reload happened, not a locally-patched list. */
function stubFetch() {
  let created: Record<string, unknown> | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/admin/task-topics")) {
      return { ok: true, status: 200, json: async () => TOPICS } as unknown as Response;
    }
    if (url.startsWith("/api/admin/tasks")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        created = {
          id: "t-new",
          topicId: body.topicId,
          title: body.title,
          detail: body.detail,
          dueDate: body.dueDate,
          status: "pending",
          completedAt: null,
          createdAt: "2026-09-14T00:00:00.000Z",
          topicName: "โทรหาลูกค้า",
          topicIcon: "📞",
          topicColor: "blue",
          links: body.links,
        };
        return { ok: true, status: 201, json: async () => created } as unknown as Response;
      }
      // GET — the new task only ever appears once it has actually been created.
      return {
        ok: true,
        status: 200,
        json: async () => (created ? [EXISTING_TASK, created] : [EXISTING_TASK]),
      } as unknown as Response;
    }
    const custMatch = url.match(/^\/api\/customers\/([^/?]+)$/);
    if (custMatch) {
      return { ok: true, status: 200, json: async () => CUSTOMER } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  __resetTaskTopics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

describe("สร้างสิ่งที่ต้องทำจากปุ่มในหน้าข้อมูลลูกค้า/เครื่อง (หน้า /crm/tasks) — ขึ้นบนกระดานทันที ไม่ต้องรีเฟรช", () => {
  it("สร้างจาก CustomerDetailsModal ที่เปิดในหน้าเดิม (ผ่านชิปบนงานเดิม) — งานใหม่ปรากฏบนกระดานเองโดยไม่รีเฟรชหน้า", async () => {
    stubFetch();
    render(<TasksPage />);

    await screen.findByText("ติดตามงานลูกค้า");
    expect(screen.queryByText("ไปส่งใบเสนอราคา")).not.toBeInTheDocument();

    // Open the customer profile in place via the existing task's chip.
    fireEvent.click(await screen.findByRole("button", { name: /คุณสมชาย \(บ\.ทดสอบ\)/ }));
    const modalHeading = await screen.findByRole("heading", { name: "คุณสมชาย", level: 2 });
    expect(modalHeading).toBeInTheDocument();

    // The quick-create button, inside that modal.
    fireEvent.click(screen.getByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    fireEvent.click(within(dialog).getByText("เลือกหัวข้อของงาน..."));
    fireEvent.click(await screen.findByText("📞 โทรหาลูกค้า"));
    fireEvent.change(within(dialog).getByPlaceholderText(/เช่น โทรหาคุณสมชาย/), {
      target: { value: "ไปส่งใบเสนอราคา" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "สร้างงาน" }));

    // The nice confirmation dialog appears...
    expect(await screen.findByText("สร้างงานสำเร็จ")).toBeInTheDocument();

    // ...and, without anything else happening, the board picks the task up
    // on its own: this is the exact behavior that used to require a manual
    // page refresh.
    expect(await screen.findByText("ไปส่งใบเสนอราคา")).toBeInTheDocument();
    expect(screen.getByText(/ไว้ใต้หัวข้อ/)).toBeInTheDocument();
  });
});
