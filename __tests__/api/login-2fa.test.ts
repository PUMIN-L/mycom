// @vitest-environment node
/**
 * Logging in to a two-factor account: POST /api/auth/login (password) then
 * POST /api/auth/login/2fa (code). Real bcrypt, real TOTP codes computed from
 * the account's secret, and a database that executes the statements
 * (helpers/fakeTwoFactorDb) — so "a code works once" is checked, not assumed.
 *
 * The properties that matter:
 *   • a correct password alone never yields a session for a 2FA account;
 *   • the pending token cannot be used as a session;
 *   • a code (or backup code) works once; five wrong ones lock the step;
 *   • an account without 2FA logs in exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { jwtVerify } from "jose";
import { createFakeTwoFactorDb, type FakeTwoFactorDb } from "../helpers/fakeTwoFactorDb";

let db: FakeTwoFactorDb;
let epoch = 0;

vi.mock("@/app/lib/db", () => ({
  query: (sql: string, params?: unknown[]) => db.run(sql, params),
  withTransaction: async (fn: (conn: unknown) => Promise<unknown>) =>
    fn({ query: (sql: string, params?: unknown[]) => db.run(sql, params) }),
}));
vi.mock("@/app/lib/settingsStore", () => ({
  getSetting: vi.fn(async (key: string) => db.settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    db.settings.set(key, value);
  }),
  getSessionEpoch: vi.fn(async () => epoch),
}));
vi.mock("@/app/lib/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
import { createSession } from "@/app/lib/session";

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as twoFactorPOST } from "@/app/api/auth/login/2fa/route";
import { loginIpLimiter } from "@/app/lib/loginThrottle";
import { beginTotpSetup, confirmTotpSetup } from "@/app/lib/twoFactor";
import { base32Decode, totpCodeAt, totpStep } from "@/app/lib/totp";

const PASSWORD = "correct-horse";
/** withRoute types its result as a plain Response; at runtime it is the route's NextResponse. */
const cookiesOf = (res: Response) => (res as NextResponse).cookies;
const codeFor = (secret: string, at: number = Date.now()) => totpCodeAt(base32Decode(secret)!, totpStep(at));

const post = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: JSON.stringify(body),
  });

const passwordStep = (cookie?: string) =>
  loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: PASSWORD }, cookie));
const codeStep = (code: string, cookie?: string) =>
  twoFactorPOST(post("http://localhost/api/auth/login/2fa", { code }, cookie));

/** Enrol admin-001; returns its secret and backup codes. Confirmed a minute
 *  ago so the CURRENT code has not been used yet. */
async function enrol(): Promise<{ secret: string; backupCodes: string[] }> {
  const secret = (await beginTotpSetup("admin-001"))!;
  const earlier = Date.now() - 60_000;
  const result = await confirmTotpSetup("admin-001", codeFor(secret, earlier), earlier);
  if (!result.ok) throw new Error("enrolment failed in test setup");
  return { secret, backupCodes: result.backupCodes };
}

