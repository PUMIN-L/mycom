import { describe, it, expect } from "vitest";
import { linkLines, linksUrl, deleteUrl, KIND_NOUN, BLOCKED_HINT } from "@/app/customers/linkHelpers";

describe("linkLines", () => {
  it("a customer: one line per kind of record still pointing at it, in a fixed order", () => {
    expect(linkLines("customer", { serviceJobs: 1, equipments: 2, salesRecords: 0, callSchedules: 3 })).toEqual([
      "เครื่องมือ 2 เครื่อง",
      "นัดโทรติดตาม 3 นัด",
      "ใบ Job 1 ใบ",
    ]);
    expect(linkLines("customer", { salesRecords: 4 })).toEqual(["รายการขาย 4 รายการ"]);
  });

  it("a company and a salesperson", () => {
    expect(linkLines("company", { customers: 12, serviceJobs: 2 })).toEqual(["ลูกค้า 12 ราย", "ใบ Job 2 ใบ"]);
    expect(linkLines("salesperson", { salesRecords: 1 })).toEqual(["รายการขาย 1 รายการ"]);
  });

  it("separates thousands", () => {
    expect(linkLines("company", { customers: 1234 })).toEqual(["ลูกค้า 1,234 ราย"]);
  });

  it("counts given as text are read as numbers", () => {
    expect(linkLines("salesperson", { salesRecords: "3" })).toEqual(["รายการขาย 3 รายการ"]);
  });

  it("nothing pointing at it — or an answer that is not counts — is no lines", () => {
    expect(linkLines("customer", { equipments: 0, salesRecords: 0, callSchedules: 0, serviceJobs: 0 })).toEqual([]);
    expect(linkLines("customer", { equipments: -1, salesRecords: "x", callSchedules: null })).toEqual([]);
    expect(linkLines("customer", [])).toEqual([]);
    expect(linkLines("customer", null)).toEqual([]);
    expect(linkLines("customer", "<html>")).toEqual([]);
    // Another kind's keys are not this kind's.
    expect(linkLines("salesperson", { customers: 5 })).toEqual([]);
  });
});

describe("urls", () => {
  it("each kind has its own route, the id encoded", () => {
    expect(linksUrl("customer", "a/b")).toBe("/api/customers/a%2Fb/links");
    expect(linksUrl("company", "co1")).toBe("/api/companies/co1/links");
    expect(linksUrl("salesperson", "sp1")).toBe("/api/salespeople/sp1/links");
    expect(deleteUrl("customer", "c 1")).toBe("/api/customers/c%201");
    expect(deleteUrl("company", "co1")).toBe("/api/companies/co1");
    expect(deleteUrl("salesperson", "sp1")).toBe("/api/salespeople/sp1");
  });
});

describe("wording", () => {
  it("every kind says what it is, why it cannot go and what to do", () => {
    for (const kind of ["customer", "company", "salesperson"] as const) {
      expect(KIND_NOUN[kind].title).toBeTruthy();
      expect(KIND_NOUN[kind].refused).toMatch(/^ลบ.+ไม่ได้$/);
      expect(KIND_NOUN[kind].done).toMatch(/^ลบ.+สำเร็จ$/);
      expect(BLOCKED_HINT[kind]).toMatch(/ก่อน/);
    }
  });
});
