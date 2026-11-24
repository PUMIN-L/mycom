/**
 * /customers — the add / edit forms: what is wrong is said in Thai under the
 * field, the keyboard works (Enter, Ctrl+Enter, Esc, the cursor on the first
 * field), a refused save stays in the form, likely duplicates are pointed
 * out, a company can be added from inside the customer form, and the province
 * is picked from the 77.
 */
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";
import { THAI_PROVINCES } from "@/app/lib/thaiProvinces";

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
  { ...C, id: "co1", name: "บริษัท ไทยแล็บ จำกัด", district: "บางนา", province: "กทม." },
  { ...C, id: "co2", name: "บริษัท สยามเทส จำกัด", province: "Osaka" },
];
const customersFixture = () => [
  { id: "c1", companyId: "co1", companyName: "บริษัท ไทยแล็บ จำกัด", name: "คุณสมชาย ใจดี", department: "QC", phone: "081-234-5678", email: "somchai@example.com", note: "1/9 โทรแล้ว", createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: "2026-01-02T00:00:00.000Z" },
  { id: "c2", companyId: "co-gone", companyName: "", name: "คุณกมล", department: "", phone: "", email: "", note: "", createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: null },
];
const salespeopleFixture = () => [{ id: "sp1", name: "คุณวิชัย", phone: "", email: "", note: "" }];

let lists: { customers: unknown[]; companies: unknown[]; salespeople: unknown[] };
let override: ((url: string, init?: RequestInit) => unknown) | null = null;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let fetchMock: ReturnType<typeof installFetch>;
function installFetch() {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = override?.(url, init);
    if (custom !== undefined) return custom;
    const method = init?.method ?? "GET";
    if (method === "GET") {
      const key = url.replace("/api/", "") as keyof typeof lists;
      return json(key in lists ? lists[key] : []);
    }
    if (method === "POST") return json({ id: "new-1" });
    return json({ success: true });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const callsOf = (method: string, url?: string) =>
  fetchMock.mock.calls.filter(([u, i]) => ((i as RequestInit | undefined)?.method ?? "GET") === method && (url === undefined || String(u) === url));
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const esc = () => fireEvent.keyDown(document, { key: "Escape" });
const saveButton = () => screen.getByRole("button", { name: "บันทึกข้อมูล" });
const problems = () => [...document.querySelectorAll("[data-field-error]")].map((p) => p.textContent);
async function loaded() {
  await screen.findByText("คุณสมชาย ใจดี");
}
async function openAddCustomer() {
  render(<Customers />);
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มลูกค้า/ }));
  return screen.getByRole("dialog", { name: "เพิ่มลูกค้าใหม่" });
}
async function openEditCustomer(name: string) {
  render(<Customers />);
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: `แก้ไข ${name}` }));
  return screen.getByRole("dialog", { name: "แก้ไขข้อมูลลูกค้า" });
}
async function openCompanyForm(action: "add" | string) {
  render(<Customers />);
  await loaded();
  fireEvent.click(tab(/^บริษัท/));
  fireEvent.click(action === "add" ? screen.getByRole("button", { name: /เพิ่มบริษัท/ }) : screen.getByRole("button", { name: `แก้ไข ${action}` }));
  return screen.getByRole("dialog");
}
async function pickOption(label: RegExp, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("button", { name: option }));
}

