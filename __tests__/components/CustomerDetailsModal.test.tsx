/**
 * CustomerDetailsModal — extracted from `/customers`' inline "Viewing
 * Customer Modal" (spec: open-customer-profile-in-place) so `/crm/alerts`
 * can open the identical view without navigating away. Tested directly here
 * (mirroring `EquipmentDetailsModal.test.tsx`) so both hosts can rely on the
 * component being correct on its own, independent of either page's wiring.
 */
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";
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
    expect(screen.getByText("02-000-0000")).toBeInTheDocument();
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

  it("เกิน 2,000 ตัวอักษร — บอกตั้งแต่ตอนพิมพ์ ปุ่มบันทึกกดไม่ได้ และ Ctrl+Enter ก็ไม่ส่ง", async () => {
    const fetchMock = mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);

    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    const box = screen.getByDisplayValue(CUSTOMER.note);
    fireEvent.change(box, { target: { value: "ก".repeat(2000) } });
    expect(screen.getByTestId("note-counter")).toHaveTextContent("2,000 / 2,000");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeEnabled();

    fireEvent.change(box, { target: { value: "ก".repeat(2003) } });
    expect(screen.getByTestId("note-counter")).toHaveTextContent("2,003 / 2,000");
    expect(screen.getByRole("alert")).toHaveTextContent("เกิน 3 ตัวอักษร ตัดให้สั้นลงก่อนบันทึก");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();

    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(showToast).toHaveBeenCalledWith("บันทึกลูกค้าต้องไม่เกิน 2,000 ตัวอักษร", "error");
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

describe("CustomerDetailsModal — แก้บันทึกค้างไว้ ไม่หายเพราะคลิกพลาด", () => {
  const backdrop = () => screen.getByRole("heading", { name: "สมชาย ใจดี" }).closest(".fixed") as HTMLElement;
  function startEditing(onClose = vi.fn()) {
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    fireEvent.change(screen.getByDisplayValue(CUSTOMER.note), { target: { value: "แก้ไปครึ่งทาง" } });
    return onClose;
  }

  it("คลิกพื้นหลังหรือ ✕ ระหว่างแก้ — ถามก่อน; กลับไปแก้ต่อ แล้วข้อความยังอยู่", () => {
    mockFetch();
    const onClose = startEditing();
    fireEvent.click(backdrop());
    expect(screen.getByText("บันทึกลูกค้าที่แก้ไว้จะหายไป ปิดหน้าต่างนี้เลยไหม?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "กลับไปแก้ต่อ" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("แก้ไปครึ่งทาง")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("กด ยกเลิก ระหว่างแก้ — ถามก่อน; ทิ้งที่แก้ไว้ แล้วกลับไปเห็นบันทึกเดิม", () => {
    mockFetch();
    const onClose = startEditing();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByText("บันทึกลูกค้าที่แก้ไว้จะหายไป ยกเลิกการแก้ไขเลยไหม?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งที่แก้ไว้" }));
    expect(screen.queryByDisplayValue("แก้ไปครึ่งทาง")).not.toBeInTheDocument();
    expect(screen.getByText(CUSTOMER.note)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ยังไม่ได้แก้อะไร (หรือแก้แล้วคืนค่าเดิม) — ปิดและยกเลิกได้ทันที ไม่ถาม", () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
    const box = screen.getByDisplayValue(CUSTOMER.note);
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.change(box, { target: { value: CUSTOMER.note } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByText(/ยังไม่ได้บันทึก/)).not.toBeInTheDocument();
    expect(screen.getByText(CUSTOMER.note)).toBeInTheDocument();
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("รีเฟรชหน้าระหว่างแก้ — เบราว์เซอร์เตือนก่อน", () => {
    mockFetch();
    startEditing();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("บันทึกไม่สำเร็จ — บอกเหตุผลจากระบบ ไม่ใช่ข้อความกลาง ๆ", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? { ok: false, status: 404, json: async () => ({ error: "ไม่พบลูกค้า" }) }
        : { ok: true, status: 200, json: async () => [] }
    ));
    startEditing();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("ไม่พบลูกค้า", "error"));
    expect(screen.getByDisplayValue("แก้ไปครึ่งทาง")).toBeInTheDocument();
  });

  it("เน็ตหลุดตอนบันทึก — บอกให้ตรวจสอบการเชื่อมต่อ", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, json: async () => [] };
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    startEditing();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่", "error")
    );
  });

  it("ดับเบิลคลิก บันทึก — ส่งครั้งเดียว และปิดหน้าต่างไม่ได้ระหว่างบันทึก", async () => {
    let release: () => void = () => {};
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ noteUpdatedAt: null }) }); })
        : Promise.resolve({ ok: true, status: 200, json: async () => [] })
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = startEditing();
    const save = screen.getByRole("button", { name: "บันทึก" });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT")).toHaveLength(1);
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/ยังไม่ได้บันทึก/)).not.toBeInTheDocument();
    await act(async () => release());
    expect(showToast).toHaveBeenCalledWith("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
  });
});

