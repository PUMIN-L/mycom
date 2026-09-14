/**
 * "📝 สร้างสิ่งที่ต้องทำ" on the Viewing Customer modal — spec:
 * add-customer-quick-task-button.
 *
 * The whole point is that the admin never has to search for the customer he
 * is already looking at: the button opens the SAME create-task form the task
 * board uses, pre-seeded with a link to exactly this customer. What is worth
 * pinning down is everything a copy-paste of that idea could get wrong: the
 * link following a stale reference to whichever customer was open first, the
 * topics list being re-fetched every click, and a failed topics fetch quietly
 * opening a form with nothing to file the task under.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";
// The topic list is a MODULE-LEVEL cache shared with EquipmentDetailsModal's
// own quick-create button (useTaskTopics.ts) — reset it before every test or
// a load from one test leaks into the next and this file's "loaded once" /
// "failed load" assertions become order-dependent.
import { __resetTaskTopics } from "@/app/components/useTaskTopics";

let mockSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(mockSearch),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

vi.mock("@/app/customers/EquipmentTab", () => ({
  default: () => <div data-testid="equipment-tab" />,
}));

vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({
  default: () => <div data-testid="call-schedule" />,
}));

vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn() }));

const CUSTOMER_A = {
  id: "c1",
  companyId: "co1",
  companyName: "บริษัท ก",
  name: "สมชาย ใจดี",
  department: "ฝ่ายแล็บ",
  phone: "020000000",
  email: "somchai@example.com",
  note: "",
};

const CUSTOMER_B = {
  id: "c2",
  companyId: "co2",
  companyName: "บริษัท ข",
  name: "สมหญิง ดีใจ",
  department: "ฝ่ายจัดซื้อ",
  phone: "020000001",
  email: "somying@example.com",
  note: "",
};

// TWO topics, deliberately — with only one, TaskFormModal's own "the only
// topic there is" rule auto-selects it and the dropdown never shows its
// placeholder, which would make these tests pass by accident rather than by
// actually exercising the topic picker.
const TOPICS = [
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

interface FetchOptions {
  topicsStatus?: number;
  topics?: unknown[];
}

function mockFetch({ topicsStatus = 200, topics = TOPICS }: FetchOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/admin/equipments/")) {
      return { ok: false, status: 404, json: async () => ({ error: "ไม่พบ" }) };
    }
    if (url === "/api/customers") {
      return { ok: true, status: 200, json: async () => [CUSTOMER_A, CUSTOMER_B] };
    }
    if (url.startsWith("/api/admin/task-topics")) {
      return topicsStatus < 400
        ? { ok: true, status: 200, json: async () => topics }
        : { ok: false, status: topicsStatus, json: async () => ({ error: "โหลดไม่สำเร็จ" }) };
    }
    if (url === "/api/admin/tasks" && init?.method === "POST") {
      return { ok: true, status: 201, json: async () => ({ id: "t9" }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function visit(search: string) {
  mockSearch = search;
  window.history.replaceState({}, "", `/customers${search ? `?${search}` : ""}`);
}

async function openTaskButton() {
  fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
}

/** Fill topic + title in the create-task dialog and submit. */
async function saveTaskForm() {
  const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
  fireEvent.click(within(dialog).getByText("เลือกหัวข้อของงาน..."));
  fireEvent.click(await screen.findByText("📞 โทรลูกค้า"));
  fireEvent.change(within(dialog).getByPlaceholderText(/เช่น โทรหาคุณสมชาย/), {
    target: { value: "โทรติดตาม" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "สร้างงาน" }));
}

