/**
 * The quotation builder made easier to use: one test group per change.
 * (Numbering, totals and downloads are pinned in quotationDocNo / quotationDownload.)
 */
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quotation",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const auth = vi.hoisted(() => ({
  isLoggedIn: true,
  isLoading: false,
  user: null as null | { userId: string; username: string },
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: auth.isLoggedIn, isLoading: auth.isLoading, user: auth.user }),
}));
const pdfSave = vi.hoisted(() => vi.fn());
vi.mock("html2canvas-pro", () => ({ default: vi.fn(async () => ({ toDataURL: () => "data:image/jpeg;base64,AA==" })) }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addImage() {}
    addPage() {}
    save = pdfSave;
  },
}));

import QuotationPage from "@/app/quotation/page";
import { bahtText } from "@/app/lib/bahtText";
import { DRAFTS_STORAGE_KEY } from "@/app/quotation/quoteDraft";

// ── Fixtures ────────────────────────────────────────────────────────────────
const SAVED = {
  id: "q1",
  docNo: "QT031126-30",
  data: {
    docNo: "QT031126-30", docDate: "2026-11-03", validDays: 30,
    sellerName: "คุณสมศรี เดิม", sellerPhone: "", sellerEmail: "",
    companyPhone: "", companyEmail: "", companyTaxId: "",
    customerContact: "คุณลูกค้า เดิม", customerCompany: "บริษัท เดิม", customerAddress: "", customerPhone: "", customerEmail: "",
    items: [{ id: "i1", name: "เครื่องชั่ง", description: "", imageUrl: "", imageUploaded: false, qty: 1, unit: "เครื่อง", unitPrice: 1000 }],
    discount: 0, discountType: "amount", vatEnabled: true, conditions: [], note: "",
  },
};
let savedRecord: typeof SAVED = SAVED;
/** Saved before conditions existed: no `conditions` key at all. */
const LEGACY = { id: "qlegacy", docNo: "QT010125-22", data: { ...SAVED.data, conditions: undefined, docNo: "QT010125-22" } };
const DEFAULTS = { companyPhone: "062-012-9895", companyEmail: "sales@profinlab.co.th", companyTaxId: "0-1255-12345-67-8" };

type Answer = { ok: boolean; status: number; json: () => Promise<unknown> };
let posts: { body: { id: string; docNo: string; data: Record<string, unknown> } }[] = [];
let postStatus = 200;
let deletes: string[] = [];
let defaults: Record<string, string> | null = DEFAULTS;
/** When set, the company-defaults answer waits for this to be called. */
let holdDefaults: Promise<void> | null = null;
const IMG = "https://res.cloudinary.com/demo/image/upload/v1/q/line.jpg";
const SAVED_IMG = { ...SAVED, id: "qimg", data: { ...SAVED.data, items: [{ ...SAVED.data.items[0], imageUrl: IMG, imageUploaded: true }] } };

function installFetch() {
  posts = [];
  deletes = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Answer> => {
    const url = String(input);
    const json = (body: unknown, status = 200): Answer => ({ ok: status < 400, status, json: async () => body });
    if (url === "/api/quotations" && init?.method === "POST") {
      posts.push({ body: JSON.parse(String(init.body)) });
      return json(postStatus < 400 ? { ok: true } : { error: "boom" }, postStatus);
    }
    if (url.startsWith("/api/quotations/") && init?.method === "DELETE") {
      deletes.push(url);
      return json({ success: true, orphanedImages: [] });
    }
    if (url === "/api/quotations/company-defaults") {
      if (holdDefaults) await holdDefaults;
      return defaults ? json(defaults) : json({ error: "x" }, 500);
    }
    if (url === "/api/quotations/qimg") return json(SAVED_IMG);
    if (url === "/api/quotations/q1") return json(savedRecord);
    if (url === "/api/quotations/qlegacy") return json(LEGACY);
    if (url === "/api/salespeople") return json([{ id: "s1", name: "คุณวิชัย ยอดขาย", phone: "086-111-1111", email: "wichai@profinlab.co.th" }]);
    if (url === "/api/product-specs") return json({ data: [] });
    return json([]);
  }));
}

function visit(search: string) {
  window.history.replaceState(null, "", `/quotation${search}`);
}

/** Open the folded "ผู้เสนอราคา" section (it is open by itself with no salesperson). */
function openSeller() {
  const t = screen.getByRole("button", { name: /ผู้เสนอราคา/ });
  if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t);
}

