/**
 * /customers lists: what a search that finds nothing says, the location
 * column, the green-row legend, the tab in the URL, sorting, copy-to-clipboard,
 * a company's contacts, row actions, keyboard, tab counts.
 */
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";

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
vi.mock("@/app/customers/EquipmentTab", () => ({ default: () => <div data-testid="equipment-tab" /> }));
vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({ default: () => <div /> }));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));

const HOUR = 3600_000;

const COMPANIES = [
  { id: "co1", name: "บริษัท ก", addressNo: "", moo: "", soi: "", road: "", subDistrict: "", district: "บางนา", province: "กรุงเทพมหานคร", postalCode: "", phone: "021111111", note: "" },
  { id: "co2", name: "บริษัท ข", addressNo: "", moo: "", soi: "", road: "", subDistrict: "", district: "", province: "", postalCode: "", phone: "", note: "" },
  { id: "co3", name: "บริษัท ค", addressNo: "", moo: "", soi: "", road: "", subDistrict: "", district: "เมือง", province: "ชลบุรี", postalCode: "", phone: "", note: "" },
];

function customersFixture({ recent = true } = {}) {
  return [
    {
      id: "c1", companyId: "co1", companyName: "บริษัท ก", name: "คุณสมชาย", department: "แล็บ",
      phone: "0812345678", email: "somchai@example.com", note: "โทรกลับ",
      createdAt: "2025-01-01T00:00:00.000Z",
      noteUpdatedAt: recent ? new Date(Date.now() - HOUR).toISOString() : "2026-01-02T00:00:00.000Z",
    },
    {
      id: "c2", companyId: "co1", companyName: "บริษัท ก", name: "คุณสมหญิง", department: "",
      phone: "0899999999", email: "", note: "นัดแล้ว",
      createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      // Points at a company that is no longer in the list: no name to show.
      id: "c3", companyId: "co-gone", companyName: "", name: "คุณกมล", department: "",
      phone: "", email: "", note: "", createdAt: "2025-02-01T00:00:00.000Z", noteUpdatedAt: null,
    },
  ];
}

const SALESPEOPLE = [{ id: "s1", name: "คุณวิชัย", phone: "0861111111", email: "wichai@example.com", note: "" }];

function mockFetch({
  customers = customersFixture(),
  companies = COMPANIES as unknown[],
  salespeople = SALESPEOPLE as unknown[],
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url === "/api/customers" ? customers : url === "/api/companies" ? companies : url === "/api/salespeople" ? salespeople : [];
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function visit(search: string) {
  mockSearch = search;
  window.history.replaceState({}, "", `/customers${search ? `?${search}` : ""}`);
}

function stubClipboard(writeText = vi.fn(async () => {})) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const customerTable = () => screen.getByText("อัปเดตล่าสุด").closest("table")!;
const companyTable = () => screen.getByText("ชื่อบริษัท").closest("table")!;
/** First-column text of each body row, top to bottom. */
const firstCells = (table: HTMLElement) =>
  within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td p.font-semibold")?.textContent ?? "");
const header = (name: RegExp) => screen.getByRole("button", { name });

async function loaded() {
  await screen.findByText("คุณสมชาย");
}

async function openCompaniesTab() {
  await loaded();
  fireEvent.click(tab(/^บริษัท/));
  await screen.findByText("ชื่อบริษัท");
}

beforeEach(() => {
  visit("");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("/customers — a search that finds nothing", () => {
  it("says nothing matched, and the button clears the search", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    const box = screen.getByPlaceholderText("ค้นหาชื่อลูกค้า บริษัท เบอร์โทร หรืออีเมล...") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "ไม่มีใครชื่อนี้" } });

    expect(screen.getByText("ไม่พบลูกค้าที่ตรงกับคำค้น")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีข้อมูลลูกค้า")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ล้างคำค้น" }));
    expect(box.value).toBe("");
    expect(firstCells(customerTable())).toHaveLength(3);
  });

  it("says there are no customers yet when there are none, with nothing to clear", async () => {
    mockFetch({ customers: [] });
    render(<Customers />);
    expect(await screen.findByText("ยังไม่มีข้อมูลลูกค้า")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ล้างคำค้น" })).not.toBeInTheDocument();
  });

  it("companies: nothing matched, and clearing empties all three boxes", async () => {
    mockFetch();
    render(<Customers />);
    await openCompaniesTab();
    const name = screen.getByPlaceholderText("ค้นหาชื่อบริษัท...") as HTMLInputElement;
    const province = screen.getByPlaceholderText("ค้นหาจังหวัด...") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "บริษัท" } });
    fireEvent.change(province, { target: { value: "เชียงใหม่" } });
    expect(screen.getByText("ไม่พบบริษัทที่ตรงกับคำค้น")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ล้างคำค้น" }));
    expect(name.value).toBe("");
    expect(province.value).toBe("");
    expect(firstCells(companyTable())).toHaveLength(3);
  });

  it("salespeople: nothing matched, then cleared", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.change(screen.getByPlaceholderText("ค้นหาชื่อพนักงานขาย..."), { target: { value: "zzz" } });
    expect(screen.getByText("ไม่พบพนักงานขายที่ตรงกับคำค้น")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ล้างคำค้น" }));
    expect(screen.getByText("คุณวิชัย")).toBeInTheDocument();
  });
});

