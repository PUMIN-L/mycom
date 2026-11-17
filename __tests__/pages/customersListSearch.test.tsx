/**
 * /customers — the lists: one search box per tab, the note search folded
 * away, a company's customer count, phones as people read them, no skeleton
 * flash on a reload, the pager taking you back to the top, and windows that
 * sit above the admin bell.
 */
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";
import { downloadExcel } from "@/app/lib/xlsxExport";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));
vi.mock("@/app/customers/EquipmentTab", () => ({ default: () => <div /> }));
vi.mock("@/app/components/modals/CustomerCallScheduleSection", () => ({ default: () => <div /> }));
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));

const C = { addressNo: "", moo: "", soi: "", road: "", subDistrict: "", district: "", province: "", postalCode: "", phone: "", note: "" };
const companiesFixture = () => [
  { ...C, id: "co1", name: "บริษัท ไทยแล็บ จำกัด", district: "ศรีราชา", province: "ชลบุรี", phone: "038123456" },
  { ...C, id: "co2", name: "บริษัท สยามเทส จำกัด", district: "บางนา", province: "กรุงเทพมหานคร", phone: "021234567" },
  { ...C, id: "co3", name: "ร้าน ช่างเอก", province: "ระยอง" },
];
const person = (id: string, over: Record<string, unknown>) => ({
  id, companyId: "co1", companyName: "บริษัท ไทยแล็บ จำกัด", name: id, department: "", phone: "", email: "", note: "",
  createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: null, ...over,
});
const customersFixture = () => [
  person("c1", { name: "คุณสมชาย ใจดี", department: "QC", phone: "0812345678", email: "somchai@example.com", note: "โทรแล้ว", noteUpdatedAt: "2026-01-02T00:00:00.000Z" }),
  person("c2", { name: "คุณสมหญิง รักงาน", department: "จัดซื้อ", companyId: "co2", companyName: "บริษัท สยามเทส จำกัด", phone: "02-987-6543 ต่อ 12" }),
  person("c3", { name: "คุณประเสริฐ", department: "QC", companyId: "co1" }),
];
const salespeopleFixture = () => [
  { id: "sp1", name: "คุณวิชัย", phone: "0861111111", email: "wichai@example.com", note: "" },
  { id: "sp2", name: "คุณวรรณา", phone: "", email: "", note: "" },
];

let lists: Record<string, unknown[]>;
let override: ((url: string, init?: RequestInit) => unknown) | null = null;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = override?.(url, init);
    if (custom !== undefined) return custom;
    if (!init?.method) {
      const key = url.replace("/api/", "");
      if (key in lists) return json(lists[key]);
      return json([]);
    }
    return json({ success: true });
  }));
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const rowNames = () =>
  screen.queryAllByRole("row", { name: /^ดูข้อมูล / }).map((r) => r.getAttribute("aria-label")!.replace("ดูข้อมูล ", ""));
async function loaded() {
  await screen.findByText("คุณสมชาย ใจดี");
}

