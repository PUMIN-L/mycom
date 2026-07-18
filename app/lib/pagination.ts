// Which page buttons to show in a paginator: the first 3 and last 3 pages, plus
// a window around the current page, with "…" filling the gaps
// (e.g. 1 2 3 … 8 9 10). Small counts (<= 7) show every page.
// Pure + dependency-free so it can be unit-tested and shared by client UIs.
export function pageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>();
  for (const p of [1, 2, 3, total - 2, total - 1, total, current - 1, current, current + 1]) {
    if (p >= 1 && p <= total) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}
