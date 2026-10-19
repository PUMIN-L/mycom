/**
 * The sales dashboard's header and overview, through the real page:
 *
 *  • the badge names the period on screen (it said ประจำปี for a month too);
 *  • period names are in พ.ศ.; ◀ ▶ step the period, the "now" button jumps
 *    back, and neither goes past the current period or the oldest year;
 *  • the overview cards sit in two full rows, say what each change is
 *    measured against, colour a COST going up red, and move rates in points;
 *  • a slow response for an earlier period never overwrites a newer one;
 *  • list rows are buttons (no "(คลิก…)" notes) and the team rows answer Enter;
 *  • the sales chart marks today's month.
 */
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { periodLabel } from "@/app/lib/dashboardPeriod";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
// A fixed-size chart, so the axes (and today's marker) render in jsdom.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 280 } as never),
  };
});

import DashboardPage from "@/app/dashboard/page";

const NOW = { year: 2026, month: 9 }; // 19 Oct 2026, Bangkok

const overviewOf = (revenue: number) => ({
  currentPeriod: { revenue, cost: 60000, profit: 30000, deals: 3, newCustomers: 2, quotations: 6 },
  previousPeriod: { revenue: revenue / 1.5, cost: 40000, profit: 15000, deals: 2, newCustomers: 4, quotations: 5 },
  expiringWarranties: 0,
});

function dashboardBody(type: string, value: string, revenue = 150000) {
  const monthly = type === "year"
    ? Array.from({ length: 12 }, (_, i) => ({ period: `${value}-${String(i + 1).padStart(2, "0")}`, revenue: 1000, deals: 1, cost: 0, expense: 0, profit: 0, margin: 0 }))
    : [];
  return {
    overview: { ...overviewOf(revenue), periodLabel: periodLabel(type as "year", value, NOW) },
    revenueMonthly: monthly,
    revenueQuarterly: [],
    revenueByCategory: [],
    topProducts: [{ id: "p1", name: "เครื่องชั่ง A", revenue: 90000, qty: 3, deals: 2, percentage: 60 }],
    topCustomers: [{ id: "c1", name: "บริษัท ลูกค้า", revenue: 90000, qty: 0, deals: 2, percentage: 60 }],
    salespersonLeaderboard: [{ id: "s1", name: "สมชาย", revenue: 150000, deals: 3, percentage: 100, avgDealSize: 50000 }],
    insights: [],
  };
}

/** Requests the page made to the dashboard API, as [type, value]. */
let dashboardCalls: Array<[string, string]> = [];
/** When set, a dashboard request waits for the test to release it. */
let gate: ((type: string, value: string) => Promise<void>) | null = null;

