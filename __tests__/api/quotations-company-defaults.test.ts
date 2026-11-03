// @vitest-environment node
/**
 * GET /api/quotations/company-defaults and latestCompanyDefaults(): what a new
 * quotation starts with in its "our company" lines.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/settingsStore", () => ({ getCompanyProfile: vi.fn() }));
import { getCompanyProfile } from "@/app/lib/settingsStore";
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";

import { latestCompanyDefaults } from "@/app/lib/quotationStore";
import { GET } from "@/app/api/quotations/company-defaults/route";

/** Answer each per-field query by the JSON key it reads. */
function answer(values: Partial<Record<"companyPhone" | "companyEmail" | "companyTaxId", unknown>>) {
  vi.mocked(query).mockImplementation((async (sql: string) => {
    const key = /\$\.(\w+)/.exec(sql)?.[1] as keyof typeof values;
    return [key in values ? [{ value: values[key] }] : []];
  }) as never);
}

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(getCompanyProfile).mockReset();
  vi.mocked(getSession).mockResolvedValue({ userId: "u1" } as never);
});

describe("latestCompanyDefaults", () => {
  it("takes each line from the latest quotation that has it", async () => {
    answer({ companyPhone: "062-012-9895", companyEmail: " sales@profinlab.co.th ", companyTaxId: "0-1255-12345-67-8" });
    expect(await latestCompanyDefaults()).toEqual({
      companyPhone: "062-012-9895",
      companyEmail: "sales@profinlab.co.th",
      companyTaxId: "0-1255-12345-67-8",
    });
  });

  it("asks per field, newest first, skipping blank and JSON-null values", async () => {
    answer({});
    await latestCompanyDefaults();
    const sqls = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    expect(sqls).toHaveLength(3);
    for (const key of ["companyPhone", "companyEmail", "companyTaxId"]) {
      const sql = sqls.find((s) => s.includes(`'$.${key}'`))!;
      expect(sql).toMatch(/ORDER BY createdAt DESC LIMIT 1/);
      expect(sql).toMatch(/NOT IN \('', 'null'\)/);
    }
  });

  it("gives empty strings when no quotation has a value (or a non-string one)", async () => {
    answer({ companyEmail: 42, companyTaxId: null });
    expect(await latestCompanyDefaults()).toEqual({ companyPhone: "", companyEmail: "", companyTaxId: "" });
  });
});

describe("GET /api/quotations/company-defaults", () => {
  it("answers the latest values", async () => {
    answer({ companyPhone: "02-111-2222", companyEmail: "a@b.co", companyTaxId: "123" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ companyPhone: "02-111-2222", companyEmail: "a@b.co", companyTaxId: "123" });
    expect(getCompanyProfile).not.toHaveBeenCalled();
  });

  it("falls back to the company profile's phone when no quotation has one", async () => {
    answer({ companyEmail: "a@b.co" });
    vi.mocked(getCompanyProfile).mockResolvedValue({ phone: "062-012-9895" } as never);
    const res = await GET();
    expect(await res.json()).toEqual({ companyPhone: "062-012-9895", companyEmail: "a@b.co", companyTaxId: "" });
  });

  it("is for signed-in admins only", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
