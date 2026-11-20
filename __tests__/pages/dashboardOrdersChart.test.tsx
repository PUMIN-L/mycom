/**
 * /dashboard — "ยอดตาม PO ลูกค้า": a chart of the customer POs received in the
 * period on screen, by their PO date. The owner: "แค่มี po ก็เอายอดมาใส่เลย
 * ไม่ต้องรอจ่ายเงิน วันที่ให้บันทึกตามวันที่ po" (2026-11-20). Kept apart from
 * the sales chart (sales count when invoiced), so a deal is never in one
 * chart twice.
 */
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cloneElement, type ReactElement } from "react";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 260 } as never),
  };
});

import OrdersChartSection from "@/app/dashboard/OrdersChartSection";

const YEAR = { start: "2026-01-01", end: "2027-01-01" };
const DAYS = [
  { date: "2026-11-03", count: 1, exVatSatang: 10000000 },
  { date: "2026-11-20", count: 2, exVatSatang: 5050000 },
  { date: "2026-03-09", count: 1, exVatSatang: 2500000 },
];

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const values = () => within(screen.getByTestId("orders-chart-values")).getAllByRole("listitem").map((li) => li.textContent);

describe("ยอดตาม PO ลูกค้า", () => {
  it("asks for the period's POs, never cached, and shows the total and each month", async () => {
    const fetchMock = stub(200, { from: YEAR.start, to: YEAR.end, days: DAYS });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    expect(await screen.findByText(/รวม 4 PO/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/accounting/sales-orders/by-date?from=2026-01-01&to=2027-01-01", { cache: "no-store" });
    expect(screen.getByRole("heading", { name: "ยอดตาม PO ลูกค้า ปี 2569" })).toBeInTheDocument();
    expect(screen.getByTestId("orders-chart-total").textContent).toContain("฿175,500.00");
    expect(values()).toHaveLength(12);
    expect(values()[10]).toBe("พ.ย.: ฿150,500.00 (3 PO)");
    expect(values()[2]).toBe("มี.ค.: ฿25,000.00 (1 PO)");
    expect(values()[0]).toBe("ม.ค.: ฿0.00 (0 PO)");
  });

  it("says what it counts: a PO on the day it was received, before VAT, not in the sales figures", async () => {
    stub(200, { from: YEAR.start, to: YEAR.end, days: DAYS });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/รวม 4 PO/);
    const note = screen.getByTestId("orders-chart-note").textContent ?? "";
    expect(note).toContain("ตามวันที่ใน PO");
    expect(note).toContain("ไม่ต้องรอส่งของหรือรับเงิน");
    expect(note).toContain("ก่อน VAT");
    expect(note).toContain("ไม่รวม PO ที่ยกเลิก");
  });

  it("a month shows its days", async () => {
    stub(200, { from: "2026-02-01", to: "2026-03-01", days: [{ date: "2026-02-14", count: 1, exVatSatang: 100 }] });
    render(<OrdersChartSection periodType="month" range={{ start: "2026-02-01", end: "2026-03-01" }} label="เดือน ก.พ. 2569" />);
    await screen.findByText(/รวม 1 PO/);
    expect(values()).toHaveLength(28);
    expect(values()[13]).toBe("14: ฿1.00 (1 PO)");
  });

  it("asks again when the period on the page changes", async () => {
    const fetchMock = stub(200, { from: YEAR.start, to: YEAR.end, days: [] });
    const { rerender } = render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/ยังไม่มี PO ลูกค้าในช่วงนี้/);
    rerender(<OrdersChartSection periodType="year" range={{ start: "2025-01-01", end: "2026-01-01" }} label="ปี 2568" />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/accounting/sales-orders/by-date?from=2025-01-01&to=2026-01-01", { cache: "no-store" })
    );
  });

  it("with no PO in the period, says so and offers to record one", async () => {
    stub(200, { from: YEAR.start, to: YEAR.end, days: [] });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    expect(await screen.findByText(/ยังไม่มี PO ลูกค้าในช่วงนี้/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /รับ PO ลูกค้า/ })).toHaveAttribute("href", "/accounting/sales-orders/new");
  });

  it("hides itself while the accounting module is switched off (404)", async () => {
    const fetchMock = stub(404, { error: "x" });
    const { container } = render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("a failed load says so, and ลองใหม่ asks again — the dashboard stays up", async () => {
    stub(500, { error: "โหลดยอดตาม PO ลูกค้าไม่สำเร็จ" });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดยอดตาม PO ลูกค้าไม่สำเร็จ");
    stub(200, { from: YEAR.start, to: YEAR.end, days: DAYS });
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText(/รวม 4 PO/)).toBeInTheDocument();
  });

  it("an answer of the wrong shape is an error, not a crash", async () => {
    stub(200, { from: YEAR.start, to: YEAR.end, days: [{ date: "2026-11-03", count: "two" }] });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดยอดตาม PO ลูกค้าไม่สำเร็จ");
  });

  it("a dropped connection is an error with a retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ตรวจสอบการเชื่อมต่อ");
  });
});