beforeEach(() => {
  lists = { customers: customersFixture(), companies: companiesFixture(), salespeople: salespeopleFixture() };
  override = null;
  fetchMock = installFetch();
  window.history.replaceState({}, "", "/customers");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("/customers forms — what is wrong, in Thai, under the field", () => {
  it("nothing is flagged until a save is tried; then each problem is said, and the cursor goes to the first", async () => {
    const dialog = await openAddCustomer();
    expect(document.getElementById("customer-form")).toHaveAttribute("novalidate");
    expect(problems()).toEqual([]);

    fireEvent.click(saveButton());
    expect(problems()).toEqual(["กรุณากรอกชื่อลูกค้า", "กรุณาเลือกบริษัท"]);
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/ชื่อ-นามสกุล/));
    expect(within(dialog).getByLabelText(/ชื่อ-นามสกุล/)).toHaveAttribute("aria-invalid", "true");
    expect(callsOf("POST")).toHaveLength(0);

    // The name given: the company is next.
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    fireEvent.click(saveButton());
    expect(problems()).toEqual(["กรุณาเลือกบริษัท"]);
    expect(document.activeElement).toBe(document.getElementById("customer-companyId"));
    expect(document.getElementById("customer-companyId")).toHaveAttribute("aria-describedby", "customer-companyId-error");
    expect(document.getElementById("customer-companyId")!.className).toContain("!border-red-500");
  });

  it("an e-mail that is not one is refused in Thai, not by the browser", async () => {
    const dialog = await openAddCustomer();
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    await pickOption(/สังกัดบริษัท/, "บริษัท ไทยแล็บ จำกัด");
    fireEvent.change(within(dialog).getByLabelText("อีเมล"), { target: { value: "somchai-at-example" } });
    fireEvent.click(saveButton());
    expect(problems()).toEqual(["รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com"]);
    expect(document.activeElement).toBe(within(dialog).getByLabelText("อีเมล"));
    expect(callsOf("POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("อีเมล"), { target: { value: "new@example.com" } });
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(bodyOf(callsOf("POST", "/api/customers")[0]).email).toBe("new@example.com");
  });

  it("the company and salesperson forms say the same of their names and e-mail", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มบริษัท/ }));
    fireEvent.click(saveButton());
    expect(problems()).toEqual(["กรุณากรอกชื่อบริษัท"]);
    expect(document.activeElement).toBe(screen.getByLabelText(/ชื่อบริษัท/));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มพนักงานขาย/ }));
    fireEvent.change(screen.getByLabelText("อีเมล"), { target: { value: "x" } });
    fireEvent.click(saveButton());
    expect(problems()).toEqual(["กรุณากรอกชื่อพนักงานขาย", "รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com"]);
    expect(callsOf("POST")).toHaveLength(0);
  });

  it("a customer whose company is gone must be given one", async () => {
    await openEditCustomer("คุณกมล");
    fireEvent.click(saveButton());
    expect(problems()).toEqual(["บริษัทเดิมของลูกค้ารายนี้ไม่อยู่ในรายการแล้ว กรุณาเลือกบริษัท"]);
    expect(callsOf("PUT")).toHaveLength(0);
    await pickOption(/สังกัดบริษัท/, "บริษัท สยามเทส จำกัด");
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(bodyOf(callsOf("PUT", "/api/customers/c2")[0]).companyId).toBe("co2");
  });

  it("a note counts its characters, and one that is too long is said so and not sent", async () => {
    const dialog = await openEditCustomer("คุณสมชาย ใจดี");
    const note = within(dialog).getByLabelText("บันทึกลูกค้า");
    expect(screen.getByTestId("customer-note-count")).toHaveTextContent("11 / 2,000");
    fireEvent.change(note, { target: { value: "ก".repeat(2001) } });
    // Said at once — not only after pressing save.
    expect(screen.getByTestId("customer-note-count")).toHaveTextContent("2,001 / 2,000 — บันทึกลูกค้ายาวเกิน 2,000 ตัวอักษร");
    expect(note).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(saveButton());
    expect(document.activeElement).toBe(note);
    expect(callsOf("PUT")).toHaveLength(0);
  });
});

