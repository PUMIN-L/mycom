/**
 * "📝 สร้างสิ่งที่ต้องทำ" on EquipmentDetailsModal — spec:
 * add-equipment-quick-task-button.
 *
 * Mirrors the customer-page button (add-customer-quick-task-button) closely
 * enough that most of what is worth pinning down is the same shape: the link
 * seeded correctly, still removable, no form opened with nothing to file the
 * task under. What is specific to THIS button: it reports outcomes with
 * `alert()` (this modal's own established convention, not a toast), and its
 * topic cache is the MODULE-LEVEL one shared with the customer button
 * (`useTaskTopics.ts`) — a load done from either button must be visible to
 * the other, which is exercised directly rather than just asserted.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EquipmentDetailsModal from "@/app/components/modals/EquipmentDetailsModal";
import { __resetTaskTopics, ensureTaskTopicsLoaded } from "@/app/components/useTaskTopics";
import type { CustomerEquipment } from "@/app/lib/types";

const EQUIPMENT: CustomerEquipment = {
  id: "eq-1",
  customerId: "c1",
  productId: "p1",
  productName: "เครื่องชั่ง A",
  serialNumber: "SN-1",
  quotationNumber: "",
  warrantyCertNumber: "",
  warrantyType: "",
  warrantyStartDate: null,
  warrantyEndDate: null,
  status: "Active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TOPICS = [
  {
    id: 1,
    name: "นัดเข้า Service",
    icon: "🔧",
    color: "purple",
    sortOrder: 0,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "อื่นๆ",
    icon: "📌",
    color: "slate",
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
    if (url.startsWith("/api/admin/schedules")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.startsWith("/api/service-jobs")) {
      return { ok: true, status: 200, json: async () => [] };
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

/** Fill topic + title in the create-task dialog and submit. */
async function saveTaskForm() {
  const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
  fireEvent.click(within(dialog).getByText("เลือกหัวข้อของงาน..."));
  fireEvent.click(await screen.findByText("🔧 นัดเข้า Service"));
  fireEvent.change(within(dialog).getByPlaceholderText(/เช่น โทรหาคุณสมชาย/), {
    target: { value: "ไปตรวจเช็คเครื่อง" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "สร้างงาน" }));
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetTaskTopics();
  alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EquipmentDetailsModal — ปุ่ม สร้างสิ่งที่ต้องทำ", () => {
  it("เปิดฟอร์มสร้างงานพร้อมลิงก์เครื่องนี้ และบันทึกสำเร็จ", async () => {
    const fetchMock = mockFetch();
    render(
      <EquipmentDetailsModal equipment={EQUIPMENT} onClose={vi.fn()} onEditEquipment={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    // Pre-seeded — no search on the admin's part.
    expect(within(dialog).getByText("เครื่องชั่ง A (S/N SN-1)")).toBeInTheDocument();

    await saveTaskForm();

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("สร้างงานสำเร็จ — ผูกกับเครื่องนี้แล้ว"));
    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/tasks" && (init as RequestInit)?.method === "POST"
    )!;
    const body = JSON.parse(String((saveCall[1] as RequestInit).body));
    expect(body.links).toEqual([
      { targetType: "equipment", targetId: "eq-1", label: "เครื่องชั่ง A (S/N SN-1)" },
    ]);
    // The equipment details modal itself is still open underneath.
    expect(screen.getByText("รายละเอียดอุปกรณ์")).toBeInTheDocument();
  });

  it("ลบลิงก์เครื่องที่ผูกมาให้ได้ก่อนบันทึก", async () => {
    const fetchMock = mockFetch();
    render(
      <EquipmentDetailsModal equipment={EQUIPMENT} onClose={vi.fn()} onEditEquipment={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /เอาลิงก์ เครื่องชั่ง A \(S\/N SN-1\) ออกจากงานนี้/ })
    );
    expect(within(dialog).queryByText("เครื่องชั่ง A (S/N SN-1)")).not.toBeInTheDocument();

    await saveTaskForm();

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/tasks")).toBe(true)
    );
    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/tasks" && (init as RequestInit)?.method === "POST"
    )!;
    const body = JSON.parse(String((saveCall[1] as RequestInit).body));
    expect(body.links).toEqual([]);
  });

  it("ไม่มีหัวข้องานเลย — alert แล้วไม่เปิดฟอร์ม", async () => {
    mockFetch({ topics: [] });
    render(
      <EquipmentDetailsModal equipment={EQUIPMENT} onClose={vi.fn()} onEditEquipment={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("ยังไม่มีหัวข้องาน กรุณาไปสร้างหัวข้อที่หน้ากระดานงานก่อน")
    );
    expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument();
  });

  it("โหลดหัวข้อไม่สำเร็จ — alert แล้วไม่เปิดฟอร์ม ครั้งถัดไปลองใหม่ได้", async () => {
    mockFetch({ topicsStatus: 500 });
    render(
      <EquipmentDetailsModal equipment={EQUIPMENT} onClose={vi.fn()} onEditEquipment={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("โหลดหัวข้องานไม่สำเร็จ กรุณาลองใหม่")
    );
    expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument();

    const fetchMock2 = mockFetch();
    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    expect(
      fetchMock2.mock.calls.some(([url]) => String(url).startsWith("/api/admin/task-topics"))
    ).toBe(true);
  });

  it("ใช้ topic cache ร่วมกับปุ่มฝั่งลูกค้า — โหลดจากที่หนึ่งแล้ว อีกที่ไม่โหลดซ้ำ", async () => {
    const fetchMock = mockFetch();
    // Simulates the customer button on /customers having already loaded the
    // shared cache earlier in the same session.
    await ensureTaskTopicsLoaded();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/task-topics"))).toHaveLength(1);

    render(
      <EquipmentDetailsModal equipment={EQUIPMENT} onClose={vi.fn()} onEditEquipment={vi.fn()} />
    );
    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    await screen.findByRole("dialog", { name: "สร้างงานใหม่" });

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/task-topics"))
    ).toHaveLength(1);
  });

  it("ปิดฟอร์มโดยไม่บันทึก — modal รายละเอียดอุปกรณ์ยังเปิดอยู่เหมือนเดิม", async () => {
    mockFetch();
    render(
      <EquipmentDetailsModal equipment={EQUIPMENT} onClose={vi.fn()} onEditEquipment={vi.fn()} />
    );

    fireEvent.click(await screen.findByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    fireEvent.click(within(dialog).getByRole("button", { name: "ปิด" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument()
    );
    expect(screen.getByText("รายละเอียดอุปกรณ์")).toBeInTheDocument();
  });
});