describe("CustomerDetailsModal — เป็นหน้าต่างจริง: Esc, โฟกัส, ปุ่มแก้ไข, คัดลอก", () => {
  function stubClipboard(writeText = vi.fn(async () => {})) {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    return writeText;
  }
  const esc = () => fireEvent.keyDown(document, { key: "Escape" });
  const startEdit = () => fireEvent.click(screen.getByRole("button", { name: "✏️ แก้ไข" }));
  const noteBox = () => screen.getByRole("textbox", { name: "บันทึกลูกค้า" }) as HTMLTextAreaElement;

  it("เป็น dialog ชื่อเดียวกับลูกค้า โฟกัสเข้ามาตอนเปิด และกลับไปที่เดิมตอนปิด", () => {
    mockFetch();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />
    );
    const dialog = screen.getByRole("dialog", { name: "สมชาย ใจดี" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("ไม่มีวงกลมตัวอักษรแรกของชื่อ และข้อมูลติดต่ออยู่ในตารางเดียว", () => {
    mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);
    expect(screen.queryByText("ส")).not.toBeInTheDocument();
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(["แผนก", "เบอร์โทร", "อีเมล"]);
  });

  it("Esc ปิดหน้าต่าง; ระหว่างแก้บันทึก Esc ออกจากโหมดแก้ก่อน", () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    startEdit();
    esc();
    // Nothing typed: straight back to reading, the window still open.
    expect(screen.queryByRole("textbox", { name: "บันทึกลูกค้า" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc ระหว่างแก้ค้างไว้ — ถามก่อน; Esc อีกครั้งปิดคำถาม ข้อความยังอยู่", () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    startEdit();
    fireEvent.change(noteBox(), { target: { value: "แก้ค้าง" } });
    esc();
    expect(screen.getByText("บันทึกลูกค้าที่แก้ไว้จะหายไป ยกเลิกการแก้ไขเลยไหม?")).toBeInTheDocument();
    esc();
    expect(screen.queryByText(/ยังไม่ได้บันทึก/)).not.toBeInTheDocument();
    expect(noteBox().value).toBe("แก้ค้าง");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc ในฟอร์มสร้างงานที่เปิดซ้อน ปิดแค่ฟอร์มนั้น ไม่ปิดหน้าต่างลูกค้า", async () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    esc();
    expect(screen.queryByRole("dialog", { name: "สร้างงานใหม่" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "สมชาย ใจดี" })).toBeInTheDocument();
  });

  it("Esc ตอนกล่อง สร้างงานสำเร็จ ขึ้นอยู่ ปิดแค่กล่องนั้น", async () => {
    mockFetch();
    const onClose = vi.fn();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    await saveTaskForm();
    expect(await screen.findByRole("alertdialog", { name: "สร้างงานสำเร็จ" })).toBeInTheDocument();
    esc();
    expect(screen.queryByText("สร้างงานสำเร็จ")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("เบอร์และอีเมลกดคัดลอกได้ บอกผลผ่าน toast ของหน้า", async () => {
    const writeText = stubClipboard();
    mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก 02-000-0000" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("02-000-0000"));
    expect(showToast).toHaveBeenCalledWith("คัดลอกแล้ว", "success");
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก somchai@example.com" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("somchai@example.com"));

    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก 02-000-0000" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("คัดลอกไม่สำเร็จ", "error"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("ปุ่ม แก้ไขข้อมูล มีเมื่อหน้าที่เปิดส่ง onEdit มา — และถามก่อนถ้าแก้บันทึกค้างอยู่", () => {
    mockFetch();
    const onEdit = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} />
    );
    expect(screen.queryByRole("button", { name: "แก้ไขข้อมูล" })).not.toBeInTheDocument();

    rerender(<CustomerDetailsModal customer={CUSTOMER} onClose={onClose} onSaved={vi.fn()} showToast={showToast} onEdit={onEdit} />);
    startEdit();
    fireEvent.change(noteBox(), { target: { value: "แก้ค้าง" } });
    fireEvent.click(screen.getByRole("button", { name: "แก้ไขข้อมูล" }));
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ชื่อบริษัทกดไปดูบริษัทได้ เมื่อหน้าที่เปิดส่ง onOpenCompany มา", () => {
    mockFetch();
    const onOpenCompany = vi.fn();
    const { rerender } = render(
      <CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />
    );
    expect(screen.queryByRole("button", { name: "บริษัท ก" })).not.toBeInTheDocument();
    expect(screen.getByText("บริษัท ก")).toBeInTheDocument();

    rerender(
      <CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} onOpenCompany={onOpenCompany} />
    );
    fireEvent.click(screen.getByRole("button", { name: "บริษัท ก" }));
    expect(onOpenCompany).toHaveBeenCalledTimes(1);
  });

  it("เริ่มแก้บันทึก — เคอร์เซอร์อยู่ท้ายข้อความ ที่ที่จะพิมพ์รายการใหม่", () => {
    mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);
    startEdit();
    expect(noteBox().selectionStart).toBe(CUSTOMER.note.length);
    expect(noteBox().selectionEnd).toBe(CUSTOMER.note.length);
    expect(screen.getByTestId("note-counter")).toHaveTextContent(`${CUSTOMER.note.length} / 2,000`);
  });

  it("Ctrl+Enter และ ⌘+Enter บันทึก; Enter เฉย ๆ คือขึ้นบรรทัดใหม่", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    const puts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    const { rerender } = render(
      <CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={onSaved} showToast={showToast} />
    );
    startEdit();
    fireEvent.change(noteBox(), { target: { value: "ใหม่ 1" } });
    fireEvent.keyDown(noteBox(), { key: "Enter" });
    expect(puts()).toHaveLength(0);
    fireEvent.keyDown(noteBox(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(puts()).toHaveLength(1);

    rerender(<CustomerDetailsModal customer={{ ...CUSTOMER, note: "ใหม่ 1" }} onClose={vi.fn()} onSaved={onSaved} showToast={showToast} />);
    startEdit();
    fireEvent.change(noteBox(), { target: { value: "ใหม่ 2" } });
    fireEvent.keyDown(noteBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
  });

  it("ตัวนับเปลี่ยนสีเมื่อใกล้เต็ม", () => {
    mockFetch();
    render(<CustomerDetailsModal customer={CUSTOMER} onClose={vi.fn()} onSaved={vi.fn()} showToast={showToast} />);
    startEdit();
    expect(screen.getByTestId("note-counter").className).toContain("text-orange-400");
    fireEvent.change(noteBox(), { target: { value: "ก".repeat(1800) } });
    expect(screen.getByTestId("note-counter").className).toContain("text-amber-600");
    fireEvent.change(noteBox(), { target: { value: "ก".repeat(2001) } });
    expect(screen.getByTestId("note-counter").className).toContain("text-red-600");
  });
});

describe("CustomerDetailsModal — ปุ่ม สร้างสิ่งที่ต้องทำ", () => {
  it("เปิดฟอร์มพร้อมลิงก์ลูกค้านี้ และบันทึกสำเร็จ", async () => {
    const fetchMock = mockFetch();
    const onTaskCreated = vi.fn();
    render(
      <CustomerDetailsModal
        customer={CUSTOMER}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        showToast={showToast}
        onTaskCreated={onTaskCreated}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /สร้างสิ่งที่ต้องทำ/ }));
    const dialog = await screen.findByRole("dialog", { name: "สร้างงานใหม่" });
    expect(within(dialog).getByText("สมชาย ใจดี (บริษัท ก)")).toBeInTheDocument();

    await saveTaskForm();

    // A styled dialog now, not just a toast — and `onTaskCreated` fires so a
    // host page's task board can reveal it without a manual refresh (bug the
    // user reported: creating from this button needed a manual page refresh
    // before the new task appeared on the board).
    expect(await screen.findByText("สร้างงานสำเร็จ")).toBeInTheDocument();
    expect(screen.getByText("ผูกกับลูกค้ารายนี้แล้ว")).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
    expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "t9" }));

    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/tasks" && (init as RequestInit)?.method === "POST"
    )!;
    const body = JSON.parse(String((saveCall[1] as RequestInit).body));
    expect(body.links).toEqual([{ targetType: "customer", targetId: "c1", label: "สมชาย ใจดี (บริษัท ก)" }]);

    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.queryByText("สร้างงานสำเร็จ")).not.toBeInTheDocument();
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
