/**
 * /dashboard — the sales table keeps to the period picked at the top, through
 * the real page:
 *
 *  • it lists the period's sales, follows ◀ ▶, and shows every sale on request;
 *  • a Top 10 row narrows it to that row's bills within the period — a product
 *    by ANY line of a bill, as the API counts it — or opens the one bill;
 *  • Export writes exactly the sales the table shows, money as numbers.
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
vi.mock("@/app/lib/xlsxExport", () => ({ downloadExcel: vi.fn(async () => {}) }));

import DashboardPage from "@/app/dashboard/page";
import { downloadExcel } from "@/app/lib/xlsxExport";

const base = {
  salespersonId: "sp1", salespersonName: "สมชาย", customerId: "c1", customerName: "คุณเอ",
  categoryId: null, qty: 1, unitPrice: "1000.00", costAmount: "400.00", saleType: "service",
  quotationRef: "", poRef: "PO", deliveryRef: "", invoiceRef: "", receiptRef: "",
  warrantyStartDate: null, warrantyEndDate: null, equipmentId: null, note: "", createdAt: "",
};
/** Money comes as DECIMAL strings, as mysql2 sends it. */
const RECORDS = [
  // Two products on one bill: Scale B is on its SECOND line.
  { ...base, id: "rec-oct", saleDate: "2026-10-05", companyId: "co1", companyName: "บริษัท เอ", productId: "p-a", productName: "Scale A", totalAmount: "3000.00",
    lineItems: [{ productId: "p-a", productName: "Scale A" }, { productId: "p-b", productName: "Scale B" }] },
  { ...base, id: "rec-oct2", saleDate: "2026-10-15", companyId: "co1", companyName: "บริษัท เอ", productId: "p-b", productName: "Scale B", totalAmount: "2000.00",
    lineItems: [{ productId: "p-b", productName: "Scale B" }] },
  { ...base, id: "rec-sep", saleDate: "2026-09-10", companyId: "co2", companyName: "บริษัท บี", productId: "p-c", productName: "Scale C", totalAmount: "1500.00",
    lineItems: [{ productId: "p-c", productName: "Scale C" }] },
  { ...base, id: "rec-2025", saleDate: "2025-12-20", companyId: "co2", companyName: "บริษัท บี", productId: "p-c", productName: "Scale C", totalAmount: "900.00",
    lineItems: [{ productId: "p-c", productName: "Scale C" }] },
];

const top = (id: string, name: string) => ({ id, name, revenue: 1000, qty: 1, deals: 1, percentage: 10 });
const DASHBOARD = {
  overview: {
    currentPeriod: { revenue: 1, cost: 0, profit: 1, deals: 1, newCustomers: 0, quotations: 0 },
    previousPeriod: { revenue: 1, cost: 0, profit: 1, deals: 1, newCustomers: 0, quotations: 0 },
    expiringWarranties: 0,
    periodLabel: "ปี 2569",
  },
  revenueMonthly: [],
  revenueQuarterly: [],
  revenueByCategory: [],
  topProducts: [top("p-b", "Scale B"), top("p-c", "Scale C")],
  topCustomers: [top("co1", "บริษัท เอ")],
  salespersonLeaderboard: [{ id: "sp1", name: "สมชาย", revenue: 1, deals: 1, percentage: 100, avgDealSize: 1 }],
  insights: [],
};

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T05:00:00Z"));
  vi.mocked(downloadExcel).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/admin/dashboard") return json(DASHBOARD);
    if (url.pathname === "/api/admin/sales") return json(RECORDS);
    const one = RECORDS.find((r) => url.pathname === `/api/admin/sales/${r.id}`);
    if (one) return json(one);
    return json([]);
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const table = () => within(document.getElementById("sales-records-section") as HTMLElement);
const heading = () => table().getByRole("heading", { level: 2 }).textContent;
/** The bills in the table, by the date column. */
const listedDates = () =>
  Array.from(document.querySelectorAll("#sales-records-section tbody tr"))
    .map((row) => row.querySelectorAll("td")[1]?.textContent)
    .filter(Boolean);