describe("/customers forms — the keyboard", () => {
  it("opens with the cursor in the first field, and says who is being edited", async () => {
    const add = await openAddCustomer();
    expect(document.activeElement).toBe(within(add).getByLabelText(/ชื่อ-นามสกุล/));
    expect(screen.queryByTestId("form-subject")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    fireEvent.click(screen.getByRole("button", { name: "แก้ไข คุณสมชาย ใจดี" }));
    expect(screen.getByTestId("form-subject")).toHaveTextContent("คุณสมชาย ใจดี");
    // The subject is who the form OPENED for, whatever is typed since.
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณสมชาย เปลี่ยนชื่อ" } });
    expect(screen.getByTestId("form-subject")).toHaveTextContent(/^คุณสมชาย ใจดี$/);
  });

  it("Ctrl+Enter and ⌘+Enter save from a multi-line field; plain Enter there does not", async () => {
    const dialog = await openEditCustomer("คุณสมชาย ใจดี");
    const note = within(dialog).getByLabelText("บันทึกลูกค้า");
    fireEvent.change(note, { target: { value: "1/9 โทรแล้ว\n2/9 โทรอีก" } });
    fireEvent.keyDown(note, { key: "Enter" });
    expect(callsOf("PUT")).toHaveLength(0);
    fireEvent.keyDown(note, { key: "Enter", ctrlKey: true });
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(bodyOf(callsOf("PUT", "/api/customers/c1")[0]).note).toBe("1/9 โทรแล้ว\n2/9 โทรอีก");

    fireEvent.click(screen.getByRole("button", { name: "แก้ไข คุณสมชาย ใจดี" }));
    fireEvent.keyDown(screen.getByLabelText("แผนก"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(callsOf("PUT", "/api/customers/c1")).toHaveLength(2));
  });

  it("Esc closes an untouched form; with typing it asks, and Esc again goes back to the form", async () => {
    await openAddCustomer();
    esc();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /เพิ่มลูกค้า/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    esc();
    expect(screen.getByText("ยังไม่ได้บันทึก")).toBeInTheDocument();
    esc();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect((screen.getByLabelText(/ชื่อ-นามสกุล/) as HTMLInputElement).value).toBe("คุณใหม่");
  });

  it("Esc with the company list open closes the list, not the form", async () => {
    const dialog = await openAddCustomer();
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    fireEvent.click(screen.getByLabelText(/สังกัดบริษัท/));
    expect(await screen.findByPlaceholderText("ค้นหา...")).toBeInTheDocument();
    esc();
    expect(screen.queryByPlaceholderText("ค้นหา...")).not.toBeInTheDocument();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "เพิ่มลูกค้าใหม่" })).toBeInTheDocument();
  });

  it("the focus goes back to what opened the form", async () => {
    render(<Customers />);
    await loaded();
    const opener = screen.getByRole("button", { name: "แก้ไข คุณสมชาย ใจดี" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText(/ชื่อ-นามสกุล/));
    esc();
    expect(document.activeElement).toBe(opener);
  });
});

describe("/customers forms — a refused save", () => {
  it("is said inside the form, and brought back into view each time", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    override = (url, init) => (init?.method === "PUT" ? json({ error: "ไม่พบลูกค้า" }, 404) : undefined);
    const dialog = await openEditCustomer("คุณสมชาย ใจดี");
    fireEvent.click(saveButton());
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("ไม่พบลูกค้า");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    // Again: the same message, shown again.
    fireEvent.click(saveButton());
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    // A save that then works clears it.
    override = null;
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // @ts-expect-error — jsdom has none of its own to put back
    delete Element.prototype.scrollIntoView;
  });
});

describe("/customers forms — likely duplicates are pointed out, not refused", () => {
  it("a company with a name already on the list", async () => {
    await openCompanyForm("add");
    fireEvent.change(screen.getByLabelText(/ชื่อบริษัท/), { target: { value: "บริษัทไทยแล็บ จำกัด" } });
    expect(screen.getByTestId("duplicate-company")).toHaveTextContent("มีบริษัทชื่อนี้อยู่แล้ว: บริษัท ไทยแล็บ จำกัด");
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลบริษัทสำเร็จ/);
    expect(callsOf("POST", "/api/companies")).toHaveLength(1);
  });

  it("editing a company is not a duplicate of itself", async () => {
    await openCompanyForm("บริษัท ไทยแล็บ จำกัด");
    expect(screen.queryByTestId("duplicate-company")).not.toBeInTheDocument();
  });

  it("a customer with the same name in the same company, or the same phone", async () => {
    const dialog = await openAddCustomer();
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณสมชาย  ใจดี" } });
    expect(screen.queryByTestId("duplicate-customer")).not.toBeInTheDocument();
    await pickOption(/สังกัดบริษัท/, "บริษัท สยามเทส จำกัด");
    expect(screen.queryByTestId("duplicate-customer")).not.toBeInTheDocument();
    await pickOption(/สังกัดบริษัท/, "บริษัท ไทยแล็บ จำกัด");
    expect(screen.getByTestId("duplicate-customer")).toHaveTextContent("มีลูกค้าชื่อนี้ในบริษัทนี้อยู่แล้ว");

    fireEvent.change(within(dialog).getByLabelText("เบอร์โทรศัพท์"), { target: { value: "0812345678" } });
    expect(screen.getByTestId("duplicate-phone")).toHaveTextContent("เบอร์นี้ตรงกับของ คุณสมชาย ใจดี");
  });

  it("editing a customer is not a duplicate of themselves; a salesperson's name is checked too", async () => {
    await openEditCustomer("คุณสมชาย ใจดี");
    expect(screen.queryByTestId("duplicate-customer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("duplicate-phone")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มพนักงานขาย/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณ วิชัย" } });
    expect(screen.getByTestId("duplicate-salesperson")).toBeInTheDocument();
  });
});

