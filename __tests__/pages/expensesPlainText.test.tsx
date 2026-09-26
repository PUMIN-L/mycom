/**
 * /expenses shows an expense's own fields exactly as typed. They are plain
 * text (schema v44 stores "<" as "<"), and the page used to run them through
 * a tag regex that cut from any "<" to the end — "ค่าส่ง <5 กก." showed as
 * "ค่าส่ง", and because the edit form is filled from the same row, saving the
 * edit wrote the cut text back. Only a row derived from a sale carries HTML
 * (a catalog product name, a rich category name), and that is read as HTML.
 */
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("recharts", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    PieChart: Box, Pie: Box, Cell: () => null, Tooltip: () => null, Legend: () => null, ResponsiveContainer: Box,
  };
});

import ExpensesPage from "@/app/expenses/page";

const OWN = {
  id: "e1",
  title: "ค่าส่ง <5 กก.",
  amount: 150,
  expenseDate: "2026-09-10",
  category: "ค่าขนส่ง",
  note: "ช่วง x < y > z",
  createdAt: "2026-09-10T03:00:00.000Z",
  source: "expense",
};
const FROM_SALE = {
  id: "s1",
  title: "<p>A &amp; B</p> (ต้นทุนขาย)",
  amount: 900,
  expenseDate: "2026-09-11",
  category: "ต้นทุน: <p>เครื่องชั่ง &amp; ตาชั่ง</p>",
  note: "อ้างอิงจากลูกค้า: สมชาย",
  createdAt: "2026-09-11T03:00:00.000Z",
  source: "sale_cost",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/admin/expenses?") ? [OWN, FROM_SALE] : [];
      return { ok: true, status: 200, json: async () => body };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/expenses — plain text is shown and edited as typed", () => {
  it("shows an expense's title and note in full, angle brackets included", async () => {
    render(<ExpensesPage />);
    expect(await screen.findByText("ค่าส่ง <5 กก.", { exact: false })).toBeDefined();
    expect(screen.getByText("ช่วง x < y > z")).toBeDefined();
  });

  it("fills the edit form with the full text — saving it cannot write a cut version back", async () => {
    render(<ExpensesPage />);
    const row = (await screen.findByText("ช่วง x < y > z")).closest("tr")!;
    fireEvent.click(within(row).getByTitle("แก้ไข"));

    expect(screen.getByDisplayValue("ค่าส่ง <5 กก.")).toBeDefined();
    expect(screen.getByDisplayValue("ช่วง x < y > z")).toBeDefined();
  });

  it("reads a sale-derived row's product and category names as HTML", async () => {
    render(<ExpensesPage />);
    expect(await screen.findByText("A & B (ต้นทุนขาย)", { exact: false })).toBeDefined();
    expect(screen.getAllByText("ต้นทุน: เครื่องชั่ง & ตาชั่ง").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("&amp;");
    expect(document.body.textContent).not.toContain("<p>");
  });
});