/** Scoped to the FORM: the printed sheet repeats some labels verbatim. */
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const lab = Array.from(document.querySelectorAll(".quote-form label")).find((l) => l.textContent?.trim() === label);
  const el = lab?.parentElement?.querySelector("input, textarea");
  if (!el) throw new Error(`no field under ${label}`);
  return el as HTMLInputElement;
}
const status = () => screen.getByTestId("quote-status").textContent;
const sheet = () => document.getElementById("quote-sheet")!;
const drafts = () => JSON.parse(window.localStorage.getItem(DRAFTS_STORAGE_KEY) || "{}");

async function openNew() {
  visit("?new=1");
  const utils = render(<QuotationPage />);
  await waitFor(() => expect((field("เลขที่ (No.)") as HTMLInputElement).value).not.toBe(""));
  return utils;
}
async function openSaved(search = "?id=q1") {
  visit(search);
  const utils = render(<QuotationPage />);
  await waitFor(() => expect(document.body.textContent).toContain("QT031126-30"));
  return utils;
}

beforeEach(() => {
  window.localStorage.clear();
  postStatus = 200;
  defaults = DEFAULTS;
  holdDefaults = null;
  auth.isLoggedIn = true;
  auth.isLoading = false;
  auth.user = null;
  savedRecord = SAVED;
  nav.push.mockClear();
  nav.replace.mockClear();
  pdfSave.mockClear();
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

// ── 1 ─────────────────────────────────────────────────────────────────────
describe("1 · how long a saved quotation is kept", () => {
  it("says two years after a save, never 30 days", async () => {
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/เก็บไว้ในระบบ 2 ปี/)).toBeInTheDocument();
    // ("ยืนราคา 30 วัน" on the sheet is the price validity, not this.)
    expect(document.body.textContent).not.toMatch(/เก็บไว้[^ย]{0,12}30 วัน|ครบ 30 วัน/);
  });

  it("says two years in the keep-or-delete prompt after a download", async () => {
    await openSaved("?id=q1&view=1");
    fireEvent.click(screen.getByRole("button", { name: /ดาวน์โหลด PDF/ }));
    expect(await screen.findByText("ดาวน์โหลดเรียบร้อย ✅")).toBeInTheDocument();
    expect(document.body.textContent).toContain("ลบให้อัตโนมัติเมื่อครบ 2 ปี");
    expect(screen.getByRole("button", { name: "เก็บไว้ 2 ปี" })).toBeInTheDocument();
    // ("ยืนราคา 30 วัน" on the sheet is the price validity, not this.)
    expect(document.body.textContent).not.toMatch(/เก็บไว้[^ย]{0,12}30 วัน|ครบ 30 วัน/);
  });
});

// ── 2 ─────────────────────────────────────────────────────────────────────
describe("2 · the item card's discount and amount fit", () => {
  it("฿ / % is two buttons, and the line's money has its own row", async () => {
    await openNew();
    fireEvent.change(field("ราคา/หน่วย (฿)"), { target: { value: "1000" } });
    const group = screen.getByRole("group", { name: "ประเภทส่วนลดรายการที่ 1" });
    const baht = within(group).getByRole("button", { name: "บาท" });
    const pct = within(group).getByRole("button", { name: "เปอร์เซ็นต์" });
    expect(baht).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pct);
    expect(pct).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(field("ส่วนลดรายการนี้"), { target: { value: "10" } });
    fireEvent.blur(field("ส่วนลดรายการนี้"));
    const card = screen.getByTestId("quote-item");
    expect(within(card).getByText("เป็นเงิน").parentElement?.textContent).toContain("900.00");
    // The sheet agrees: a 10% line discount.
    expect(sheet().textContent).toContain("(10%)");
    // No dropdown left to cut off.
    expect(within(card).queryByText(/เปอร์เซ็…|เปอร์เซ็นต์ \(%\)/)).toBeNull();
  });

  it("the bill discount uses the same buttons", async () => {
    await openNew();
    const group = screen.getByRole("group", { name: "ประเภทส่วนลดท้ายใบ" });
    fireEvent.click(within(group).getByRole("button", { name: "เปอร์เซ็นต์" }));
    expect(within(group).getByRole("button", { name: "เปอร์เซ็นต์" })).toHaveAttribute("aria-pressed", "true");
  });
});

// ── 3 ─────────────────────────────────────────────────────────────────────
describe("3 · the date", () => {
  it("is the shared date picker (yyyy-mm-dd), with the sheet's Thai date under it", async () => {
    await openSaved();
    expect(document.querySelector('.quote-form input[type="date"]')).toBeNull();
    const date = field("วันที่ (Date)") as HTMLInputElement;
    expect(date.value).toBe("2026-11-03");
    expect(screen.getByTestId("quote-date-thai").textContent).toBe("3 พ.ย. 2569");
    fireEvent.change(date, { target: { value: "2026-12-25" } });
    await waitFor(() => expect(screen.getByTestId("quote-date-thai").textContent).toBe("25 ธ.ค. 2569"));
    expect(sheet().textContent).toContain("25 ธ.ค. 2569");
  });
});