describe("/customers forms — a company added from inside the customer form", () => {
  it("opens over the customer form with the searched name, and comes back picked", async () => {
    const dialog = await openAddCustomer();
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    // Looked for in the list, not there.
    fireEvent.click(screen.getByLabelText(/สังกัดบริษัท/));
    fireEvent.change(await screen.findByPlaceholderText("ค้นหา..."), { target: { value: "บริษัท ใหม่จริง จำกัด" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ เพิ่มบริษัทใหม่" }));

    const companyDialog = screen.getByRole("dialog", { name: "เพิ่มบริษัทใหม่" });
    expect((within(companyDialog).getByLabelText(/ชื่อบริษัท/) as HTMLInputElement).value).toBe("บริษัท ใหม่จริง จำกัด");
    // The customer form is still there, underneath, with what was typed.
    expect((within(dialog).getByLabelText(/ชื่อ-นามสกุล/) as HTMLInputElement).value).toBe("คุณใหม่");

    override = (url, init) => (url === "/api/companies" && init?.method === "POST" ? json({ id: "co-new" }) : undefined);
    lists.companies = [{ ...C, id: "co-new", name: "บริษัท ใหม่จริง จำกัด" }, ...companiesFixture()];
    fireEvent.click(within(companyDialog).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/เพิ่มบริษัทแล้ว และเลือกให้ลูกค้ารายนี้แล้ว/);
    expect(screen.queryByRole("dialog", { name: "เพิ่มบริษัทใหม่" })).not.toBeInTheDocument();
    expect(within(document.getElementById("customer-form")!).getByText("บริษัท ใหม่จริง จำกัด")).toBeInTheDocument();

    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(bodyOf(callsOf("POST", "/api/customers")[0])).toMatchObject({ name: "คุณใหม่", companyId: "co-new" });
  });

  it("the new company is picked at once — before the lists have been reloaded", async () => {
    const dialog = await openAddCustomer();
    fireEvent.click(within(dialog).getByRole("button", { name: "+ เพิ่มบริษัทใหม่" }));
    const companyDialog = screen.getByRole("dialog", { name: "เพิ่มบริษัทใหม่" });
    fireEvent.change(within(companyDialog).getByLabelText(/ชื่อบริษัท/), { target: { value: "บริษัท เพิ่งเพิ่ม" } });
    // From here no list ever comes back: the reload after the save hangs.
    override = (url, init) => {
      if (url === "/api/companies" && init?.method === "POST") return json({ id: "co-new" });
      return init?.method ? undefined : new Promise(() => {});
    };
    fireEvent.click(within(companyDialog).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/เพิ่มบริษัทแล้ว และเลือกให้ลูกค้ารายนี้แล้ว/);
    expect(within(document.getElementById("customer-form")!).getByText("บริษัท เพิ่งเพิ่ม")).toBeInTheDocument();
    // And it is no longer "a company that is not on the list".
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกข้อมูล" }));
    await waitFor(() => expect(callsOf("POST", "/api/customers")).toHaveLength(1));
    expect(problems()).toEqual([]);
  });

  it("Esc there closes the company form only", async () => {
    const dialog = await openAddCustomer();
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ เพิ่มบริษัทใหม่" }));
    expect(screen.getByRole("dialog", { name: "เพิ่มบริษัทใหม่" })).toBeInTheDocument();
    esc();
    expect(screen.queryByRole("dialog", { name: "เพิ่มบริษัทใหม่" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "เพิ่มลูกค้าใหม่" })).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(callsOf("POST")).toHaveLength(0);
  });

  it("a name picked from the list is not carried into a new company", async () => {
    const dialog = await openAddCustomer();
    fireEvent.click(screen.getByLabelText(/สังกัดบริษัท/));
    fireEvent.change(await screen.findByPlaceholderText("ค้นหา..."), { target: { value: "ไทย" } });
    fireEvent.click(screen.getByRole("button", { name: "บริษัท ไทยแล็บ จำกัด" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "+ เพิ่มบริษัทใหม่" }));
    expect((within(screen.getByRole("dialog", { name: "เพิ่มบริษัทใหม่" })).getByLabelText(/ชื่อบริษัท/) as HTMLInputElement).value).toBe("");
  });
});

describe("/customers company form — เซลล์ผู้ดูแล", () => {
  it("picks the salesperson from the list, and sends nobody as empty", async () => {
    const dialog = await openCompanyForm("add");
    expect(within(dialog).getByLabelText("เซลล์ผู้ดูแล")).toHaveTextContent("— ไม่ระบุ —");
    fireEvent.change(within(dialog).getByLabelText(/ชื่อบริษัท/), { target: { value: "บริษัท ใหม่ จำกัด" } });
    await pickOption(/เซลล์ผู้ดูแล/, "คุณวิชัย");
    fireEvent.click(saveButton());
    await waitFor(() => expect(callsOf("POST", "/api/companies")).toHaveLength(1));
    expect(bodyOf(callsOf("POST", "/api/companies")[0]).salespersonId).toBe("sp1");
  });

  it("opens with the saved one, and clears it back to nobody", async () => {
    lists.companies = [{ ...companiesFixture()[0], salespersonId: "sp1" }, companiesFixture()[1]];
    await openCompanyForm("บริษัท ไทยแล็บ จำกัด");
    expect(screen.getByLabelText("เซลล์ผู้ดูแล")).toHaveTextContent("คุณวิชัย");
    await pickOption(/เซลล์ผู้ดูแล/, "— ไม่ระบุ —");
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลบริษัทสำเร็จ/);
    expect(bodyOf(callsOf("PUT", "/api/companies/co1")[0]).salespersonId).toBe("");
  });
});

describe("/customers forms — the province is picked from the 77", () => {
  it("a company stored as กทม. opens as กรุงเทพมหานคร, unchanged until something is, and is saved by that name", async () => {
    await openCompanyForm("บริษัท ไทยแล็บ จำกัด");
    expect(screen.getByLabelText("จังหวัด")).toHaveTextContent("กรุงเทพมหานคร");
    // Opening it is not an edit.
    esc();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "แก้ไข บริษัท ไทยแล็บ จำกัด" }));
    fireEvent.change(screen.getByLabelText("ถนน"), { target: { value: "บางนา-ตราด" } });
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลบริษัทสำเร็จ/);
    expect(bodyOf(callsOf("PUT", "/api/companies/co1")[0])).toMatchObject({ province: "กรุงเทพมหานคร", road: "บางนา-ตราด" });
  });

  it("lists the provinces, and keeps a stored value that is none of them", async () => {
    await openCompanyForm("บริษัท สยามเทส จำกัด");
    const trigger = screen.getByLabelText("จังหวัด");
    expect(trigger).toHaveTextContent("Osaka (ที่พิมพ์ไว้เดิม)");
    fireEvent.click(trigger);
    await screen.findByPlaceholderText("ค้นหา...");
    for (const province of ["กรุงเทพมหานคร", "ชลบุรี", "อุบลราชธานี"]) {
      expect(screen.getByRole("button", { name: province })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button").filter((b) => THAI_PROVINCES.includes(b.textContent || ""))).toHaveLength(77);

    fireEvent.click(screen.getByRole("button", { name: "ระยอง" }));
    fireEvent.click(saveButton());
    await screen.findByText(/บันทึกข้อมูลบริษัทสำเร็จ/);
    expect(bodyOf(callsOf("PUT", "/api/companies/co2")[0]).province).toBe("ระยอง");
  });

  it("the list shows and finds กรุงเทพมหานคร for a company stored as กทม.", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    const cells = within(screen.getByRole("row", { name: "ดูข้อมูล บริษัท ไทยแล็บ จำกัด" })).getAllByRole("cell");
    // จังหวัด and อำเภอ, each in its own column.
    expect(cells[1].textContent).toBe("กรุงเทพมหานคร");
    expect(cells[2].textContent).toBe("บางนา");
    fireEvent.change(screen.getByRole("textbox", { name: "ค้นหาบริษัท" }), { target: { value: "กรุงเทพมหานคร" } });
    expect(screen.getAllByRole("row", { name: /^ดูข้อมูล / })).toHaveLength(1);
  });
});