beforeEach(() => {
  visit("customerId=c1");
  __resetTaskTopics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ปุ่ม สร้างสิ่งที่ต้องทำ บนหน้ารายละเอียดลูกค้า", () => {
  it("เปิดฟอร์มสร้างงานพร้อมลิงก์ลูกค้าที่กำลังดูอยู่ และบันทึกสำเร็จ", async () => {
    const fetchMock = mockFetch();
    render(<Customers />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument()
    );

    await openTaskButton();
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    // Pre-seeded — no search on the admin's part.
    expect(within(dialog).getByText("สมชาย ใจดี (บริษัท ก)")).toBeInTheDocument();

    await saveTaskForm();

    await waitFor(() =>
      expect(screen.getByText(/สร้างงานสำเร็จ/)).toBeInTheDocument()
    );
    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/tasks" && (init as RequestInit)?.method === "POST"
    )!;
    const body = JSON.parse(String((saveCall[1] as RequestInit).body));
    expect(body.links).toEqual([
      { targetType: "customer", targetId: "c1", label: "สมชาย ใจดี (บริษัท ก)" },
    ]);
    // Stayed on the customer's own page — the modal underneath is still open.
    expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument();
  });

  it("เปิดลูกค้าคนละคน ได้ลิงก์คนละอันเสมอ ไม่ค้างจากคนก่อนหน้า", async () => {
    mockFetch();
    visit("");
    render(<Customers />);
    const viewButtons = await screen.findAllByRole("button", { name: "ดูข้อมูล" });
    expect(viewButtons).toHaveLength(2);

    // Open customer A, use the button, see A's chip, close WITHOUT saving.
    fireEvent.click(viewButtons[0]);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument()
    );
    await openTaskButton();
    const dialogA = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    expect(within(dialogA).getByText("สมชาย ใจดี (บริษัท ก)")).toBeInTheDocument();
    fireEvent.click(within(dialogA).getByRole("button", { name: "ปิด" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument()
    );

    // The Viewing Customer modal for A is still open underneath — switch it to
    // B by clicking B's own "ดูข้อมูล", exactly as the admin would.
    fireEvent.click(viewButtons[1]);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "สมหญิง ดีใจ" })).toBeInTheDocument()
    );

    await openTaskButton();
    const dialogB = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    expect(within(dialogB).getByText("สมหญิง ดีใจ (บริษัท ข)")).toBeInTheDocument();
    // A's link must not have carried over.
    expect(within(dialogB).queryByText("สมชาย ใจดี (บริษัท ก)")).not.toBeInTheDocument();
  });

  it("โหลดหัวข้องานครั้งเดียว ไม่โหลดซ้ำทุกครั้งที่กดปุ่ม", async () => {
    const fetchMock = mockFetch();
    render(<Customers />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument()
    );

    await openTaskButton();
    const dialog1 = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    fireEvent.click(within(dialog1).getByRole("button", { name: "ปิด" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument()
    );

    await openTaskButton();
    await screen.findByRole("dialog", { name: "สร้างงานใหม่" });

    const topicCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/admin/task-topics")
    );
    expect(topicCalls).toHaveLength(1);
  });

  it("โหลดหัวข้องานไม่สำเร็จ — แจ้งเตือนแล้วไม่เปิดฟอร์ม ครั้งถัดไปลองใหม่ได้", async () => {
    const fetchMock = mockFetch({ topicsStatus: 500 });
    render(<Customers />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument()
    );

    await openTaskButton();
    await waitFor(() =>
      expect(screen.getByText(/โหลดหัวข้องานไม่สำเร็จ/)).toBeInTheDocument()
    );
    expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument();

    // Retried on the very next click — the failure was not cached forever.
    const fetchMock2 = mockFetch();
    vi.stubGlobal("fetch", fetchMock2);
    await openTaskButton();
    await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    expect(
      fetchMock2.mock.calls.some(([url]) => String(url).startsWith("/api/admin/task-topics"))
    ).toBe(true);
  });

  it("ไม่มีหัวข้องานเลยสักอันในระบบ — แจ้งเตือนแล้วไม่เปิดฟอร์มเปล่า", async () => {
    mockFetch({ topics: [] });
    render(<Customers />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument()
    );

    await openTaskButton();
    await waitFor(() =>
      expect(screen.getByText(/ยังไม่มีหัวข้องาน/)).toBeInTheDocument()
    );
    expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument();
  });
});