async function renderLoaded() {
  render(<DashboardPage />);
  await waitFor(() => expect(heading()).toBe("รายการขาย ปี 2569 (3)"));
}

describe("dashboard sales table — the period", () => {
  it("lists the sales of the period on screen, not every sale", async () => {
    await renderLoaded();
    expect(listedDates()).toEqual(["5 ต.ค. 2569", "15 ต.ค. 2569", "10 ก.ย. 2569"]);
    // The header's รายการขาย button counts the same sales, not every year's 4.
    expect(document.querySelector("[data-records-count]")!.textContent).toBe("3");
  });

  it("follows ◀ to the year before", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" }));
    await waitFor(() => expect(heading()).toBe("รายการขาย ปี 2568 (1)"));
    expect(listedDates()).toEqual(["20 ธ.ค. 2568"]);
    expect(document.querySelector("[data-records-count]")!.textContent).toBe("1");
  });

  it("shows every sale on request", async () => {
    await renderLoaded();
    fireEvent.click(table().getByRole("button", { name: "ตามช่วงด้านบน" }));
    fireEvent.click(screen.getByRole("button", { name: "ทุกช่วงเวลา" }));
    expect(heading()).toBe("รายการขาย ทุกช่วงเวลา (4)");
  });
});

describe("dashboard sales table — a Top 10 row", () => {
  it("narrows the table to a product's bills — a bill holding it on its second line too", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Scale B/ }));
    await waitFor(() => expect(heading()).toBe("รายการขาย ปี 2569 (2)"));
    expect(listedDates()).toEqual(["5 ต.ค. 2569", "15 ต.ค. 2569"]);
    expect(document.querySelector("[data-sales-focus]")!.textContent).toContain("เฉพาะสินค้า «Scale B»");
    // Why the first bill is listed: its other product is named under it.
    expect(document.querySelector("[data-other-products]")!.textContent).toBe("+ Scale B");

    fireEvent.click(table().getByRole("button", { name: "เลิกกรองเฉพาะสินค้า «Scale B»" }));
    expect(heading()).toBe("รายการขาย ปี 2569 (3)");
  });

  it("narrows the table to a company's bills in the period", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /บริษัท เอ/ }));
    await waitFor(() => expect(heading()).toBe("รายการขาย ปี 2569 (2)"));
    expect(document.querySelector("[data-sales-focus]")!.textContent).toContain("เฉพาะบริษัท «บริษัท เอ»");
  });

  it("opens the bill when the period has only one — counting the period's bills, not every year's", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Scale C/ }));
    expect(await screen.findByText("รายละเอียดยอดขาย")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === "/api/admin/sales/rec-sep")).toBe(true);
  });

  it("brings the table back to the period when it was showing every sale", async () => {
    await renderLoaded();
    fireEvent.click(table().getByRole("button", { name: "ตามช่วงด้านบน" }));
    fireEvent.click(screen.getByRole("button", { name: "ทุกช่วงเวลา" }));
    fireEvent.click(screen.getByRole("button", { name: /Scale B/ }));
    await waitFor(() => expect(heading()).toBe("รายการขาย ปี 2569 (2)"));
  });

  it("a salesperson row lets go of a product the table was narrowed to", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Scale B/ }));
    await waitFor(() => expect(document.querySelector("[data-sales-focus]")).toBeTruthy());
    fireEvent.click(screen.getByRole("row", { name: "ดูประวัติการขายของ สมชาย" }));
    expect(document.querySelector("[data-sales-focus]")).toBeNull();
    expect((table().getByPlaceholderText(/ค้นหาสินค้า/) as HTMLInputElement).value).toBe("สมชาย");
  });
});

