/**
 * The dashboard's สัดส่วนตามหมวดหมู่ chart. Its names and percentages used to be
 * slice labels around the pie, in 10px type and the slice's colour, and a long
 * name ran off the card ("ไม่ระบุหมวด 13.7…"). They are now a key under the
 * donut — ink-coloured, wrapping, with each share and amount — and the slices
 * take a validated palette in a fixed order, never cycled.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import CategoryShareChart from "@/app/dashboard/CategoryShareChart";
import {
  categorySlices,
  CATEGORY_COLORS,
  OTHER_COLOR,
  UNCATEGORISED_COLOR,
} from "@/app/dashboard/categorySlices";
import type { TopItem } from "@/app/dashboard/types";

// jsdom has no layout, so a ResponsiveContainer would measure 0x0 and warn;
// the key under the chart is what these tests read.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

const item = (id: string, name: string, revenue: number): TopItem => ({ id, name, revenue, qty: 1, deals: 1, percentage: 0 });

describe("categorySlices", () => {
  it("gives each category its own hue in the fixed order, largest first", () => {
    const slices = categorySlices([item("a", "A", 300), item("b", "B", 200), item("c", "C", 100)]);
    expect(slices.map((s) => s.color)).toEqual(CATEGORY_COLORS.slice(0, 3));
    expect(slices.map((s) => s.percentage)).toEqual([50, 33.33, 16.67]);
  });

  it("folds categories past the eighth into one อื่นๆ slice instead of reusing a hue", () => {
    const many = Array.from({ length: 11 }, (_, i) => item(`c${i}`, `หมวด ${i}`, 110 - i * 10));
    const slices = categorySlices(many);
    expect(slices).toHaveLength(9);
    expect(slices.slice(0, 8).map((s) => s.color)).toEqual([...CATEGORY_COLORS]);
    const other = slices[8];
    expect(other).toMatchObject({ key: "other-categories", name: "อื่นๆ (3 หมวด)", revenue: 30 + 20 + 10, color: OTHER_COLOR });
    expect(new Set(slices.map((s) => s.color)).size).toBe(9);
  });

  it("keeps ไม่ระบุหมวด as its own grey slice, last, whatever its size", () => {
    const slices = categorySlices([item("unknown", "ไม่ระบุหมวด", 500), item("p", "งานพิมพ์", 100)]);
    expect(slices.map((s) => [s.name, s.color])).toEqual([
      ["งานพิมพ์", CATEGORY_COLORS[0]],
      ["ไม่ระบุหมวด", UNCATEGORISED_COLOR],
    ]);
    expect(slices[1].percentage).toBe(83.33);
  });

  it("merges every uncategorised row — no category, or a deleted one — into ONE grey slice", () => {
    // A deleted category keeps its id but comes back with the fallback name.
    const slices = categorySlices([
      item("p", "งานพิมพ์", 300),
      item("unknown", "ไม่ระบุหมวด", 100),
      item("7", "ไม่ระบุหมวด", 50),
      item("9", "ไม่ระบุหมวด", 50),
    ]);
    expect(slices.map((s) => [s.name, s.revenue, s.color])).toEqual([
      ["งานพิมพ์", 300, CATEGORY_COLORS[0]],
      ["ไม่ระบุหมวด", 200, UNCATEGORISED_COLOR],
    ]);
    expect(slices[1].percentage).toBe(40);
  });

  it("gives every slice its own key, even for a category whose id is 'other' or 'uncategorised'", () => {
    const many = [item("other", "หมวด other", 1000), item("uncategorised", "หมวด u", 900)].concat(
      Array.from({ length: 9 }, (_, i) => item(`c${i}`, `หมวด ${i}`, 100 - i))
    );
    const keys = categorySlices([...many, item("unknown", "ไม่ระบุหมวด", 5)]).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves out categories with nothing sold", () => {
    expect(categorySlices([item("a", "A", 100), item("z", "Z", 0)]).map((s) => s.name)).toEqual(["A"]);
  });
});

describe("CategoryShareChart", () => {
  it("lists every category under the chart: name (tags stripped), share and amount", () => {
    render(
      <CategoryShareChart
        items={[item("p", "<p>งานพิมพ์</p>", 250000), item("unknown", "ไม่ระบุหมวด", 39750)]}
      />
    );
    const rows = within(screen.getByRole("list", { name: "สัดส่วนยอดขายตามหมวดหมู่" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["งานพิมพ์86.28%฿250,000", "ไม่ระบุหมวด13.72%฿39,750"]);
  });

  it("wraps a long name instead of cutting it off", () => {
    const long = "เครื่องชั่งน้ำหนักดิจิตอลความละเอียดสูงสำหรับห้องปฏิบัติการวิเคราะห์ทางเคมี";
    render(<CategoryShareChart items={[item("a", long, 100), item("b", "อื่น", 50)]} />);
    const name = screen.getByText(long);
    expect(name.className).toContain("break-words");
    expect(name.className).not.toContain("truncate");
  });

  it("shows the total in the middle of the donut", () => {
    render(<CategoryShareChart items={[item("a", "A", 1000), item("b", "B", 234)]} />);
    expect(screen.getByText("ยอดรวม").nextElementSibling?.textContent).toBe("฿1,234");
  });

  it("says there is no data when nothing was sold", () => {
    render(<CategoryShareChart items={[item("a", "A", 0)]} />);
    expect(screen.getByText("ยังไม่มีข้อมูล")).toBeTruthy();
  });
});