describe("/customers — the customers list", () => {
  it("finds a customer by phone, however it is typed, and by e-mail", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    const box = screen.getByPlaceholderText("ค้นหาชื่อลูกค้า บริษัท เบอร์โทร หรืออีเมล...");
    fireEvent.change(box, { target: { value: "081-234" } });
    expect(firstCells(customerTable())).toEqual(["คุณสมชาย"]);
    fireEvent.change(box, { target: { value: "SOMCHAI@" } });
    expect(firstCells(customerTable())).toEqual(["คุณสมชาย"]);
  });

  it("shows '-' for a customer with no company, and no initial-letter avatar", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    const row = screen.getByRole("row", { name: "ดูข้อมูล คุณกมล" });
    const cells = within(row).getAllByRole("cell");
    // The whole first cell is the name — no "ค" circle in front of it.
    expect(cells[0].textContent).toBe("คุณกมล");
    expect(cells[1].textContent).toBe("-");
  });

  it("sorts by name, by company and by date from the headers", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    // Default: the note order, its header marked.
    expect(firstCells(customerTable())).toEqual(["คุณสมชาย", "คุณสมหญิง", "คุณกมล"]);
    expect(header(/อัปเดตล่าสุด/).closest("th")).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(header(/ชื่อลูกค้า/));
    expect(firstCells(customerTable())).toEqual(["คุณกมล", "คุณสมชาย", "คุณสมหญิง"]);
    expect(header(/ชื่อลูกค้า/).closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(header(/อัปเดตล่าสุด/).closest("th")).toHaveAttribute("aria-sort", "none");
    fireEvent.click(header(/ชื่อลูกค้า/));
    expect(firstCells(customerTable())).toEqual(["คุณสมหญิง", "คุณสมชาย", "คุณกมล"]);

    // Company: the customer without one goes last.
    fireEvent.click(within(customerTable()).getByRole("button", { name: /^บริษัท/ }));
    expect(firstCells(customerTable())[2]).toBe("คุณกมล");

    // Back to the date, which starts newest-first; again flips to oldest-first.
    fireEvent.click(header(/อัปเดตล่าสุด/));
    expect(firstCells(customerTable())).toEqual(["คุณสมชาย", "คุณสมหญิง", "คุณกมล"]);
    fireEvent.click(header(/อัปเดตล่าสุด/));
    expect(firstCells(customerTable())).toEqual(["คุณสมหญิง", "คุณสมชาย", "คุณกมล"]);
  });

  it("explains the green rows when there is one", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    expect(screen.getByTestId("recent-note-legend").textContent).toContain("แถวสีเขียว");
    expect(screen.getByRole("row", { name: "ดูข้อมูล คุณสมชาย" }).className).toContain("bg-green-100");
  });

  it("says nothing about green rows when there are none", async () => {
    mockFetch({ customers: customersFixture({ recent: false }) });
    render(<Customers />);
    await loaded();
    expect(screen.queryByTestId("recent-note-legend")).not.toBeInTheDocument();
  });
});

describe("/customers — copy a phone or e-mail", () => {
  it("copies on click, says so, and does not open the customer", async () => {
    const writeText = stubClipboard();
    mockFetch();
    render(<Customers />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก 0812345678" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("0812345678"));
    expect(await screen.findByText(/คัดลอกแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "คุณสมชาย" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "คัดลอก somchai@example.com" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("somchai@example.com"));
  });

  it("says when the copy failed", async () => {
    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    mockFetch();
    render(<Customers />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก 0812345678" }));
    expect(await screen.findByText(/คัดลอกไม่สำเร็จ/)).toBeInTheDocument();
  });

  it("a second toast is not cut short by the first one's timer", async () => {
    stubClipboard();
    mockFetch();
    render(<Customers />);
    await loaded();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "คัดลอก 0812345678" }));
    });
    expect(screen.getByText(/คัดลอกแล้ว/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "คัดลอก somchai@example.com" }));
    });
    // 3.5 s after the first copy, 1.5 s after the second: still showing.
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(/คัดลอกแล้ว/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(screen.queryByText(/คัดลอกแล้ว/)).not.toBeInTheDocument();
  });
});