/** The password step's pending cookie, as a Cookie header value. */
async function pendingCookie(): Promise<string> {
  const res = await passwordStep();
  const value = cookiesOf(res).get("login_2fa")?.value;
  if (!value) throw new Error("no pending cookie");
  return `login_2fa=${value}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  loginIpLimiter.reset();
  epoch = 0;
  db = createFakeTwoFactorDb([
    { id: "admin-001", username: "admin", passwordHash: bcrypt.hashSync(PASSWORD, 4) },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an account WITHOUT 2FA", () => {
  it("logs in with the password alone, exactly as before", async () => {
    const res = await passwordStep();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, username: "admin" });
    expect(createSession).toHaveBeenCalledWith("admin-001", "admin");
    expect(cookiesOf(res).get("login_2fa")).toBeUndefined();
  });
});

describe("step one — the password, on a 2FA account", () => {
  it("issues NO session, only a short-lived pending cookie for the code step", async () => {
    await enrol();
    const res = await passwordStep();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ twoFactorRequired: true });
    expect(createSession).not.toHaveBeenCalled();
    expect(cookiesOf(res).get("login_device")).toBeUndefined();

    const pending = cookiesOf(res).get("login_2fa")!;
    expect(pending.httpOnly).toBe(true);
    expect(pending.sameSite).toBe("strict");
    expect(pending.path).toBe("/api/auth/login");
    expect(pending.maxAge).toBe(300);
  });

  // THE POINT: if the pending token verified under the session key, proxy.ts
  // would let it through as a session and the code step would be decoration.
  it("the pending token does not verify as a session", async () => {
    await enrol();
    const token = (await pendingCookie()).split("=")[1];
    await expect(
      jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET!), { algorithms: ["HS256"] })
    ).rejects.toThrow();
  });

  it("a wrong password is still just a wrong password", async () => {
    await enrol();
    const res = await loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: "nope" }));
    expect(res.status).toBe(401);
    expect(cookiesOf(res).get("login_2fa")).toBeUndefined();
  });
});

describe("step two — the code", () => {
  it("the right code logs in: session, device cookie, pending cookie cleared", async () => {
    const { secret } = await enrol();
    const res = await codeStep(codeFor(secret), await pendingCookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, username: "admin" });
    expect(createSession).toHaveBeenCalledWith("admin-001", "admin");
    expect(cookiesOf(res).get("login_2fa")?.maxAge).toBe(0);
    expect(cookiesOf(res).get("login_device")?.value).toBeTruthy();
  });

  it("refuses without the pending cookie — the password step cannot be skipped", async () => {
    const { secret } = await enrol();
    const res = await codeStep(codeFor(secret));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ restart: true });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses a forged pending cookie, and a session token passed off as one", async () => {
    const { secret } = await enrol();
    expect((await codeStep(codeFor(secret), "login_2fa=not.a.token")).status).toBe(401);
    const { SignJWT } = await import("jose");
    const sessionShaped = await new SignJWT({ userId: "admin-001", username: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    expect((await codeStep(codeFor(secret), `login_2fa=${sessionShaped}`)).status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("the pending cookie expires after five minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T03:00:00Z"));
    const { secret } = await enrol();
    const cookie = await pendingCookie();
    vi.setSystemTime(new Date("2026-10-01T03:05:01Z"));
    const res = await codeStep(codeFor(secret), cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ restart: true });
  });

  it("'log out other devices' voids a half-finished login too", async () => {
    const { secret } = await enrol();
    const cookie = await pendingCookie();
    epoch = 1;
    expect((await codeStep(codeFor(secret), cookie)).status).toBe(401);
  });

  it("a wrong code is refused and counted", async () => {
    await enrol();
    const res = await codeStep("000000", await pendingCookie());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("รหัสไม่ถูกต้อง");
    expect(db.settings.get("login_fail_2fa_admin-001")?.startsWith("1|")).toBe(true);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a code works once — the same code again is refused", async () => {
    const { secret } = await enrol();
    const code = codeFor(secret);
    expect((await codeStep(code, await pendingCookie())).status).toBe(200);
    const again = await codeStep(code, await pendingCookie());
    expect(again.status).toBe(401);
    expect((await again.json()).error).toContain("ถูกใช้ไปแล้ว");
  });

  it("five wrong codes lock the step — even the right code is then refused", async () => {
    const { secret } = await enrol();
    const cookie = await pendingCookie();
    for (let i = 0; i < 5; i++) expect((await codeStep("000000", cookie)).status).toBe(401);
    const res = await codeStep(codeFor(secret), cookie);
    expect(res.status).toBe(429);
    expect(createSession).not.toHaveBeenCalled();
  });

  // Someone who knows the password locks the account's code step; the admin's
  // own browser — it carries a device cookie from an earlier login — is
  // counted in its own bucket and still gets in.
  it("an attacker locking the code step does not lock the admin's trusted browser out", async () => {
    const { secret } = await enrol();
    const { issueLoginDeviceToken } = await import("@/app/lib/loginDevice");
    const device = `login_device=${await issueLoginDeviceToken("admin")}`;

    const attacker = await pendingCookie();
    for (let i = 0; i < 5; i++) await codeStep("000000", attacker);
    expect((await codeStep(codeFor(secret), attacker)).status).toBe(429);

    const mine = await passwordStep(device);
    const pending = `login_2fa=${cookiesOf(mine).get("login_2fa")!.value}`;
    expect((await codeStep(codeFor(secret), `${pending}; ${device}`)).status).toBe(200);
  });

  it("a backup code works once, and says how many are left", async () => {
    const { backupCodes } = await enrol();
    const res = await codeStep(backupCodes[0], await pendingCookie());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, username: "admin", backupCodesRemaining: 9 });
    expect((await codeStep(backupCodes[0], await pendingCookie())).status).toBe(401);
  });

  it("refuses an empty or oversized body before touching anything", async () => {
    await enrol();
    const cookie = await pendingCookie();
    expect((await codeStep("", cookie)).status).toBe(400);
    expect((await codeStep("x".repeat(65), cookie)).status).toBe(400);
    const notString = await twoFactorPOST(post("http://localhost/api/auth/login/2fa", { code: 123456 }, cookie));
    expect(notString.status).toBe(400);
  });

  it("is behind the same per-IP brake as the password step", async () => {
    await enrol();
    const cookie = await pendingCookie(); // 1 attempt used
    const fromOneIp = (code: string) =>
      twoFactorPOST(
        new NextRequest("http://localhost/api/auth/login/2fa", {
          method: "POST",
          headers: { cookie, "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ code }),
        })
      );
    loginIpLimiter.reset();
    for (let i = 0; i < 10; i++) await fromOneIp("000000");
    // After five wrong codes the bucket lockout answers 429 too, so tell the
    // two apart: only the per-IP brake sets Retry-After and says "เครือข่าย".
    const eleventh = await fromOneIp("000000");
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get("Retry-After")).toBeTruthy();
    expect((await eleventh.json()).error).toContain("เครือข่าย");
  });
});
