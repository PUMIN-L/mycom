/**
 * /customers — what used to lose data or mislead: a delete that refused
 * without saying why, a failed load shown as "no customers", typing thrown
 * away by a stray click, a double click saving twice, the server's reason
 * replaced by "เกิดข้อผิดพลาด", and a phone field that ate "-" and "ต่อ".
 */
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Customers from "@/app/customers/page";
import { SESSION_EXPIRED_MESSAGE } from "@/app/lib/apiErrorMessage";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn(), back: vi.fn() }),
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

const COMPANY = { addressNo: "", moo: "", soi: "", road: "", subDistrict: "", district: "", province: "", postalCode: "", phone: "", note: "" };
const companiesFixture = () => [
  { ...COMPANY, id: "co1", name: "บริษัท ก" },
  { ...COMPANY, id: "co2", name: "บริษัท ข" },
];
const customersFixture = () => [
  { id: "c1", companyId: "co1", companyName: "บริษัท ก", name: "คุณสมชาย", department: "QC", phone: "0812345678", email: "", note: "1/9 โทรแล้ว\n2/9 ส่งใบเสนอราคา", createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: "2026-01-02T00:00:00.000Z" },
  { id: "c2", companyId: "co2", companyName: "บริษัท ข", name: "คุณสมหญิง", department: "", phone: "", email: "", note: "", createdAt: "2025-01-01T00:00:00.000Z", noteUpdatedAt: null },
];
const salespeopleFixture = () => [{ id: "sp1", name: "คุณวิชัย", phone: "0861111111", email: "", note: "" }];