// The owner, 2026-11-20: "ทำให้ปรับดูรายปี รายไตรมาส รายอาทิตย์ได้ด้วย".
describe("ยอดตาม PO ลูกค้า — แบ่งแท่งกราฟ", () => {
  const group = () => screen.getByRole("group", { name: "แบ่งแท่งกราฟ PO" });
  const offered = () => within(group()).getAllByRole("button").map((b) => b.textContent);
  const pressed = () =>
    within(group())
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
  const Q4 = { start: "2026-10-01", end: "2027-01-01" };
  const FEB = { start: "2026-02-01", end: "2026-03-01" };

  it("for a year: by week, by month (chosen), by quarter, by year", async () => {
    stub(200, { from: YEAR.start, to: YEAR.end, days: DAYS });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/รวม 4 PO/);
    expect(offered()).toEqual(["สัปดาห์", "เดือน", "ไตรมาส", "ปี"]);
    expect(pressed()).toEqual(["เดือน"]);
  });

  it("never offers a single bar: a quarter has no ไตรมาส, a month opens by day", async () => {
    stub(200, { from: Q4.start, to: Q4.end, days: [] });
    const { rerender } = render(<OrdersChartSection periodType="quarter" range={Q4} label="ไตรมาส 4/2569" />);
    await screen.findByText(/ยังไม่มี PO ลูกค้าในช่วงนี้/);
    expect(offered()).toEqual(["สัปดาห์", "เดือน", "ปี"]);
    rerender(<OrdersChartSection periodType="month" range={FEB} label="เดือน ก.พ. 2569" />);
    await waitFor(() => expect(offered()).toEqual(["วัน", "สัปดาห์", "ปี"]));
    expect(pressed()).toEqual(["วัน"]);
  });

  it("ไตรมาส: the year's four quarters, from the answer already there", async () => {
    const fetchMock = stub(200, { from: YEAR.start, to: YEAR.end, days: DAYS });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/รวม 4 PO/);
    fireEvent.click(within(group()).getByRole("button", { name: "ไตรมาส" }));
    expect(pressed()).toEqual(["ไตรมาส"]);
    expect(values()).toEqual([
      "ไตรมาส 1: ฿25,000.00 (1 PO)",
      "ไตรมาส 2: ฿0.00 (0 PO)",
      "ไตรมาส 3: ฿0.00 (0 PO)",
      "ไตรมาส 4: ฿150,500.00 (3 PO)",
    ]);
    // The same days, divided again — nothing asked twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("สัปดาห์: one bar a week, Monday to Sunday", async () => {
    stub(200, { from: YEAR.start, to: YEAR.end, days: DAYS });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/รวม 4 PO/);
    fireEvent.click(within(group()).getByRole("button", { name: "สัปดาห์" }));
    expect(values()).toHaveLength(53);
    expect(values()).toContain("2 พ.ย.: ฿100,000.00 (1 PO)");
    expect(values()).toContain("16 พ.ย.: ฿50,500.00 (2 PO)");
    expect(values()).toContain("9 มี.ค.: ฿25,000.00 (1 PO)");
    // The total does not change with the way the bars are divided.
    expect(screen.getByTestId("orders-chart-total").textContent).toContain("฿175,500.00");
  });

  it("ปี: asks for the five years up to the period's, and the heading says which", async () => {
    const fetchMock = stub(200, { from: "2022-01-01", to: "2027-01-01", days: DAYS });
    render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/รวม 4 PO/);
    fireEvent.click(within(group()).getByRole("button", { name: "ปี" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/accounting/sales-orders/by-date?from=2022-01-01&to=2027-01-01", { cache: "no-store" })
    );
    expect(screen.getByRole("heading", { name: "ยอดตาม PO ลูกค้า ปี 2565–2569" })).toBeInTheDocument();
    await waitFor(() => expect(values()).toHaveLength(5));
    expect(values()[0]).toBe("2565: ฿0.00 (0 PO)");
    expect(values()[4]).toBe("2569: ฿175,500.00 (4 PO)");
  });

  it("keeps the choice when the period changes — unless there it would be a single bar", async () => {
    stub(200, { from: YEAR.start, to: YEAR.end, days: [] });
    const { rerender } = render(<OrdersChartSection periodType="year" range={YEAR} label="ปี 2569" />);
    await screen.findByText(/ยังไม่มี PO ลูกค้าในช่วงนี้/);
    fireEvent.click(within(group()).getByRole("button", { name: "สัปดาห์" }));
    rerender(<OrdersChartSection periodType="quarter" range={Q4} label="ไตรมาส 4/2569" />);
    await waitFor(() => expect(pressed()).toEqual(["สัปดาห์"]));
    fireEvent.click(within(group()).getByRole("button", { name: "เดือน" }));
    rerender(<OrdersChartSection periodType="month" range={FEB} label="เดือน ก.พ. 2569" />);
    // A month by month is one bar: back to the month's own way, by day.
    await waitFor(() => expect(pressed()).toEqual(["วัน"]));
  });
});
