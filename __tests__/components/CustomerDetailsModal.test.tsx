/**
 * CustomerDetailsModal — extracted from `/customers`' inline "Viewing
 * Customer Modal" (spec: open-customer-profile-in-place) so `/crm/alerts`
 * can open the identical view without navigating away. Tested directly here
 * (mirroring `EquipmentDetailsModal.test.tsx`) so both hosts can rely on the
 * component being correct on its own, independent of either page's wiring.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CustomerDetailsModal from "@/app/components/modals/CustomerDetailsModal";
import { __resetTaskTopics } from "@/app/components/useTaskTopics";
import type { Customer } from "@/app/lib/types";

const CUSTOMER: Customer = {
  id: "c1",
  companyId: "co1",
  companyName: "บริษัท ก",
  name: "สมชาย ใจดี",
  department: "ฝ่ายแล็บ",
  phone: "020000000",
  email: "somchai@example.com",
  note: "6/9/26 โทรติดตามใบเสนอราคา",
};

// TWO topics, deliberately — with only one, TaskFormModal's own "the only
// topic there is" rule auto-selects it and the dropdown never shows its
// placeholder, which would make the topic-picking step below a no-op.
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

vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({
  default: () => <div data-testid="call-schedule" />,
}));

interface FetchOptions {
  topicsStatus?: number;
  topics?: unknown[];
  putStatus?: number;
}

function mockFetch({ topicsStatus = 200, topics = TOPICS, putStatus = 200 }: FetchOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PUT" && url === `/api/customers/${CUSTOMER.id}`) {
      return { ok: putStatus < 400, status: putStatus, json: async () => ({}) };
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

async function saveTaskForm() {
  const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
  fireEvent.click(within(dialog).getByText("เลือกหัวข้อของงาน..."));
  fireEvent.click(await screen.findByText("📞 โทรลูกค้า"));
  fireEvent.change(within(dialog).getByPlaceholderText(/เช่น โทรหาคุณสมชาย/), {
    target: { value: "โทรติดตาม" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "สร้างงาน" }));
}

let showToast: (message: string, type: "success" | "error") => void;

beforeEach(() => {
  __resetTaskTopics();
  showToast = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CustomerDetailsModal — ข้อมูลลูกค้า", () => {
  it("แสดงแผนก/อีเมล/เบอร์โทร/บันทึกลูกค้า", () => {
    mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument();
    expect(screen.getByText("ฝ่ายแล็บ")).toBeInTheDocument();
    expect(screen.getByText("somchai@example.com")).toBeInTheDocument();
    expect(screen.getByText("020000000")).toBeInTheDocument();
    expect(screen.getByText("6/9/26 โทรติดตามใบเสนอราคา")).toBeInTheDocument();
  });

  it("onClose ถูกเรียกตอนกดปิด", () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CustomerDetailsModal — แก้ไขบันทึกลูกค้า", () => {
  it("บันทึกสำเร็จ: เรียก onSaved พร้อมค่าใหม่ และ toast", async () => {
    mockFetch();
    const onSaved = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={onSaved} showToast={showToast} />);

    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    const textarea = screen.getByDisplayValue(CUSTOMER.note);
    fireEvent.change(textarea, { target: { value: "6/9/26 โทรติดตาม\n13/9/26 ปิดการขาย" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      ...CUSTOMER,
      note: "6/9/26 โทรติดตาม\n13/9/26 ปิดการขาย",
    }));
    expect(showToast).toHaveBeenCalledWith("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
  });

  it("เกิน 2000 ตัวอักษร — ปฏิเสธก่อนยิง request", async () => {
    const fetchMock = mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    fireEvent.change(screen.getByDisplayValue(CUSTOMER.note), { target: { value: "ก".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(showToast).toHaveBeenCalledWith("บันทึกลูกค้าต้องไม่เกิน 2000 ตัวอักษร", "error");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PUT")).toBe(false);
  });

  it("บันทึกไม่สำเร็จ — toast error, ยังอยู่ในโหมดแก้ไข", async () => {
    mockFetch({ putStatus: 500 });
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    fireEvent.change(screen.getByDisplayValue(CUSTOMER.note), { target: { value: "แก้ไขใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("เกิดข้อผิดพลาดในการบันทึก", "error"));
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeInTheDocument();
  });

  it("สลับลูกค้าคนละคน — เลิกโหมดแก้ไขที่ค้างอยู่ ไม่ให้ draft รั่วข้ามคน", () => {
    mockFetch();
    const { rerender } = render(
      <CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />
    );
    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    expect(screen.getByDisplayValue(CUSTOMER.note)).toBeInTheDocument();

    const other: Customer = { ...CUSTOMER, id: "c2", name: "สมหญิง", note: "คนละโน้ต" };
    rerender(<CustomerDetailsModal customer={other} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    expect(screen.queryByDisplayValue(CUSTOMER.note)).not.toBeInTheDocument();
    expect(screen.getByText("คนละโน้ต")).toBeInTheDocument();
  });
});

describe("CustomerDetailsModal — ปุ่ม สร้างสิ่งที่ต้องทำ", () => {
  it("เปิดฟอร์มพร้อมลิงก์ลูกค้านี้ และบันทึกสำเร็จ", async () => {
    const fetchMock = mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    fireEvent.click(screen.getByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    expect(within(dialog).getByText("สมชาย ใจดี (บริษัท ก)")).toBeInTheDocument();

    await saveTaskForm();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("สร้างงานสำเร็จ — ผูกกับลูกค้ารายนี้แล้ว", "success")
    );
    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/tasks" && (init as RequestInit)?.method === "POST"
    )!;
    const body = JSON.parse(String((saveCall[1] as RequestInit).body));
    expect(body.links).toEqual([{ targetType: "customer", targetId: "c1", label: "สมชาย ใจดี (บริษัท ก)" }]);
  });

  it("ไม่มีหัวข้องานเลย — toast แล้วไม่เปิดฟอร์ม", async () => {
    mockFetch({ topics: [] });
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    fireEvent.click(screen.getByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("ยังไม่มีหัวข้องาน กรุณาไปสร้างหัวข้อที่หน้ากระดานงานก่อน", "error")
    );
    expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument();
  });
});
