/**
 * /product-specs: specs grouped by product, search and product filter, the
 * products still without a spec, the editor (new / edit / copy) with its
 * checks and keys, delete, load failures and the toast.
 */
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ProductSpecsPage from "@/app/product-specs/page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/product-specs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

const PRODUCTS = [
  { id: "utm", title_th: "<p>เครื่องทดสอบแรงดึง Universal Testing Machine รุ่น UTM-5000</p>", title_en: "UTM" },
  { id: "px", title_th: "<p>เครื่องชั่ง PX-3000</p>", title_en: "PX" },
  { id: "oven", title_th: "<p>ตู้อบ 🐧</p>", title_en: "Oven" },
];
const LONG = "Capacity: 5 kN\nAccuracy: ±0.5%\nSpeed: 0.001 – 500 mm/min\nPower: 220V";

function specsFixture() {
  return [
    { id: "s50", productId: "utm", name: "สเปค 50kN", detail: "Capacity: 50 kN", createdAt: "2025-01-01" },
    { id: "spx", productId: "px", name: "ชั่งได้ 3 กก.", detail: "Capacity 3000 g", createdAt: "2025-01-02" },
    { id: "s5", productId: "utm", name: "สเปค 5kN", detail: LONG, createdAt: "2025-01-03" },
    { id: "sgone", productId: "gone", name: "สเปคเก่า", detail: "เลิกขาย", createdAt: "2025-01-04" },
  ];
}

