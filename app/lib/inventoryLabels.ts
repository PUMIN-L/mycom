// Sticker sheets for /assets and /stock (optional — nothing else depends on
// printing them). Pure layout: which piece goes in which cell of which page.
//
// The sizes are the common blank-label stocks; nobody has bought paper yet,
// so the page lets the admin pick one and says to test-print on plain paper
// first. A new stock is one more entry here.

export interface LabelPreset {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  cols: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  /** Space between columns / rows. */
  gapXMm: number;
  gapYMm: number;
}

export const LABEL_PRESETS: readonly LabelPreset[] = [
  {
    id: "a4-3x8",
    name: "A4 · 3 × 8 ดวง (70 × 37 มม.)",
    pageWidthMm: 210,
    pageHeightMm: 297,
    cols: 3,
    rows: 8,
    labelWidthMm: 70,
    labelHeightMm: 37,
    marginTopMm: 0.5,
    marginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
  },
  {
    id: "a4-2x7",
    name: "A4 · 2 × 7 ดวง (99.1 × 38.1 มม.)",
    pageWidthMm: 210,
    pageHeightMm: 297,
    cols: 2,
    rows: 7,
    labelWidthMm: 99.1,
    labelHeightMm: 38.1,
    marginTopMm: 15.15,
    marginLeftMm: 4.65,
    gapXMm: 2.5,
    gapYMm: 0,
  },
  {
    id: "a4-4x10",
    name: "A4 · 4 × 10 ดวง (48.5 × 25.4 มม.)",
    pageWidthMm: 210,
    pageHeightMm: 297,
    cols: 4,
    rows: 10,
    labelWidthMm: 48.5,
    labelHeightMm: 25.4,
    marginTopMm: 21.5,
    marginLeftMm: 8,
    gapXMm: 0,
    gapYMm: 0,
  },
  {
    id: "roll-62x29",
    name: "ม้วนฉลาก 62 × 29 มม. (เครื่องพิมพ์ฉลาก)",
    pageWidthMm: 62,
    pageHeightMm: 29,
    cols: 1,
    rows: 1,
    labelWidthMm: 62,
    labelHeightMm: 29,
    marginTopMm: 0,
    marginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
  },
];

export const DEFAULT_LABEL_PRESET_ID = "a4-3x8";

export function labelPreset(id: string | null | undefined): LabelPreset {
  return LABEL_PRESETS.find((p) => p.id === id) ?? LABEL_PRESETS.find((p) => p.id === DEFAULT_LABEL_PRESET_ID)!;
}

export function labelsPerPage(p: LabelPreset): number {
  return p.cols * p.rows;
}

/** A start position the sheet actually has (1 … labels per page). */
export function clampStartAt(p: LabelPreset, startAt: number): number {
  const n = Math.floor(Number(startAt));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, labelsPerPage(p));
}

/**
 * Pages of cells, row by row. The first page leaves cells 1 … startAt−1 empty
 * (null) — the labels already peeled off a part-used sheet.
 */
export function layoutLabels<T>(items: T[], p: LabelPreset, startAt = 1): Array<Array<T | null>> {
  if (items.length === 0) return [];
  const perPage = labelsPerPage(p);
  const cells: Array<T | null> = [...Array(clampStartAt(p, startAt) - 1).fill(null), ...items];
  const pages: Array<Array<T | null>> = [];
  for (let i = 0; i < cells.length; i += perPage) {
    const page = cells.slice(i, i + perPage);
    while (page.length < perPage) page.push(null);
    pages.push(page);
  }
  return pages;
}

/** Where cell `index` of a page sits, in mm from the page's top-left. */
export function labelPosition(p: LabelPreset, index: number): { topMm: number; leftMm: number } {
  const col = index % p.cols;
  const row = Math.floor(index / p.cols);
  return {
    topMm: p.marginTopMm + row * (p.labelHeightMm + p.gapYMm),
    leftMm: p.marginLeftMm + col * (p.labelWidthMm + p.gapXMm),
  };
}