beforeEach(() => {
  // jsdom has no scrollIntoView; the page scrolls to the sales table.
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T05:00:00Z"));
  dashboardCalls = [];
  gate = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/admin/dashboard") {
      const type = url.searchParams.get("periodType") ?? "";
      const value = url.searchParams.get("periodValue") ?? "";
      dashboardCalls.push([type, value]);
      if (gate) await gate(type, value);
      const revenue = value === "2025" ? 120000 : 150000;
      return { ok: true, status: 200, json: async () => dashboardBody(type, value, revenue) };
    }
    return { ok: true, status: 200, json: async () => [] };
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const badge = () => screen.getByText(/^ภาพรวม(ปี|เดือน|ไตรมาส)/);
const lastCall = () => dashboardCalls[dashboardCalls.length - 1];
const overview = () => within(document.querySelector("[data-overview-cards]") as HTMLElement);
const card = (label: string) => overview().getByText(label).closest("div.rounded-2xl") as HTMLElement;

async function renderLoaded() {
  render(<DashboardPage />);
  await waitFor(() => expect(document.querySelector("[data-overview-cards]")).toBeTruthy());
  expect(overview().getByText("ยอดขาย ปี 2569")).toBeTruthy();
}

describe("dashboard — the period", () => {
  it("names the period on screen, in พ.ศ., in the badge and the year picker", async () => {
    await renderLoaded();
    expect(badge().textContent).toBe("ภาพรวมปี 2569");
    expect(screen.getByRole("button", { name: /ปี 2569/ })).toBeTruthy();
    expect(screen.queryByText("ภาพรวมธุรกิจประจำปี")).toBeNull();
  });

  it("steps back a year with ◀, forward with ▶, and jumps back with ปีนี้ — never past now", async () => {
    await renderLoaded();
    const back = screen.getByRole("button", { name: "ช่วงก่อนหน้า" });
    const forward = screen.getByRole("button", { name: "ช่วงถัดไป" });
    const now = screen.getByRole("button", { name: "ปีนี้" });
    expect(forward).toBeDisabled();
    expect(now).toBeDisabled();

    fireEvent.click(back);
    await waitFor(() => expect(lastCall()).toEqual(["year", "2025"]));
    expect(badge().textContent).toBe("ภาพรวมปี 2568");
    expect(forward).not.toBeDisabled();
    expect(now).not.toBeDisabled();

    fireEvent.click(now);
    await waitFor(() => expect(lastCall()).toEqual(["year", "2026"]));
    expect(forward).toBeDisabled();
  });

  it("offers the new year in its picker when the page was left open over New Year", async () => {
    vi.setSystemTime(new Date("2026-12-31T16:58:00Z")); // 23:58 on 31 Dec in Bangkok
    await renderLoaded();
    vi.setSystemTime(new Date("2026-12-31T17:05:00Z")); // 00:05 on 1 Jan 2027
    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" })); // any re-render
    await waitFor(() => expect(lastCall()).toEqual(["year", "2025"]));
    fireEvent.click(screen.getByRole("button", { name: "ปีนี้" }));
    await waitFor(() => expect(lastCall()).toEqual(["year", "2027"]));
    expect(screen.getByRole("button", { name: /ปี 2570/ })).toBeTruthy();
  });

  it("keeps the period on screen when the type already shown is picked again", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" }));
    await waitFor(() => expect(lastCall()).toEqual(["year", "2025"]));
    const calls = dashboardCalls.length;
    fireEvent.click(screen.getByRole("button", { name: "รายปี" }));
    const options = screen.getAllByRole("button", { name: "รายปี" });
    fireEvent.click(options[options.length - 1]);
    expect(badge().textContent).toBe("ภาพรวมปี 2568");
    expect(dashboardCalls.length).toBe(calls);
  });

  it("does not step back past the oldest year the pickers offer", async () => {
    await renderLoaded();
    const back = screen.getByRole("button", { name: "ช่วงก่อนหน้า" });
    for (let i = 0; i < 4; i++) fireEvent.click(back);
    await waitFor(() => expect(lastCall()).toEqual(["year", "2022"]));
    expect(back).toBeDisabled();
  });

  it("switches to months: the current month, named in พ.ศ., stepping month by month", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "รายปี" }));
    // The period-type panel portals to <body>, after the chart toggle of the same name.
    const options = screen.getAllByRole("button", { name: "รายเดือน" });
    fireEvent.click(options[options.length - 1]);
    await waitFor(() => expect(lastCall()).toEqual(["month", "2026-10"]));
    expect(badge().textContent).toBe("ภาพรวมเดือน ต.ค. 2569");
    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" }));
    await waitFor(() => expect(lastCall()).toEqual(["month", "2026-09"]));
    expect(badge().textContent).toBe("ภาพรวมเดือน ก.ย. 2569");
    await waitFor(() => expect(screen.getAllByText("จากเดือนก่อน").length).toBeGreaterThan(0));
  });

  it("keeps the newest period's figures when an older request answers last", async () => {
    let releaseFirst!: () => void;
    let first = true;
    gate = (_type, value) =>
      first && value === "2026" ? ((first = false), new Promise<void>((r) => { releaseFirst = r; })) : Promise.resolve();
    render(<DashboardPage />);
    await waitFor(() => expect(dashboardCalls).toEqual([["year", "2026"]]));

    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" }));
    await waitFor(() => expect(overview().getByText("ยอดขาย ปี 2568")).toBeTruthy());

    await act(async () => { releaseFirst(); });
    // The 2026 answer arrived late; the 2025 figures stay.
    expect(overview().getByText("ยอดขาย ปี 2568")).toBeTruthy();
    expect(overview().queryByText("ยอดขาย ปี 2569")).toBeNull();
    expect(overview().getByText("฿120,000")).toBeTruthy();
  });
});

