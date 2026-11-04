/**
 * Login history and the new-device email (app/lib/loginEvents.ts):
 *   - every step that got past the password is stored, after the response;
 *   - the PASSWORD step from a browser with no device cookie emails the fixed
 *     address — on a two-factor account too, where it says the code is still
 *     ahead — and the code step never emails again;
 *   - at most 5 emails an hour / 20 a day, the rest stored as "capped";
 *   - no part of it can fail a login, and each part survives another's failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { afterQueue, afterMode } = vi.hoisted(() => ({
  afterQueue: [] as Array<() => unknown>,
  afterMode: { throws: false },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    if (afterMode.throws) throw new Error("`after` was called outside a request scope.");
    afterQueue.push(fn);
  },
}));
vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/mailer", () => ({
  isMailConfigured: vi.fn(() => true),
  sendNewDeviceLoginEmail: vi.fn(async () => undefined),
}));

import { query } from "@/app/lib/db";
import { isMailConfigured, sendNewDeviceLoginEmail } from "@/app/lib/mailer";
import { PASSWORD_OTP_EMAIL } from "@/app/lib/passwordReset";
import {
  LOGIN_ALERTS_PER_DAY,
  LOGIN_ALERTS_PER_HOUR,
  LOGIN_HISTORY_RETENTION_DAYS,
  deviceLabel,
  listLoginHistory,
  locationOf,
  loginAlertDue,
  loginRequestDetails,
  noteLoginEvent,
  recordLoginEvent,
  type LoginStep,
} from "@/app/lib/loginEvents";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const AT = "2026-11-04T07:00:00.000Z";
const DETAILS = { ip: "203.0.113.9", location: "Bangkok, TH", userAgent: CHROME_WINDOWS };
const step = (over: Partial<LoginStep> = {}): LoginStep => ({
  userId: "admin-001",
  username: "admin",
  outcome: "signed_in",
  method: "password",
  newDevice: false,
  attemptId: "attempt-1",
  ...over,
});

let calls: Array<{ sql: string; params: unknown[] }>;
let counts: { lastHour: number; lastDay: number };
let failing: RegExp | null;
let listRows: Record<string, unknown>[];

const sqlOf = (re: RegExp) => calls.filter((c) => re.test(c.sql));

beforeEach(() => {
  vi.clearAllMocks();
  afterQueue.length = 0;
  afterMode.throws = false;
  calls = [];
  counts = { lastHour: 0, lastDay: 0 };
  failing = null;
  listRows = [];
  vi.mocked(isMailConfigured).mockReturnValue(true);
  vi.mocked(sendNewDeviceLoginEmail).mockResolvedValue(undefined);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (failing?.test(sql)) throw new Error("db down");
    if (sql.startsWith("SELECT COUNT(*)")) return [[counts], []];
    if (sql.startsWith("SELECT id")) return [listRows, []];
    return [{ affectedRows: 1 }, []];
  }) as never);
});

describe("what a step is", () => {
  it("only the password step from a new browser is due an email", () => {
    expect(loginAlertDue(step({ newDevice: true }))).toBe(true);
    expect(loginAlertDue(step({ newDevice: true, outcome: "password_ok" }))).toBe(true);
    expect(loginAlertDue(step({ newDevice: false }))).toBe(false);
    expect(loginAlertDue(step({ newDevice: true, method: "totp" }))).toBe(false);
    expect(loginAlertDue(step({ newDevice: true, method: "backup" }))).toBe(false);
  });

  it("reads the place from Vercel's headers, decoding the city", () => {
    expect(locationOf(new Headers({ "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-vercel-ip-country": "BR" }))).toBe(
      "São Paulo, BR"
    );
    expect(locationOf(new Headers({ "x-vercel-ip-country": "TH" }))).toBe("TH");
    expect(locationOf(new Headers({ "x-vercel-ip-city": "%E0%A4%A", "x-vercel-ip-country": "TH" }))).toBe("%E0%A4%A, TH");
    expect(locationOf(new Headers())).toBeNull();
    expect(locationOf(new Headers({ "x-vercel-ip-city": "x".repeat(400) }))!.length).toBe(160);
  });

  it("reads the address and the browser from the request", () => {
    const details = loginRequestDetails({
      headers: new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "u".repeat(900) }),
    });
    expect(details).toEqual({ ip: "203.0.113.9", location: null, userAgent: "u".repeat(500) });
    expect(loginRequestDetails({ headers: new Headers() })).toEqual({ ip: null, location: null, userAgent: null });
  });

  it("names the device in words", () => {
    expect(deviceLabel(CHROME_WINDOWS)).toBe("Chrome บน Windows");
    expect(deviceLabel(SAFARI_IPHONE)).toBe("Mobile Safari บน iOS (Apple iPhone)");
    expect(deviceLabel(null)).toBe("ไม่ทราบอุปกรณ์");
    expect(deviceLabel("???")).toBe("ไม่ทราบอุปกรณ์");
  });
});

describe("noteLoginEvent", () => {
  const request = () =>
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9", "x-vercel-ip-country": "TH", "user-agent": CHROME_WINDOWS },
    });

  it("does nothing until the response has gone, then stores the step", async () => {
    noteLoginEvent(request(), step({ newDevice: true }));
    expect(calls).toEqual([]);
    expect(afterQueue).toHaveLength(1);
    await afterQueue[0]();
    const insert = sqlOf(/^INSERT INTO login_events/)[0];
    expect(insert.params).toEqual([
      expect.any(String),
      "admin-001",
      "admin",
      "signed_in",
      "password",
      1,
      "pending",
      "attempt-1",
      "203.0.113.9",
      "TH",
      CHROME_WINDOWS,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    ]);
    expect(sendNewDeviceLoginEmail).toHaveBeenCalledTimes(1);
  });

  it("never fails the login when it cannot schedule the work", () => {
    afterMode.throws = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => noteLoginEvent(request(), step())).not.toThrow();
    expect(error).toHaveBeenCalledWith("[login-history] could not schedule the record:", expect.any(Error));
    error.mockRestore();
  });
});

describe("recordLoginEvent", () => {
  it("a known browser: stored with no email due, and nothing sent", async () => {
    await recordLoginEvent(step(), DETAILS, AT);
    expect(sqlOf(/^INSERT/)[0].params[5]).toBe(0);
    expect(sqlOf(/^INSERT/)[0].params[6]).toBeNull();
    expect(sendNewDeviceLoginEmail).not.toHaveBeenCalled();
    expect(sqlOf(/^SELECT COUNT/)).toEqual([]);
    expect(sqlOf(/^UPDATE/)).toEqual([]);
  });

  it("a new browser: emails the FIXED address what, when, where — and records it as sent", async () => {
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    expect(sendNewDeviceLoginEmail).toHaveBeenCalledWith(PASSWORD_OTP_EMAIL, {
      username: "admin",
      awaitingCode: false,
      at: AT,
      device: "Chrome บน Windows",
      ip: "203.0.113.9",
      location: "Bangkok, TH",
    });
    const id = sqlOf(/^INSERT/)[0].params[0];
    expect(sqlOf(/^UPDATE/)[0].params).toEqual(["sent", id]);
  });

  it("a right password on a two-factor account emails at once, saying the code is still ahead", async () => {
    await recordLoginEvent(step({ newDevice: true, outcome: "password_ok" }), DETAILS, AT);
    expect(vi.mocked(sendNewDeviceLoginEmail).mock.calls[0][1]).toMatchObject({ awaitingCode: true });
  });

  it("the code step never emails again", async () => {
    await recordLoginEvent(step({ newDevice: true, method: "totp" }), DETAILS, AT);
    await recordLoginEvent(step({ newDevice: true, method: "backup" }), DETAILS, AT);
    expect(sendNewDeviceLoginEmail).not.toHaveBeenCalled();
    expect(sqlOf(/^INSERT/).map((c) => c.params[6])).toEqual([null, null]);
  });

  it("no mail set up: recorded as such, nothing tried", async () => {
    vi.mocked(isMailConfigured).mockReturnValue(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    error.mockRestore();
    expect(sendNewDeviceLoginEmail).not.toHaveBeenCalled();
    expect(sqlOf(/^UPDATE/)[0].params[0]).toBe("no_smtp");
  });

  it("counts the emails SENT in the last hour and day", async () => {
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    const count = sqlOf(/^SELECT COUNT/)[0];
    expect(count.sql).toContain("alert = 'sent'");
    expect(count.params).toEqual(["2026-11-04T06:00:00.000Z", "2026-11-03T07:00:00.000Z"]);
  });

  it.each([
    ["the hour", { lastHour: LOGIN_ALERTS_PER_HOUR, lastDay: LOGIN_ALERTS_PER_HOUR }],
    ["the day", { lastHour: 0, lastDay: LOGIN_ALERTS_PER_DAY }],
  ])("stops emailing once %s's allowance is spent, and says so", async (_, spent) => {
    counts = spent;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    warn.mockRestore();
    expect(sendNewDeviceLoginEmail).not.toHaveBeenCalled();
    expect(sqlOf(/^UPDATE/)[0].params[0]).toBe("capped");
  });

  it("one short of either allowance still emails", async () => {
    counts = { lastHour: LOGIN_ALERTS_PER_HOUR - 1, lastDay: LOGIN_ALERTS_PER_DAY - 1 };
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    expect(sendNewDeviceLoginEmail).toHaveBeenCalledTimes(1);
  });

  it("a count that fails sends anyway — a warning is worth more than the cap", async () => {
    failing = /^SELECT COUNT/;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    error.mockRestore();
    expect(sendNewDeviceLoginEmail).toHaveBeenCalledTimes(1);
    expect(sqlOf(/^UPDATE/)[0].params[0]).toBe("sent");
  });

  it("a send that fails is recorded as failed", async () => {
    vi.mocked(sendNewDeviceLoginEmail).mockRejectedValue(new Error("smtp down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    error.mockRestore();
    expect(sqlOf(/^UPDATE/)[0].params[0]).toBe("failed");
  });

  it("a step that cannot be stored still gets its email", async () => {
    failing = /^INSERT/;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordLoginEvent(step({ newDevice: true }), DETAILS, AT);
    error.mockRestore();
    expect(sendNewDeviceLoginEmail).toHaveBeenCalledTimes(1);
    expect(sqlOf(/^UPDATE/)).toEqual([]);
  });

  it("drops steps older than the retention period", async () => {
    await recordLoginEvent(step(), DETAILS, AT);
    const cutoff = new Date(Date.parse(AT) - LOGIN_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(sqlOf(/^DELETE FROM login_events/)[0].params).toEqual([cutoff]);
  });

  it("no failure in its own bookkeeping rejects", async () => {
    failing = /^(UPDATE|DELETE)/;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordLoginEvent(step({ newDevice: true }), DETAILS, AT)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe("listLoginHistory", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "r1",
    userId: "admin-001",
    username: "admin",
    outcome: "signed_in",
    method: "password",
    newDevice: 0,
    alert: null,
    attemptId: null,
    ip: "203.0.113.9",
    location: "Bangkok, TH",
    userAgent: CHROME_WINDOWS,
    createdAt: AT,
    ...over,
  });

  it("reads the newest steps and pairs them into lines", async () => {
    listRows = [
      row({ id: "code", method: "totp", newDevice: 1, attemptId: "A", createdAt: "2026-11-04T07:00:30.000Z" }),
      row({ id: "pw", outcome: "password_ok", newDevice: 1, alert: "sent", attemptId: "A", createdAt: AT }),
      // Another attempt's password step, left unfinished: not joined.
      row({ id: "other", outcome: "password_ok", newDevice: 1, alert: "sent", attemptId: "B", createdAt: "2026-11-04T07:00:10.000Z" }),
    ];
    const lines = await listLoginHistory();
    expect(calls[0].sql).toContain("attemptId");
    expect(calls[0].sql).toContain("ORDER BY createdAt DESC LIMIT 100");
    expect(lines).toEqual([
      {
        id: "code",
        username: "admin",
        at: "2026-11-04T07:00:30.000Z",
        result: "signed_in",
        method: "totp",
        newDevice: true,
        alert: "sent",
        ip: "203.0.113.9",
        location: "Bangkok, TH",
        device: "Chrome บน Windows",
      },
      expect.objectContaining({ id: "other", result: "awaiting_2fa", newDevice: true, alert: "sent" }),
    ]);
  });

  it("skips a row it cannot read, and an unknown email status reads as none", async () => {
    listRows = [
      row({ id: "bad-outcome", outcome: "hacked" }),
      row({ id: "bad-method", method: "sms" }),
      row({ id: "ok", alert: "weird", ip: null, location: null, userAgent: null }),
    ];
    const lines = await listLoginHistory();
    expect(lines).toEqual([
      expect.objectContaining({ id: "ok", alert: null, ip: null, location: null, device: "ไม่ทราบอุปกรณ์" }),
    ]);
  });
});