// ── 4 ─────────────────────────────────────────────────────────────────────
describe("4 · unsaved work is kept as a draft and offered back", () => {
  it("keeps an edited new quotation, and offers it back on the next visit", async () => {
    const { unmount } = await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "คุณร่าง ไม่หาย" } });
    await waitFor(() => expect(drafts().new?.state.customerContact).toBe("คุณร่าง ไม่หาย"), { timeout: 2000 });
    unmount();

    await openNew();
    const offer = screen.getByTestId("draft-offer");
    expect(offer.textContent).toContain("มีใบที่ยังไม่ได้บันทึกค้างอยู่");
    expect(field("ชื่อผู้ติดต่อ").value).toBe("");
    fireEvent.click(within(offer).getByRole("button", { name: "กู้คืน" }));
    expect(field("ชื่อผู้ติดต่อ").value).toBe("คุณร่าง ไม่หาย");
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    // Still unsaved — leaving still asks.
    expect(status()).toBe("ยังไม่ได้บันทึก");
  });

  it("ทิ้ง forgets it", async () => {
    const { unmount } = await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "ทิ้งได้" } });
    await waitFor(() => expect(drafts().new).toBeDefined(), { timeout: 2000 });
    unmount();
    await openNew();
    fireEvent.click(within(screen.getByTestId("draft-offer")).getByRole("button", { name: "ทิ้ง" }));
    expect(drafts().new).toBeUndefined();
    expect(field("ชื่อผู้ติดต่อ").value).toBe("");
  });

  it("does not keep an untouched new quotation (even after its number moved on)", async () => {
    await openNew();
    await new Promise((r) => setTimeout(r, 700));
    expect(drafts()).toEqual({});
    expect(status()).toBe("ใบใหม่");
  });

  it("drops the draft once the quotation is saved", async () => {
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "จะบันทึก" } });
    await waitFor(() => expect(drafts().new).toBeDefined(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() => expect(drafts()).toEqual({}));
  });

  it("keeps an edit of a saved quotation under that quotation, apart from new ones", async () => {
    const { unmount } = await openSaved();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "แก้ใบเดิม" } });
    await waitFor(() => expect(drafts()["edit:q1"]?.state.customerContact).toBe("แก้ใบเดิม"), { timeout: 2000 });
    unmount();
    // A NEW quotation does not offer it…
    const fresh = await openNew();
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    fresh.unmount();
    // …the same saved quotation does.
    await openSaved();
    fireEvent.click(within(screen.getByTestId("draft-offer")).getByRole("button", { name: "กู้คืน" }));
    expect(field("ชื่อผู้ติดต่อ").value).toBe("แก้ใบเดิม");
  });

  it("keeps nothing while only viewing", async () => {
    await openSaved("?id=q1&view=1");
    await new Promise((r) => setTimeout(r, 700));
    expect(drafts()).toEqual({});
  });

  it("writes the last keystrokes at once when the tab is hidden", async () => {
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "ก่อนปิดแท็บ" } });
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(drafts().new?.state.customerContact).toBe("ก่อนปิดแท็บ");
  });
});

// ── 5 ─────────────────────────────────────────────────────────────────────
describe("5 · our company's lines on a new quotation", () => {
  it("are filled in from the latest quotation, and the sheet prints them", async () => {
    await openNew();
    await waitFor(() => expect(sheet().textContent).toContain("โทร 062-012-9895"));
    expect(sheet().textContent).toContain("อีเมล sales@profinlab.co.th");
    expect(sheet().textContent).toContain("เลขประจำตัวผู้เสียภาษี 0-1255-12345-67-8");
    // Filled in by the page: still a clean new quotation.
    expect(status()).toBe("ใบใหม่");
  });

  it("are left alone on a saved quotation", async () => {
    await openSaved();
    await new Promise((r) => setTimeout(r, 50));
    expect(sheet().textContent).not.toContain("062-012-9895");
  });

  it("never overwrites what was typed before they arrived", async () => {
    let release: () => void = () => {};
    holdDefaults = new Promise<void>((r) => { release = r; });
    await openNew();
    fireEvent.change(field("โทรบริษัท"), { target: { value: "02-999-9999" } });
    await act(async () => { release(); });
    await waitFor(() => expect(sheet().textContent).toContain("อีเมล sales@profinlab.co.th"));
    expect(sheet().textContent).toContain("โทร 02-999-9999");
    expect(sheet().textContent).not.toContain("062-012-9895");
  });

  it("a failed lookup leaves the boxes as they were", async () => {
    defaults = null;
    await openNew();
    await new Promise((r) => setTimeout(r, 50));
    expect(sheet().textContent).not.toContain("062-012-9895");
  });
});

