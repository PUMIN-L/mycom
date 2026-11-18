// @vitest-environment node
/**
 * /api/accounting/{status,settings,bank-accounts,audit} — admin only, and only
 * with two-factor login on; changing what a tax invoice prints asks for the
 * password again; nothing is cached; and the whole module is dark in
 * production until it is switched on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";

vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";

vi.mock("@/app/lib/twoFactorReauth", () => ({ requirePassword: vi.fn() }));
import { requirePassword } from "@/app/lib/twoFactorReauth";

vi.mock("@/app/lib/accounting/settings", () => ({
  getAccountingSettings: vi.fn(),
  saveSellerProfile: vi.fn(),
  saveAccountingOptions: vi.fn(),
  listBankAccounts: vi.fn(),
  createBankAccount: vi.fn(),
  updateBankAccount: vi.fn(),
  removeBankAccount: vi.fn(),
}));
import * as store from "@/app/lib/accounting/settings";

vi.mock("@/app/lib/accounting/audit", () => ({ listAudit: vi.fn(async () => []) }));
import { listAudit } from "@/app/lib/accounting/audit";

import { GET as status } from "@/app/api/accounting/status/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/accounting/settings/route";
import { GET as listBanks, POST as createBank } from "@/app/api/accounting/bank-accounts/route";
import { DELETE as deleteBank, PUT as putBank } from "@/app/api/accounting/bank-accounts/[id]/route";
import { GET as getAudit } from "@/app/api/accounting/audit/route";
import { TWO_FACTOR_REQUIRED } from "@/app/lib/accounting/guard";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const withTwoFactor = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const withoutTwoFactor = { ...withTwoFactor, totpEnabled: false };

const req = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const VALID_SELLER = {
  name: "บริษัท โปรฟิน แล็บ จำกัด",
  address: "93 ซอยงามวงศ์วาน นนทบุรี 11000",
  taxId: "0-1075-37000-11-4",
  branchCode: "สำนักงานใหญ่",
  phone: "062-012-9895",
  email: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(withTwoFactor);
  vi.mocked(requirePassword).mockResolvedValue(null);
  vi.mocked(store.getAccountingSettings).mockResolvedValue({
    seller: { ...VALID_SELLER, taxId: "0107537000114", branchCode: "00000" },
    sellerVersionId: "v1",
    vatRate: 7,
    creditDays: 30,
    bankAccounts: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("who may use the module", () => {
  it("401s an anonymous request", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    for (const res of [await status(), await getSettings(), await listBanks(), await getAudit(req("/api/accounting/audit"))]) {
      expect(res.status).toBe(401);
    }
    expect(store.getAccountingSettings).not.toHaveBeenCalled();
  });

  it("403s an admin without two-factor login, in Thai — except the status, which says so", async () => {
    vi.mocked(getTwoFactorUser).mockResolvedValue(withoutTwoFactor);
    const res = await getSettings();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(TWO_FACTOR_REQUIRED);
    expect(store.getAccountingSettings).not.toHaveBeenCalled();

    const st = await status();
    expect(st.status).toBe(200);
    expect(await st.json()).toEqual({ twoFactorEnabled: false, username: "admin" });
  });

  it("is dark in production until switched on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await status()).status).toBe(404);
    expect((await getSettings()).status).toBe(404);
    vi.stubEnv("NEXT_PUBLIC_ACCOUNTING_ENABLED", "1");
    expect((await getSettings()).status).toBe(200);
  });

  it("never lets an answer be cached", async () => {
    const res = await getSettings();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await status()).headers.get("cache-control")).toBe("no-store");
  });
});

describe("PUT /api/accounting/settings", () => {
  const put = (body: Record<string, unknown>) =>
    putSettings(req("/api/accounting/settings", { method: "PUT", body: { vatRate: 7, creditDays: 30, password: "secret", ...body } }));

  it("refuses a tax ID that is not a real one, by field, before asking for the password", async () => {
    const res = await put({ seller: { ...VALID_SELLER, taxId: "0107537000115" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields.taxId).toContain("ไม่ถูกต้อง");
    expect(requirePassword).not.toHaveBeenCalled();
    expect(store.saveSellerProfile).not.toHaveBeenCalled();
  });

  it("refuses an impossible VAT rate or credit term", async () => {
    expect((await put({ seller: VALID_SELLER, vatRate: 50 })).status).toBe(400);
    expect((await put({ seller: VALID_SELLER, creditDays: 1.5 })).status).toBe(400);
    expect(store.saveAccountingOptions).not.toHaveBeenCalled();
  });

  it("answers the password check's refusal, and saves nothing", async () => {
    vi.mocked(requirePassword).mockResolvedValue(NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 403 }));
    const res = await put({ seller: VALID_SELLER });
    expect(res.status).toBe(403);
    expect(store.saveSellerProfile).not.toHaveBeenCalled();
    expect(store.saveAccountingOptions).not.toHaveBeenCalled();
  });

  it("saves the company cleaned — tax ID as digits, head office as 00000 — and the options as numbers", async () => {
    const res = await put({ seller: VALID_SELLER, vatRate: "7", creditDays: "45" });
    expect(res.status).toBe(200);
    expect(requirePassword).toHaveBeenCalledWith(withTwoFactor, "secret");
    expect(store.saveSellerProfile).toHaveBeenCalledWith(
      expect.objectContaining({ taxId: "0107537000114", branchCode: "00000", name: VALID_SELLER.name }),
      { userId: "admin-001", username: "admin" }
    );
    expect(store.saveAccountingOptions).toHaveBeenCalledWith({ vatRate: 7, creditDays: 45 }, expect.anything());
  });

  it("refuses a request from another site (the CSRF guard)", async () => {
    const res = await putSettings(
      new NextRequest("http://localhost:3000/api/accounting/settings", {
        method: "PUT",
        headers: { host: "localhost:3000", origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ seller: VALID_SELLER, vatRate: 7, creditDays: 30, password: "secret" }),
      })
    );
    expect(res.status).toBe(403);
    expect(store.saveSellerProfile).not.toHaveBeenCalled();
  });
});

describe("bank accounts", () => {
  it("refuses an account number with letters", async () => {
    const res = await createBank(req("/api/accounting/bank-accounts", { method: "POST", body: { bankName: "กสิกรไทย", accountNo: "abc" } }));
    expect(res.status).toBe(400);
    expect(store.createBankAccount).not.toHaveBeenCalled();
  });

  it("creates one", async () => {
    vi.mocked(store.createBankAccount).mockResolvedValue({ id: "b1", bankName: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "", isActive: true, sortOrder: 1 });
    const res = await createBank(req("/api/accounting/bank-accounts", { method: "POST", body: { bankName: " กสิกรไทย ", accountNo: "123-4-56789-0" } }));
    expect(res.status).toBe(201);
    expect(store.createBankAccount).toHaveBeenCalledWith({ bankName: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "" }, expect.anything());
  });

  it("404s an edit or delete of an account that is not there", async () => {
    vi.mocked(store.updateBankAccount).mockResolvedValue(false);
    vi.mocked(store.removeBankAccount).mockResolvedValue("missing");
    expect((await putBank(req("/api/accounting/bank-accounts/x", { method: "PUT", body: { bankName: "ก", accountNo: "1" } }), ctx("x"))).status).toBe(404);
    expect((await deleteBank(req("/api/accounting/bank-accounts/x", { method: "DELETE" }), ctx("x"))).status).toBe(404);
  });

  it("keeps an account as it is when an edit does not send isActive", async () => {
    vi.mocked(store.updateBankAccount).mockResolvedValue(true);
    await putBank(req("/api/accounting/bank-accounts/b1", { method: "PUT", body: { bankName: "ก", accountNo: "1" } }), ctx("b1"));
    expect(vi.mocked(store.updateBankAccount).mock.calls[0][1]).toMatchObject({ isActive: undefined });
    await putBank(req("/api/accounting/bank-accounts/b1", { method: "PUT", body: { bankName: "ก", accountNo: "1", isActive: false } }), ctx("b1"));
    expect(vi.mocked(store.updateBankAccount).mock.calls[1][1]).toMatchObject({ isActive: false });
  });

  it("says when a delete only switched the account off", async () => {
    vi.mocked(store.removeBankAccount).mockResolvedValue("deactivated");
    const res = await deleteBank(req("/api/accounting/bank-accounts/b1", { method: "DELETE" }), ctx("b1"));
    expect(await res.json()).toEqual({ outcome: "deactivated" });
  });
});

describe("GET /api/accounting/audit", () => {
  it("passes one document's id and the limit through", async () => {
    await getAudit(req("/api/accounting/audit?documentId=d1&limit=20"));
    expect(listAudit).toHaveBeenCalledWith({ documentId: "d1", limit: 20 });
  });
});
