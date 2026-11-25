// @vitest-environment node
/**
 * The commission rate table, stored (lib/accounting/commissionRates.ts):
 *  • kept as sets by the month they start (the 1st), every save a new row —
 *    the newest of a month is the set, a removal is a row too: history kept;
 *  • changed ONLY with a 6-digit code emailed to the owner's fixed inbox (the
 *    owner, 2026-11-25): asking stores the code WITH the change it is for, so
 *    the code approves exactly what its email showed; confirming takes a guess
 *    before comparing (five, the fifth wrong wipes the code), spends the code
 *    in the same transaction that saves, and then emails the latest tables.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, string>();
vi.mock("@/app/lib/settingsStore", () => ({
  getSetting: vi.fn(async (k: string) => settings.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string) => {
    settings.set(k, v);
  }),
}));
vi.mock("@/app/lib/otpAttempts", () => ({
  claimOtpIssue: vi.fn(async () => ({ allowed: true })),
  takeOtpAttempt: vi.fn(async () => ({ allowed: true, last: false })),
  resetOtpAttempts: vi.fn(async () => {}),
  clearOtpAttempts: vi.fn(async () => {}),
  OTP_TOO_MANY_ATTEMPTS: "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่",
}));
import { claimOtpIssue, clearOtpAttempts, resetOtpAttempts, takeOtpAttempt } from "@/app/lib/otpAttempts";
const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/mailer", () => ({ isMailConfigured: vi.fn(() => true), sendSystemHtmlEmail: vi.fn(async () => {}) }));
import { isMailConfigured, sendSystemHtmlEmail } from "@/app/lib/mailer";
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";

import { DEFAULT_COMMISSION_RULES, FIRST_EFFECTIVE_MONTH, type RateRules } from "@/app/lib/accounting/commission";
import { confirmRatesChange, loadRates, requestRatesCode } from "@/app/lib/accounting/commissionRates";

const actor = { userId: "admin-001", username: "admin" };
const STATE = "commission_rates_otp_state";
const copy = (r: RateRules = DEFAULT_COMMISSION_RULES): RateRules => JSON.parse(JSON.stringify(r));
const edited = () => {
  const r = copy();
  r.ladder[1].fordBp = 3300;
  r.ladder[1].torBp = 1700;
  return r;
};

type Row = { id: string; effectiveMonth: string; rulesJson: string; removed: number; createdAt: string; createdBy: string };
let stored: Row[] = [];
const row = (id: string, month: string, rules: RateRules | null, createdAt: string, removed = 0): Row => ({
  id,
  effectiveMonth: month,
  rulesJson: rules ? JSON.stringify(rules) : "{}",
  removed,
  createdAt,
  createdBy: "admin",
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  stored = [];
  conn.query.mockReset();
  conn.query.mockImplementation(async (sql: string) => (String(sql).startsWith("UPDATE settings") ? [{ affectedRows: 1 }, []] : [{}, []]));
  vi.mocked(query).mockImplementation((async () => [stored, []]) as never);
  vi.mocked(isMailConfigured).mockReturnValue(true);
  vi.mocked(claimOtpIssue).mockResolvedValue({ allowed: true });
  vi.mocked(takeOtpAttempt).mockResolvedValue({ allowed: true, last: false });
});

describe("loadRates — the sets in force, and the history", () => {
  it("nothing saved yet: the owner's table, from the beginning", async () => {
    const state = await loadRates();
    expect(state.sets).toEqual([{ id: null, effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: DEFAULT_COMMISSION_RULES, savedAt: null, savedBy: null }]);
    expect(state.history).toEqual([]);
  });

  it("the newest save of each month; a removed month is gone; an unreadable row is skipped", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stored = [
      row("a", FIRST_EFFECTIVE_MONTH, copy(), "2026-11-25T01:00:00.000Z"),
      row("b", FIRST_EFFECTIVE_MONTH, edited(), "2026-11-25T02:00:00.000Z"),
      row("c", "2029-04", copy(), "2026-11-25T03:00:00.000Z"),
      row("d", "2029-04", null, "2026-11-25T04:00:00.000Z", 1),
      { ...row("e", "2030-01", copy(), "2026-11-25T05:00:00.000Z"), rulesJson: "{not json" },
    ];
    const state = await loadRates();
    expect(state.sets.map((s) => [s.id, s.effectiveMonth, s.savedBy])).toEqual([["b", FIRST_EFFECTIVE_MONTH, "admin"]]);
    expect(state.sets[0].rules.ladder[1].fordBp).toBe(3300);
    expect(state.history.map((h) => [h.id, h.removed])).toEqual([["e", false], ["d", true], ["c", false], ["b", false], ["a", false]]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("requestRatesCode — asking for the code", () => {
  const change = { kind: "save" as const, effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: edited() };

  it("stores the code with the change it is for, starts its guesses afresh, and emails it to the owner", async () => {
    const before = Date.now();
    await expect(requestRatesCode(change, actor)).resolves.toEqual({ allowed: true });
    const state = JSON.parse(settings.get(STATE)!);
    expect(state.otp).toMatch(/^\d{6}$/);
    expect(state.pending).toEqual(change);
    expect(state.userId).toBe("admin-001");
    expect(state.expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(state.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    expect(claimOtpIssue).toHaveBeenCalledWith("commission_rates_otp");
    expect(resetOtpAttempts).toHaveBeenCalledWith("commission_rates_otp");
    const [to, subject, html] = vi.mocked(sendSystemHtmlEmail).mock.calls[0];
    expect(to).toBe("ampumin@gmail.com");
    expect(subject).toBe("[รหัสยืนยัน] แก้ตารางอัตราค่าคอมมิชชั่น");
    expect(html).toContain(state.otp);
    expect(html).toContain("32% → 33%");
  });

  it("refuses a table with something wrong — before using up a code", async () => {
    const bad = edited();
    bad.ladder[0].fordBp = 9000;
    await expect(requestRatesCode({ ...change, rules: bad }, actor)).rejects.toMatchObject({ status: 400, message: "ขั้นที่ 1: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%" });
    await expect(requestRatesCode({ ...change, rules: copy() }, actor)).rejects.toMatchObject({ status: 400, message: "ตารางนี้เหมือนเดิม ไม่มีอะไรเปลี่ยน" });
    expect(claimOtpIssue).not.toHaveBeenCalled();
    expect(sendSystemHtmlEmail).not.toHaveBeenCalled();
  });

  it("cannot send without mail set up — says so, uses nothing up", async () => {
    vi.mocked(isMailConfigured).mockReturnValue(false);
    await expect(requestRatesCode(change, actor)).rejects.toMatchObject({ status: 503, message: "ระบบอีเมลยังไม่ได้ตั้งค่า จึงส่งรหัสยืนยันไม่ได้" });
    expect(claimOtpIssue).not.toHaveBeenCalled();
  });

  it("asked too often: says how long to wait, sends nothing", async () => {
    vi.mocked(claimOtpIssue).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    await expect(requestRatesCode(change, actor)).resolves.toEqual({ allowed: false, retryAfterSeconds: 42 });
    expect(settings.has(STATE)).toBe(false);
    expect(sendSystemHtmlEmail).not.toHaveBeenCalled();
  });

  it("a code whose email failed is withdrawn", async () => {
    vi.mocked(sendSystemHtmlEmail).mockRejectedValueOnce(new Error("SMTP down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(requestRatesCode(change, actor)).rejects.toMatchObject({ status: 502, message: "ส่งอีเมลรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่" });
    expect(settings.get(STATE)).toBe("");
    err.mockRestore();
  });
});

describe("confirmRatesChange — typing the code", () => {
  const pending = { kind: "save" as const, effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: edited() };
  const asked = (over: Record<string, unknown> = {}) =>
    settings.set(STATE, JSON.stringify({ otp: "123456", expiresAt: Date.now() + 60_000, pending, userId: "admin-001", ...over }));
  const inserts = () => conn.query.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO acc_commission_rates"));

  it("the right code: spends it and saves THE change it was asked for, in one transaction — then emails the latest tables", async () => {
    asked();
    const raw = settings.get(STATE)!;
    const result = await confirmRatesChange("123456", actor);
    const calls = conn.query.mock.calls.map(([sql]) => String(sql));
    expect(calls[0]).toBe("UPDATE settings SET value = '' WHERE name = ? AND value = ?");
    expect(conn.query.mock.calls[0][1]).toEqual([STATE, raw]);
    expect(inserts()).toHaveLength(1);
    const params = inserts()[0][1] as unknown[];
    expect(params[1]).toBe(FIRST_EFFECTIVE_MONTH);
    expect(JSON.parse(String(params[2]))).toEqual(pending.rules);
    expect(params[3]).toBe(0);
    expect(params[5]).toBe("admin");
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "commission.rates", detail: "แก้ตารางอัตราค่าคอม ตั้งแต่เริ่มต้น" }));
    expect(clearOtpAttempts).toHaveBeenCalledWith("commission_rates_otp");
    const [to, subject, html] = vi.mocked(sendSystemHtmlEmail).mock.calls[0];
    expect(to).toBe("ampumin@gmail.com");
    expect(subject).toBe("แจ้งเตือน: ตารางอัตราค่าคอมมิชชั่นถูกแก้แล้ว");
    expect(html).toContain("32% → 33%");
    expect(result.summaryEmailSent).toBe(true);
    expect(Array.isArray(result.sets)).toBe(true);
  });

  it("a wrong code: refused, the guess counted, the code kept", async () => {
    asked();
    await expect(confirmRatesChange("654321", actor)).rejects.toMatchObject({ status: 400, message: "รหัสยืนยันไม่ถูกต้อง" });
    expect(takeOtpAttempt).toHaveBeenCalledWith("commission_rates_otp");
    expect(settings.get(STATE)).not.toBe("");
    expect(inserts()).toHaveLength(0);
  });

  it("the fifth wrong code wipes it", async () => {
    asked();
    vi.mocked(takeOtpAttempt).mockResolvedValue({ allowed: true, last: true });
    await expect(confirmRatesChange("654321", actor)).rejects.toMatchObject({ status: 400, message: "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่" });
    expect(settings.get(STATE)).toBe("");
    vi.mocked(takeOtpAttempt).mockResolvedValue({ allowed: false, last: false });
    asked();
    await expect(confirmRatesChange("123456", actor)).rejects.toMatchObject({ status: 400 });
    expect(inserts()).toHaveLength(0);
  });

  it("no code asked for, an expired one, or another admin's: one answer", async () => {
    const NONE = "ไม่มีคำขอแก้ตารางอัตรา หรือรหัสหมดอายุแล้ว กรุณาขอรหัสใหม่";
    await expect(confirmRatesChange("123456", actor)).rejects.toMatchObject({ status: 400, message: NONE });
    asked({ expiresAt: Date.now() - 1 });
    await expect(confirmRatesChange("123456", actor)).rejects.toMatchObject({ status: 400, message: NONE });
    asked({ userId: "someone-else" });
    await expect(confirmRatesChange("123456", actor)).rejects.toMatchObject({ status: 400, message: NONE });
    expect(takeOtpAttempt).not.toHaveBeenCalled();
  });

  it("not six digits: asks for them, spends no guess", async () => {
    asked();
    for (const typed of ["", "12345", "abcdef", null, 123456]) {
      await expect(confirmRatesChange(typed, actor)).rejects.toMatchObject({ status: 400, message: "กรุณากรอกรหัส 6 หลักจากอีเมล" });
    }
    expect(takeOtpAttempt).not.toHaveBeenCalled();
  });

  it("a code already spent (two tabs) saves nothing the second time", async () => {
    asked();
    conn.query.mockImplementation(async (sql: string) => (String(sql).startsWith("UPDATE settings") ? [{ affectedRows: 0 }, []] : [{}, []]));
    await expect(confirmRatesChange("123456", actor)).rejects.toMatchObject({ status: 409, message: "รหัสนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่" });
    expect(inserts()).toHaveLength(0);
  });

  it("a change overtaken since the code was sent is refused, and the code withdrawn", async () => {
    // Someone saved the very same table meanwhile.
    stored = [row("x", FIRST_EFFECTIVE_MONTH, edited(), "2026-11-25T02:00:00.000Z")];
    asked();
    await expect(confirmRatesChange("123456", actor)).rejects.toMatchObject({ status: 409, message: "ตารางนี้เหมือนเดิม ไม่มีอะไรเปลี่ยน" });
    expect(settings.get(STATE)).toBe("");
    expect(inserts()).toHaveLength(0);
  });

  it("saved even when the summary email fails — and says it did not go", async () => {
    asked();
    vi.mocked(sendSystemHtmlEmail).mockRejectedValueOnce(new Error("SMTP down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await confirmRatesChange("123456", actor);
    expect(inserts()).toHaveLength(1);
    expect(result.summaryEmailSent).toBe(false);
    err.mockRestore();
  });

  it("a removal is saved as a row too", async () => {
    stored = [row("c", "2029-04", edited(), "2026-11-25T03:00:00.000Z")];
    settings.set(STATE, JSON.stringify({ otp: "123456", expiresAt: Date.now() + 60_000, pending: { kind: "remove", effectiveMonth: "2029-04" }, userId: "admin-001" }));
    await confirmRatesChange("123456", actor);
    const params = inserts()[0][1] as unknown[];
    expect([params[1], params[3]]).toEqual(["2029-04", 1]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ detail: "ลบตารางอัตราค่าคอม ตั้งแต่เดือนเมษายน 2572" }));
  });
});