type Handler = (url: string, init?: RequestInit) => unknown;
let lists: { customers: unknown[]; companies: unknown[]; salespeople: unknown[] };
let override: Handler | null = null;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A DELETE that went through: the record is gone from what the next load returns. */
function forget(url: string) {
  const [, , kind, id] = url.split("/");
  const key = kind as keyof typeof lists;
  if (lists[key]) lists[key] = lists[key].filter((r) => (r as { id: string }).id !== decodeURIComponent(id));
}

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = override?.(url, init);
    if (custom !== undefined) return custom;
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (url === "/api/customers") return json(lists.customers);
      if (url === "/api/companies") return json(lists.companies);
      if (url === "/api/salespeople") return json(lists.salespeople);
      if (url.endsWith("/links")) return json({});
      return json([]);
    }
    if (method === "POST") return json({ id: "new-1" });
    if (method === "DELETE") forget(url);
    return json({ success: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
let fetchMock: ReturnType<typeof installFetch>;
const callsOf = (method: string, url?: string | RegExp) =>
  fetchMock.mock.calls.filter(
    ([u, i]) =>
      ((i as RequestInit | undefined)?.method ?? "GET") === method &&
      (url === undefined || (typeof url === "string" ? String(u) === url : url.test(String(u))))
  );
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const rowOf = (name: string) => screen.getByRole("row", { name: `ดูข้อมูล ${name}` });
const alertDialog = () => screen.getByRole("alertdialog");
const formDialog = () => screen.getByRole("dialog");
async function loaded() {
  await screen.findByText("คุณสมชาย");
}
async function openDelete(name: string) {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: `ลบ ${name}` }));
  return alertDialog();
}
/** Waits until the links check has answered and the dialog can delete. */
async function confirmButton() {
  const button = await within(alertDialog()).findByRole("button", { name: "ลบข้อมูล" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}
async function pickCompany(name: string) {
  fireEvent.click(screen.getByLabelText(/สังกัดบริษัท/));
  fireEvent.click(await screen.findByRole("button", { name }));
}

beforeEach(() => {
  lists = { customers: customersFixture(), companies: companiesFixture(), salespeople: salespeopleFixture() };
  override = null;
  replace.mockReset();
  fetchMock = installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/customers — delete says what still points at the record", () => {
  it("a customer with machines and a job sheet: says what, how many, and sends no DELETE", async () => {
    override = (url) =>
      url === "/api/customers/c1/links" ? json({ equipments: 2, salesRecords: 0, callSchedules: 0, serviceJobs: 1 }) : undefined;
    render(<Customers />);
    await loaded();
    await openDelete("คุณสมชาย");

    expect(await within(alertDialog()).findByText("ลบลูกค้ารายนี้ไม่ได้")).toBeInTheDocument();
    const blockers = within(alertDialog()).getByTestId("delete-blockers");
    expect(blockers.textContent).toContain("เครื่องมือ 2 เครื่อง");
    expect(blockers.textContent).toContain("ใบ Job 1 ใบ");
    expect(blockers.textContent).not.toContain("รายการขาย");
    expect(within(alertDialog()).queryByRole("button", { name: "ลบข้อมูล" })).not.toBeInTheDocument();
    // Read-only now: the focus is on the only thing left to press.
    await waitFor(() => expect(document.activeElement).toBe(within(alertDialog()).getByRole("button", { name: "ตกลง" })));

    fireEvent.click(within(alertDialog()).getByRole("button", { name: "ตกลง" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(callsOf("DELETE")).toHaveLength(0);
  });

  it("while the check runs it asks nothing yet; with nothing linked it deletes — once, however often pressed", async () => {
    const check = deferred<unknown>();
    const del = deferred<unknown>();
    override = (url, init) => {
      if (url === "/api/customers/c2/links") return check.promise;
      if (init?.method === "DELETE") return del.promise;
      return undefined;
    };
    render(<Customers />);
    await loaded();
    await openDelete("คุณสมหญิง");
    expect(within(alertDialog()).getByText("ยืนยันการลบลูกค้า")).toBeInTheDocument();
    expect(within(alertDialog()).getByRole("status")).toHaveTextContent("กำลังตรวจสอบข้อมูลที่ผูกอยู่");
    expect(within(alertDialog()).getByRole("button", { name: "ลบข้อมูล" })).toBeDisabled();

    await act(async () => check.resolve(json({ equipments: 0, salesRecords: 0, callSchedules: 0, serviceJobs: 0 })));
    const button = await confirmButton();
    expect(within(alertDialog()).queryByRole("status")).not.toBeInTheDocument();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(within(alertDialog()).getByRole("button", { name: "กำลังลบ..." })).toBeDisabled();
    expect(callsOf("DELETE", "/api/customers/c2")).toHaveLength(1);

    forget("/api/customers/c2");
    await act(async () => del.resolve(json({ success: true })));
    expect(await screen.findByText(/ลบลูกค้าสำเร็จ/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: "ดูข้อมูล คุณสมหญิง" })).not.toBeInTheDocument();
    expect(callsOf("DELETE")).toHaveLength(1);
  });

  it("the deleted one is off the list at once, before the reload answers", async () => {
    const reload = deferred<unknown>();
    let gets = 0;
    override = (url, init) => (url === "/api/customers" && !init?.method && ++gets === 2 ? reload.promise : undefined);
    render(<Customers />);
    await loaded();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 2");
    await openDelete("คุณสมหญิง");
    fireEvent.click(await confirmButton());
    await screen.findByText(/ลบลูกค้าสำเร็จ/);
    // The reload is still out; the count already says one.
    expect(gets).toBe(2);
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 1");
    await act(async () => reload.resolve(json(lists.customers)));
  });

  it("a refusal the check did not foresee is said in the server's own words, with only ตกลง", async () => {
    const reason = "ลบลูกค้ารายนี้ไม่ได้ เพราะยังมีใบ Job ที่ผูกกับลูกค้ารายนี้อยู่";
    override = (url, init) => (init?.method === "DELETE" ? json({ error: reason }, 400) : undefined);
    render(<Customers />);
    await loaded();
    await openDelete("คุณสมหญิง");
    const button = await confirmButton();
    button.focus(); // as a mouse click would
    fireEvent.click(button);

    expect(await within(alertDialog()).findByTestId("delete-refusal")).toHaveTextContent(reason);
    await waitFor(() => expect(document.activeElement).toBe(within(alertDialog()).getByRole("button", { name: "ตกลง" })));
    expect(within(alertDialog()).getByText("ลบลูกค้ารายนี้ไม่ได้")).toBeInTheDocument();
    expect(within(alertDialog()).queryByRole("button", { name: "ลบข้อมูล" })).not.toBeInTheDocument();
    expect(screen.queryByText(/เกิดข้อผิดพลาดในการลบ/)).not.toBeInTheDocument();
    expect(rowOf("คุณสมหญิง")).toBeInTheDocument();
  });

  it("a delete that failed can be pressed again; an expired session and a lost connection say so", async () => {
    let answer: () => unknown = () => json({ error: "ลบลูกค้าไม่สำเร็จ" }, 500);
    override = (url, init) => (init?.method === "DELETE" ? answer() : undefined);
    render(<Customers />);
    await loaded();
    await openDelete("คุณสมหญิง");

    const first = await confirmButton();
    first.focus(); // as a mouse click would
    fireEvent.click(first);
    expect(await within(alertDialog()).findByRole("alert")).toHaveTextContent("ลบลูกค้าไม่สำเร็จ");
    // ลบข้อมูล was disabled under the request; the focus is back on the safe button.
    await waitFor(() => expect(document.activeElement).toBe(within(alertDialog()).getByRole("button", { name: "ยกเลิก" })));
    answer = () => json({ error: "Unauthorized" }, 401);
    fireEvent.click(await confirmButton());
    await waitFor(() => expect(within(alertDialog()).getByRole("alert")).toHaveTextContent(SESSION_EXPIRED_MESSAGE));
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    fireEvent.click(await confirmButton());
    await waitFor(() =>
      expect(within(alertDialog()).getByRole("alert")).toHaveTextContent("ลบลูกค้าไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่")
    );
    expect(within(alertDialog()).getByRole("button", { name: "ลบข้อมูล" })).toBeEnabled();
    expect(rowOf("คุณสมหญิง")).toBeInTheDocument();
  });

  it("an unanswered check still asks, and the delete goes through", async () => {
    override = (url) => (url.endsWith("/links") ? json({ error: "x" }, 500) : undefined);
    render(<Customers />);
    await loaded();
    await openDelete("คุณสมหญิง");
    fireEvent.click(await confirmButton());
    expect(await screen.findByText(/ลบลูกค้าสำเร็จ/)).toBeInTheDocument();
  });

  it("a check lost on the network still asks", async () => {
    override = (url) => (url.endsWith("/links") ? Promise.reject(new TypeError("Failed to fetch")) : undefined);
    render(<Customers />);
    await loaded();
    await openDelete("คุณสมชาย");
    expect(await confirmButton()).toBeEnabled();
    expect(within(alertDialog()).getByText("ยืนยันการลบลูกค้า")).toBeInTheDocument();
  });

  it("a company: its customers are the reason", async () => {
    override = (url) => (url === "/api/companies/co1/links" ? json({ customers: 2, serviceJobs: 0 }) : undefined);
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    await openDelete("บริษัท ก");
    expect(await within(alertDialog()).findByText("ลบบริษัทนี้ไม่ได้")).toBeInTheDocument();
    expect(within(alertDialog()).getByTestId("delete-blockers")).toHaveTextContent("ลูกค้า 2 ราย");
  });

  it("a salesperson: their sales records are the reason", async () => {
    override = (url) => (url === "/api/salespeople/sp1/links" ? json({ salesRecords: 3 }) : undefined);
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^พนักงานขาย/));
    await openDelete("คุณวิชัย");
    expect(await within(alertDialog()).findByText("ลบพนักงานขายคนนี้ไม่ได้")).toBeInTheDocument();
    expect(within(alertDialog()).getByTestId("delete-blockers")).toHaveTextContent("รายการขาย 3 รายการ");
  });

  it("deleting a company and a salesperson goes to their own routes and says so", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^บริษัท/));
    await openDelete("บริษัท ข");
    fireEvent.click(await confirmButton());
    expect(await screen.findByText(/ลบบริษัทสำเร็จ/)).toBeInTheDocument();
    expect(callsOf("DELETE", "/api/companies/co2")).toHaveLength(1);

    fireEvent.click(tab(/^พนักงานขาย/));
    await openDelete("คุณวิชัย");
    fireEvent.click(await confirmButton());
    expect(await screen.findByText(/ลบพนักงานขายสำเร็จ/)).toBeInTheDocument();
    expect(callsOf("DELETE", "/api/salespeople/sp1")).toHaveLength(1);
  });

  it("Esc and the backdrop close it — but not while it is deleting", async () => {
    const del = deferred<unknown>();
    override = (url, init) => (init?.method === "DELETE" ? del.promise : undefined);
    render(<Customers />);
    await loaded();
    const opener = within(rowOf("คุณสมหญิง")).getByRole("button", { name: "ลบ คุณสมหญิง" });
    opener.focus();
    await openDelete("คุณสมหญิง");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(opener));

    await openDelete("คุณสมหญิง");
    fireEvent.click(screen.getByTestId("delete-dialog-backdrop"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await openDelete("คุณสมหญิง");
    fireEvent.click(await confirmButton());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("delete-dialog-backdrop"));
    expect(alertDialog()).toBeInTheDocument();
    await act(async () => del.resolve(json({ success: true })));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("/customers — a list that fails to load", () => {
  it("says so, with ลองใหม่ — not 'no customers', not a count of 0", async () => {
    let fail = true;
    override = (url, init) => (url === "/api/customers" && !init?.method && fail ? json({ error: "x" }, 500) : undefined);
    render(<Customers />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายชื่อลูกค้าไม่สำเร็จ");
    expect(screen.queryByText("ยังไม่มีข้อมูลลูกค้า")).not.toBeInTheDocument();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า");
    expect(screen.getByRole("heading", { name: "ลูกค้าทั้งหมด" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ส่งออก Excel/ })).toBeDisabled();
    // The other lists did load.
    expect(tab(/^บริษัท/).textContent).toBe("บริษัท 2");

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));
    await loaded();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 2");
    expect(screen.getByRole("button", { name: /ส่งออก Excel/ })).toBeEnabled();
  });

  it("only the list that failed is an error; the companies tab says it of itself", async () => {
    override = (url, init) => (url === "/api/companies" && !init?.method ? json({ error: "x" }, 500) : undefined);
    render(<Customers />);
    await loaded();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByText(/โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองใหม่/)).toBeInTheDocument();
    fireEvent.click(tab(/^บริษัท/));
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรายชื่อบริษัทไม่สำเร็จ");
    expect(screen.queryByText("ยังไม่มีข้อมูลบริษัท")).not.toBeInTheDocument();
    expect(screen.queryByTestId("company-pagination")).not.toBeInTheDocument();
  });

  it("the salespeople tab too, and a lost connection is said in Thai", async () => {
    override = (url, init) => (url === "/api/salespeople" && !init?.method ? Promise.reject(new TypeError("Failed to fetch")) : undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^พนักงานขาย/));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายชื่อพนักงานขายไม่สำเร็จ");
    expect(alert).not.toHaveTextContent("Failed to fetch");
    expect(screen.queryByText("ยังไม่มีข้อมูลพนักงานขาย")).not.toBeInTheDocument();
  });

  it("an expired session goes to the login page", async () => {
    override = (url) => (url === "/api/customers" ? json({ error: "Unauthorized" }, 401) : undefined);
    render(<Customers />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("a reload that fails after a save keeps the list on screen and says so", async () => {
    let gets = 0;
    override = (url, init) => (url === "/api/customers" && !init?.method && ++gets > 1 ? json({ error: "x" }, 500) : undefined);
    render(<Customers />);
    await loaded();
    fireEvent.click(within(rowOf("คุณสมหญิง")).getByRole("button", { name: "แก้ไข คุณสมหญิง" }));
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    expect(await screen.findByText(/โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่/)).toBeInTheDocument();
    expect(screen.getByText("คุณสมชาย")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(tab(/^ลูกค้า/).textContent).toBe("ลูกค้า 2");
  });

  it("an older load answering last never overwrites a newer one", async () => {
    const stale = deferred<unknown>();
    let gets = 0;
    override = (url, init) => {
      if (url !== "/api/customers" || init?.method) return undefined;
      return ++gets === 1 ? stale.promise : undefined;
    };
    render(<Customers />);
    // The first load hangs; a salesperson saved meanwhile starts a second one,
    // which answers first.
    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มพนักงานขาย/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณขาย" } });
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/บันทึกข้อมูลพนักงานขายสำเร็จ/);
    fireEvent.click(tab(/^ลูกค้า/));
    await loaded();
    // The first load answers last, with a list from before.
    await act(async () => stale.resolve(json([{ ...customersFixture()[0], id: "old", name: "คุณเก่า" }])));
    expect(screen.queryByText("คุณเก่า")).not.toBeInTheDocument();
    expect(rowOf("คุณสมชาย")).toBeInTheDocument();
    expect(rowOf("คุณสมหญิง")).toBeInTheDocument();
  });
});

describe("/customers — the add / edit forms", () => {
  it("a phone keeps its dashes and its extension, in all three forms", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มลูกค้า/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณใหม่" } });
    await pickCompany("บริษัท ข");
    const phone = screen.getByLabelText("เบอร์โทรศัพท์") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "02-123-4567 ต่อ 105, 081-111-2222" } });
    expect(phone.value).toBe("02-123-4567 ต่อ 105, 081-111-2222");
    expect(phone).not.toHaveAttribute("pattern");
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(bodyOf(callsOf("POST", "/api/customers")[0])).toMatchObject({
      name: "คุณใหม่",
      companyId: "co2",
      phone: "02-123-4567 ต่อ 105, 081-111-2222",
    });

    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มบริษัท/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อบริษัท/), { target: { value: "บริษัท ใหม่" } });
    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "+66 2 123 4567" } });
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/บันทึกข้อมูลบริษัทสำเร็จ/);
    expect(bodyOf(callsOf("POST", "/api/companies")[0]).phone).toBe("+66 2 123 4567");

    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มพนักงานขาย/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณขาย" } });
    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: " 089-000-0000 " } });
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/บันทึกข้อมูลพนักงานขายสำเร็จ/);
    expect(bodyOf(callsOf("POST", "/api/salespeople")[0]).phone).toBe("089-000-0000");
  });

  it("saves once however often it is submitted, and says it is saving", async () => {
    const post = deferred<unknown>();
    override = (url, init) => (init?.method === "POST" ? post.promise : undefined);
    render(<Customers />);
    await loaded();
    fireEvent.click(tab(/^พนักงานขาย/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มพนักงานขาย/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: "คุณขาย" } });
    const form = document.getElementById("salesperson-form") as HTMLFormElement;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    fireEvent.submit(form);
    expect(within(formDialog()).getByRole("button", { name: "กำลังบันทึก..." })).toBeDisabled();
    expect(callsOf("POST", "/api/salespeople")).toHaveLength(1);
    // Saving: it cannot be closed under the request — not even asked about.
    fireEvent.click(screen.getByTestId("salesperson-form-backdrop"));
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(within(formDialog()).getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
    expect(within(formDialog()).getByRole("button", { name: "ปิด" })).toBeDisabled();
    expect(formDialog()).toBeInTheDocument();

    await act(async () => post.resolve(json({ id: "sp9", name: "คุณขาย" }, 201)));
    expect(await screen.findByText(/บันทึกข้อมูลพนักงานขายสำเร็จ/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callsOf("POST", "/api/salespeople")).toHaveLength(1);
  });

  it("says what the server said, and keeps the form with what was typed", async () => {
    let answer: () => unknown = () => json({ error: "กรุณาเลือกบริษัท" }, 400);
    override = (url, init) => (init?.method === "PUT" ? answer() : undefined);
    render(<Customers />);
    await loaded();
    fireEvent.click(within(rowOf("คุณสมชาย")).getByRole("button", { name: "แก้ไข คุณสมชาย" }));
    fireEvent.change(screen.getByLabelText("แผนก"), { target: { value: "จัดซื้อ" } });
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    expect(await screen.findByText(/กรุณาเลือกบริษัท/)).toBeInTheDocument();
    expect(screen.queryByText(/เกิดข้อผิดพลาดในการบันทึก/)).not.toBeInTheDocument();
    expect((screen.getByLabelText("แผนก") as HTMLInputElement).value).toBe("จัดซื้อ");

    answer = () => json({ error: "Unauthorized" }, 401);
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    expect(await screen.findByText(new RegExp(SESSION_EXPIRED_MESSAGE))).toBeInTheDocument();

    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    expect(await screen.findByText(/บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่/)).toBeInTheDocument();
    expect(formDialog()).toBeInTheDocument();
  });

  it("editing a customer sends every field back, the call log included", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(within(rowOf("คุณสมชาย")).getByRole("button", { name: "แก้ไข คุณสมชาย" }));
    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "081-234-5678" } });
    fireEvent.click(within(formDialog()).getByRole("button", { name: "บันทึกข้อมูล" }));
    await screen.findByText(/บันทึกข้อมูลลูกค้าสำเร็จ/);
    expect(bodyOf(callsOf("PUT", "/api/customers/c1")[0])).toEqual({
      name: "คุณสมชาย",
      companyId: "co1",
      department: "QC",
      phone: "081-234-5678",
      email: "",
      note: "1/9 โทรแล้ว\n2/9 ส่งใบเสนอราคา",
    });
  });

  it("closing with typing in it asks first — the backdrop, ✕ and ยกเลิก alike", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มลูกค้า/ }));
    const name = screen.getByLabelText(/ชื่อ-นามสกุล/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "คุณใหม่" } });

    fireEvent.click(screen.getByTestId("customer-form-backdrop"));
    expect(screen.getByText("ยังไม่ได้บันทึก")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "กลับไปแก้ต่อ" }));
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(name.value).toBe("คุณใหม่");

    fireEvent.click(within(formDialog()).getByRole("button", { name: "ยกเลิก" }));
    fireEvent.click(screen.getByRole("button", { name: "กลับไปแก้ต่อ" }));
    fireEvent.click(within(formDialog()).getByRole("button", { name: "ปิด" }));
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callsOf("POST")).toHaveLength(0);
  });

  it("an untouched form — or one put back as it was — closes at once", async () => {
    render(<Customers />);
    await loaded();
    fireEvent.click(within(rowOf("คุณสมชาย")).getByRole("button", { name: "แก้ไข คุณสมชาย" }));
    fireEvent.click(screen.getByTestId("customer-form-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(rowOf("คุณสมชาย")).getByRole("button", { name: "แก้ไข คุณสมชาย" }));
    const dept = screen.getByLabelText("แผนก");
    fireEvent.change(dept, { target: { value: "QCx" } });
    fireEvent.change(dept, { target: { value: "QC" } });
    fireEvent.click(within(formDialog()).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A company opened from its window's "+ เพิ่มลูกค้าในบริษัทนี้" starts
    // with the company picked — that alone is not typing to lose.
    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(rowOf("บริษัท ข"));
    fireEvent.click(await screen.findByRole("button", { name: "+ เพิ่มลูกค้าในบริษัทนี้" }));
    fireEvent.click(within(formDialog()).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refresh with typing in the form gets the browser's warning", async () => {
    render(<Customers />);
    await loaded();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    fireEvent.click(tab(/^บริษัท/));
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มบริษัท/ }));
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("ถนน"), { target: { value: "สุขุมวิท" } });
    expect(unload()).toBe(true);
    fireEvent.click(within(formDialog()).getByRole("button", { name: "ยกเลิก" }));
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(unload()).toBe(false);
  });
});
