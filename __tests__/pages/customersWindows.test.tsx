/**
 * /customers — the read-only windows of a company, a salesperson and a
 * customer: real dialogs (Esc, the backdrop, the focus), แก้ไข inside them,
 * an address written the way addresses are, and a way to copy it.
 */
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";

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
const COMPANIES = [
  { ...C, id: "co1", name: "บริษัท กรุงเทพแล็บ จำกัด", addressNo: "1", road: "บางนา-ตราด", subDistrict: "บางนาเหนือ", district: "บางนา", province: "กรุงเทพมหานคร", postalCode: "10260", phone: "021234567", note: "วางบิลทุกวันที่ 25" },
  { ...C, id: "co2", name: "บริษัท ชลบุรีเทส จำกัด", moo: "3", subDistrict: "บ่อวิน", district: "ศรีราชา", province: "ชลบุรี", postalCode: "20230" },
  { ...C, id: "co3", name: "ร้าน มีแต่อำเภอ", district: "ปลวกแดง" },
  { ...C, id: "co4", name: "ร้าน ไม่มีที่อยู่" },
];
const CUSTOMERS = [
  { id: "c1", companyId: "co1", companyName: "บริษัท กรุงเทพแล็บ จำกัด", name: "คุณสมชาย", department: "QC", phone: "0812345678", email: "somchai@example.com", note: "โทรแล้ว", createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: "2026-01-02T00:00:00.000Z" },
  // Points at a company that is no longer in the list.
  { id: "c2", companyId: "co-gone", companyName: "บริษัท ที่ถูกลบ", name: "คุณกมล", department: "", phone: "", email: "", note: "", createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: null },
];
const SALESPEOPLE = [{ id: "sp1", name: "คุณวิชัย", phone: "0861111111", email: "wichai@example.com", note: "ดูแลภาคตะวันออก" }];

let failCustomers = false;
function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method) return { ok: true, status: 200, json: async () => ({ success: true }) };
    if (url === "/api/customers") return failCustomers ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => CUSTOMERS };
    if (url === "/api/companies") return { ok: true, status: 200, json: async () => COMPANIES };
    if (url === "/api/salespeople") return { ok: true, status: 200, json: async () => SALESPEOPLE };
    return { ok: true, status: 200, json: async () => [] };
  }));
}
function stubClipboard(writeText = vi.fn(async () => {})) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const row = (name: string) => screen.getByRole("row", { name: `ดูข้อมูล ${name}` });
const esc = () => fireEvent.keyDown(document, { key: "Escape" });
async function openCompany(name: string) {
  render(<Customers />);
  await screen.findByText("บริษัท กรุงเทพแล็บ จำกัด");
  fireEvent.click(tab(/^บริษัท/));
  const opener = row(name);
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: await screen.findByRole("dialog", { name }) };
}
const addressOf = (dialog: HTMLElement) =>
  [...within(dialog).getByTestId("company-address").querySelectorAll("span")].map((s) => s.textContent);

