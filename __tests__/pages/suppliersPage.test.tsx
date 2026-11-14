/**
 * /suppliers: a failed load, saving once and saying what went wrong, the
 * company-name check, duplicate warnings, and a delete that says what goes
 * with the supplier.
 */
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SuppliersPage from "@/app/suppliers/page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/suppliers",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

const product = (i: number) => ({ id: `p${i}`, title_th: `<p>สินค้า ${i} &amp; อะไหล่</p>`, title_en: "" });
function suppliersFixture() {
  return [
    {
      id: "s1",
      companyName: "บริษัท อิมาดะ จำกัด",
      contactName: "คุณสมชาย",
      phone: "02-123-4567",
      address: "กรุงเทพฯ",
      taxId: "0105556123456",
      note: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      linkedProducts: Array.from({ length: 7 }, (_, i) => product(i + 1)),
    },
    {
      id: "s2",
      companyName: "YASUDA SEIKI CO., LTD.",
      contactName: "Mr. Tanaka",
      phone: "+81-6-1234",
      address: "",
      taxId: "",
      note: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      linkedProducts: [],
    },
  ];
}

type Handler = (url: string, init?: RequestInit) => unknown;
let suppliers = suppliersFixture();
let override: Handler | null = null;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = override?.(url, init);
    if (custom !== undefined) return custom;
    if (url === "/api/suppliers" && (!init?.method || init.method === "GET")) return json(suppliers);
    return json({ success: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const callsOf = (fetchMock: ReturnType<typeof installFetch>, method: string, url?: string) =>
  fetchMock.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === method && (url === undefined || String(u) === url));

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const dialog = () => screen.getByRole("dialog");
const nameBox = () => screen.getByLabelText(/ชื่อบริษัท/) as HTMLInputElement;
async function loaded() {
  await screen.findByText("บริษัท อิมาดะ จำกัด");
}
async function openAdd() {
  render(<SuppliersPage />);
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มซัพพลายเออร์" }));
}

beforeEach(() => {
  suppliers = suppliersFixture();
  override = null;
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("/suppliers — loading the list", () => {
  it("a failed load says so, with ลองใหม่ — not that there are no suppliers", async () => {
    let fail = true;
    override = (url, init) =>
      url === "/api/suppliers" && !init?.method && fail ? json({ error: "โหลดรายชื่อซัพพลายเออร์ไม่สำเร็จ" }, 500) : undefined;
    render(<SuppliersPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายชื่อซัพพลายเออร์ไม่สำเร็จ");
    expect(screen.queryByText("ไม่พบข้อมูลผู้ผลิต")).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));
    await loaded();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a network failure is said in Thai, not in the browser's words", async () => {
    override = (url) => (url === "/api/suppliers" ? Promise.reject(new TypeError("Failed to fetch")) : undefined);
    render(<SuppliersPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายชื่อซัพพลายเออร์ไม่สำเร็จ");
    expect(alert).not.toHaveTextContent("Failed to fetch");
  });

  it("a lapsed session goes to the login page", async () => {
    override = (url) => (url === "/api/suppliers" ? json({ error: "Unauthorized" }, 401) : undefined);
    render(<SuppliersPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("a reload that fails after a save keeps the list on screen and says so", async () => {
    let gets = 0;
    override = (url, init) => (url === "/api/suppliers" && !init?.method && ++gets > 1 ? json({ error: "x" }, 500) : undefined);
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(within(rowOf("YASUDA SEIKI CO., LTD.")).getByRole("button", { name: /แก้ไข/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่/)).toBeInTheDocument();
    expect(screen.getByText("บริษัท อิมาดะ จำกัด")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("an older reload answering last never brings a deleted supplier back", async () => {
    const staleReload = deferred<unknown>();
    let gets = 0;
    override = (url, init) => {
      if (url !== "/api/suppliers" || init?.method) return undefined;
      gets++;
      if (gets === 2) return staleReload.promise; // the reload after the save
      return undefined;
    };
    render(<SuppliersPage />);
    await loaded();
    // A save starts reload #2 (held back)…
    fireEvent.click(within(rowOf("YASUDA SEIKI CO., LTD.")).getByRole("button", { name: /แก้ไข/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await screen.findByText(/บันทึกการแก้ไขแล้ว/);
    // …then a delete, whose reload #3 answers first.
    fireEvent.click(screen.getByRole("button", { name: "ลบ บริษัท อิมาดะ จำกัด" }));
    suppliers = suppliersFixture().slice(1);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await screen.findByText(/ลบซัพพลายเออร์แล้ว/);
    await waitFor(() => expect(gets).toBe(3));

    staleReload.resolve(json(suppliersFixture())); // still has บริษัท อิมาดะ
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("บริษัท อิมาดะ จำกัด")).not.toBeInTheDocument();
  });
});

describe("/suppliers — saving", () => {
  it("a double click saves ONCE, says กำลังบันทึก..., and shows the new supplier at once", async () => {
    const post = deferred<unknown>();
    const reload = deferred<unknown>();
    let gets = 0;
    override = (url, init) => {
      if (url === "/api/suppliers" && init?.method === "POST") return post.promise;
      if (url === "/api/suppliers" && !init?.method && ++gets > 1) return reload.promise; // the reload never answers
      return undefined;
    };
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "  บริษัท ใหม่ จำกัด  " } });
    const save = within(dialog()).getByRole("button", { name: "บันทึก" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(within(dialog()).getByRole("button", { name: "กำลังบันทึก..." })).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "ยกเลิก" })).toBeDisabled();

    const fetchMock = vi.mocked(fetch);
    expect(callsOf(fetchMock as never, "POST")).toHaveLength(1);
    expect(JSON.parse(String(callsOf(fetchMock as never, "POST")[0][1]!.body)).companyName).toBe("บริษัท ใหม่ จำกัด");

    post.resolve(json({ ...suppliersFixture()[1], id: "s3", companyName: "บริษัท ใหม่ จำกัด" }));
    expect(await screen.findByText(/เพิ่มซัพพลายเออร์แล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // From the POST's answer — the reload has not answered.
    expect(screen.getByText("บริษัท ใหม่ จำกัด")).toBeInTheDocument();
    expect(callsOf(fetchMock as never, "POST")).toHaveLength(1);
  });

  it("a refused save stays open, with the route's message and what was typed", async () => {
    override = (url, init) => (init?.method === "POST" ? json({ error: "เพิ่มซัพพลายเออร์ไม่สำเร็จ" }, 500) : undefined);
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "บริษัท ใหม่ จำกัด" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("เพิ่มซัพพลายเออร์ไม่สำเร็จ");
    expect(nameBox().value).toBe("บริษัท ใหม่ จำกัด");
    expect(within(dialog()).getByRole("button", { name: "บันทึก" })).toBeEnabled();
    expect(screen.queryByText(/เพิ่มซัพพลายเออร์แล้ว/)).not.toBeInTheDocument();
  });

  it("a refused save is brought into view — the form may be scrolled down to the note", async () => {
    const scrolled: Element[] = [];
    // jsdom has no scrollIntoView; record which element asked for it.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      override = (url, init) => (init?.method === "POST" ? json({ error: "เพิ่มซัพพลายเออร์ไม่สำเร็จ" }, 500) : undefined);
      await openAdd();
      fireEvent.change(nameBox(), { target: { value: "บริษัท ใหม่ จำกัด" } });
      const save = within(dialog()).getByRole("button", { name: "บันทึก" });
      fireEvent.click(save);
      await waitFor(() => expect(scrolled).toHaveLength(1));
      expect(scrolled[0].textContent).toBe("เพิ่มซัพพลายเออร์ไม่สำเร็จ");
      // The same refusal again is brought into view again.
      fireEvent.click(save);
      await waitFor(() => expect(scrolled).toHaveLength(2));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("a lapsed session is said in Thai, never 'Unauthorized'", async () => {
    override = (url, init) => (init?.method === "PUT" ? json({ error: "Unauthorized" }, 401) : undefined);
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(within(rowOf("YASUDA SEIKI CO., LTD.")).getByRole("button", { name: /แก้ไข/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
    expect(alert).not.toHaveTextContent("Unauthorized");
  });

  it("an edit is a PUT of the form's fields, said in Thai, and the row shows it", async () => {
    override = (url, init) => {
      if (init?.method !== "PUT") return undefined;
      // The server keeps the edit, so the reload after the save agrees.
      suppliers = suppliers.map((s) => (s.id === "s2" ? { ...s, contactName: "Ms. Sato" } : s));
      return json(suppliers[1]);
    };
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(within(rowOf("YASUDA SEIKI CO., LTD.")).getByRole("button", { name: /แก้ไข/ }));
    fireEvent.change(screen.getByLabelText("ผู้ติดต่อ"), { target: { value: "Ms. Sato" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/บันทึกการแก้ไขแล้ว/)).toBeInTheDocument();

    const put = callsOf(vi.mocked(fetch) as never, "PUT");
    expect(put).toHaveLength(1);
    expect(String(put[0][0])).toBe("/api/suppliers/s2");
    expect(JSON.parse(String(put[0][1]!.body))).toEqual({
      companyName: "YASUDA SEIKI CO., LTD.",
      contactName: "Ms. Sato",
      phone: "+81-6-1234",
      taxId: "",
      address: "",
      note: "",
    });
    expect(within(rowOf("YASUDA SEIKI CO., LTD.")).getByText("Ms. Sato")).toBeInTheDocument();
  });
});

describe("/suppliers — the company name and duplicates", () => {
  it("an empty name is said under the field, the cursor is put there, and nothing is sent", async () => {
    await openAdd();
    // The admin is further down the form (jsdom's click moves no focus, so
    // it is moved here — the name box has it from the start).
    (screen.getByLabelText("หมายเหตุ") as HTMLTextAreaElement).focus();
    expect(document.activeElement).not.toBe(nameBox());
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(within(dialog()).getByText("กรุณากรอกชื่อบริษัท")).toBeInTheDocument();
    expect(nameBox()).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(nameBox());
    expect(callsOf(vi.mocked(fetch) as never, "POST")).toHaveLength(0);
  });

  it("warns of a name or tax ID already there — and still saves when asked", async () => {
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "บริษัท  อิมาดะ  จำกัด" } });
    expect(screen.getByTestId("duplicate-name")).toHaveTextContent("มีซัพพลายเออร์ชื่อนี้อยู่แล้ว: บริษัท อิมาดะ จำกัด");
    fireEvent.change(screen.getByLabelText("เลขผู้เสียภาษี"), { target: { value: "0-1055-56123-45-6" } });
    expect(screen.getByTestId("duplicate-taxid")).toHaveTextContent("เลขนี้ใช้กับ บริษัท อิมาดะ จำกัด อยู่แล้ว");

    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(callsOf(vi.mocked(fetch) as never, "POST")).toHaveLength(1));
  });

  it("never warns about the supplier being edited", async () => {
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(within(rowOf("บริษัท อิมาดะ จำกัด")).getByRole("button", { name: /แก้ไข/ }));
    expect(nameBox().value).toBe("บริษัท อิมาดะ จำกัด");
    expect(screen.queryByTestId("duplicate-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("duplicate-taxid")).not.toBeInTheDocument();
  });

  it("stops typing at the column's length instead of cutting it short on save", async () => {
    await openAdd();
    expect(nameBox().maxLength).toBe(255);
    expect((screen.getByLabelText("ที่อยู่") as HTMLTextAreaElement).maxLength).toBe(2000);
    expect((screen.getByLabelText("หมายเหตุ") as HTMLTextAreaElement).maxLength).toBe(5000);
  });
});

describe("/suppliers — the list", () => {
  const searchBox = () => screen.getByRole("textbox", { name: "ค้นหาซัพพลายเออร์" }) as HTMLInputElement;
  const listedNames = () =>
    screen.getAllByRole("row", { name: /^ดูข้อมูล / }).map((r) => r.querySelector("td p")?.textContent);

  it("counts the suppliers, and how many a search found", async () => {
    render(<SuppliersPage />);
    await loaded();
    expect(screen.getByTestId("supplier-count")).toHaveTextContent("(2)");
    fireEvent.change(searchBox(), { target: { value: "tanaka" } });
    expect(screen.getByTestId("supplier-count")).toHaveTextContent("(พบ 1 จาก 2)");
  });

  it("searches the contact, the phone however typed, the tax ID and the linked products", async () => {
    render(<SuppliersPage />);
    await loaded();
    const search = (q: string) => {
      fireEvent.change(searchBox(), { target: { value: q } });
      return listedNames();
    };
    expect(search("Tanaka")).toEqual(["YASUDA SEIKI CO., LTD."]);
    expect(search("021234567")).toEqual(["บริษัท อิมาดะ จำกัด"]);
    expect(search("0-1055-56123")).toEqual(["บริษัท อิมาดะ จำกัด"]);
    expect(search("สินค้า 3 & อะไหล่")).toEqual(["บริษัท อิมาดะ จำกัด"]);
  });

  it("a search that finds nothing says so, and ล้างคำค้น — or ✕ — brings the list back", async () => {
    render(<SuppliersPage />);
    await loaded();
    fireEvent.change(searchBox(), { target: { value: "ไม่มีชื่อนี้" } });
    expect(screen.getByText("ไม่พบซัพพลายเออร์ที่ตรงกับคำค้น")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีซัพพลายเออร์")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "ล้างคำค้น" })[1]); // the one under the message
    expect(searchBox().value).toBe("");
    expect(listedNames()).toHaveLength(2);

    fireEvent.change(searchBox(), { target: { value: "x" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ล้างคำค้น" })[0]); // the ✕ in the box
    expect(searchBox().value).toBe("");
    expect(screen.queryByRole("button", { name: "ล้างคำค้น" })).not.toBeInTheDocument();
  });

  it("no suppliers at all is not a failed search: it offers to add the first", async () => {
    suppliers = [];
    render(<SuppliersPage />);
    expect(await screen.findByText("ยังไม่มีซัพพลายเออร์")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ เพิ่มซัพพลายเออร์รายแรก" }));
    expect(dialog()).toBeInTheDocument();
    expect(nameBox().value).toBe("");
  });

  it("sorts by a clicked header: names first A→Z then back, products most first", async () => {
    render(<SuppliersPage />);
    await loaded();
    expect(listedNames()).toEqual(["บริษัท อิมาดะ จำกัด", "YASUDA SEIKI CO., LTD."]); // the API's order
    const header = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("th")!;

    fireEvent.click(within(header("ชื่อบริษัท")).getByRole("button"));
    expect(header("ชื่อบริษัท")).toHaveAttribute("aria-sort", "ascending");
    expect(listedNames()).toEqual(["บริษัท อิมาดะ จำกัด", "YASUDA SEIKI CO., LTD."]);
    fireEvent.click(within(header("ชื่อบริษัท")).getByRole("button"));
    expect(header("ชื่อบริษัท")).toHaveAttribute("aria-sort", "descending");
    expect(listedNames()).toEqual(["YASUDA SEIKI CO., LTD.", "บริษัท อิมาดะ จำกัด"]);

    fireEvent.click(within(header("สินค้า")).getByRole("button"));
    expect(header("สินค้า")).toHaveAttribute("aria-sort", "descending");
    expect(header("ชื่อบริษัท")).toHaveAttribute("aria-sort", "none");
    expect(listedNames()).toEqual(["บริษัท อิมาดะ จำกัด", "YASUDA SEIKI CO., LTD."]);
  });

  it("shows each supplier's number of linked products", async () => {
    render(<SuppliersPage />);
    await loaded();
    expect(within(rowOf("บริษัท อิมาดะ จำกัด")).getByTestId("product-count")).toHaveTextContent("7");
    expect(within(rowOf("YASUDA SEIKI CO., LTD.")).getByTestId("product-count")).toHaveTextContent("-");
  });

  it("flags what a purchase order would print blank — a tax ID only for a Thai-named supplier", async () => {
    suppliers = [
      ...suppliersFixture(),
      { ...suppliersFixture()[1], id: "s3", companyName: "หจก. ไทยสเกล", address: "", taxId: "" },
    ];
    render(<SuppliersPage />);
    await loaded();
    expect(within(rowOf("บริษัท อิมาดะ จำกัด")).queryByText(/^ไม่มี/)).not.toBeInTheDocument();
    expect(within(rowOf("YASUDA SEIKI CO., LTD.")).getByText("ไม่มีที่อยู่")).toBeInTheDocument();
    expect(within(rowOf("YASUDA SEIKI CO., LTD.")).queryByText("ไม่มีเลขภาษี")).not.toBeInTheDocument();
    expect(within(rowOf("หจก. ไทยสเกล")).getByText("ไม่มีที่อยู่")).toBeInTheDocument();
    expect(within(rowOf("หจก. ไทยสเกล")).getByText("ไม่มีเลขภาษี")).toBeInTheDocument();
  });

  it("a row opens with Enter from the keyboard — it used to be mouse-only", async () => {
    render(<SuppliersPage />);
    await loaded();
    const row = screen.getByRole("row", { name: "ดูข้อมูล บริษัท อิมาดะ จำกัด" });
    expect(row).toHaveAttribute("tabindex", "0");
    expect(screen.queryByText("กรุงเทพฯ")).not.toBeInTheDocument(); // the address is not in the list
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByText("กรุงเทพฯ")).toBeInTheDocument();
  });

  it("a click on the phone copies it, says so, and does not open the supplier", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(within(rowOf("บริษัท อิมาดะ จำกัด")).getByRole("button", { name: "คัดลอก 02-123-4567" }));
    expect(writeText).toHaveBeenCalledWith("02-123-4567");
    expect(await screen.findByText(/คัดลอกแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText("กรุงเทพฯ")).not.toBeInTheDocument();
  });

  it("leaves room under the list for the admin bell", async () => {
    const { container } = render(<SuppliersPage />);
    await loaded();
    expect(container.firstElementChild).toHaveClass("pb-32");
  });
});

describe("/suppliers — the form", () => {
  const postCount = () => callsOf(vi.mocked(fetch) as never, "POST").length;

  it("starts with the cursor in the company name", async () => {
    await openAdd();
    expect(document.activeElement).toBe(nameBox());
  });

  it("saves on the form's submit — what Enter in a field does — through a submit button", async () => {
    await openAdd();
    const form = nameBox().closest("form")!;
    expect(form).toBe(dialog());
    expect(within(form).getByRole("button", { name: "บันทึก" })).toHaveAttribute("type", "submit");
    expect(within(form).getByRole("button", { name: "ยกเลิก" })).toHaveAttribute("type", "button");
    fireEvent.change(nameBox(), { target: { value: "บริษัท ใหม่ จำกัด" } });
    fireEvent.submit(form);
    await waitFor(() => expect(postCount()).toBe(1));
  });

  it("saves with Ctrl + Enter from the note, where Enter is a new line", async () => {
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "บริษัท ใหม่ จำกัด" } });
    const note = screen.getByLabelText("หมายเหตุ");
    fireEvent.keyDown(note, { key: "Enter" });
    expect(postCount()).toBe(0);
    fireEvent.keyDown(note, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(postCount()).toBe(1));
  });

  it("Esc closes at once when nothing was typed", async () => {
    await openAdd();
    fireEvent.keyDown(nameBox(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before throwing typing away — Esc, ✕, ยกเลิก and the backdrop alike", async () => {
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "บริษัท ใหม่ จำกัด" } });
    const closers = [
      () => fireEvent.keyDown(nameBox(), { key: "Escape" }),
      () => fireEvent.click(within(dialog()).getByRole("button", { name: "ปิด" })),
      () => fireEvent.click(within(dialog()).getByRole("button", { name: "ยกเลิก" })),
      () => fireEvent.click(screen.getByTestId("supplier-editor-backdrop")),
    ];
    for (const close of closers) {
      close();
      expect(screen.getByText("สิ่งที่แก้ไว้จะหายไป ปิดหน้าต่างนี้เลยไหม?")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "กลับไปแก้ต่อ" }));
      expect(screen.queryByText("สิ่งที่แก้ไว้จะหายไป ปิดหน้าต่างนี้เลยไหม?")).not.toBeInTheDocument();
      expect(nameBox().value).toBe("บริษัท ใหม่ จำกัด");
    }
    fireEvent.keyDown(nameBox(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postCount()).toBe(0);
  });

  it("warns the browser's way on a refresh only while there is typing to lose", async () => {
    await openAdd();
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    fireEvent.change(nameBox(), { target: { value: "x" } });
    expect(unload()).toBe(true);
    fireEvent.change(nameBox(), { target: { value: "" } });
    expect(unload()).toBe(false);
  });

  it("an edit's title names the supplier it is editing — as it was", async () => {
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(within(rowOf("YASUDA SEIKI CO., LTD.")).getByRole("button", { name: /แก้ไข/ }));
    expect(screen.getByTestId("editor-subject")).toHaveTextContent("YASUDA SEIKI CO., LTD.");
    fireEvent.change(nameBox(), { target: { value: "YASUDA (ใหม่)" } });
    expect(screen.getByTestId("editor-subject")).toHaveTextContent("YASUDA SEIKI CO., LTD.");
  });

  it("a new supplier's form has no such line", async () => {
    await openAdd();
    expect(screen.queryByTestId("editor-subject")).not.toBeInTheDocument();
  });

  it("checks a Thai tax ID once the box is left — and still saves it", async () => {
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "บริษัท ใหม่ จำกัด" } });
    const tax = screen.getByLabelText("เลขผู้เสียภาษี");
    fireEvent.focus(tax);
    fireEvent.change(tax, { target: { value: "01075" } });
    expect(screen.queryByTestId("taxid-warning")).not.toBeInTheDocument(); // still typing
    fireEvent.blur(tax);
    expect(screen.getByTestId("taxid-warning")).toHaveTextContent("เลขผู้เสียภาษีของไทยมี 13 หลัก (ตอนนี้ 5 หลัก)");

    fireEvent.focus(tax);
    fireEvent.change(tax, { target: { value: "0-1075-37000-11-4" } });
    fireEvent.blur(tax);
    expect(screen.queryByTestId("taxid-warning")).not.toBeInTheDocument(); // a real one

    fireEvent.change(tax, { target: { value: "0107537000115" } });
    expect(screen.getByTestId("taxid-warning")).toHaveTextContent("เลขนี้อาจพิมพ์ผิด");
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(postCount()).toBe(1)); // a warning, not a refusal
  });

  it("shows a stored tax ID's typo as soon as the form opens", async () => {
    render(<SuppliersPage />);
    await loaded();
    // 0105556123456: its last digit should be 3.
    fireEvent.click(within(rowOf("บริษัท อิมาดะ จำกัด")).getByRole("button", { name: /แก้ไข/ }));
    expect(screen.getByTestId("taxid-warning")).toHaveTextContent("เลขนี้อาจพิมพ์ผิด");
  });

  it("says that editing never changes a purchase order already issued", async () => {
    await openAdd();
    const note = screen.getByTestId("po-note");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent("แก้ที่นี่ไม่เปลี่ยนใบสั่งซื้อที่ออกไปแล้ว");
  });

  it("gives the focus back to what opened it — the add button, or the row its window came from", async () => {
    render(<SuppliersPage />);
    await loaded();
    const add = screen.getByRole("button", { name: "เพิ่มซัพพลายเออร์" });
    add.focus();
    fireEvent.click(add);
    fireEvent.click(within(dialog()).getByRole("button", { name: "ยกเลิก" }));
    expect(document.activeElement).toBe(add);

    const row = screen.getByRole("row", { name: "ดูข้อมูล YASUDA SEIKI CO., LTD." });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /แก้ไข/ }));
    expect(document.activeElement).toBe(nameBox()); // the form, not the row, has it now
    fireEvent.keyDown(nameBox(), { key: "Escape" });
    expect(document.activeElement).toBe(row);
  });
});

describe("/suppliers — a supplier's window", () => {
  async function openWindow(name: string) {
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(rowOf(name));
    return screen.getByRole("dialog", { name });
  }

  it("is a dialog named for the supplier, its details labelled in Thai, left to right", async () => {
    const win = await openWindow("บริษัท อิมาดะ จำกัด");
    const labels = Array.from(win.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(labels).toEqual(["ผู้ติดต่อ", "เบอร์โทร", "ที่อยู่", "เลขผู้เสียภาษี"]);
    const values = Array.from(win.querySelectorAll("dd")).map((dd) => dd.textContent);
    expect(values).toEqual(["คุณสมชาย", "02-123-4567", "กรุงเทพฯ", "0105556123456"]);
    expect(win.textContent).not.toMatch(/Contact Person|Phone Number|Linked Products|Tax ID|Close/i);
  });

  it("lists every linked product, each opening its product in a new tab", async () => {
    suppliers = suppliersFixture();
    suppliers[0].linkedProducts = [...suppliers[0].linkedProducts, { id: "p-untitled", title_th: "<p></p>", title_en: "" }];
    const win = await openWindow("บริษัท อิมาดะ จำกัด");
    expect(within(win).getByText("สินค้าที่ผูกไว้ (8)")).toBeInTheDocument();
    const link = within(win).getByRole("link", { name: "สินค้า 1 & อะไหล่" });
    expect(link).toHaveAttribute("href", "/edit-product/p1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(win).getByRole("link", { name: "(สินค้าไม่มีชื่อ)" })).toHaveAttribute("href", "/edit-product/p-untitled");
  });

  it("says when no product is linked, and what a PO would print blank", async () => {
    const win = await openWindow("YASUDA SEIKI CO., LTD.");
    expect(within(win).getByText(/ยังไม่มีสินค้าที่ผูกกับซัพพลายเออร์นี้/)).toBeInTheDocument();
    expect(within(win).getByTestId("supplier-missing-po")).toHaveTextContent("ใบสั่งซื้อที่ออกให้ซัพพลายเออร์นี้จะยังไม่มีที่อยู่ — กด “แก้ไข” เพื่อเพิ่ม");
  });

  it("starts a purchase order with this supplier picked", async () => {
    const win = await openWindow("บริษัท อิมาดะ จำกัด");
    expect(within(win).getByRole("link", { name: /สร้างใบสั่งซื้อ/ })).toHaveAttribute("href", "/purchase-order?supplierId=s1");
  });

  it("แก้ไข closes the window and opens this supplier's form", async () => {
    const win = await openWindow("YASUDA SEIKI CO., LTD.");
    fireEvent.click(within(win).getByRole("button", { name: /แก้ไข/ }));
    expect(screen.queryByRole("dialog", { name: "YASUDA SEIKI CO., LTD." })).not.toBeInTheDocument();
    expect(nameBox().value).toBe("YASUDA SEIKI CO., LTD.");
    expect((screen.getByLabelText("ผู้ติดต่อ") as HTMLInputElement).value).toBe("Mr. Tanaka");
  });

  it("closes with Esc, the backdrop, ✕ and ปิด — and gives the focus back to the row", async () => {
    render(<SuppliersPage />);
    await loaded();
    const row = screen.getByRole("row", { name: "ดูข้อมูล บริษัท อิมาดะ จำกัด" });
    const reopen = () => {
      row.focus();
      fireEvent.keyDown(row, { key: "Enter" });
      return screen.getByRole("dialog", { name: "บริษัท อิมาดะ จำกัด" });
    };

    let win = reopen();
    expect(document.activeElement).toBe(win); // focus moves into the window
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);

    reopen();
    fireEvent.click(screen.getByTestId("supplier-view-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    win = reopen();
    const [cross, closeButton] = within(win).getAllByRole("button", { name: "ปิด" });
    expect(cross).toHaveAttribute("aria-label", "ปิด"); // ✕ in the header
    fireEvent.click(cross);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    win = reopen();
    fireEvent.click(within(win).getAllByRole("button", { name: "ปิด" })[1]); // ปิด at the bottom
    expect(closeButton).not.toBeInTheDocument(); // the old window's button went with it
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);
  });

  it("copies the tax ID from the window", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const win = await openWindow("บริษัท อิมาดะ จำกัด");
    fireEvent.click(within(win).getByRole("button", { name: "คัดลอก 0105556123456" }));
    expect(writeText).toHaveBeenCalledWith("0105556123456");
    expect(await screen.findByText(/คัดลอกแล้ว/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "บริษัท อิมาดะ จำกัด" })).toBeInTheDocument(); // still open
  });
});

// One word for one thing: the page said ผู้ผลิตสินค้า in its title, รายชื่อ on its
// buttons and ซัพพลายเออร์ in its messages — and ผู้ผลิต again when empty.
describe("/suppliers — one word: ซัพพลายเออร์", () => {
  const noOldWords = () => {
    expect(document.body.textContent).not.toMatch(/ผู้ผลิต|รายชื่อใหม่|เพิ่มรายชื่อ|แก้ไขรายชื่อ|Suppliers/);
  };

  it("in the title, the buttons and both forms", async () => {
    render(<SuppliersPage />);
    await loaded();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^ซัพพลายเออร์$/);
    noOldWords();

    fireEvent.click(screen.getByRole("button", { name: "เพิ่มซัพพลายเออร์" }));
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent(/^เพิ่มซัพพลายเออร์$/);
    noOldWords();
    fireEvent.keyDown(nameBox(), { key: "Escape" });

    fireEvent.click(within(rowOf("YASUDA SEIKI CO., LTD.")).getByRole("button", { name: /แก้ไข/ }));
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent(/^แก้ไขซัพพลายเออร์$/);
    noOldWords();
  });

  it("in the window, the delete question and an empty list", async () => {
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(rowOf("บริษัท อิมาดะ จำกัด"));
    noOldWords();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "ลบ บริษัท อิมาดะ จำกัด" }));
    expect(screen.getByText("ยืนยันการลบซัพพลายเออร์")).toBeInTheDocument();
    noOldWords();
  });

  it("when there are none yet", async () => {
    suppliers = [];
    render(<SuppliersPage />);
    await screen.findByText("ยังไม่มีซัพพลายเออร์");
    noOldWords();
  });
});

describe("/suppliers — delete", () => {
  it("says how many linked products lose the supplier, names five, and deletes ONCE", async () => {
    const del = deferred<unknown>();
    override = (url, init) => (init?.method === "DELETE" ? del.promise : undefined);
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ บริษัท อิมาดะ จำกัด" }));

    const message = screen.getByText(/ผูกกับสินค้า 7 รายการ/).textContent!;
    expect(message).toContain('ลบ "บริษัท อิมาดะ จำกัด"? ลบแล้วกู้คืนไม่ได้');
    expect(message).toContain("• สินค้า 1 & อะไหล่");
    expect(message).toContain("• สินค้า 5 & อะไหล่");
    expect(message).not.toContain("สินค้า 6");
    expect(message).toContain("…และอีก 2 รายการ");
    expect(message).toContain("ใบสั่งซื้อที่ออกไปแล้ว และทรัพย์สิน/สต็อกที่อ้างถึง ยังแสดงชื่อเดิม");

    const confirm = screen.getByRole("button", { name: "ลบ" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(screen.getByRole("button", { name: /กำลังลบ/ })).toBeDisabled();
    expect(callsOf(vi.mocked(fetch) as never, "DELETE")).toHaveLength(1);
    expect(String(callsOf(vi.mocked(fetch) as never, "DELETE")[0][0])).toBe("/api/suppliers/s1");

    suppliers = suppliersFixture().slice(1);
    del.resolve(json({ success: true }));
    expect(await screen.findByText(/ลบซัพพลายเออร์แล้ว/)).toBeInTheDocument();
    expect(screen.queryByText("บริษัท อิมาดะ จำกัด")).not.toBeInTheDocument();
    expect(screen.queryByText(/ผูกกับสินค้า 7 รายการ/)).not.toBeInTheDocument(); // the question is gone
  });

  it("a supplier with no linked products is not said to have any", async () => {
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ YASUDA SEIKI CO., LTD." }));
    expect(screen.getByText(/ลบ "YASUDA SEIKI CO., LTD."\?/).textContent).not.toContain("ผูกกับสินค้า");
  });

  it("a refused delete keeps the supplier and says why", async () => {
    override = (url, init) => (init?.method === "DELETE" ? json({ error: "ลบซัพพลายเออร์ไม่สำเร็จ" }, 500) : undefined);
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ บริษัท อิมาดะ จำกัด" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(await screen.findByText(/ลบซัพพลายเออร์ไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getByText("บริษัท อิมาดะ จำกัด")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบ" })).toBeEnabled(); // still open, to try again
  });

  it("one already deleted elsewhere leaves the list and says so", async () => {
    override = (url, init) => (init?.method === "DELETE" ? json({ error: "ไม่พบซัพพลายเออร์นี้" }, 404) : undefined);
    render(<SuppliersPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ บริษัท อิมาดะ จำกัด" }));
    suppliers = suppliersFixture().slice(1);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(await screen.findByText(/ซัพพลายเออร์นี้ถูกลบไปแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText("บริษัท อิมาดะ จำกัด")).not.toBeInTheDocument();
  });
});
