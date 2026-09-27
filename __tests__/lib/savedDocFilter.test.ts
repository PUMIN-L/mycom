// @vitest-environment node
/**
 * The rules behind /billing/saved's date-range filter and its bulk delete.
 * These decide which documents one press of ลบที่เลือก can reach, so the
 * cases that matter are the boundaries: the Bangkok day, an open end, a
 * backwards range, and a filter change made after rows were ticked.
 */
import { describe, it, expect } from "vitest";
import {
  savedOnBangkokDate,
  isWithinBangkokDateRange,
  isImpossibleRange,
  filterSavedDocs,
  selectAllPlan,
  visibleSelection,
  summariseByDocType,
  BULK_DELETE_MAX_ITEMS,
} from "@/app/lib/savedDocFilter";

const row = (id: string, createdAt: string, extra: Partial<{ docType: string; docNo: string; customer: string }> = {}) => ({
  id,
  docType: extra.docType ?? "quotation",
  docNo: extra.docNo ?? `QT-${id}`,
  createdAt,
  customer: extra.customer ?? "บริษัท ทดสอบ",
});

describe("savedOnBangkokDate", () => {
  // 06:00 in the office on the 27th is 23:00 UTC on the 26th. Reading the
  // stored string's first ten characters would file it under the 26th.
  it("reads the Bangkok calendar day, not the UTC one", () => {
    expect(savedOnBangkokDate("2026-09-26T23:00:00.000Z")).toBe("2026-09-27");
    expect(savedOnBangkokDate("2026-09-26T16:59:59.999Z")).toBe("2026-09-26");
    expect(savedOnBangkokDate("2026-09-26T17:00:00.000Z")).toBe("2026-09-27");
  });

  it("is null for a date it cannot read", () => {
    for (const value of ["", "   ", "not-a-date", null, undefined]) {
      expect(savedOnBangkokDate(value)).toBeNull();
    }
  });
});

describe("isWithinBangkokDateRange", () => {
  const AT_0600_BKK = "2026-09-26T23:00:00.000Z"; // = 27 Sep in Bangkok

  it("includes both ends of the range", () => {
    expect(isWithinBangkokDateRange(AT_0600_BKK, "2026-09-27", "2026-09-27")).toBe(true);
    expect(isWithinBangkokDateRange(AT_0600_BKK, "2026-09-01", "2026-09-30")).toBe(true);
  });

  it("excludes the days either side", () => {
    expect(isWithinBangkokDateRange(AT_0600_BKK, "2026-09-28", null)).toBe(false);
    expect(isWithinBangkokDateRange(AT_0600_BKK, null, "2026-09-26")).toBe(false);
  });

  it("takes one bound on its own", () => {
    expect(isWithinBangkokDateRange(AT_0600_BKK, "2026-09-27", null)).toBe(true);
    expect(isWithinBangkokDateRange(AT_0600_BKK, null, "2026-09-27")).toBe(true);
  });

  it("with no range at all, everything is in", () => {
    expect(isWithinBangkokDateRange(AT_0600_BKK)).toBe(true);
    expect(isWithinBangkokDateRange(AT_0600_BKK, "", "")).toBe(true);
    expect(isWithinBangkokDateRange("nonsense")).toBe(true);
  });

  it("ignores a bound that is not a real date", () => {
    expect(isWithinBangkokDateRange(AT_0600_BKK, "27/09/2026", null)).toBe(true);
    expect(isWithinBangkokDateRange(AT_0600_BKK, "2026-13-45", "2026-09-27")).toBe(true);
  });

  // The point: a bulk delete scoped to a range must not sweep up a document
  // that could not be shown to be inside it.
  it("drops an unreadable date once a range is set, but keeps it when none is", () => {
    expect(isWithinBangkokDateRange("", "2026-09-01", "2026-09-30")).toBe(false);
    expect(isWithinBangkokDateRange("", null, null)).toBe(true);
  });

  it("a backwards range covers nothing, and says so", () => {
    expect(isImpossibleRange("2026-09-30", "2026-09-01")).toBe(true);
    expect(isImpossibleRange("2026-09-01", "2026-09-30")).toBe(false);
    expect(isImpossibleRange("2026-09-01", null)).toBe(false);
    expect(isImpossibleRange(null, null)).toBe(false);
    expect(isWithinBangkokDateRange("2026-09-15T03:00:00.000Z", "2026-09-30", "2026-09-01")).toBe(false);
  });
});