describe("/customers — rows", () => {
  it("open with a click, Enter or Space; a key on a button inside is that button's", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    const row = screen.getByRole("row", { name: "ดูข้อมูล คุณสมหญิง" });
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(within(row).getByRole("button", { name: "แก้ไข คุณสมหญิง" }), { key: "Enter" });
    fireEvent.keyDown(row, { key: "a" });
    fireEvent.keyDown(within(row).getAllByRole("cell")[0], { key: "Enter" });
    expect(screen.queryByRole("heading", { name: "คุณสมหญิง" })).not.toBeInTheDocument();

    fireEvent.keyDown(row, { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "คุณสมหญิง" })).toBeInTheDocument();
  });

  it("Space opens too", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    fireEvent.keyDown(screen.getByRole("row", { name: "ดูข้อมูล คุณกมล" }), { key: " " });
    expect(await screen.findByRole("heading", { name: "คุณกมล" })).toBeInTheDocument();
  });

  it("Esc on a row button still reaches window-level listeners", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      fireEvent.keyDown(screen.getByRole("button", { name: "ลบ คุณสมชาย" }), { key: "Escape" });
      fireEvent.keyDown(screen.getByRole("button", { name: "แก้ไข คุณสมชาย" }), { key: "Escape" });
      expect(onWindowKey).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("edit and delete are icons that do not open the row; delete shows on hover", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    expect(screen.queryByRole("button", { name: "ดูข้อมูล" })).not.toBeInTheDocument();

    const del = screen.getByRole("button", { name: "ลบ คุณสมชาย" });
    expect(del.className).toContain("opacity-0");
    expect(del.className).toContain("group-hover:opacity-100");
    expect(del.className).toContain("focus-visible:opacity-100");

    fireEvent.click(screen.getByRole("button", { name: "แก้ไข คุณสมชาย" }));
    expect(screen.getByRole("heading", { name: "แก้ไขข้อมูลลูกค้า" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "คุณสมชาย" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    fireEvent.click(del);
    expect(screen.getByText("ยืนยันการลบลูกค้า")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "คุณสมชาย" })).not.toBeInTheDocument();
  });

  it("salespeople open from the keyboard too, with copyable details and no letter avatar", async () => {
    stubClipboard();
    mockFetch();
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.keyDown(screen.getByRole("row", { name: "ดูข้อมูล คุณวิชัย" }), { key: "Enter" });
    const heading = await screen.findByRole("heading", { name: "คุณวิชัย" });
    const modal = heading.closest(".relative") as HTMLElement;
    expect(within(modal).getAllByRole("button", { name: "คัดลอก 0861111111" })).toHaveLength(1);
    expect(within(modal).getByRole("button", { name: "คัดลอก wichai@example.com" })).toBeInTheDocument();
    expect(within(modal).queryByText("ค")).not.toBeInTheDocument();
  });
});

