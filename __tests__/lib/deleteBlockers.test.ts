// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/app/lib/db";
import { customerLinkCounts, companyLinkCounts, salespersonLinkCounts } from "@/app/lib/deleteBlockers";

const ROOT = path.resolve(__dirname, "../..");
const sqlOf = (n = 0) => String(vi.mocked(query).mock.calls[n][0]).replace(/\s+/g, " ");
const paramsOf = (n = 0) => vi.mocked(query).mock.calls[n][1];
/** "table.column" for every `FROM t WHERE c = ?` in a piece of SQL or source. */
function lookups(text: string): string[] {
  return [...text.matchAll(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/gi)].map((m) => `${m[1]}.${m[2]}`).sort();
}

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe("customerLinkCounts", () => {
  it("counts the machines, sales, follow-up calls and job sheets of one customer, in one query", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ equipments: 2, salesRecords: "1", callSchedules: 0, serviceJobs: "3" }]] as never);
    expect(await customerLinkCounts("cust-1")).toEqual({ equipments: 2, salesRecords: 1, callSchedules: 0, serviceJobs: 3 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(lookups(sqlOf())).toEqual([
      "customer_equipments.customerId",
      "sales_records.customerId",
      "service_jobs.customerId",
      "service_schedules.customerId",
    ]);
    expect(paramsOf()).toEqual(["cust-1", "cust-1", "cust-1", "cust-1"]);
  });

  it("reads nothing, NULL or nonsense as none", async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as never);
    expect(await customerLinkCounts("x")).toEqual({ equipments: 0, salesRecords: 0, callSchedules: 0, serviceJobs: 0 });
    vi.mocked(query).mockResolvedValueOnce([[{ equipments: null, salesRecords: "abc", callSchedules: -2, serviceJobs: 1.9 }]] as never);
    expect(await customerLinkCounts("x")).toEqual({ equipments: 0, salesRecords: 0, callSchedules: 0, serviceJobs: 1 });
  });

  it("checks exactly the tables DELETE /api/customers/[id] refuses on", () => {
    const route = fs.readFileSync(path.join(ROOT, "app/api/customers/[id]/route.ts"), "utf8");
    const del = route.slice(route.indexOf("export const DELETE"));
    const counts = fs.readFileSync(path.join(ROOT, "app/lib/deleteBlockers.ts"), "utf8");
    const fn = counts.slice(counts.indexOf("customerLinkCounts"), counts.indexOf("companyLinkCounts"));
    expect(lookups(fn)).toEqual(lookups(del).filter((l) => !l.startsWith("customers.")));
  });
});

describe("companyLinkCounts", () => {
  it("counts the company's customers and job sheets", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ customers: 4, serviceJobs: 0 }]] as never);
    expect(await companyLinkCounts("co-1")).toEqual({ customers: 4, serviceJobs: 0 });
    expect(lookups(sqlOf())).toEqual(["customers.companyId", "service_jobs.companyId"]);
    expect(paramsOf()).toEqual(["co-1", "co-1"]);
  });

  it("checks exactly the tables DELETE /api/companies/[id] refuses on", () => {
    const route = fs.readFileSync(path.join(ROOT, "app/api/companies/[id]/route.ts"), "utf8");
    const del = route.slice(route.indexOf("export const DELETE"));
    const counts = fs.readFileSync(path.join(ROOT, "app/lib/deleteBlockers.ts"), "utf8");
    const fn = counts.slice(counts.indexOf("companyLinkCounts"), counts.indexOf("salespersonLinkCounts"));
    expect(lookups(fn)).toEqual(lookups(del).filter((l) => !l.startsWith("companies.")));
  });
});

describe("salespersonLinkCounts", () => {
  it("counts the sales records that name the salesperson", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ salesRecords: "7" }]] as never);
    expect(await salespersonLinkCounts("sp-1")).toEqual({ salesRecords: 7 });
    expect(lookups(sqlOf())).toEqual(["sales_records.salespersonId"]);
    expect(paramsOf()).toEqual(["sp-1"]);
  });

  it("checks exactly the table DELETE /api/salespeople/[id] refuses on", () => {
    const route = fs.readFileSync(path.join(ROOT, "app/api/salespeople/[id]/route.ts"), "utf8");
    const del = route.slice(route.indexOf("export const DELETE"));
    const counts = fs.readFileSync(path.join(ROOT, "app/lib/deleteBlockers.ts"), "utf8");
    const fn = counts.slice(counts.indexOf("salespersonLinkCounts"));
    expect(lookups(fn)).toEqual(lookups(del));
  });
});