describe("dashboard sales table — Export", () => {
  const exportButton = () => screen.getByRole("button", { name: "Excel" });

  it("writes the period's sales, named after it, money as numbers", async () => {
    await renderLoaded();
    fireEvent.click(exportButton());
    await waitFor(() => expect(downloadExcel).toHaveBeenCalledTimes(1));
    const [filename, sheets] = vi.mocked(downloadExcel).mock.calls[0];
    expect(filename).toBe("sales-report-2026.xlsx");
    expect(sheets[0].name).toBe("Sales ปี 2569");
    const rows = sheets[0].rows as Record<string, unknown>[];
    expect(rows.map((r) => r["วันที่"])).toEqual(["2026-10-05", "2026-10-15", "2026-09-10"]);
    expect(rows[0]["ยอดรวม"]).toBe(3000);
    expect(rows[0]["ราคาต่อหน่วย"]).toBe(1000);
    expect(rows[0]["ต้นทุน"]).toBe(400);
    expect(rows[0]["กำไร"]).toBe(2600);
    expect(rows[0]["สินค้าทั้งหมดในบิล"]).toBe("Scale A, Scale B");
  });

  it("writes only the bills a Top 10 row narrowed the table to", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /บริษัท เอ/ }));
    await waitFor(() => expect(heading()).toBe("รายการขาย ปี 2569 (2)"));
    fireEvent.click(exportButton());
    await waitFor(() => expect(downloadExcel).toHaveBeenCalledTimes(1));
    const rows = vi.mocked(downloadExcel).mock.calls[0][1][0].rows as Record<string, unknown>[];
    expect(rows.map((r) => r["วันที่"])).toEqual(["2026-10-05", "2026-10-15"]);
  });

  it("names the file all when the table shows every sale", async () => {
    await renderLoaded();
    fireEvent.click(table().getByRole("button", { name: "ตามช่วงด้านบน" }));
    fireEvent.click(screen.getByRole("button", { name: "ทุกช่วงเวลา" }));
    fireEvent.click(exportButton());
    await waitFor(() => expect(downloadExcel).toHaveBeenCalledTimes(1));
    const [filename, sheets] = vi.mocked(downloadExcel).mock.calls[0];
    expect(filename).toBe("sales-report-all.xlsx");
    expect(sheets[0].name).toBe("Sales ทุกช่วงเวลา");
    expect(sheets[0].rows).toHaveLength(4);
  });
});

// Item 7 — opening a sale fetches it first: the page says so meanwhile, and a second click waits.
describe("dashboard — opening a sale", () => {
  function gateSale(id: string) {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const working = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === `/api/admin/sales/${id}`) await held;
      return working(input, init);
    });
    return () => release();
  }
  const saleCalls = (path: string) => vi.mocked(fetch).mock.calls.filter(([u]) => new URL(String(u), "http://localhost").pathname === path).length;

  it("says it is opening the sale, marks its row, and opens nothing else meanwhile", async () => {
    await renderLoaded();
    const release = gateSale("rec-oct");
    const row = table().getByText("Scale A").closest("tr")!;
    fireEvent.click(row);
    expect(await screen.findByTestId("opening-sale")).toHaveTextContent("กำลังเปิดรายการขาย…");
    expect(row.getAttribute("aria-busy")).toBe("true");
    // A second click — on this row or another — waits for the first.
    fireEvent.click(table().getByText("Scale C").closest("tr")!);
    expect(saleCalls("/api/admin/sales/rec-sep")).toBe(0);
    release();
    await waitFor(() => expect(screen.queryByTestId("opening-sale")).toBeNull());
    expect(row.getAttribute("aria-busy")).toBeNull();
  });

  it("says it is loading the sale to edit, and holds every แก้ไข until the form opens", async () => {
    await renderLoaded();
    const release = gateSale("rec-oct");
    const row = table().getByText("Scale A").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    expect(await screen.findByTestId("opening-sale")).toHaveTextContent("กำลังโหลดรายการขายเพื่อแก้ไข…");
    expect(table().getAllByRole("button", { name: "แก้ไข" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    release();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "แก้ไขรายการ" })).toBeTruthy());
    expect(screen.queryByTestId("opening-sale")).toBeNull();
  });
});