type Handler = (url: string, init?: RequestInit) => unknown;
let specs = specsFixture();
let products: unknown = PRODUCTS;
let override: Handler | null = null;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = override?.(url, init);
    if (custom !== undefined) return custom;
    if (url === "/api/product-specs" && (!init?.method || init.method === "GET")) return json({ data: specs });
    if (url === "/api/products") return json(products);
    return json({ success: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const groups = () => screen.getAllByTestId("spec-group");
const groupTitles = () => groups().map((g) => g.querySelector("th span")?.textContent);
const specNames = (group: HTMLElement) =>
  within(group).getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
const dialog = () => screen.getByRole("dialog");
const nameBox = () => screen.getByLabelText(/หัวข้อสเปค/) as HTMLInputElement;
const detailBox = () => screen.getByLabelText(/รายละเอียด/) as HTMLTextAreaElement;

async function loaded() {
  await screen.findByText("สเปค 5kN");
}

beforeEach(() => {
  specs = specsFixture();
  products = PRODUCTS;
  override = null;
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("/product-specs — the list", () => {
  it("groups specs by product, products A→Z with a missing one last, specs 5 before 50", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    expect(groupTitles()).toEqual([
      "เครื่องชั่ง PX-3000",
      "เครื่องทดสอบแรงดึง Universal Testing Machine รุ่น UTM-5000",
      "ไม่พบสินค้า",
    ]);
    expect(specNames(groups()[1])).toEqual(["สเปค 5kN", "สเปค 50kN"]);
    expect(within(groups()[1]).getByText("2 สเปค")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /สเปคทั้งหมด/ }).textContent).toContain("(4)");
    // The full product name — it used to be cut at 200px.
    expect(screen.queryByText(/Univ\.\.\./)).not.toBeInTheDocument();
  });

  it("a group of a missing product has no add button; the others do", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    expect(within(groups()[2]).queryByRole("button", { name: /เพิ่มสเปคให้/ })).not.toBeInTheDocument();
    fireEvent.click(within(groups()[0]).getByRole("button", { name: "เพิ่มสเปคให้ เครื่องชั่ง PX-3000" }));
    expect(within(dialog()).getByRole("heading", { name: "เพิ่มสเปคใหม่" })).toBeInTheDocument();
    expect(within(dialog()).getByText("เครื่องชั่ง PX-3000")).toBeInTheDocument();
  });

  it("cuts a long detail to three lines with ดูเพิ่ม / ย่อ, without opening the spec", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    const longRow = screen.getByRole("row", { name: "แก้ไขสเปค สเปค 5kN" });
    const detail = within(longRow).getByTestId("spec-detail");
    expect(detail.className).toContain("line-clamp-3");
    const more = within(longRow).getByRole("button", { name: "ดูเพิ่ม" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(detail.className).not.toContain("line-clamp-3");
    expect(within(longRow).getByRole("button", { name: "ย่อ" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A short one is shown whole, with no button.
    const shortRow = screen.getByRole("row", { name: "แก้ไขสเปค สเปค 50kN" });
    expect(within(shortRow).getByTestId("spec-detail").className).not.toContain("line-clamp-3");
    expect(within(shortRow).queryByRole("button", { name: "ดูเพิ่ม" })).not.toBeInTheDocument();
  });

  it("searches the product, heading and detail", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    const box = screen.getByRole("textbox", { name: "ค้นหาสเปค" });
    fireEvent.change(box, { target: { value: "px-3000" } });
    expect(groupTitles()).toEqual(["เครื่องชั่ง PX-3000"]);
    fireEvent.change(box, { target: { value: "±0.5" } });
    expect(specNames(groups()[0])).toEqual(["สเปค 5kN"]);
    expect(screen.getByRole("heading", { level: 2, name: /สเปคทั้งหมด/ }).textContent).toContain("(1)");
  });

  it("a search that finds nothing says so, and clearing brings everything back", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "ค้นหาสเปค" }), { target: { value: "ไม่มีคำนี้" } });
    expect(screen.getByText("ไม่พบสเปคที่ตรงกับคำค้น")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีสเปค")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ล้างคำค้น" }));
    expect(groups()).toHaveLength(3);
    expect((screen.getByRole("textbox", { name: "ค้นหาสเปค" }) as HTMLInputElement).value).toBe("");
  });

  it("narrows to one product from the picker", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(within(screen.getByTestId("product-filter")).getByRole("button"));
    fireEvent.click(await screen.findByRole("button", { name: "เครื่องชั่ง PX-3000" }));
    expect(groupTitles()).toEqual(["เครื่องชั่ง PX-3000"]);
    // "เพิ่มสเปค" now starts with that product picked.
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มสเปค" }));
    expect(within(dialog()).getByText("เครื่องชั่ง PX-3000")).toBeInTheDocument();
  });

  it("a picked product with no spec offers to add one, or to see every product", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(within(screen.getByTestId("product-filter")).getByRole("button"));
    fireEvent.click(await screen.findByRole("button", { name: "ตู้อบ" }));
    expect(screen.getByText("สินค้านี้ยังไม่มีสเปค")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ดูทุกสินค้า" }));
    expect(groups()).toHaveLength(3);
  });

  it("says there are no specs yet when there are none", async () => {
    specs = [];
    render(<ProductSpecsPage />);
    expect(await screen.findByText("ยังไม่มีสเปค")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ เพิ่มสเปคแรก" }));
    expect(within(dialog()).getByRole("heading", { name: "เพิ่มสเปคใหม่" })).toBeInTheDocument();
  });

  it("lists the products still without a spec, each one a click from a new spec", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    const toggle = screen.getByRole("button", { name: /สินค้าที่ยังไม่มีสเปค/ });
    expect(toggle.textContent).toContain("1");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const panel = screen.getByTestId("products-without-specs");
    expect(within(panel).getByText("ตู้อบ")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "เพิ่มสเปคให้ ตู้อบ" }));
    expect(within(dialog()).getByText("ตู้อบ")).toBeInTheDocument();
  });

  it("says when every product has a spec", async () => {
    specs = [...specsFixture(), { id: "so", productId: "oven", name: "100 ลิตร", detail: "x", createdAt: "2025-02-01" }];
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /สินค้าที่ยังไม่มีสเปค/ }));
    expect(screen.getByTestId("products-without-specs").textContent).toContain("สินค้าทุกตัวมีสเปคแล้ว");
  });
});

