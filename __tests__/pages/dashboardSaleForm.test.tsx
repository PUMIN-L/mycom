/**
 * /dashboard — the บันทึกยอดขาย / แก้ไขรายการ window, through the real page:
 *
 *  • closing it with typing in it (Esc, ✕, ยกเลิก, the backdrop) asks first;
 *  • Esc in an open dropdown list closes only the list;
 *  • it cannot be closed while a save is under way;
 *  • an edited sale opened and left untouched closes without a question;
 *  • a fresh form does not carry the red marks of an earlier attempt;
 *  • the toast is drawn over the form.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloneElement, type ReactElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 280 } as never),
  };
});

import DashboardPage from "@/app/dashboard/page";

const DASHBOARD = {
  overview: {
    currentPeriod: { revenue: 0, cost: 0, profit: 0, deals: 0, newCustomers: 0, quotations: 0 },
    previousPeriod: { revenue: 0, cost: 0, profit: 0, deals: 0, newCustomers: 0, quotations: 0 },
    expiringWarranties: 0,
    periodLabel: "ปี 2569",
  },
  revenueMonthly: [],
  revenueQuarterly: [],
  revenueByCategory: [],
  topProducts: [],
  topCustomers: [],
  salespersonLeaderboard: [],
  insights: [],
};

const RECORD = {
  id: "rec-1",
  saleType: "service",
  salespersonId: "sp1",
  salespersonName: "สมชาย",
  customerId: "",
  companyId: "",
  productId: "",
  productName: "งานสอบเทียบ",
  categoryId: null,
  qty: 2,
  unitPrice: 1500,
  totalAmount: 3000,
  costAmount: 500,
  saleDate: "2026-11-10",
  quotationRef: "QT-1",
  poRef: "PO-9",
  deliveryRef: "",
  invoiceRef: "",
  receiptRef: "",
  warrantyStartDate: null,
  warrantyEndDate: null,
  note: "หมายเหตุเดิม",
  customerName: "คุณเอ",
  companyName: "",
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
/** When set, answers a request first (return undefined to fall through). */
let override: ((path: string, init?: RequestInit) => unknown) | null = null;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  override = null;
  // The new-sale FORM is what the live site uses until the accounting module
  // is switched on there (with it on, บันทึกยอดขาย opens an invoice instead —
  // pinned at the end of this file). React is already loaded, so this only
  // switches the module flag off.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    switch (url.pathname) {
      case "/api/admin/dashboard": return json(DASHBOARD);
      case "/api/salespeople": return json([{ id: "sp1", name: "สมชาย" }]);
      case "/api/admin/sales": return json([RECORD]);
      case "/api/admin/sales/rec-1": return json(RECORD);
      case "/api/admin/sales/rec-1/costs":
        return json({ items: [{ id: "ci1", costType: "transport", label: "ค่ารถ", amount: "500.00", note: "" }] });
      case "/api/admin/sales/rec-1/items": return json({ items: [{ id: "i1" }] });
      default: return json([]);
    }
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const esc = () => fireEvent.keyDown(document, { key: "Escape" });
const formDialog = () => screen.queryByRole("dialog", { name: /บันทึกยอดขาย|แก้ไขรายการ/ });
const discardQuestion = () => screen.queryByText("ยังไม่ได้บันทึก");
const poInput = () => screen.getByPlaceholderText("เลขที่ใบ PO") as HTMLInputElement;

async function renderPage() {
  render(<DashboardPage />);
  // The records list has loaded once its row is in the table.
  await screen.findByText("งานสอบเทียบ");
}

async function openNewSale() {
  await renderPage();
  fireEvent.click(screen.getByRole("button", { name: "บันทึกยอดขาย" }));
  return screen.getByRole("dialog", { name: "บันทึกยอดขาย" });
}