// ── 6 ─────────────────────────────────────────────────────────────────────
describe("6 · คืนค่าเริ่มต้น asks first", () => {
  it("is off while the conditions are the defaults, and asks once they were edited", async () => {
    await openNew();
    const reset = screen.getByRole("button", { name: /คืนค่าเริ่มต้น/ });
    expect(reset).toBeDisabled();
    const first = document.querySelector('.quote-form input[placeholder="หัวข้อ (เช่น เงื่อนไขชำระเงิน)"]') as HTMLInputElement;
    fireEvent.change(first, { target: { value: "ชำระเป็นงวด" } });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(screen.getByText("คืนค่าเงื่อนไขเริ่มต้น?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(first.value).toBe("ชำระเป็นงวด");

    fireEvent.click(reset);
    fireEvent.click(within(screen.getByText("คืนค่าเงื่อนไขเริ่มต้น?").closest("div")!.parentElement!).getByRole("button", { name: "คืนค่าเริ่มต้น" }));
    await waitFor(() =>
      expect((document.querySelector('.quote-form input[placeholder="หัวข้อ (เช่น เงื่อนไขชำระเงิน)"]') as HTMLInputElement).value).toBe("เงื่อนไขชำระเงิน")
    );
  });
});

// ── 7 ─────────────────────────────────────────────────────────────────────
describe("7 · save and download in one step while editing", () => {
  it("saves, then makes the PDF, then asks keep-or-delete", async () => {
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก + ดาวน์โหลด PDF" }));
    await waitFor(() => expect(pdfSave).toHaveBeenCalledTimes(1));
    expect(posts).toHaveLength(1);
    expect(await screen.findByText("ดาวน์โหลดเรียบร้อย ✅")).toBeInTheDocument();
    expect(status()).toBe("บันทึกแล้ว");
  });

  it("makes no PDF when the save fails", async () => {
    postStatus = 500;
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก + ดาวน์โหลด PDF" }));
    expect(await screen.findByText(/บันทึกใบเสนอราคาไม่สำเร็จ จึงยังไม่ได้สร้าง PDF/)).toBeInTheDocument();
    expect(pdfSave).not.toHaveBeenCalled();
  });

  it("ลบทันที after it leaves a new quotation, not a link to a deleted one", async () => {
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก + ดาวน์โหลด PDF" }));
    await screen.findByText("ดาวน์โหลดเรียบร้อย ✅");
    nav.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /ลบทันที/ }));
    await waitFor(() => expect(deletes).toHaveLength(1));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/quotation?new=1"));
    expect(status()).toBe("ใบใหม่");
  });
});

// ── 8 ─────────────────────────────────────────────────────────────────────
describe("8 · after บันทึก the page stays", () => {
  it("stays, is saved, and the URL names the saved quotation", async () => {
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "คุณลูกค้า" } });
    expect(status()).toBe("ยังไม่ได้บันทึก");
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(status()).toBe("บันทึกแล้ว"));
    const id = posts[0].body.id;
    expect(nav.replace).toHaveBeenCalledWith(`/quotation?id=${encodeURIComponent(id)}`);
    expect(nav.push).not.toHaveBeenCalled();
    // Leaving now does not ask.
    fireEvent.click(screen.getByRole("button", { name: "ใบเสนอราคาที่บันทึกไว้" }));
    expect(nav.push).toHaveBeenCalledWith("/billing/saved?tab=quotation");
  });

  it("a failed save says so and stays unsaved", async () => {
    postStatus = 500;
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/บันทึกไม่สำเร็จ/)).toBeInTheDocument();
    expect(status()).toBe("ยังไม่ได้บันทึก");
  });

  it("saving again updates the same quotation (same id)", async () => {
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "แก้ต่อ" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body.id).toBe(posts[0].body.id);
    expect(posts[1].body.docNo).toBe(posts[0].body.docNo);
  });
});

