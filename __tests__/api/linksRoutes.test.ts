// @vitest-environment node
/**
 * GET /api/{customers,companies,salespeople}/[id]/links — what still points at
 * a record, counted, for the delete dialog on /customers. Admin only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/app/lib/db";

vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";

import { GET as customerLinks } from "@/app/api/customers/[id]/links/route";
import { GET as companyLinks } from "@/app/api/companies/[id]/links/route";
import { GET as salespersonLinks } from "@/app/api/salespeople/[id]/links/route";

const admin = { userId: "1", username: "admin", expiresAt: new Date() } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(getSession).mockResolvedValue(admin);
});

describe("GET /api/customers/[id]/links", () => {
  it("answers the counts for that customer", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ equipments: 1, salesRecords: 0, callSchedules: 2, serviceJobs: 0 }]] as never);
    const res = await customerLinks(req("/api/customers/c%201/links"), ctx("c 1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ equipments: 1, salesRecords: 0, callSchedules: 2, serviceJobs: 0 });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(["c 1", "c 1", "c 1", "c 1"]);
  });

  it("401s an anonymous request before any query", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await customerLinks(req("/api/customers/c1/links"), ctx("c1"));
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("a database failure is a Thai 500", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("ECONNRESET"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await customerLinks(req("/api/customers/c1/links"), ctx("c1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("ตรวจสอบข้อมูลที่ผูกกับลูกค้าไม่สำเร็จ");
  });
});

describe("GET /api/companies/[id]/links", () => {
  it("answers the counts for that company", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ customers: 3, serviceJobs: 1 }]] as never);
    const res = await companyLinks(req("/api/companies/co1/links"), ctx("co1"));
    expect(await res.json()).toEqual({ customers: 3, serviceJobs: 1 });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(["co1", "co1"]);
  });

  it("401s an anonymous request before any query", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await companyLinks(req("/api/companies/co1/links"), ctx("co1"))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("GET /api/salespeople/[id]/links", () => {
  it("answers the counts for that salesperson", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ salesRecords: 5 }]] as never);
    const res = await salespersonLinks(req("/api/salespeople/sp1/links"), ctx("sp1"));
    expect(await res.json()).toEqual({ salesRecords: 5 });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(["sp1"]);
  });

  it("401s an anonymous request before any query", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await salespersonLinks(req("/api/salespeople/sp1/links"), ctx("sp1"))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