// v50 — the company's tax fields, for the accounting module's tax invoices.
describe("/customers company form — tax fields", () => {
  it("warns about a tax ID that looks mistyped, but still saves it (a number from abroad is legal)", async () => {
    const dialog = await openCompanyForm("add");
    fireEvent.change(within(dialog).getByLabelText(/ชื่อบริษัท/), { target: { value: "บริษัท ภาษี จำกัด" } });
    fireEvent.change(within(dialog).getByLabelText("เลขประจำตัวผู้เสียภาษี"), { target: { value: "0107537000115" } });
    expect(within(dialog).getByText(/อาจพิมพ์ผิด/)).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(callsOf("POST", "/api/companies")).toHaveLength(1));
    expect(bodyOf(callsOf("POST", "/api/companies")[0]).taxId).toBe("0107537000115");
  });

  it("wants a branch number once สาขา is picked, and sends the branch and the usual withholding", async () => {
    const dialog = await openCompanyForm("add");
    fireEvent.change(within(dialog).getByLabelText(/ชื่อบริษัท/), { target: { value: "บริษัท สาขา จำกัด" } });
    await pickOption(/สำนักงานใหญ่ \/ สาขา/, "สาขา (ระบุเลขสาขา)");
    fireEvent.click(saveButton());
    expect(problems()).toEqual(["กรุณากรอกเลขสาขาเป็นตัวเลขไม่เกิน 5 หลัก เช่น 00001"]);
    expect(document.activeElement).toBe(within(dialog).getByLabelText("เลขสาขา"));
    expect(callsOf("POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("เลขสาขา"), { target: { value: "2x" } });
    expect((within(dialog).getByLabelText("เลขสาขา") as HTMLInputElement).value).toBe("2");
    await pickOption(/หัก ณ ที่จ่ายประจำ/, "3% (ค่าบริการ / จ้างทำของ)");
    fireEvent.click(saveButton());
    await waitFor(() => expect(callsOf("POST", "/api/companies")).toHaveLength(1));
    expect(bodyOf(callsOf("POST", "/api/companies")[0])).toMatchObject({ branchCode: "สาขา 2", whtPercent: "3" });
  });

  it("opens a company's saved tax fields as they were, and shows them in its window", async () => {
    lists.companies = [{ ...companiesFixture()[0], taxId: "0107537000114", branchCode: "00000", whtPercent: "3.00" }];
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข บริษัท ไทยแล็บ จำกัด" }));
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("เลขประจำตัวผู้เสียภาษี") as HTMLInputElement).value).toBe("0107537000114");
    expect(within(dialog).getByLabelText(/สำนักงานใหญ่ \/ สาขา/)).toHaveTextContent("สำนักงานใหญ่");
    expect(within(dialog).getByLabelText(/หัก ณ ที่จ่ายประจำ/)).toHaveTextContent("3% (ค่าบริการ / จ้างทำของ)");
  });
});