// ── 9 ─────────────────────────────────────────────────────────────────────
describe("9 · Ctrl+S saves", () => {
  it("Ctrl+S and ⌘S save — on a Thai keyboard too", async () => {
    await openNew();
    const e1 = new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, cancelable: true });
    act(() => { window.dispatchEvent(e1); });
    expect(e1.defaultPrevented).toBe(true);
    await waitFor(() => expect(posts).toHaveLength(1));
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ห", code: "KeyS", metaKey: true })); });
    await waitFor(() => expect(posts).toHaveLength(2));
  });

  it("other keys, and Ctrl+Shift+S, do nothing", async () => {
    await openNew();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true }));
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toHaveLength(0);
  });

  it("does nothing while only viewing", async () => {
    await openSaved("?id=q1&view=1");
    const e = new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, cancelable: true });
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toHaveLength(0);
  });

  it("held down, saves once", async () => {
    await openNew();
    // Our company's lines first: arriving DURING the save they rightly make
    // the screen differ from what was saved.
    await waitFor(() => expect(sheet().textContent).toContain("062-012-9895"));
    act(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true }));
    });
    await waitFor(() => expect(status()).toBe("บันทึกแล้ว"));
    expect(posts).toHaveLength(1);
  });
});

// ── 10 ────────────────────────────────────────────────────────────────────
describe("10 · copy a line", () => {
  it("puts the same line right below it", async () => {
    await openSaved();
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนารายการ" }));
    const cards = screen.getAllByTestId("quote-item");
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.querySelector("button span")?.textContent)).toEqual(["เครื่องชั่ง", "เครื่องชั่ง"]);
    expect(document.querySelectorAll("#quote-tbody tr")).toHaveLength(2);
  });

  it("lists a shared uploaded image once when saving, and the copy gets its own id", async () => {
    visit("?id=qimg");
    render(<QuotationPage />);
    await waitFor(() => expect(document.body.textContent).toContain("QT031126-30"));
    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนารายการ" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const body = posts[0].body as unknown as { data: { items: { id: string; imageUrl: string }[] }; uploadedImages: string[] };
    expect(body.data.items.map((i) => i.imageUrl)).toEqual([IMG, IMG]);
    expect(new Set(body.data.items.map((i) => i.id)).size).toBe(2);
    expect(body.uploadedImages).toEqual([IMG]);
  });
});

// ── 11 ────────────────────────────────────────────────────────────────────
describe("11 · the detail box grows with the text", () => {
  it("2 rows empty, more with more lines, at most 12", async () => {
    await openNew();
    const box = document.querySelector('.quote-form textarea[placeholder="รายละเอียด / สเปค (ถ้ามี)"]') as HTMLTextAreaElement;
    expect(box).toHaveAttribute("rows", "2");
    fireEvent.change(box, { target: { value: "a\nb\nc\nd\ne" } });
    expect(box).toHaveAttribute("rows", "6");
    fireEvent.change(box, { target: { value: Array.from({ length: 30 }, () => "x").join("\n") } });
    expect(box).toHaveAttribute("rows", "12");
  });
});