beforeEach(() => {
  lists = { customers: customersFixture(), companies: companiesFixture(), salespeople: salespeopleFixture() };
  override = null;
  installFetch();
  window.history.replaceState({}, "", "/customers");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("/customers — one search box for the customers", () => {
  it("finds by department, and by words from different columns; says how many of how many", async () => {
    render(<Customers />);
    await loaded();
    expect(screen.getByTestId("customer-count").textContent).toBe(" (3)");
    const box = screen.getByRole("textbox", { name: "ค้นหาลูกค้า" });

    fireEvent.change(box, { target: { value: "qc" } });
    expect(rowNames()).toEqual(expect.arrayContaining(["คุณสมชาย ใจดี", "คุณประเสริฐ"]));
    expect(rowNames()).toHaveLength(2);
    expect(screen.getByTestId("customer-count").textContent).toBe(" (พบ 2 จาก 3)");

    fireEvent.change(box, { target: { value: "สมชาย QC" } });
    expect(rowNames()).toEqual(["คุณสมชาย ใจดี"]);

    fireEvent.change(box, { target: { value: "สยามเทส จัดซื้อ" } });
    expect(rowNames()).toEqual(["คุณสมหญิง รักงาน"]);

    // A phone typed with an extension is still found by its number.
    fireEvent.change(box, { target: { value: "029876543" } });
    expect(rowNames()).toEqual(["คุณสมหญิง รักงาน"]);
  });

  it("✕ in the box clears it", async () => {
    render(<Customers />);
    await loaded();
    const box = screen.getByRole("textbox", { name: "ค้นหาลูกค้า" }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "ล้างคำค้น" })).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "สมชาย" } });
    expect(rowNames()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "ล้างคำค้น" }));
    expect(box.value).toBe("");
    expect(rowNames()).toHaveLength(3);
  });

  it("the note search-and-replace is folded away until its button is pressed", async () => {
    render(<Customers />);
    await loaded();
    const toggle = screen.getByRole("button", { name: "ค้นหา-แทนที่ในบันทึก" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "คำที่ต้องการค้นในบันทึกลูกค้า" })).not.toBeInTheDocument();
    // The list's own search box is the only one on the tab.
    expect(screen.getAllByRole("textbox").filter((el) => el.getAttribute("aria-label") !== "ไปที่หน้า")).toHaveLength(1);

    fireEvent.click(toggle);
    const noteBox = screen.getByRole("textbox", { name: "คำที่ต้องการค้นในบันทึกลูกค้า" });
    expect(document.activeElement).toBe(noteBox);
    expect(screen.getByRole("button", { name: "ปิดค้นหาในบันทึก" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("customer-note-search")).toContainElement(noteBox);

    fireEvent.click(screen.getByRole("button", { name: "ปิดค้นหาในบันทึก" }));
    expect(screen.queryByRole("textbox", { name: "คำที่ต้องการค้นในบันทึกลูกค้า" })).not.toBeInTheDocument();
  });
});

describe("/customers — companies", () => {
  async function openCompanies() {
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    await screen.findByText("บริษัท สยามเทส จำกัด");
  }
  const countOf = (name: string) =>
    within(screen.getByRole("row", { name: `ดูข้อมูล ${name}` })).getByTestId("company-customer-count").textContent;

  it("one box finds a company by name, district, province or phone", async () => {
    await openCompanies();
    const box = screen.getByRole("textbox", { name: "ค้นหาบริษัท" });
    fireEvent.change(box, { target: { value: "ศรีราชา" } });
    expect(rowNames()).toEqual(["บริษัท ไทยแล็บ จำกัด"]);
    fireEvent.change(box, { target: { value: "สยามเทส กรุงเทพ" } });
    expect(rowNames()).toEqual(["บริษัท สยามเทส จำกัด"]);
    fireEvent.change(box, { target: { value: "038-123" } });
    expect(rowNames()).toEqual(["บริษัท ไทยแล็บ จำกัด"]);
    expect(screen.getByTestId("company-count").textContent).toBe(" (พบ 1 จาก 3)");
  });

  it("shows how many customers each has, and sorts by it — most first", async () => {
    await openCompanies();
    expect(countOf("บริษัท ไทยแล็บ จำกัด")).toBe("2");
    expect(countOf("บริษัท สยามเทส จำกัด")).toBe("1");
    expect(countOf("ร้าน ช่างเอก")).toBe("0");
    const header = screen.getByRole("button", { name: /^ลูกค้า/ });
    fireEvent.click(header);
    expect(rowNames()).toEqual(["บริษัท ไทยแล็บ จำกัด", "บริษัท สยามเทส จำกัด", "ร้าน ช่างเอก"]);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(header);
    expect(rowNames()).toEqual(["ร้าน ช่างเอก", "บริษัท สยามเทส จำกัด", "บริษัท ไทยแล็บ จำกัด"]);
  });

  it("says '-' rather than 0 when the customers did not load", async () => {
    override = (url, init) => (url === "/api/customers" && !init?.method ? json({ error: "x" }, 500) : undefined);
    render(<Customers />);
    await screen.findByText("โหลดรายชื่อลูกค้าไม่สำเร็จ");
    fireEvent.click(tab(/^บริษัท/));
    await screen.findByText("บริษัท สยามเทส จำกัด");
    expect(countOf("บริษัท ไทยแล็บ จำกัด")).toBe("-");
  });

  it("phones read the way people write them, here and in the company window", async () => {
    await openCompanies();
    expect(screen.getByRole("button", { name: "คัดลอก 038-123-456" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คัดลอก 02-123-4567" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล บริษัท ไทยแล็บ จำกัด" }));
    const contacts = await screen.findByTestId("company-contacts");
    expect(contacts.textContent).toContain("081-234-5678");
  });
});

