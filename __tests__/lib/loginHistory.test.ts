/**
 * The login history's lines (app/lib/loginHistory.ts): the two steps of a
 * two-factor login become one line — joined by their login attempt id, never
 * by time — and a right password that no code followed stays a line of its
 * own: the one that says the password leaked.
 */
import { describe, it, expect } from "vitest";
import { loginAlertLabel, loginResultLabel, mergeLoginSteps, type LoginStepRecord } from "@/app/lib/loginHistory";

const T0 = Date.parse("2026-11-04T07:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

let n = 0;
function step(over: Partial<LoginStepRecord>): LoginStepRecord {
  n += 1;
  return {
    id: `s${n}`,
    userId: "admin-001",
    username: "admin",
    outcome: "signed_in",
    method: "password",
    newDevice: false,
    alert: null,
    ip: "1.2.3.4",
    location: "Bangkok, TH",
    device: "Chrome บน Windows",
    attemptId: `attempt-${n}`,
    createdAt: at(0),
    ...over,
  };
}

describe("mergeLoginSteps", () => {
  it("a login on the password alone is one line, as stored", () => {
    const s = step({ newDevice: true, alert: "sent" });
    expect(mergeLoginSteps([s])).toEqual([
      {
        id: s.id,
        username: "admin",
        at: s.createdAt,
        result: "signed_in",
        method: "password",
        newDevice: true,
        alert: "sent",
        ip: "1.2.3.4",
        location: "Bangkok, TH",
        device: "Chrome บน Windows",
      },
    ]);
  });

  it("the password step and its code step are ONE line: time and device from the code, new-device and email from the password", () => {
    const password = step({ outcome: "password_ok", attemptId: "A", newDevice: true, alert: "sent", createdAt: at(0) });
    const code = step({ method: "totp", attemptId: "A", newDevice: true, alert: null, createdAt: at(40_000), device: "Chrome บน Windows (code)" });
    const lines = mergeLoginSteps([code, password]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: code.id,
      at: code.createdAt,
      result: "signed_in",
      method: "totp",
      newDevice: true,
      alert: "sent",
      device: "Chrome บน Windows (code)",
    });
  });

  it("a right password that no code followed is its own line, awaiting the code", () => {
    const password = step({ outcome: "password_ok", newDevice: true, alert: "sent" });
    expect(mergeLoginSteps([password])).toEqual([
      expect.objectContaining({ id: password.id, result: "awaiting_2fa", method: "password", alert: "sent" }),
    ]);
  });

  it("the owner's code never lands on a stranger's password typed in between — the warning keeps the STRANGER's device and address", () => {
    const owner = step({ outcome: "password_ok", attemptId: "owner", createdAt: at(0), ip: "171.97.12.40", device: "Chrome บน Windows" });
    const stranger = step({
      outcome: "password_ok",
      attemptId: "stranger",
      createdAt: at(10_000),
      newDevice: true,
      alert: "sent",
      ip: "185.220.101.4",
      device: "Firefox บน Linux",
    });
    const ownerCode = step({ method: "totp", attemptId: "owner", createdAt: at(20_000), ip: "171.97.12.40", device: "Chrome บน Windows" });
    const lines = mergeLoginSteps([owner, stranger, ownerCode]);
    expect(lines).toEqual([
      expect.objectContaining({ id: ownerCode.id, result: "signed_in", newDevice: false, alert: null, ip: "171.97.12.40" }),
      expect.objectContaining({ id: stranger.id, result: "awaiting_2fa", newDevice: true, alert: "sent", ip: "185.220.101.4", device: "Firefox บน Linux" }),
    ]);
  });

  it("two attempts of one shared account at once keep their own flags", () => {
    const a = step({ outcome: "password_ok", attemptId: "a", newDevice: true, alert: "sent", createdAt: at(0) });
    const b = step({ outcome: "password_ok", attemptId: "b", newDevice: false, createdAt: at(5_000) });
    const aCode = step({ method: "totp", attemptId: "a", createdAt: at(15_000) });
    const bCode = step({ method: "backup", attemptId: "b", createdAt: at(10_000) });
    const lines = mergeLoginSteps([a, b, aCode, bCode]);
    expect(lines.map((l) => [l.id, l.method, l.newDevice, l.alert])).toEqual([
      [aCode.id, "totp", true, "sent"],
      [bCode.id, "backup", false, null],
    ]);
  });

  it("pairs whatever order the clocks put the two steps in", () => {
    const password = step({ outcome: "password_ok", attemptId: "skew", newDevice: true, alert: "sent", createdAt: at(1) });
    const code = step({ method: "totp", attemptId: "skew", createdAt: at(0) });
    expect(mergeLoginSteps([password, code])).toEqual([
      expect.objectContaining({ id: code.id, result: "signed_in", newDevice: true, alert: "sent" }),
    ]);
  });

  it("a login on the password alone never swallows an unfinished password step (2FA switched off meanwhile)", () => {
    const unfinished = step({ outcome: "password_ok", newDevice: true, alert: "sent", createdAt: at(0) });
    const passwordOnly = step({ outcome: "signed_in", method: "password", createdAt: at(60_000) });
    expect(mergeLoginSteps([unfinished, passwordOnly]).map((l) => [l.id, l.result])).toEqual([
      [passwordOnly.id, "signed_in"],
      [unfinished.id, "awaiting_2fa"],
    ]);
  });

  it("a password-only login that shares an attempt id still never joins a password step", () => {
    const unfinished = step({ outcome: "password_ok", attemptId: "same", createdAt: at(0) });
    const passwordOnly = step({ method: "password", attemptId: "same", createdAt: at(1_000) });
    expect(mergeLoginSteps([unfinished, passwordOnly]).map((l) => l.result)).toEqual(["signed_in", "awaiting_2fa"]);
  });

  it("a code step whose password step is out of reach — or that has no attempt id — is shown as it is", () => {
    const code = step({ method: "totp", newDevice: true });
    const noId = step({ method: "backup", attemptId: null });
    const openNoId = step({ outcome: "password_ok", attemptId: null });
    const lines = mergeLoginSteps([code, noId, openNoId]);
    expect(lines.map((l) => [l.id, l.result])).toEqual(
      expect.arrayContaining([
        [code.id, "signed_in"],
        [noId.id, "signed_in"],
        [openNoId.id, "awaiting_2fa"],
      ])
    );
    expect(lines).toHaveLength(3);
  });

  it("lists newest first, whatever order the steps came in", () => {
    const a = step({ createdAt: at(0) });
    const b = step({ createdAt: at(2_000) });
    const c = step({ createdAt: at(1_000) });
    expect(mergeLoginSteps([a, b, c]).map((l) => l.id)).toEqual([b.id, c.id, a.id]);
    expect(mergeLoginSteps([])).toEqual([]);
  });
});