// ── 12 ────────────────────────────────────────────────────────────────────
describe("12 · the last salesperson is remembered", () => {
  it("a new quotation starts with the one saved last from here", async () => {
    const first = await openNew();
    openSeller();
    fireEvent.change(field("ชื่อเซลล์"), { target: { value: "คุณวิชัย ยอดขาย" } });
    fireEvent.change(field("โทร (เซลล์)"), { target: { value: "086-111-1111" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    first.unmount();

    await openNew();
    expect(sheet().textContent).toContain("คุณวิชัย ยอดขาย");
    expect(sheet().textContent).toContain("086-111-1111");
    expect(status()).toBe("ใบใหม่");
  });

  it("not remembered when the save fails, and never put onto a saved quotation", async () => {
    postStatus = 500;
    const first = await openNew();
    openSeller();
    fireEvent.change(field("ชื่อเซลล์"), { target: { value: "คุณไม่ได้บันทึก" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await screen.findByText(/บันทึกไม่สำเร็จ/);
    first.unmount();
    window.localStorage.setItem("quotation-last-seller-v1", JSON.stringify({ sellerName: "คุณจำไว้" }));
    await openSaved();
    expect(sheet().textContent).toContain("คุณสมศรี เดิม");
    expect(sheet().textContent).not.toContain("คุณจำไว้");
    expect(sheet().textContent).not.toContain("คุณไม่ได้บันทึก");
  });
});

// ── 13 ────────────────────────────────────────────────────────────────────
describe("13 · the form in the order a quotation is written", () => {
  it("document, customer, items, terms, then who offers it", async () => {
    await openNew();
    const headings = Array.from(document.querySelectorAll(".quote-form section h2, .quote-form section > button span span:first-child")).map((h) => h.textContent);
    expect(headings).toEqual(["เอกสาร", "ลูกค้า", "รายการสินค้า (1)", "ส่วนลด / VAT / เงื่อนไข", "ผู้เสนอราคา (พนักงานขาย / บริษัทเรา)"]);
  });

  it("who offers it is folded to one line once there is a salesperson", async () => {
    window.localStorage.setItem("quotation-last-seller-v1", JSON.stringify({ sellerName: "คุณวิชัย ยอดขาย" }));
    await openNew();
    const toggle = screen.getByRole("button", { name: /ผู้เสนอราคา/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.getByTestId("seller-summary").textContent).toContain("คุณวิชัย ยอดขาย · โทร 062-012-9895"));
    expect(() => field("ชื่อเซลล์")).toThrow();
    fireEvent.click(toggle);
    expect(field("ชื่อเซลล์").value).toBe("คุณวิชัย ยอดขาย");
  });

  it("…and open while there is none", async () => {
    await openNew();
    expect(screen.getByRole("button", { name: /ผู้เสนอราคา/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("stays open while a salesperson is typed into it (it used to fold on the first letter)", async () => {
    await openNew();
    fireEvent.change(field("ชื่อเซลล์"), { target: { value: "ค" } });
    expect(screen.getByRole("button", { name: /ผู้เสนอราคา/ })).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(field("ชื่อเซลล์"), { target: { value: "คุณวิชัย" } });
    expect(field("ชื่อเซลล์").value).toBe("คุณวิชัย");
  });
});

// ── 14 ────────────────────────────────────────────────────────────────────
describe("14 · the total in Thai words", () => {
  it("is printed under the total, matching it", async () => {
    await openSaved();
    // 1,000 + 7% VAT.
    expect(sheet().textContent).toContain("1,070.00");
    expect(screen.getByTestId("quote-total-words").textContent).toBe(`(${bahtText(1070)})`);
    expect(screen.getByTestId("quote-total-words").textContent).toBe("(หนึ่งพันเจ็ดสิบบาทถ้วน)");
  });
});

// ── 15 ────────────────────────────────────────────────────────────────────
describe("15 · one way back", () => {
  it("one back button and a small link — no '← กลับ' or 🏠 button", async () => {
    await openNew();
    expect(screen.queryByRole("button", { name: "← กลับ" })).toBeNull();
    expect(screen.queryByRole("button", { name: /🏠/ })).toBeNull();
    expect(screen.getByRole("button", { name: "ใบเสนอราคาที่บันทึกไว้" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "กลับหน้าระบบจัดการ" })).toBeInTheDocument();
  });

  it("with unsaved edits it asks; บันทึกแล้วออก saves, then goes where the admin was going", async () => {
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("link", { name: "กลับหน้าระบบจัดการ" }));
    expect(screen.getByText("มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกแล้วออก" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/adminpanel"));
    expect(posts).toHaveLength(1);
  });

  it("บันทึกแล้วออก stays put when the save fails", async () => {
    postStatus = 500;
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("link", { name: "กลับหน้าระบบจัดการ" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกแล้วออก" }));
    await screen.findByText(/บันทึกไม่สำเร็จ/);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("ออกโดยไม่บันทึก leaves, and drops the draft", async () => {
    await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "ไม่เอา" } });
    await waitFor(() => expect(drafts().new).toBeDefined(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "ใบเสนอราคาที่บันทึกไว้" }));
    fireEvent.click(screen.getByRole("button", { name: /ออกโดยไม่บันทึก/ }));
    expect(nav.push).toHaveBeenCalledWith("/billing/saved?tab=quotation");
    expect(drafts().new).toBeUndefined();
  });
});

// ── 16 · 17 · 18 ──────────────────────────────────────────────────────────
describe("16–18 · one colour, plainer cards, the same look as the other pages", () => {
  it("no blue / green / purple / pink in the form; orange primary actions", async () => {
    await openSaved();
    const form = document.querySelector(".quote-form")!;
    expect(form.innerHTML).not.toMatch(/\b(?:bg|text|border)-(?:blue|green|emerald|purple|pink)-/);
    expect(screen.getByRole("button", { name: "บันทึก + ดาวน์โหลด PDF" }).className).toContain("bg-orange-500");
    expect(screen.getByRole("button", { name: "บันทึก" }).className).toContain("bg-white");
    expect(document.querySelector(".min-h-screen")!.className).toContain("bg-[#F8FAFC]");
  });

  it("an item card folds to one line, and ย่อทั้งหมด folds them all", async () => {
    await openSaved();
    const card = screen.getByTestId("quote-item");
    const header = within(card).getByRole("button", { expanded: true });
    expect(within(card).getByTestId("quote-item-total").textContent).toBe("1,000.00");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(card.textContent).toContain("1 เครื่อง × 1,000.00");
    expect(within(card).queryByPlaceholderText("ชื่อเครื่อง / รุ่น")).toBeNull();
    fireEvent.click(header);

    fireEvent.click(screen.getByRole("button", { name: "ทำสำเนารายการ" }));
    fireEvent.click(screen.getByRole("button", { name: "ย่อทั้งหมด" }));
    expect(screen.getAllByTestId("quote-item").every((c) => !c.querySelector('input[placeholder="ชื่อเครื่อง / รุ่น"]'))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "ขยายทั้งหมด" }));
    expect(document.querySelectorAll('.quote-form input[placeholder="ชื่อเครื่อง / รุ่น"]')).toHaveLength(2);
  });

  it("one short line explains the bill discount", async () => {
    await openNew();
    expect(document.body.textContent).not.toContain("ℹ️ ส่วนลดรายรายการจะถูกหักก่อน");
    expect(document.body.textContent).toContain("แล้วจึงคิด VAT");
  });

  it("the state is beside the title", async () => {
    await openSaved("?id=q1&view=1");
    expect(status()).toBe("ดูอย่างเดียว");
  });
});

// ── Found in the bug check ────────────────────────────────────────────────
describe("bug check · round 1", () => {
  it("a new version is never called saved", async () => {
    visit("?id=q1&action=clone");
    render(<QuotationPage />);
    await waitFor(() => expect(document.body.textContent).toContain("QT031126-30v1"));
    expect(status()).toBe("เวอร์ชันใหม่ · ยังไม่ได้บันทึก");
  });

  it("a link to a quotation that is gone opens a NEW one, and says so", async () => {
    visit("?id=gone");
    render(<QuotationPage />);
    expect(await screen.findByText(/ไม่พบใบเสนอราคานี้/)).toBeInTheDocument();
    await waitFor(() => expect(status()).toBe("ใบใหม่"));
  });

  it("while a draft is on offer the form is locked and nothing saves", async () => {
    const first = await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "ร่างเก่า" } });
    await waitFor(() => expect(drafts().new).toBeDefined(), { timeout: 2000 });
    first.unmount();

    await openNew();
    expect(field("ชื่อผู้ติดต่อ")).toBeDisabled();
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "บันทึก + ดาวน์โหลด PDF" })).toBeDisabled();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true })); });
    expect(await screen.findByText(/เลือก กู้คืน หรือ ทิ้ง/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    expect(drafts().new?.state.customerContact).toBe("ร่างเก่า");

    fireEvent.click(within(screen.getByTestId("draft-offer")).getByRole("button", { name: "ทิ้ง" }));
    expect(field("ชื่อผู้ติดต่อ")).toBeEnabled();
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeEnabled();
  });

  it("a second message is not cut short by the first one's timer", async () => {
    await openNew();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await screen.findByText(/เก็บไว้ในระบบ 2 ปี/);
    await act(async () => { vi.advanceTimersByTime(2000); });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true })); });
    await waitFor(() => expect(posts).toHaveLength(2));
    // 3.5 s after the first message, 1.5 s after the second: still on screen.
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(/เก็บไว้ในระบบ 2 ปี/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1700); });
    expect(screen.queryByText(/เก็บไว้ในระบบ 2 ปี/)).toBeNull();
  });

  it("downloading a quotation while only viewing it does not change the remembered salesperson", async () => {
    window.localStorage.setItem("quotation-last-seller-v1", JSON.stringify({ sellerName: "คุณของฉัน" }));
    await openSaved("?id=q1&view=1");
    fireEvent.click(screen.getByRole("button", { name: /ดาวน์โหลด PDF/ }));
    await screen.findByText("ดาวน์โหลดเรียบร้อย ✅");
    expect(JSON.parse(window.localStorage.getItem("quotation-last-seller-v1")!).sellerName).toBe("คุณของฉัน");
  });
});