beforeEach(() => {
  failCustomers = false;
  installFetch();
  window.history.replaceState({}, "", "/customers");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("/customers — the company window", () => {
  it("is a dialog: the focus goes in, Esc closes it, and the focus goes back to its row", async () => {
    const { opener, dialog } = await openCompany("บริษัท กรุงเทพแล็บ จำกัด");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
    esc();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("view-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("writes a Bangkok address with แขวง / เขต, a provincial one with ตำบล / อำเภอ / จังหวัด", async () => {
    const { dialog } = await openCompany("บริษัท กรุงเทพแล็บ จำกัด");
    expect(addressOf(dialog)).toEqual(["เลขที่ 1 ถนนบางนา-ตราด", "แขวงบางนาเหนือ เขตบางนา", "กรุงเทพมหานคร 10260"]);
    esc();
    fireEvent.click(row("บริษัท ชลบุรีเทส จำกัด"));
    const second = await screen.findByRole("dialog", { name: "บริษัท ชลบุรีเทส จำกัด" });
    expect(addressOf(second)).toEqual(["หมู่ 3", "ตำบลบ่อวิน อำเภอศรีราชา", "จังหวัดชลบุรี 20230"]);
  });

  it("an address with only a district shows it — without also saying there is no address", async () => {
    const { dialog } = await openCompany("ร้าน มีแต่อำเภอ");
    expect(addressOf(dialog)).toEqual(["อำเภอปลวกแดง"]);
    expect(within(dialog).queryByText("ไม่มีข้อมูลที่อยู่")).not.toBeInTheDocument();
  });

  it("no address at all says so, and offers nothing to copy", async () => {
    const { dialog } = await openCompany("ร้าน ไม่มีที่อยู่");
    expect(within(dialog).getByText("ไม่มีข้อมูลที่อยู่")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "คัดลอกที่อยู่" })).not.toBeInTheDocument();
  });

  it("คัดลอกที่อยู่ copies the address as one line, and says so", async () => {
    const writeText = stubClipboard();
    const { dialog } = await openCompany("บริษัท กรุงเทพแล็บ จำกัด");
    fireEvent.click(within(dialog).getByRole("button", { name: "คัดลอกที่อยู่" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("เลขที่ 1 ถนนบางนา-ตราด แขวงบางนาเหนือ เขตบางนา กรุงเทพมหานคร 10260"));
    expect(await screen.findByText(/คัดลอกแล้ว/)).toBeInTheDocument();
  });

  it("says when the copy failed", async () => {
    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    const { dialog } = await openCompany("บริษัท กรุงเทพแล็บ จำกัด");
    fireEvent.click(within(dialog).getByRole("button", { name: "คัดลอกที่อยู่" }));
    expect(await screen.findByText(/คัดลอกไม่สำเร็จ/)).toBeInTheDocument();
  });

  it("แก้ไข opens the company's form, filled in, in place of the window", async () => {
    const { dialog } = await openCompany("บริษัท กรุงเทพแล็บ จำกัด");
    fireEvent.click(within(dialog).getByRole("button", { name: "แก้ไข" }));
    expect(screen.getByRole("heading", { name: "แก้ไขข้อมูลบริษัท" })).toBeInTheDocument();
    expect((screen.getByLabelText(/ชื่อบริษัท/) as HTMLInputElement).value).toBe("บริษัท กรุงเทพแล็บ จำกัด");
    expect((screen.getByLabelText("ถนน") as HTMLInputElement).value).toBe("บางนา-ตราด");
    expect(screen.queryByTestId("company-contacts")).not.toBeInTheDocument();
  });

  it("when the customers did not load, it does not claim the company has none", async () => {
    failCustomers = true;
    render(<Customers />);
    await screen.findByText("โหลดรายชื่อลูกค้าไม่สำเร็จ");
    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(await screen.findByRole("row", { name: "ดูข้อมูล บริษัท กรุงเทพแล็บ จำกัด" }));
    const contacts = await screen.findByTestId("company-contacts");
    expect(contacts.textContent).toContain("โหลดรายชื่อลูกค้าไม่สำเร็จ");
    expect(contacts.textContent).not.toContain("ยังไม่มีลูกค้าในบริษัทนี้");
    expect(contacts.textContent).not.toContain("(0)");
  });

  it("shows the note with its line breaks", async () => {
    const { dialog } = await openCompany("บริษัท กรุงเทพแล็บ จำกัด");
    expect(within(dialog).getByText("วางบิลทุกวันที่ 25").className).toContain("whitespace-pre-wrap");
  });
});

describe("/customers — the salesperson window", () => {
  it("is a dialog that Esc closes, and แก้ไข opens the salesperson's form", async () => {
    render(<Customers />);
    await screen.findByText("คุณสมชาย");
    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(row("คุณวิชัย"));
    const dialog = await screen.findByRole("dialog", { name: "คุณวิชัย" });
    expect(within(dialog).getByText("ดูแลภาคตะวันออก")).toBeInTheDocument();
    esc();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(row("คุณวิชัย"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "คุณวิชัย" })).getByRole("button", { name: "แก้ไข" }));
    expect(screen.getByRole("heading", { name: "แก้ไขข้อมูลพนักงานขาย" })).toBeInTheDocument();
    expect((screen.getByLabelText(/ชื่อ-นามสกุล/) as HTMLInputElement).value).toBe("คุณวิชัย");
  });
});

describe("/customers — the customer window", () => {
  async function openCustomer(name: string) {
    render(<Customers />);
    await screen.findByText("คุณสมชาย");
    fireEvent.click(row(name));
    return screen.findByRole("dialog", { name });
  }

  it("แก้ไขข้อมูล opens the customer's form, filled in, in place of the window", async () => {
    const dialog = await openCustomer("คุณสมชาย");
    fireEvent.click(within(dialog).getByRole("button", { name: "แก้ไขข้อมูล" }));
    expect(screen.getByRole("heading", { name: "แก้ไขข้อมูลลูกค้า" })).toBeInTheDocument();
    expect((screen.getByLabelText(/ชื่อ-นามสกุล/) as HTMLInputElement).value).toBe("คุณสมชาย");
    expect((screen.getByLabelText("บันทึกลูกค้า") as HTMLTextAreaElement).value).toBe("โทรแล้ว");
    expect(screen.queryByRole("dialog", { name: "คุณสมชาย" })).not.toBeInTheDocument();
  });

  it("the company's name goes to the company's window", async () => {
    const dialog = await openCustomer("คุณสมชาย");
    fireEvent.click(within(dialog).getByRole("button", { name: "บริษัท กรุงเทพแล็บ จำกัด" }));
    expect(await screen.findByRole("dialog", { name: "บริษัท กรุงเทพแล็บ จำกัด" })).toBeInTheDocument();
    expect(screen.getByTestId("company-contacts")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "คุณสมชาย" })).not.toBeInTheDocument();
  });

  it("a company that is no longer in the list is a name, not a button", async () => {
    const dialog = await openCustomer("คุณกมล");
    expect(within(dialog).getByText("บริษัท ที่ถูกลบ")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "บริษัท ที่ถูกลบ" })).not.toBeInTheDocument();
  });

  it("Esc closes it", async () => {
    await openCustomer("คุณสมชาย");
    esc();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