describe("/customers — companies", () => {
  it("shows the district and province, '-' when unknown", async () => {
    mockFetch();
    render(<Customers />);
    await openCompaniesTab();
    const location = (name: string) => within(screen.getByRole("row", { name: `ดูข้อมูล ${name}` })).getAllByRole("cell")[1].textContent;
    expect(location("บริษัท ก")).toBe("บางนา, กรุงเทพมหานคร");
    expect(location("บริษัท ข")).toBe("-");
    expect(location("บริษัท ค")).toBe("เมือง, ชลบุรี");
  });

  it("sorts by name and by location from the headers", async () => {
    mockFetch({ companies: [COMPANIES[2], COMPANIES[0], COMPANIES[1]] });
    render(<Customers />);
    await openCompaniesTab();
    // The API's order (newest first) until a header is clicked.
    expect(firstCells(companyTable())).toEqual(["บริษัท ค", "บริษัท ก", "บริษัท ข"]);

    fireEvent.click(header(/ชื่อบริษัท/));
    expect(firstCells(companyTable())).toEqual(["บริษัท ก", "บริษัท ข", "บริษัท ค"]);
    fireEvent.click(header(/ชื่อบริษัท/));
    expect(firstCells(companyTable())).toEqual(["บริษัท ค", "บริษัท ข", "บริษัท ก"]);

    fireEvent.click(header(/อำเภอ \/ จังหวัด/));
    // กรุงเทพมหานคร, ชลบุรี, then the one with no location.
    expect(firstCells(companyTable())).toEqual(["บริษัท ก", "บริษัท ค", "บริษัท ข"]);
  });

  it("a search that still leaves two pages starts from page 1", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...COMPANIES[1],
      id: `k${i}`,
      name: `${i % 2 ? "ร้าน" : "บริษัท"} ${String(i + 1).padStart(3, "0")}`,
    }));
    mockFetch({ companies: many });
    render(<Customers />);
    await openCompaniesTab();
    fireEvent.click(within(screen.getByTestId("company-pagination")).getByRole("button", { name: "หน้าสุดท้าย" }));
    // 75 shops: two pages, and we must be on the first.
    fireEvent.change(screen.getByPlaceholderText("ค้นหาชื่อบริษัท..."), { target: { value: "ร้าน" } });
    expect(firstCells(companyTable())[0]).toBe("ร้าน 002");
    expect(screen.getByTestId("company-pagination").textContent).toContain("แสดง 1 ถึง 50 จาก 75 รายการ");
  });

  it("pages 50 at a time; a search or a sort starts again from page 1", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...COMPANIES[1],
      id: `k${i}`,
      name: `ร้าน ${String(i + 1).padStart(2, "0")}`,
    }));
    mockFetch({ companies: many });
    render(<Customers />);
    await openCompaniesTab();
    expect(firstCells(companyTable())).toHaveLength(50);
    const pager = () => screen.getByTestId("company-pagination");
    fireEvent.click(within(pager()).getByRole("button", { name: "หน้าสุดท้าย" }));
    expect(firstCells(companyTable())).toHaveLength(10);
    expect(pager().textContent).toContain("แสดง 51 ถึง 60 จาก 60 รายการ");

    fireEvent.click(header(/ชื่อบริษัท/));
    expect(firstCells(companyTable())[0]).toBe("ร้าน 01");

    fireEvent.click(within(pager()).getByRole("button", { name: "ถัดไป" }));
    fireEvent.change(screen.getByPlaceholderText("ค้นหาชื่อบริษัท..."), { target: { value: "ร้าน 5" } });
    expect(firstCells(companyTable())).toEqual(["ร้าน 50", "ร้าน 51", "ร้าน 52", "ร้าน 53", "ร้าน 54", "ร้าน 55", "ร้าน 56", "ร้าน 57", "ร้าน 58", "ร้าน 59"]);
    expect(screen.queryByTestId("company-pagination")).not.toBeInTheDocument();
  });

  it("the company window lists its customers, A→Z, each opening its own window", async () => {
    mockFetch({ customers: customersFixture().reverse() });
    render(<Customers />);
    await openCompaniesTab();
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล บริษัท ก" }));
    const contacts = await screen.findByTestId("company-contacts");
    expect(contacts.textContent).toContain("ลูกค้าในบริษัทนี้ (2)");
    const buttons = within(contacts).getAllByRole("button").filter((b) => !b.textContent?.startsWith("+"));
    expect(buttons.map((b) => b.textContent)).toEqual(["คุณสมชายแล็บ0812345678", "คุณสมหญิง0899999999"]);
    // No made-up status box.
    expect(screen.queryByText(/Active/)).not.toBeInTheDocument();

    fireEvent.click(buttons[1]);
    expect(await screen.findByRole("heading", { name: "คุณสมหญิง" })).toBeInTheDocument();
    expect(screen.queryByTestId("company-contacts")).not.toBeInTheDocument();
  });

  it("adds a customer to the company from its window, the company already picked", async () => {
    mockFetch();
    render(<Customers />);
    await openCompaniesTab();
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล บริษัท ค" }));
    const contacts = await screen.findByTestId("company-contacts");
    expect(contacts.textContent).toContain("ยังไม่มีลูกค้าในบริษัทนี้");
    fireEvent.click(within(contacts).getByRole("button", { name: "+ เพิ่มลูกค้าในบริษัทนี้" }));

    expect(screen.getByRole("heading", { name: "เพิ่มลูกค้าใหม่" })).toBeInTheDocument();
    const form = document.getElementById("customer-form")!;
    expect(within(form).getByText("บริษัท ค")).toBeInTheDocument();
    expect(screen.queryByTestId("company-contacts")).not.toBeInTheDocument();
  });

  it("company rows open from the keyboard", async () => {
    mockFetch();
    render(<Customers />);
    await openCompaniesTab();
    fireEvent.keyDown(screen.getByRole("row", { name: "ดูข้อมูล บริษัท ข" }), { key: "Enter" });
    expect(await screen.findByTestId("company-contacts")).toBeInTheDocument();
  });
});