describe("/product-specs — loading", () => {
  it("says the load failed — not 'no specs' — and retries", async () => {
    let fail = true;
    override = (url) => (url === "/api/product-specs" && fail ? json({ error: "x" }, 500) : undefined);
    render(<ProductSpecsPage />);
    expect(await screen.findByText("โหลดสเปคไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีสเปค")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    await loaded();
    expect(screen.queryByText("โหลดสเปคไม่สำเร็จ")).not.toBeInTheDocument();
  });

  it("still loads the products when the specs fail, so a new spec can be added", async () => {
    override = (url) => (url === "/api/product-specs" ? json({ error: "x" }, 500) : undefined);
    render(<ProductSpecsPage />);
    await screen.findByText("โหลดสเปคไม่สำเร็จ");
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มสเปค" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: /เลือกสินค้า/ }));
    expect(await screen.findByRole("button", { name: "เครื่องชั่ง PX-3000" })).toBeInTheDocument();
  });

  it("applies only the latest load — an older one answering late cannot undo a delete", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    let releaseOld: () => void = () => {};
    let gets = 0;
    override = (url, init) => {
      if (url !== "/api/product-specs" || init?.method) return undefined;
      gets++;
      // The save's reload answers last, with the list from before the delete.
      if (gets === 1) {
        const before = specsFixture();
        return new Promise((r) => { releaseOld = () => r(json({ data: before })); });
      }
      return undefined;
    };
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 5kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(gets).toBe(1));

    specs = specs.filter((x) => x.id !== "s50");
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 50kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(screen.queryByText("สเปค 50kN")).not.toBeInTheDocument());

    await act(async () => { releaseOld(); });
    expect(screen.queryByText("สเปค 50kN")).not.toBeInTheDocument();
  });

  it("a network error is a failed load too", async () => {
    override = (url) => (url === "/api/product-specs" ? Promise.reject(new TypeError("offline")) : undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ProductSpecsPage />);
    expect(await screen.findByText("โหลดสเปคไม่สำเร็จ")).toBeInTheDocument();
  });

  it("says when the product names failed, and still shows the specs", async () => {
    override = (url) => (url === "/api/products" ? json({ error: "x" }, 500) : undefined);
    render(<ProductSpecsPage />);
    await loaded();
    expect(screen.getByRole("alert").textContent).toContain("โหลดรายชื่อสินค้าไม่สำเร็จ");
    expect(groupTitles().every((t) => t === "ไม่พบสินค้า")).toBe(true);
    // No "products without a spec" when the products are unknown.
    expect(screen.queryByRole("button", { name: /สินค้าที่ยังไม่มีสเปค/ })).not.toBeInTheDocument();
  });

  it("an expired session goes to the login page", async () => {
    override = (url) => (url === "/api/product-specs" ? json({ error: "x" }, 401) : undefined);
    render(<ProductSpecsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

describe("/product-specs — the editor", () => {
  it("opens a spec from its row by click, Enter or Space", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    const row = screen.getByRole("row", { name: "แก้ไขสเปค สเปค 50kN" });
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(within(dialog()).getByRole("heading", { name: "แก้ไขสเปค" })).toBeInTheDocument();
    expect(nameBox().value).toBe("สเปค 50kN");
    expect(detailBox().value).toBe("Capacity: 50 kN");
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("row", { name: "แก้ไขสเปค ชั่งได้ 3 กก." }), { key: " " });
    expect(nameBox().value).toBe("ชั่งได้ 3 กก.");
  });

  it("names each missing field instead of a vague error, and sends nothing", async () => {
    const fetchMock = installFetch();
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มสเปค" }));
    fireEvent.change(nameBox(), { target: { value: "   " } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(within(dialog()).getByText("กรุณาเลือกสินค้า")).toBeInTheDocument();
    expect(within(dialog()).getByText("กรุณากรอกหัวข้อสเปค")).toBeInTheDocument();
    expect(within(dialog()).getByText("กรุณากรอกรายละเอียด")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("saves an edit with a trimmed heading, closes, says so, and reloads", async () => {
    const fetchMock = installFetch();
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.change(nameBox(), { target: { value: "  สเปค 50kN ใหม่  " } });
    specs = specs.map((s) => (s.id === "s50" ? { ...s, name: "สเปค 50kN ใหม่" } : s));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));

    expect(await screen.findByText(/บันทึกสเปคแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toBe("/api/product-specs/s50");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ productId: "utm", name: "สเปค 50kN ใหม่", detail: "Capacity: 50 kN" });
    expect(await screen.findByText("สเปค 50kN ใหม่")).toBeInTheDocument();
  });

  it("saves with Ctrl+Enter, once, however often it is pressed", async () => {
    let release: () => void = () => {};
    const posts: unknown[] = [];
    override = (url, init) => {
      if (init?.method === "POST") {
        posts.push(init.body);
        return new Promise((r) => { release = () => r(json({ data: {} }, 201)); });
      }
      return undefined;
    };
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(within(groups()[0]).getByRole("button", { name: /เพิ่มสเปคให้/ }));
    fireEvent.change(nameBox(), { target: { value: "ชั่งได้ 6 กก." } });
    fireEvent.change(detailBox(), { target: { value: "Capacity 6000 g" } });
    fireEvent.keyDown(detailBox(), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(detailBox(), { key: "Enter", ctrlKey: true });
    fireEvent.click(within(dialog()).getByRole("button", { name: "กำลังบันทึก..." }));
    expect(within(dialog()).getByRole("button", { name: "กำลังบันทึก..." })).toBeDisabled();
    await act(async () => { release(); });
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]))).toEqual({ productId: "px", name: "ชั่งได้ 6 กก.", detail: "Capacity 6000 g" });
  });

  it("a spec opened while the list reloads after a save can be saved at once", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    // From here the list reload never answers.
    override = (url, init) => (url === "/api/product-specs" && !init?.method ? new Promise(() => {}) : undefined);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "แก้ไข ชั่งได้ 3 กก." }));
    expect(within(dialog()).getByRole("button", { name: "บันทึก" })).toBeEnabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a spec can be deleted while the list reloads after another delete", async () => {
    let deletes = 0;
    render(<ProductSpecsPage />);
    await loaded();
    override = (url, init) => {
      if (init?.method === "DELETE") { deletes++; return json({ success: true }); }
      return url === "/api/product-specs" && !init?.method ? new Promise(() => {}) : undefined;
    };
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 50kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(screen.queryByText("ยืนยันการลบสเปค")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "ลบ ชั่งได้ 3 กก." }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(deletes).toBe(2));
  });

  it("shows a saved edit at once, as the API stored it, before the reload answers", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    override = (url, init) => {
      if (init?.method === "PUT") return json({ data: { id: "s50", productId: "utm", name: "สเปค 50kN (จัดเก็บแล้ว)", detail: "Capacity: 50 kN" } });
      return url === "/api/product-specs" && !init?.method ? new Promise(() => {}) : undefined;
    };
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.change(nameBox(), { target: { value: "สเปค 50kN ใหม่" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("สเปค 50kN (จัดเก็บแล้ว)")).toBeInTheDocument();
    expect(screen.queryByText("สเปค 50kN")).not.toBeInTheDocument();
  });

  it("a copy saved on a slow line counts for the next copy's heading", async () => {
    let n = 0;
    render(<ProductSpecsPage />);
    await loaded();
    override = (url, init) => {
      if (init?.method === "POST") {
        n++;
        const body = JSON.parse(String(init.body));
        return json({ data: { id: `new${n}`, ...body, createdAt: "2026-01-01" } }, 201);
      }
      return url === "/api/product-specs" && !init?.method ? new Promise(() => {}) : undefined;
    };
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนา สเปค 5kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("สเปค 5kN (สำเนา)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนา สเปค 5kN" }));
    expect(nameBox().value).toBe("สเปค 5kN (สำเนา 2)");
  });

  it("a saved spec with no data in the answer waits for the reload", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    override = (url, init) => (init?.method === "PUT" ? json({ ok: true }) : undefined);
    specs = specs.map((s) => (s.id === "s50" ? { ...s, name: "จากการโหลดใหม่" } : s));
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("จากการโหลดใหม่")).toBeInTheDocument();
  });

  it("Cmd+Enter saves too; plain Enter in the detail is a new line", async () => {
    const fetchMock = installFetch();
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.keyDown(detailBox(), { key: "Enter" });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    fireEvent.keyDown(detailBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  });

  describe("on a short screen the first problem is scrolled into view", () => {
    const scrolled: Element[] = [];
    beforeEach(() => {
      scrolled.length = 0;
      // jsdom has no scrollIntoView; record which element asked for it.
      Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    });
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it("a missing field — the first one, top to bottom", async () => {
      render(<ProductSpecsPage />);
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "เพิ่มสเปค" }));
      fireEvent.change(nameBox(), { target: { value: "ชื่อ" } });
      fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(scrolled).toHaveLength(1));
      expect(scrolled[0].textContent).toBe("กรุณาเลือกสินค้า");

      // Only the detail missing now: that is the one shown.
      fireEvent.click(within(dialog()).getByRole("button", { name: /เลือกสินค้า/ }));
      fireEvent.click(await screen.findByRole("button", { name: "ตู้อบ" }));
      fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(scrolled).toHaveLength(2));
      expect(scrolled[1].textContent).toBe("กรุณากรอกรายละเอียด");
    });

    it("the API's refusal at the top", async () => {
      override = (url, init) => (init?.method === "PUT" ? json({ error: "กรุณากรอกชื่อสเปก" }, 400) : undefined);
      render(<ProductSpecsPage />);
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
      fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(scrolled).toHaveLength(1));
      expect(scrolled[0]).toBe(within(dialog()).getByRole("alert"));
    });

    it("nothing moves when the save goes through", async () => {
      render(<ProductSpecsPage />);
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
      fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(scrolled).toHaveLength(0);
    });
  });

  it("shows the API's reason when it refuses, and keeps the form open", async () => {
    override = (url, init) => (init?.method === "PUT" ? json({ error: "กรุณากรอกชื่อสเปก" }, 400) : undefined);
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("กรุณากรอกชื่อสเปก");
    expect(nameBox().value).toBe("สเปค 50kN");
  });

  it("a refusal without a reason still says the save failed", async () => {
    override = (url, init) => (init?.method === "PUT" ? { ok: false, status: 500, json: async () => { throw new Error("not json"); } } : undefined);
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("บันทึกสเปคไม่สำเร็จ");
  });

  it("gives focus back to the row it was opened from", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    const row = screen.getByRole("row", { name: "แก้ไขสเปค สเปค 50kN" });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(document.activeElement).toBe(nameBox());
    fireEvent.keyDown(nameBox(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);
  });

  it("closes at once when nothing changed — Esc, backdrop, ✕ or ยกเลิก", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    const open = () => fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    open();
    fireEvent.click(screen.getByTestId("spec-editor-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    fireEvent.click(within(dialog()).getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    fireEvent.click(within(dialog()).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before throwing away typing, and can go back to it", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.change(detailBox(), { target: { value: "Capacity: 50 kN\nเพิ่มบรรทัด" } });
    fireEvent.keyDown(detailBox(), { key: "Escape" });
    expect(screen.getByText("ยังไม่ได้บันทึก")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "กลับไปแก้ต่อ" }));
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
    expect(detailBox().value).toBe("Capacity: 50 kN\nเพิ่มบรรทัด");

    fireEvent.click(screen.getByTestId("spec-editor-backdrop"));
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("ยังไม่ได้บันทึก")).not.toBeInTheDocument();
  });

  it("warns before a refresh or a closed tab throws typing away — and only then", async () => {
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    render(<ProductSpecsPage />);
    await loaded();
    expect(leave()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    expect(leave()).toBe(false); // opened, nothing typed
    fireEvent.change(nameBox(), { target: { value: "สเปค 50kN แก้" } });
    expect(leave()).toBe(true);
    fireEvent.change(nameBox(), { target: { value: "สเปค 50kN" } });
    expect(leave()).toBe(false); // typed back to what it was
    fireEvent.change(detailBox(), { target: { value: "ใหม่" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(leave()).toBe(false); // saved
  });

  it("a key in the product picker's panel is the picker's, not the form's", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มสเปค" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: /เลือกสินค้า/ }));
    const pickerSearch = await screen.findByPlaceholderText("ค้นหา...");
    expect(dialog().contains(pickerSearch)).toBe(false);
    fireEvent.keyDown(pickerSearch, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("copies a spec as a new one of the same product, under a free heading", async () => {
    specs = [...specsFixture(), { id: "s5c", productId: "utm", name: "สเปค 5kN (สำเนา)", detail: "y", createdAt: "2025-03-01" }];
    const fetchMock = installFetch();
    render(<ProductSpecsPage />);
    await screen.findByText("สเปค 5kN (สำเนา)");
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนา สเปค 5kN" }));
    expect(within(dialog()).getByRole("heading", { name: "ทำสำเนาสเปค" })).toBeInTheDocument();
    expect(nameBox().value).toBe("สเปค 5kN (สำเนา 2)");
    expect(detailBox().value).toBe(LONG);
    // Nothing typed yet: Esc closes without asking.
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนา สเปค 5kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/product-specs");
    expect(JSON.parse(String(post[1]!.body))).toEqual({ productId: "utm", name: "สเปค 5kN (สำเนา 2)", detail: LONG });
  });

  it("counts the detail's characters against the limit, and grows with it", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    expect(screen.getByTestId("spec-detail-count").textContent).toBe("15 / 5,000");
    expect(detailBox()).toHaveAttribute("maxLength", "5000");
    expect(nameBox()).toHaveAttribute("maxLength", "255");
    expect(detailBox()).toHaveAttribute("rows", "8");
    fireEvent.change(detailBox(), { target: { value: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n") } });
    expect(detailBox()).toHaveAttribute("rows", "13");
    fireEvent.change(detailBox(), { target: { value: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") } });
    expect(detailBox()).toHaveAttribute("rows", "18");
  });
});

describe("/product-specs — delete and the toast", () => {
  it("asks first, deletes, says so, and the toast goes away by itself", async () => {
    const fetchMock = installFetch();
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 50kN" }));
    expect(screen.getByText(/ลบ "สเปค 50kN" ของ เครื่องทดสอบแรงดึง/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    specs = specs.filter((s) => s.id !== "s50");

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(await screen.findByText(/ลบสเปคแล้ว/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")![0]).toBe("/api/product-specs/s50");
    await waitFor(() => expect(screen.queryByText("สเปค 50kN")).not.toBeInTheDocument());

    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText(/ลบสเปคแล้ว/)).not.toBeInTheDocument();
  });

  it("a deleted spec leaves the list at once, before the reload answers", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    override = (url, init) => {
      if (init?.method === "DELETE") return json({ success: true });
      return url === "/api/product-specs" && !init?.method ? new Promise(() => {}) : undefined;
    };
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 50kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(screen.queryByText("สเปค 50kN")).not.toBeInTheDocument());
    expect(screen.getByText("สเปค 5kN")).toBeInTheDocument();
  });

  it("a failed delete shows the API's reason and keeps the spec", async () => {
    override = (url, init) => (init?.method === "DELETE" ? json({ error: "ไม่พบสเปกนี้" }, 404) : undefined);
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 50kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(await screen.findByText(/ไม่พบสเปกนี้/)).toBeInTheDocument();
    expect(screen.getByText("สเปค 50kN")).toBeInTheDocument();
  });

  it("deletes once however often ลบ is pressed, and cancel waits for it", async () => {
    let release: () => void = () => {};
    let deletes = 0;
    override = (url, init) => {
      if (init?.method === "DELETE") {
        deletes++;
        return new Promise((r) => { release = () => r(json({ success: true })); });
      }
      return undefined;
    };
    render(<ProductSpecsPage />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ สเปค 50kN" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    fireEvent.click(screen.getByRole("button", { name: "กำลังลบ..." }));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByText("ยืนยันการลบสเปค")).toBeInTheDocument();
    await act(async () => { release(); });
    expect(deletes).toBe(1);
  });

  it("a reload that fails after a save keeps the list and says so", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    override = (url, init) => (url === "/api/product-specs" && !init?.method ? json({ error: "x" }, 500) : undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สเปค 50kN" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/โหลดข้อมูลล่าสุดไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getByText("สเปค 50kN")).toBeInTheDocument();
    expect(screen.queryByText("โหลดสเปคไม่สำเร็จ")).not.toBeInTheDocument();
  });
});

describe("/product-specs — looks", () => {
  it("one orange primary button, a header like the other pages, no blue", async () => {
    const { container } = render(<ProductSpecsPage />);
    await loaded();
    expect(screen.getByRole("heading", { level: 1, name: "สเปคสินค้า" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ไปที่หน้าระบบจัดการ/ })).toHaveAttribute("href", "/adminpanel");
    expect(screen.getByRole("button", { name: "เพิ่มสเปค" }).className).toContain("bg-orange-500");
    expect(container.innerHTML).not.toMatch(/\b(?:bg|text|ring|border)-blue-/);
    expect(container.textContent).not.toContain("Product Specs");
    expect(container.textContent).not.toContain("Unknown Product");
  });

  it("rows sit at the top of their cells", async () => {
    render(<ProductSpecsPage />);
    await loaded();
    expect(screen.getByRole("row", { name: "แก้ไขสเปค สเปค 5kN" }).className).toContain("align-top");
  });
});