describe("dashboard sale form — closing", () => {
  it("closes on Esc at once when nothing was typed", async () => {
    await openNewSale();
    esc();
    expect(formDialog()).toBeNull();
    expect(discardQuestion()).toBeNull();
  });

  it("asks before Esc throws typing away; Esc again goes back with the typing kept", async () => {
    await openNewSale();
    fireEvent.change(poInput(), { target: { value: "PO-1" } });

    esc();
    expect(discardQuestion()).toBeTruthy();
    esc();
    expect(discardQuestion()).toBeNull();
    expect(poInput().value).toBe("PO-1");

    esc();
    fireEvent.click(screen.getByRole("button", { name: "ปิดโดยไม่บันทึก" }));
    expect(formDialog()).toBeNull();
  });

  it("asks before a backdrop click throws typing away", async () => {
    await openNewSale();
    fireEvent.change(poInput(), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByTestId("sale-form-backdrop"));
    expect(discardQuestion()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "กลับไปกรอกต่อ" }));
    expect(formDialog()).toBeTruthy();
    expect(poInput().value).toBe("PO-1");
  });

  it("Esc in an open dropdown list closes only the list", async () => {
    const dialog = await openNewSale();
    fireEvent.click(within(dialog).getByRole("button", { name: "เลือกเซลล์..." }));
    expect(document.querySelector("[data-dropdown-panel]")).toBeTruthy();

    esc();
    expect(document.querySelector("[data-dropdown-panel]")).toBeNull();
    expect(formDialog()).toBeTruthy();
    expect(discardQuestion()).toBeNull();
  });

  it("cannot be closed while the save is under way", async () => {
    let posted = false;
    override = (path, init) => {
      if (path === "/api/admin/sales" && init?.method === "POST") {
        posted = true;
        return new Promise(() => {}); // never answers
      }
      return undefined;
    };
    const dialog = await openNewSale();
    fireEvent.click(within(dialog).getByLabelText(/ขายงาน Service/));
    fireEvent.change(within(dialog).getByPlaceholderText("ชื่อเครื่อง / สินค้า / บริการ"), { target: { value: "งานซ่อม" } });
    const priceBox = within(dialog).getByText(/ราคาต่อหน่วย/).parentElement!.querySelector("input")!;
    fireEvent.change(priceBox, { target: { value: "1000" } });
    fireEvent.change(poInput(), { target: { value: "PO-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /เปิด ตัวช่วยคำนวณต้นทุน/ }));
    const costRow = within(dialog).getByPlaceholderText("รายละเอียด (เช่น ค่ารถไปส่ง)").parentElement!;
    fireEvent.change(within(costRow).getByPlaceholderText("0"), { target: { value: "400" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกยอดขาย" }));
    await waitFor(() => expect(posted).toBe(true));
    expect(within(dialog).getByRole("button", { name: "ปิด" })).toBeDisabled();
    esc();
    fireEvent.click(screen.getByTestId("sale-form-backdrop"));
    expect(formDialog()).toBeTruthy();
    expect(discardQuestion()).toBeNull();
  });
});

describe("dashboard sale form — editing a sale", () => {
  async function openEdit() {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    return screen.findByRole("dialog", { name: "แก้ไขรายการ" });
  }

  it("opens with the sale's own values and closes without a question when nothing changed", async () => {
    await openEdit();
    expect(poInput().value).toBe("PO-9");
    expect(screen.getByDisplayValue("ค่ารถ")).toBeTruthy();
    esc();
    expect(formDialog()).toBeNull();
    expect(discardQuestion()).toBeNull();
  });

  it("asks once something in it was changed", async () => {
    await openEdit();
    fireEvent.change(screen.getByDisplayValue("หมายเหตุเดิม"), { target: { value: "หมายเหตุใหม่" } });
    esc();
    expect(discardQuestion()).toBeTruthy();
  });
});

describe("dashboard sale form — a fresh start", () => {
  it("does not carry the red marks of an earlier attempt into a new form", async () => {
    const dialog = await openNewSale();
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกยอดขาย" }));
    await waitFor(() => expect(document.querySelectorAll(".error-border").length).toBeGreaterThan(0));

    fireEvent.click(within(dialog).getByRole("button", { name: "ปิด" }));
    expect(formDialog()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกยอดขาย" }));
    expect(formDialog()).toBeTruthy();
    expect(document.querySelectorAll(".error-border").length).toBe(0);
  });

  // Item 4 — the list of what is missing stays in the form, by the save button, until it is all filled.
  it("keeps what is missing in the form — each thing drops off, and its red border goes, as it is filled", async () => {
    const dialog = await openNewSale();
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกยอดขาย" }));
    const notice = await within(dialog).findByTestId("sale-form-missing");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toMatch(/^กรุณากรอก:/);
    expect(notice.textContent).toContain("อ้างอิง PO");
    const po = within(dialog).getByPlaceholderText("เลขที่ใบ PO");
    expect(po.className).toContain("error-border");

    fireEvent.change(po, { target: { value: "PO-2569-01" } });
    expect(within(dialog).getByTestId("sale-form-missing").textContent).not.toContain("อ้างอิง PO");
    expect(po.className).not.toContain("error-border");
    // The rest is still said — nothing vanished on a timer.
    expect(within(dialog).getByTestId("sale-form-missing").textContent).toContain("ชื่อสินค้า");
  });
});

describe("dashboard — บันทึกยอดขาย with the accounting module on", () => {
  it("leads to a new invoice instead of the form — issuing it records the sale here", async () => {
    vi.unstubAllEnvs(); // the module is on outside production
    await renderPage();
    const link = screen.getByRole("link", { name: /บันทึกยอดขาย/ });
    expect(link).toHaveAttribute("href", "/accounting/invoices/new");
    expect(screen.queryByRole("button", { name: "บันทึกยอดขาย" })).toBeNull();
  });
});