describe("/customers — tabs", () => {
  it("count what each holds once loaded; equipment has no count", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 3");
    expect(tab(/^บริษัท/).textContent).toBe("บริษัท 3");
    expect(tab(/^พนักงานขาย/).textContent).toBe("พนักงานขาย 1");
    expect(tab(/^อุปกรณ์ที่ขาย/).textContent).toBe("อุปกรณ์ที่ขาย");
    // Read out with a space between the name and the count.
    expect(screen.getByRole("tab", { name: "ลูกค้า 3" })).toBeInTheDocument();
    expect(tab(/^ลูกค้า/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^บริษัท/)).toHaveAttribute("aria-selected", "false");
  });

  it("show no count while loading — not a misleading 0", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      await gate;
      const url = String(input);
      return { ok: true, status: 200, json: async () => (url === "/api/customers" ? customersFixture() : []) };
    }));
    render(<Customers />);
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า");
    await act(async () => { release(); });
    await loaded();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 3");
  });

  it("keep their counts while a save reloads the lists", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    // From here on the lists never come back: the page sits in its reload.
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (init?.method === "PUT") return { ok: true, status: 200, json: async () => ({}) };
      return new Promise(() => {});
    }));
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข คุณสมชาย" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูล" }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(screen.queryByText("คุณสมชาย")).not.toBeInTheDocument(); // the skeleton
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 3");
  });

  it("thousands are separated", async () => {
    const many = Array.from({ length: 1234 }, (_, i) => ({ ...customersFixture()[2], id: `x${i}`, name: `ลูกค้า ${i}` }));
    mockFetch({ customers: [...customersFixture(), ...many] });
    render(<Customers />);
    await loaded();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 1,237");
  });

  it("write the open tab into the URL, so a refresh opens it again", async () => {
    visit("utm=keep");
    mockFetch();
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    expect(window.location.search).toBe("?utm=keep&tab=companies");
    fireEvent.click(tab(/^อุปกรณ์ที่ขาย/));
    expect(window.location.search).toBe("?utm=keep&tab=equipment");
    expect(screen.getByTestId("equipment-tab")).toBeInTheDocument();
    fireEvent.click(tab(/^ลูกค้า/));
    expect(window.location.search).toBe("?utm=keep");
  });

  it("move with the arrow keys, Home and End, as one Tab stop", async () => {
    mockFetch();
    render(<Customers />);
    await loaded();
    expect(tab(/^ลูกค้า/)).toHaveAttribute("tabindex", "0");
    expect(tab(/^บริษัท/)).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab(/^ลูกค้า/).id);

    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab(/^บริษัท/)).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab(/^บริษัท/));
    expect(tab(/^บริษัท/)).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab(/^บริษัท/).id);
    expect(window.location.search).toBe("?tab=companies");

    fireEvent.keyDown(list, { key: "End" });
    expect(tab(/^อุปกรณ์ที่ขาย/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab(/^ลูกค้า/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tab(/^อุปกรณ์ที่ขาย/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(tab(/^ลูกค้า/)).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab(/^ลูกค้า/));

    // Other keys are left alone.
    fireEvent.keyDown(list, { key: "a" });
    expect(tab(/^ลูกค้า/)).toHaveAttribute("aria-selected", "true");
  });

  it("open the tab the URL names", async () => {
    visit("tab=salespeople");
    mockFetch();
    render(<Customers />);
    expect(await screen.findByText("คุณวิชัย")).toBeInTheDocument();
    expect(tab(/^พนักงานขาย/)).toHaveAttribute("aria-selected", "true");
  });

  it("drop a used deep link when the tab changes, so a refresh does not reopen it", async () => {
    visit("customerId=c1");
    mockFetch();
    render(<Customers />);
    expect(await screen.findByRole("heading", { name: "คุณสมชาย" })).toBeInTheDocument();
    // The page already strips it once the customer is opened…
    await waitFor(() => expect(window.location.search).toBe(""));
    // …and a tab change never writes it back.
    window.history.replaceState({}, "", "/customers?customerId=c1");
    fireEvent.click(tab(/^บริษัท/));
    expect(window.location.search).toBe("?tab=companies");
  });
});
