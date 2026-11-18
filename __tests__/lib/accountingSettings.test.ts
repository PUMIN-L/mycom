// @vitest-environment node
/**
 * The accounting settings store (lib/accounting/settings.ts): our company is
 * kept as versions — a new row only for a real change — every change is
 * audited, and a bank account a payment names is switched off, not deleted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/app/lib/db";

vi.mock("@/app/lib/settingsStore", () => ({
  getCompanyProfile: vi.fn(async () => ({ addressDisplay: "93 ซอยงามวงศ์วาน นนทบุรี", phone: "062-012-9895" })),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));
import { getSetting, setSetting } from "@/app/lib/settingsStore";

import {
  getSellerProfile,
  saveSellerProfile,
  saveAccountingOptions,
  removeBankAccount,
  updateBankAccount,
  getVatRate,
  getDefaultCreditDays,
} from "@/app/lib/accounting/settings";

const actor = { userId: "admin-001", username: "admin" };
const SELLER = {
  name: "บริษัท โปรฟิน แล็บ จำกัด",
  address: "93 ซอยงามวงศ์วาน นนทบุรี 11000",
  taxId: "0107537000114",
  branchCode: "00000",
  phone: "062-012-9895",
  email: "",
};
const sqlOf = (i: number) => String(vi.mocked(query).mock.calls[i][0]);
const auditCalls = () => vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("INTO acc_audit_log"));

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(getSetting).mockReset().mockResolvedValue(null);
  vi.mocked(setSetting).mockClear();
});

describe("getSellerProfile", () => {
  it("is the newest version, with its id", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: "v2", ...SELLER }]] as never);
    expect(await getSellerProfile()).toEqual({ seller: SELLER, versionId: "v2" });
    expect(sqlOf(0)).toContain("ORDER BY createdAt DESC");
  });

  it("before the first save, starts from the website's address and phone", async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as never);
    const { seller, versionId } = await getSellerProfile();
    expect(versionId).toBeNull();
    expect(seller).toMatchObject({ name: "", taxId: "", branchCode: "00000", address: "93 ซอยงามวงศ์วาน นนทบุรี", phone: "062-012-9895" });
  });
});

describe("saveSellerProfile", () => {
  it("writes no new version when nothing changed", async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: "v2", ...SELLER }]] as never);
    expect(await saveSellerProfile(SELLER, actor)).toBe("v2");
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });

  it("writes a new version for a change, and audits which fields changed", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[{ id: "v2", ...SELLER }]] as never)
      .mockResolvedValue([{ affectedRows: 1 }] as never);
    const id = await saveSellerProfile({ ...SELLER, address: "ที่อยู่ใหม่", phone: "02-111-2222" }, actor);
    expect(id).not.toBe("v2");
    expect(sqlOf(1)).toContain("INSERT INTO acc_seller_versions");
    expect(vi.mocked(query).mock.calls[1][1]).toContain("ที่อยู่ใหม่");
    expect(auditCalls()).toHaveLength(1);
    expect(auditCalls()[0][1]).toEqual(expect.arrayContaining(["settings.update", "ข้อมูลบริษัท: ที่อยู่, เบอร์โทร"]));
  });
});

describe("VAT and default credit", () => {
  it("default to 7% and 30 days until set", async () => {
    expect(await getVatRate()).toBe(7);
    expect(await getDefaultCreditDays()).toBe(30);
  });

  it("are saved and audited only when they change", async () => {
    vi.mocked(getSetting).mockImplementation(async (name: string) => (name === "acc_vat_rate" ? "7" : "30"));
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await saveAccountingOptions({ vatRate: 7, creditDays: 30 }, actor);
    expect(setSetting).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);

    await saveAccountingOptions({ vatRate: 7, creditDays: 45 }, actor);
    expect(setSetting).toHaveBeenCalledWith("acc_default_credit_days", "45");
    expect(auditCalls()[0][1]).toEqual(expect.arrayContaining(["เครดิต 30 → 45 วัน"]));
  });
});

describe("removeBankAccount", () => {
  it("deletes an account no payment names", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[{ bankName: "กสิกรไทย", accountNo: "123-4-56789-0" }]] as never)
      .mockResolvedValueOnce([[]] as never) // no payment names it
      .mockResolvedValue([{ affectedRows: 1 }] as never);
    expect(await removeBankAccount("b1", actor)).toBe("deleted");
    expect(sqlOf(2)).toContain("DELETE FROM acc_bank_accounts");
  });

  it("only switches off one a payment names, so that payment still says where the money went", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[{ bankName: "กสิกรไทย", accountNo: "123-4-56789-0" }]] as never)
      .mockResolvedValueOnce([[{ 1: 1 }]] as never)
      .mockResolvedValue([{ affectedRows: 1 }] as never);
    expect(await removeBankAccount("b1", actor)).toBe("deactivated");
    expect(sqlOf(2)).toContain("SET isActive = 0");
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).includes("DELETE FROM acc_bank_accounts"))).toBe(false);
  });

  it("says when there is no such account", async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as never);
    expect(await removeBankAccount("nope", actor)).toBe("missing");
  });
});

describe("updateBankAccount", () => {
  it("leaves an account switched off when the edit does not say otherwise", async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await updateBankAccount("b1", { bankName: "กสิกรไทย", accountNo: "1", accountName: "" }, actor);
    expect(sqlOf(0)).not.toContain("isActive");
    await updateBankAccount("b1", { bankName: "กสิกรไทย", accountNo: "1", accountName: "", isActive: false }, actor);
    const [sql, params] = vi.mocked(query).mock.calls.find(([q], i) => i > 0 && String(q).startsWith("UPDATE acc_bank_accounts"))!;
    expect(sql).toContain("isActive = ?");
    expect(params).toEqual(["กสิกรไทย", "1", "", 0, "b1"]);
  });
});