// ── Adversarial review ────────────────────────────────────────────────────
describe("adversarial review", () => {
  const now = () => new Date().toISOString();
  const plant = (drafts: Record<string, unknown>) => window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));

  it("one admin's draft is never offered to (or overwritten by) another on the same browser", async () => {
    auth.user = { userId: "u1", username: "a" };
    const first = await openNew();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "ของ u1" } });
    await waitFor(() => expect(drafts()["u1/new"]?.state.customerContact).toBe("ของ u1"), { timeout: 2000 });
    first.unmount();

    auth.user = { userId: "u2", username: "b" };
    const second = await openNew();
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "ของ u2" } });
    await waitFor(() => expect(drafts()["u2/new"]?.state.customerContact).toBe("ของ u2"), { timeout: 2000 });
    expect(drafts()["u1/new"].state.customerContact).toBe("ของ u1");
    second.unmount();

    auth.user = { userId: "u1", username: "a" };
    await openNew();
    fireEvent.click(within(screen.getByTestId("draft-offer")).getByRole("button", { name: "กู้คืน" }));
    expect(field("ชื่อผู้ติดต่อ").value).toBe("ของ u1");
  });

  it("the remembered salesperson is per admin too", async () => {
    window.localStorage.setItem("quotation-last-seller-v1:u1", JSON.stringify({ sellerName: "คุณของ u1" }));
    auth.user = { userId: "u2", username: "b" };
    const other = await openNew();
    expect(sheet().textContent).not.toContain("คุณของ u1");
    other.unmount();
    auth.user = { userId: "u1", username: "a" };
    await openNew();
    expect(sheet().textContent).toContain("คุณของ u1");
  });

  it("a draft of a quotation someone has saved since says so before it is restored", async () => {
    const first = await openSaved();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "แก้ของฉัน" } });
    await waitFor(() => expect(drafts()["edit:q1"]?.base).toBeDefined(), { timeout: 2000 });
    first.unmount();
    savedRecord = { ...SAVED, data: { ...SAVED.data, note: "แก้โดยคนอื่น" } };
    await openSaved();
    expect(screen.getByTestId("draft-stale").textContent).toContain("ถูกบันทึกใหม่หลังจากร่างนี้");
  });

  it("…and says nothing when the saved quotation is as it was", async () => {
    const first = await openSaved();
    fireEvent.change(field("ชื่อผู้ติดต่อ"), { target: { value: "แก้ของฉัน" } });
    await waitFor(() => expect(drafts()["edit:q1"]?.base).toBeDefined(), { timeout: 2000 });
    first.unmount();
    await openSaved();
    expect(screen.getByTestId("draft-offer")).toBeInTheDocument();
    expect(screen.queryByTestId("draft-stale")).toBeNull();
  });

  it("a malformed draft is never offered, and the page still opens", async () => {
    plant({
      new: { savedAt: now(), state: { items: "oops" } },
      "edit:q1": { savedAt: now(), state: { items: [null] } },
    });
    const a = await openNew();
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    expect(drafts().new).toBeUndefined();
    a.unmount();
    await openSaved();
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    expect(field("ชื่อผู้ติดต่อ").value).toBe("คุณลูกค้า เดิม");
  });

  it("a draft that says nothing new is dropped, not offered", async () => {
    plant({ "edit:q1": { savedAt: now(), state: { ...SAVED.data, id: "q1" } } });
    await openSaved();
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    expect(drafts()["edit:q1"]).toBeUndefined();
  });

  it("…an old quotation's too, though its conditions get new ids on every load", async () => {
    const defaultsWithIds = [
      { id: "x1", label: "เงื่อนไขชำระเงิน", value: "ชำระเงิน 100% ก่อนส่งมอบสินค้า" },
      { id: "x2", label: "กำหนดส่งมอบ", value: "30-45 วัน หลังยืนยันการสั่งซื้อ" },
      { id: "x3", label: "การรับประกัน", value: "รับประกันสินค้า 1 ปี" },
    ];
    plant({ "edit:qlegacy": { savedAt: now(), state: { ...LEGACY.data, id: "qlegacy", conditions: defaultsWithIds } } });
    visit("?id=qlegacy");
    render(<QuotationPage />);
    await waitFor(() => expect(document.body.textContent).toContain("QT010125-22"));
    expect(screen.queryByTestId("draft-offer")).toBeNull();
  });

  it("opens the document only once the signed-in user is known", async () => {
    plant({ "u1/new": { savedAt: now(), state: { ...SAVED.data, id: "d1", docNo: "QT-DRAFT" } } });
    auth.isLoggedIn = false;
    auth.isLoading = true;
    visit("?new=1");
    const { rerender } = render(<QuotationPage />);
    expect(screen.queryByTestId("draft-offer")).toBeNull();
    auth.isLoggedIn = true;
    auth.isLoading = false;
    auth.user = { userId: "u1", username: "a" };
    rerender(<QuotationPage />);
    expect(await screen.findByTestId("draft-offer")).toBeInTheDocument();
    expect(screen.getByTestId("draft-offer").textContent).toContain("QT-DRAFT");
  });
});
