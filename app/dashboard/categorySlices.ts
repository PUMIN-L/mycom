// The slices of the dashboard's สัดส่วนตามหมวดหมู่ chart. Pure — the chart
// draws them, the tests pin them.
import type { TopItem } from "./types";

/**
 * One hue per category, assigned in this order and never cycled. The order is
 * what keeps neighbours apart for colour-blind readers — validated with the
 * dataviz palette checker (light): lightness band, chroma floor, adjacent CVD
 * separation and normal-vision separation all pass. The previous ten-colour
 * list failed CVD (pink beside teal, ΔE 3.7 deutan).
 */
export const CATEGORY_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#6250d6", // violet
  "#e34948", // red
] as const;

/** "ไม่ระบุหมวด" and the folded remainder are not categories: neutrals. */
export const UNCATEGORISED_COLOR = "#898781";
export const OTHER_COLOR = "#c3c2b7";

/**
 * How the store marks sales lines without a live category. A line with NO
 * category comes back with id "unknown"; a line whose category was DELETED
 * keeps that category's id but gets the fallback name — so one chart could show
 * several "ไม่ระบุหมวด" rows in different colours. Either mark puts a row in
 * the one grey uncategorised slice.
 */
const UNCATEGORISED_ID = "unknown";
const UNCATEGORISED_NAME = "ไม่ระบุหมวด";
const isUncategorised = (item: TopItem) => item.id === UNCATEGORISED_ID || item.name === UNCATEGORISED_NAME;

export interface CategorySlice {
  key: string;
  name: string;
  revenue: number;
  percentage: number;
  color: string;
}

const percentageOf = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 10000) / 100 : 0;

/**
 * Categories with sales, largest first (the order the store returns), each
 * with its own hue. Past the eighth, the rest fold into one "อื่นๆ (n หมวด)"
 * slice rather than reuse a hue; everything uncategorised is ONE grey
 * "ไม่ระบุหมวด" slice. Both neutrals come last. Percentages are of the total of
 * every slice.
 */
export function categorySlices(items: readonly TopItem[]): CategorySlice[] {
  const sold = items.filter((item) => item.revenue > 0);
  const total = sold.reduce((sum, item) => sum + item.revenue, 0);
  const named = sold.filter((item) => !isUncategorised(item));
  const shown = named.slice(0, CATEGORY_COLORS.length);
  const rest = named.slice(CATEGORY_COLORS.length);
  const uncategorisedRevenue = sold.filter(isUncategorised).reduce((sum, item) => sum + item.revenue, 0);

  // Keys are namespaced: a category whose id happened to be "other" must not
  // collide with the folded slice.
  const slices: CategorySlice[] = shown.map((item, i) => ({
    key: `category:${item.id}`,
    name: item.name,
    revenue: item.revenue,
    percentage: percentageOf(item.revenue, total),
    color: CATEGORY_COLORS[i],
  }));
  if (rest.length > 0) {
    const revenue = rest.reduce((sum, item) => sum + item.revenue, 0);
    slices.push({
      key: "other-categories",
      name: `อื่นๆ (${rest.length} หมวด)`,
      revenue,
      percentage: percentageOf(revenue, total),
      color: OTHER_COLOR,
    });
  }
  if (uncategorisedRevenue > 0) {
    slices.push({
      key: "uncategorised",
      name: UNCATEGORISED_NAME,
      revenue: uncategorisedRevenue,
      percentage: percentageOf(uncategorisedRevenue, total),
      color: UNCATEGORISED_COLOR,
    });
  }
  return slices;
}