describe("/customers — salespeople", () => {
  it("one box finds a salesperson by name or phone; phones are dashed", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^พนักงานขาย/));
    const box = screen.getByRole("textbox", { name: "ค้นหาพนักงานขาย" });
    fireEvent.change(box, { target: { value: "086 111" } });
    expect(rowNames()).toEqual(["คุณวิชัย"]);
    expect(screen.getByTestId("salesperson-count").textContent).toBe(" (พบ 1 จาก 2)");
    expect(screen.getByRole("button", { name: "คัดลอก 086-111-1111" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล คุณวิชัย" }));
    expect(await screen.findByRole("heading", { name: "คุณวิชัย" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "คัดลอก 086-111-1111" })).toHaveLength(2);
  });
});

describe("/customers — reloading, paging, exporting", () => {
  function many(n: number) {
    return Array.from({ length: n }, (_, i) => person(`m${i}`, { name: `ลูกค้า ${String(i + 1).padStart(3, "0")}` }));
  }

  it("a reload keeps the rows AND the pager on screen", async () => {
    lists.customers = many(60);
    let gets = 0;
    override = (url, init) => (url === "/api/customers" && !init?.method && ++gets > 1 ? new Promise(() => {}) : undefined);
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");
    fireEvent.click(within(screen.getByRole("row", { name: "ดูข้อมูล ลูกค้า 001" })).getByRole("button", { name: "แก้ไข ลูกค้า 001" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูล" }));
    await waitFor(() => expect(gets).toBe(2));
    expect(screen.getByText("ลูกค้า 001")).toBeInTheDocument();
    expect(screen.getByTestId("customer-pagination")).toBeInTheDocument();
    expect(document.querySelector("tr.animate-pulse")).toBeNull();
  });

  it("the companies and salespeople tabs keep their rows through a reload too", async () => {
    let reloading = false;
    override = (url, init) => (reloading && !init?.method && url.startsWith("/api/") ? new Promise(() => {}) : undefined);
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    await screen.findByText("ร้าน ช่างเอก");
    reloading = true;
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข ร้าน ช่างเอก" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/บันทึกข้อมูลบริษัทสำเร็จ/);
    expect(screen.getByText("ร้าน ช่างเอก")).toBeInTheDocument();
    expect(document.querySelector("tr.animate-pulse")).toBeNull();

    fireEvent.click(tab(/^พนักงานขาย/));
    expect(screen.getByText("คุณวิชัย")).toBeInTheDocument();
    expect(document.querySelector("tr.animate-pulse")).toBeNull();
  });

  it("the green-row legend and an empty list's message stay through a reload", async () => {
    lists.customers = [person("r1", { name: "คุณเพิ่งโทร", note: "โทรแล้ว", noteUpdatedAt: new Date(Date.now() - 3600_000).toISOString() })];
    let gets = 0;
    override = (url, init) => (url === "/api/customers" && !init?.method && ++gets > 1 ? new Promise(() => {}) : undefined);
    render(<Customers />);
    await screen.findByText("คุณเพิ่งโทร");
    expect(screen.getByTestId("recent-note-legend")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข คุณเพิ่งโทร" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูล" }));
    await waitFor(() => expect(gets).toBe(2));
    expect(screen.getByTestId("recent-note-legend")).toBeInTheDocument();
  });

  it("an empty list says so through a reload, too", async () => {
    lists.customers = [];
    let gets = 0;
    override = (url, init) => (url === "/api/customers" && !init?.method && ++gets > 1 ? new Promise(() => {}) : undefined);
    render(<Customers />);
    await screen.findByText("ยังไม่มีข้อมูลลูกค้า");
    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข คุณวรรณา" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูล" }));
    await waitFor(() => expect(gets).toBe(2));
    fireEvent.click(tab(/^ลูกค้า/));
    expect(screen.getByText("ยังไม่มีข้อมูลลูกค้า")).toBeInTheDocument();
  });

  it("the first load still shows skeleton rows", async () => {
    override = (url, init) => (url === "/api/customers" && !init?.method ? new Promise(() => {}) : undefined);
    render(<Customers />);
    await waitFor(() => expect(document.querySelectorAll("tr.animate-pulse").length).toBeGreaterThan(0));
  });

  it("changing page from below the list brings its top back into view", async () => {
    lists.customers = many(120);
    render(<Customers />);
    await screen.findByText("ลูกค้า 001");
    const panel = screen.getByRole("tabpanel");
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;
    const next = () => within(screen.getByTestId("customer-pagination")).getByRole("button", { name: "ถัดไป" });
    const pageBox = () => within(screen.getByTestId("customer-pagination")).getByRole("textbox", { name: "ไปที่หน้า" }) as HTMLInputElement;

    // The top of the list is on screen: nothing moves.
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 120 } as DOMRect);
    fireEvent.click(next());
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(pageBox().value).toBe("2");

    // Scrolled past it, at the pager: back up to the top of the list.
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: -2400 } as DOMRect);
    fireEvent.click(next());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(pageBox().value).toBe("3");
  });

  it("the companies pager does the same", async () => {
    lists.companies = Array.from({ length: 60 }, (_, i) => ({ ...C, id: `k${i}`, name: `ร้าน ${String(i + 1).padStart(2, "0")}` }));
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    await screen.findByText("ร้าน 01");
    const panel = screen.getByRole("tabpanel");
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: -900 } as DOMRect);
    fireEvent.click(within(screen.getByTestId("company-pagination")).getByRole("button", { name: "ถัดไป" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("exports to a file named for the day, from a Thai button", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ส่งออก Excel" }));
    await waitFor(() => expect(downloadExcel).toHaveBeenCalled());
    expect(vi.mocked(downloadExcel).mock.calls[0][0]).toMatch(/^customers_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe("/customers — above the admin bell", () => {
  it("the page leaves room under the last row, and every window is over the bell (z-90)", async () => {
    const { container } = render(<Customers />);
    await loaded();
    expect((container.firstChild as HTMLElement).className).toContain("pb-32");

    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล คุณสมชาย ใจดี" }));
    const customerWindow = (await screen.findByRole("heading", { name: "คุณสมชาย ใจดี" })).closest(".fixed") as HTMLElement;
    expect(customerWindow.className).toContain("z-100");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    });

    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(await screen.findByRole("row", { name: "ดูข้อมูล ร้าน ช่างเอก" }));
    expect((await screen.findByTestId("company-contacts")).closest(".fixed")!.className).toContain("z-100");
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));

    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("row", { name: "ดูข้อมูล คุณวรรณา" }));
    expect((await screen.findByRole("heading", { name: "คุณวรรณา" })).closest(".fixed")!.className).toContain("z-100");
  });
});
