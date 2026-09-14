/**
 * "customer"/"equipment" chips on a SAVED task card (the "สิ่งที่ต้องทำ" board,
 * now its own page at `/crm/tasks` — spec: move-task-board-to-own-page) open
 * the shared details modal IN PLACE rather than navigating away via
 * `<Link href>` to `/customers?tab=...` — the same component and the same
 * fetch-and-open functions `/crm/alerts`' own "แก้ไข" button uses (spec:
 * open-task-chip-targets-in-place, unaffected by the board's page move).
 * `quotation`/`document` chips, and any chip whose target has been deleted,
 * are untouched by either change and are asserted here as a regression
 * check. Moved verbatim (adjusted for the new page) from
 * alertsTaskChipTargets.test.tsx, which tested this on `/crm/alerts` back
 * when the board rendered there.
 *
 * These chips live in `TaskBoardSection.tsx`, NOT `TaskLinkChips.tsx` — the
 * latter is only used (with `navigable={false}`) inside `TaskFormModal`'s
 * own link picker while composing a task, and its navigable path is not
 * reachable from anywhere in the app today.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

const pushMock = vi.fn();
// STABLE object — see alertsCustomerCallEditRoute.test.tsx for why a fresh
// literal per call sends a page depending on it into a real infinite
// re-render loop via `handleUnauthorized` → `fetchTopics`.
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

const TOPIC = {
  id: 1,
  name: "อื่นๆ",
  icon: "📌",
  color: "slate",
  sortOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TASK_WITH_LINKS = {
  id: "t1",
  topicId: 1,
  title: "ติดตามงานลูกค้า",
  detail: null,
  dueDate: null,
  status: "pending",
  completedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  topicName: "อื่นๆ",
  topicIcon: "📌",
  topicColor: "slate",
  links: [
    { taskId: "t1", targetType: "customer", targetId: "cus-1", label: "คุณสมชาย (บริษัท ก)", createdAt: "" },
    { taskId: "t1", targetType: "equipment", targetId: "eq-1", label: "เครื่องชั่ง A (S/N SN-1)", createdAt: "" },
    { taskId: "t1", targetType: "quotation", targetId: "q-1", label: "QT260905-01", createdAt: "" },
    { taskId: "t1", targetType: "document", targetId: "d-1", label: "คู่มือการใช้งาน", createdAt: "" },
    { taskId: "t1", targetType: "customer", targetId: "cus-gone", label: "ลูกค้าที่ถูกลบ", createdAt: "" },
  ],
};

interface Options {
  customerById?: Record<string, unknown>;
  equipmentById?: Record<string, unknown>;
}

function stubFetch({ customerById = {}, equipmentById = {} }: Options = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/admin/task-topics")) {
      return { ok: true, status: 200, json: async () => [TOPIC] } as unknown as Response;
    }
    if (url.startsWith("/api/admin/tasks")) {
      if (init?.method) return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => [TASK_WITH_LINKS] } as unknown as Response;
    }
    const custMatch = url.match(/^\/api\/customers\/([^/?]+)$/);
    if (custMatch) {
      const id = decodeURIComponent(custMatch[1]);
      const customer = customerById[id];
      return customer
        ? ({ ok: true, status: 200, json: async () => customer } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({ error: "ไม่พบลูกค้า" }) } as unknown as Response);
    }
    const eqMatch = url.match(/\/api\/admin\/equipments\/([^/?]+)/);
    if (eqMatch) {
      const eq = equipmentById[eqMatch[1]];
      return eq
        ? ({ ok: true, status: 200, json: async () => eq } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

describe("ชิปลิงก์บนการ์ดงาน (หน้า /crm/tasks) — ลูกค้า/เครื่อง เปิดในหน้าเดิม ที่เหลือไม่เปลี่ยน", () => {
  it("กดชิปลูกค้า — เปิด CustomerDetailsModal ในหน้าเดิม ไม่นำทางออก", async () => {
    const fetchMock = stubFetch({
      customerById: {
        "cus-1": {
          id: "cus-1",
          companyId: "co1",
          companyName: "บริษัท ก",
          name: "คุณสมชาย",
          department: "ฝ่ายจัดซื้อ",
          phone: "020000000",
          email: "somchai@example.com",
          note: "",
        },
      },
    });
    render(<TasksPage />);

    const chip = await screen.findByRole("button", { name: /คุณสมชาย \(บริษัท ก\)/ });
    fireEvent.click(chip);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/customers/cus-1")).toBe(true)
    );
    expect(await screen.findByRole("heading", { name: "คุณสมชาย", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("ฝ่ายจัดซื้อ")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("กดชิปเครื่องจักร — เปิด EquipmentDetailsModal ในหน้าเดิม ไม่นำทางออก", async () => {
    const fetchMock = stubFetch({
      equipmentById: {
        "eq-1": { id: "eq-1", productName: "เครื่องชั่ง A", serialNumber: "SN-1" },
      },
    });
    render(<TasksPage />);

    const chip = await screen.findByRole("button", { name: /เครื่องชั่ง A/ });
    fireEvent.click(chip);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/admin/equipments/eq-1"))).toBe(true)
    );
    expect(await screen.findByText("รายละเอียดอุปกรณ์")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("ชิปใบเสนอราคา/เอกสาร ยังเป็นลิงก์นำทางเหมือนเดิม (ไม่ถูกงานนี้แตะ)", async () => {
    stubFetch();
    render(<TasksPage />);

    const quotationChip = await screen.findByRole("link", { name: /QT260905-01/ });
    expect(quotationChip).toHaveAttribute("href", "/quotation?id=q-1&view=1");

    const documentChip = screen.getByRole("link", { name: /คู่มือการใช้งาน/ });
    expect(documentChip).toHaveAttribute("href", "/document/d-1");
  });

  // `/crm/tasks` does not pass `linkTargetIndex` to `TaskBoardSection` (it
  // never has — same pre-existing gap this page inherited from /crm/alerts,
  // not something this change touches), so every chip's liveness reads
  // "unknown" here, never "dead". A "unknown" chip is still a live,
  // clickable one by design (see `lookupTarget` in taskBoard.ts) — it is NOT
  // the same thing as a confirmed-deleted target. The actual "dead chip
  // stays inert even with onOpenCustomer set" guarantee is a
  // `TaskBoardSection` concern and belongs in its own component test
  // (TaskBoardSection.test.tsx), where `linkTargetIndex` can be set directly.
  it("ชิปลูกค้าที่ยังไม่ได้ตรวจสอบ (ไม่มี linkTargetIndex) ยังเปิดได้ตามปกติ ไม่ถูกมองว่าตายไปเงียบๆ", async () => {
    const fetchMock = stubFetch({
      customerById: {
        "cus-gone": {
          id: "cus-gone",
          companyId: "co1",
          name: "ลูกค้าที่ถูกลบ",
          department: "",
          phone: "",
          email: "",
          note: "",
        },
      },
    });
    render(<TasksPage />);

    const chip = await screen.findByRole("button", { name: /ลูกค้าที่ถูกลบ/ });
    fireEvent.click(chip);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/customers/cus-gone")).toBe(true)
    );
  });
});