describe("labels", () => {
  it("says what completed the login, and warns about one left at its password", () => {
    expect(loginResultLabel({ result: "signed_in", method: "password" })).toBe("เข้าสู่ระบบสำเร็จ (รหัสผ่าน)");
    expect(loginResultLabel({ result: "signed_in", method: "totp" })).toBe("เข้าสู่ระบบสำเร็จ (รหัสผ่าน + รหัสจากแอป)");
    expect(loginResultLabel({ result: "signed_in", method: "backup" })).toBe("เข้าสู่ระบบสำเร็จ (รหัสผ่าน + รหัสสำรอง)");
    expect(loginResultLabel({ result: "awaiting_2fa", method: "password" })).toBe(
      "ใส่รหัสผ่านถูก แต่ไม่ได้ใส่รหัสยืนยัน 2 ขั้นต่อ"
    );
  });

  it("says what became of the email, and nothing when none was due", () => {
    expect(loginAlertLabel("sent")).toBe("ส่งอีเมลแจ้งเตือนแล้ว");
    expect(loginAlertLabel("failed")).toBe("ส่งอีเมลแจ้งเตือนไม่สำเร็จ");
    expect(loginAlertLabel("capped")).toBe("ไม่ได้ส่งอีเมลแจ้งเตือน (แจ้งเตือนถี่เกินไป)");
    expect(loginAlertLabel("no_smtp")).toBe("ไม่ได้ส่งอีเมลแจ้งเตือน (ยังไม่ได้ตั้งค่าอีเมลของระบบ)");
    expect(loginAlertLabel("pending")).toBe("กำลังส่งอีเมลแจ้งเตือน");
    expect(loginAlertLabel(null)).toBeNull();
  });
});