describe("dashboard — while loading and on failure", () => {
  it("titles the chart with the period picked, even while it loads", async () => {
    await renderLoaded();
    gate = () => new Promise<void>(() => {}); // the next period never answers
    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" }));
    expect(await screen.findByRole("heading", { name: "ยอดขาย ปี 2568" })).toBeTruthy();
  });

  it("shows no figures — not the previous period's — when a period fails to load", async () => {
    await renderLoaded();
    vi.mocked(fetch).mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    fireEvent.click(screen.getByRole("button", { name: "ช่วงก่อนหน้า" }));
    expect(await screen.findByText("โหลดข้อมูล Dashboard ไม่สำเร็จ กรุณาลองใหม่")).toBeTruthy();
    expect(document.querySelector("[data-overview-cards]")).toBeNull();
    expect(screen.queryByText("฿150,000")).toBeNull();
  });
});

describe("dashboard — the overview cards", () => {
  it("sits in two full rows: four money cards, three selling cards", async () => {
    await renderLoaded();
    const rows = Array.from(document.querySelector("[data-overview-cards]")!.children);
    expect(rows.map((r) => r.children.length)).toEqual([4, 3]);
  });

  it("says what each change is measured against, in one ink, without a hover lift", async () => {
    await renderLoaded();
    const sales = card("ยอดขาย ปี 2569");
    expect(within(sales).getByText("฿150,000").className).toContain("text-gray-900");
    expect(within(sales).getByText("↑50%").className).toContain("text-emerald-600");
    expect(within(sales).getByText("จากปีก่อน")).toBeTruthy();
    expect(sales.className).not.toContain("hover:-translate-y-1");
  });

  it("colours a cost going UP red", async () => {
    await renderLoaded();
    expect(within(card("ต้นทุนและรายจ่ายรวม")).getByText("↑50%").className).toContain("text-red-500");
    expect(within(card("ลูกค้าใหม่")).getByText("↓50%").className).toContain("text-red-500");
  });

  it("moves the margin and the conversion rate in points", async () => {
    await renderLoaded();
    // margin 30,000/150,000 = 20% vs 15,000/100,000 = 15%; conversion 3/6 = 50% vs 2/5 = 40%
    expect(within(card("Profit Margin")).getByText("20%")).toBeTruthy();
    expect(within(card("Profit Margin")).getByText("↑5 จุด")).toBeTruthy();
    expect(within(card("Conversion Rate")).getByText("↑10 จุด")).toBeTruthy();
  });
});

describe("dashboard — lists and chart", () => {
  it("has no (คลิก…) notes; the top-10 rows are buttons", async () => {
    await renderLoaded();
    expect(document.body.textContent).not.toMatch(/\(คลิก/);
    expect(screen.getByRole("button", { name: /เครื่องชั่ง A/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /บริษัท ลูกค้า/ })).toBeTruthy();
  });

  it("opens a salesperson's sales from the keyboard", async () => {
    await renderLoaded();
    const row = screen.getByRole("row", { name: "ดูประวัติการขายของ สมชาย" });
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect((screen.getByPlaceholderText(/ค้นหาสินค้า/) as HTMLInputElement).value).toBe("สมชาย"));
  });

  it("marks today's month on the sales chart", async () => {
    await renderLoaded();
    await waitFor(() => expect(screen.getAllByText("เดือนนี้").length).toBeGreaterThan(0));
  });
});