describe("filterSavedDocs", () => {
  const rows = [
    row("a", "2026-09-01T03:00:00.000Z", { docType: "quotation", docNo: "QT-2609-001", customer: "บริษัท กอไก่" }),
    row("b", "2026-09-15T03:00:00.000Z", { docType: "invoice", docNo: "INV-2609-002", customer: "ห้างขอไข่" }),
    row("c", "2026-09-30T03:00:00.000Z", { docType: "quotation", docNo: "QT-2609-003", customer: "บริษัท กอไก่" }),
  ];

  it("returns everything with no filter, in the original order", () => {
    expect(filterSavedDocs(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterSavedDocs(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterSavedDocs(rows, { docType: "all" }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by type", () => {
    expect(filterSavedDocs(rows, { docType: "quotation" }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("filters by date range", () => {
    expect(filterSavedDocs(rows, { from: "2026-09-10", to: "2026-09-20" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterSavedDocs(rows, { from: "2026-09-15" }).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterSavedDocs(rows, { to: "2026-09-15" }).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("searches docNo and customer, case-insensitively", () => {
    expect(filterSavedDocs(rows, { search: "inv-2609" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterSavedDocs(rows, { search: "กอไก่" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterSavedDocs(rows, { search: "   " }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("applies type, search and range together", () => {
    expect(
      filterSavedDocs(rows, { docType: "quotation", search: "กอไก่", from: "2026-09-20" }).map((r) => r.id)
    ).toEqual(["c"]);
  });
});

describe("selectAllPlan", () => {
  it("ticks every row on screen and counts them", () => {
    const rows = [row("a", "2026-09-01T03:00:00.000Z"), row("b", "2026-09-02T03:00:00.000Z")];
    expect(selectAllPlan(rows)).toEqual({ ids: ["a", "b"], selectedCount: 2, scopeCount: 2, cappedOut: 0 });
  });

  it("stops at the cap and reports what it left, rather than trimming quietly", () => {
    const rows = Array.from({ length: BULK_DELETE_MAX_ITEMS + 7 }, (_, i) =>
      row(`q${i}`, "2026-09-01T03:00:00.000Z")
    );
    const plan = selectAllPlan(rows);
    expect(plan.selectedCount).toBe(BULK_DELETE_MAX_ITEMS);
    expect(plan.scopeCount).toBe(BULK_DELETE_MAX_ITEMS + 7);
    expect(plan.cappedOut).toBe(7);
    expect(plan.ids).toHaveLength(BULK_DELETE_MAX_ITEMS);
  });

  it("is empty for an empty screen", () => {
    expect(selectAllPlan([])).toEqual({ ids: [], selectedCount: 0, scopeCount: 0, cappedOut: 0 });
  });
});

describe("visibleSelection", () => {
  const rows = [row("a", "2026-09-01T03:00:00.000Z"), row("b", "2026-09-02T03:00:00.000Z")];

  it("keeps only what is on screen, in screen order", () => {
    expect(visibleSelection(rows, new Set(["b", "a"])).map((r) => r.id)).toEqual(["a", "b"]);
  });

  // Tick 40 rows, switch tab, press ลบที่เลือก: the ones no longer in front of
  // him must not be deleted.
  it("drops a ticked row that the filter has hidden", () => {
    const onScreen = rows.filter((r) => r.id === "a");
    expect(visibleSelection(onScreen, new Set(["a", "b"])).map((r) => r.id)).toEqual(["a"]);
    expect(visibleSelection([], new Set(["a", "b"]))).toEqual([]);
  });
});

describe("summariseByDocType", () => {
  const label = (t: string) => (t === "quotation" ? "ใบเสนอราคา" : t === "receipt" ? "ใบเสร็จ" : t);

  it("names the kinds about to be deleted, with counts", () => {
    const rows = [
      row("a", "2026-09-01T03:00:00.000Z", { docType: "quotation" }),
      row("b", "2026-09-02T03:00:00.000Z", { docType: "receipt" }),
      row("c", "2026-09-03T03:00:00.000Z", { docType: "quotation" }),
    ];
    expect(summariseByDocType(rows, label)).toBe("ใบเสนอราคา 2 ใบ · ใบเสร็จ 1 ใบ");
  });

  it("is empty for nothing selected", () => {
    expect(summariseByDocType([], label)).toBe("");
  });
});
