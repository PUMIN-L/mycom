import { describe, it, expect } from "vitest";
import {
  WARRANTY_FILTER_OPTIONS,
  WARRANTY_STATE_LABEL,
  matchesEquipmentSearch,
  matchesWarrantyFilter,
  sortEquipments,
  warrantyDaysLeft,
  warrantyLeftText,
  warrantyState,
} from "@/app/customers/equipmentHelpers";
import type { CustomerEquipment } from "@/app/lib/types";

// 15 Nov 2026, mid-afternoon local time.
const NOW = new Date(2026, 10, 15, 15, 30);

function machine(id: string, over: Partial<CustomerEquipment> = {}): CustomerEquipment {
  return {
    id,
    customerId: "c1",
    productId: "p1",
    serialNumber: "",
    quotationNumber: "",
    warrantyCertNumber: "",
    warrantyType: "",
    warrantyStartDate: null,
    warrantyEndDate: null,
    status: "Active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
const ids = (list: { id: string }[]) => list.map((m) => m.id);

describe("warrantyDaysLeft", () => {
  it("counts calendar days from today, 0 on the last day, negative once past", () => {
    expect(warrantyDaysLeft("2026-11-15", NOW)).toBe(0);
    expect(warrantyDaysLeft("2026-11-16", NOW)).toBe(1);
    expect(warrantyDaysLeft("2026-11-14", NOW)).toBe(-1);
    expect(warrantyDaysLeft("2026-12-15", NOW)).toBe(30);
    expect(warrantyDaysLeft("2026-11-15T00:00:00.000Z", NOW)).toBe(0);
  });

  it("is null without a usable date", () => {
    for (const bad of [null, undefined, "", "2026-11", "not a date", 20261115]) expect(warrantyDaysLeft(bad, NOW)).toBeNull();
  });
});

describe("warrantyState", () => {
  it("the last day still holds — it is not 'expired' in one column and 'active' in the next", () => {
    expect(warrantyState(machine("a", { warrantyEndDate: "2026-11-15" }), NOW)).toBe("active");
    expect(warrantyLeftText(warrantyDaysLeft("2026-11-15", NOW))).toEqual({ text: "หมดวันนี้", tone: "soon" });
  });

  it("expired once past, or when marked so", () => {
    expect(warrantyState(machine("a", { warrantyEndDate: "2026-11-14" }), NOW)).toBe("expired");
    expect(warrantyState(machine("a", { warrantyEndDate: "2027-01-01", status: "Expired" }), NOW)).toBe("expired");
    expect(warrantyState(machine("a", { status: "Expired" }), NOW)).toBe("expired");
  });

  it("unknown without an end date — nothing claimed either way", () => {
    expect(warrantyState(machine("a"), NOW)).toBe("unknown");
  });

  it("is said in Thai", () => {
    expect(WARRANTY_STATE_LABEL).toEqual({ active: "อยู่ในประกัน", expired: "หมดประกัน", unknown: "ไม่ระบุวันหมด" });
  });
});

describe("warrantyLeftText", () => {
  it("says how long is left, louder as it nears", () => {
    expect(warrantyLeftText(null)).toBeNull();
    expect(warrantyLeftText(-3)).toEqual({ text: "หมดแล้ว", tone: "expired" });
    expect(warrantyLeftText(0)).toEqual({ text: "หมดวันนี้", tone: "soon" });
    expect(warrantyLeftText(30)).toEqual({ text: "เหลือ 30 วัน", tone: "soon" });
    expect(warrantyLeftText(31)).toEqual({ text: "เหลือ 31 วัน", tone: "fine" });
    expect(warrantyLeftText(1200)).toEqual({ text: "เหลือ 1,200 วัน", tone: "fine" });
  });
});

describe("the warranty filter", () => {
  const list = [
    machine("past", { warrantyEndDate: "2026-11-01" }),
    machine("today", { warrantyEndDate: "2026-11-15" }),
    machine("in30", { warrantyEndDate: "2026-12-15" }),
    machine("in31", { warrantyEndDate: "2026-12-16" }),
    machine("in60", { warrantyEndDate: "2027-01-14" }),
    machine("in61", { warrantyEndDate: "2027-01-15" }),
    machine("marked", { warrantyEndDate: "2027-06-01", status: "Expired" }),
    machine("none"),
  ];
  const pick = (filter: string) => ids(list.filter((m) => matchesWarrantyFilter(m, filter, NOW)));

  it("all, expired, within 30 days, within 31–60 days", () => {
    expect(pick("all")).toHaveLength(8);
    expect(pick("expired")).toEqual(["past", "marked"]);
    expect(pick("expiring_30")).toEqual(["today", "in30"]);
    expect(pick("expiring_60")).toEqual(["in31", "in60"]);
  });

  it("every option says it is the warranty filter, in Thai", () => {
    expect(WARRANTY_FILTER_OPTIONS.map((o) => o.value)).toEqual(["all", "expired", "expiring_30", "expiring_60"]);
    for (const o of WARRANTY_FILTER_OPTIONS) expect(o.label).toMatch(/^ประกัน: /);
    expect(WARRANTY_FILTER_OPTIONS.map((o) => o.label).join(" ")).not.toMatch(/All/);
  });
});

describe("matchesEquipmentSearch", () => {
  const eq = machine("a", {
    customerName: "คุณสมชาย",
    companyName: "บริษัท ไทยแล็บ",
    productName: "<p>เครื่องวัดแรงดึง <b>ZTA</b></p>",
    serialNumber: "SN-2026-001",
    quotationNumber: "QT-6911-05",
  });
  it("finds a machine by customer, company, product (as text), serial or quotation", () => {
    for (const q of ["สมชาย", "ไทยแล็บ", "แรงดึง zta", "sn-2026", "qt-6911", "  SN-2026-001 ", ""]) {
      expect(matchesEquipmentSearch(eq, q)).toBe(true);
    }
    expect(matchesEquipmentSearch(eq, "<b>")).toBe(false);
    expect(matchesEquipmentSearch(eq, "สมหญิง")).toBe(false);
  });
});

describe("sortEquipments", () => {
  const list = [
    machine("1", { customerName: "คุณข", companyName: "บริษัท ก", productName: "<p>เครื่อง ข</p>", serialNumber: "SN-2", warrantyEndDate: "2027-03-01" }),
    machine("2", { customerName: "คุณก", companyName: "บริษัท ข", productName: "<p>เครื่อง ก</p>", serialNumber: "", warrantyEndDate: null }),
    machine("3", { customerName: "คุณก", companyName: "บริษัท ก", productName: "<p>เครื่อง ค</p>", serialNumber: "SN-10", warrantyEndDate: "2026-12-01" }),
    machine("4", { customerName: "", companyName: "", productName: "", serialNumber: "SN-1", warrantyEndDate: "2028-01-01" }),
  ];

  it("leaves the API's order alone without a sort, and never touches the list", () => {
    const out = sortEquipments(list, null);
    expect(ids(out)).toEqual(["1", "2", "3", "4"]);
    expect(out).not.toBe(list);
    sortEquipments(list, { key: "customer", dir: "desc" });
    expect(ids(list)).toEqual(["1", "2", "3", "4"]);
  });

  it("by customer, then company — a machine with no customer last either way", () => {
    expect(ids(sortEquipments(list, { key: "customer", dir: "asc" }))).toEqual(["3", "2", "1", "4"]);
    expect(ids(sortEquipments(list, { key: "customer", dir: "desc" }))).toEqual(["1", "2", "3", "4"]);
  });

  it("by product, as text", () => {
    expect(ids(sortEquipments(list, { key: "product", dir: "asc" }))).toEqual(["2", "1", "3", "4"]);
  });

  it("by serial, numbers as numbers, a blank one last", () => {
    expect(ids(sortEquipments(list, { key: "serial", dir: "asc" }))).toEqual(["4", "1", "3", "2"]);
    expect(ids(sortEquipments(list, { key: "serial", dir: "desc" }))).toEqual(["3", "1", "4", "2"]);
  });

  it("by the warranty's end date, no date last either way", () => {
    expect(ids(sortEquipments(list, { key: "warrantyEnd", dir: "asc" }))).toEqual(["3", "1", "4", "2"]);
    expect(ids(sortEquipments(list, { key: "warrantyEnd", dir: "desc" }))).toEqual(["4", "1", "3", "2"]);
  });
});
