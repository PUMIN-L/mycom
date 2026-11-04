// @vitest-environment node
/**
 * The login routes report each successful step to the login history
 * (app/lib/loginEvents.ts), and say whether the browser was new to the
 * account — which decides the new-device email:
 *   - password alone        → one "signed_in" step;
 *   - a two-factor account  → "password_ok" at the password step (the email
 *                             goes from there), then "signed_in" by totp /
 *                             backup at the code step;
 *   - nothing for a wrong password or a wrong code;
 *   - "new" means no valid device cookie FOR THIS ACCOUNT.
 * Also GET /api/auth/login-history: logged in only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createFakeTwoFactorDb, type FakeTwoFactorDb } from "../helpers/fakeTwoFactorDb";

let db: FakeTwoFactorDb;

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
  getSessionEpoch: vi.fn(async () => 0),
}));
vi.mock("@/app/lib/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock("@/app/lib/loginEvents", () => ({
  noteLoginEvent: vi.fn(),
  listLoginHistory: vi.fn(async () => []),
  LOGIN_HISTORY_RETENTION_DAYS: 365,
}));

import { getSession } from "@/app/lib/session";
import { listLoginHistory, noteLoginEvent } from "@/app/lib/loginEvents";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as twoFactorPOST } from "@/app/api/auth/login/2fa/route";
import { GET as historyGET } from "@/app/api/auth/login-history/route";
import { issueLoginDeviceToken } from "@/app/lib/loginDevice";
import { loginIpLimiter } from "@/app/lib/loginThrottle";
import { beginTotpSetup, confirmTotpSetup } from "@/app/lib/twoFactor";
import { base32Decode, totpCodeAt, totpStep } from "@/app/lib/totp";

const PASSWORD = "correct-horse";
const cookiesOf = (res: Response) => (res as NextResponse).cookies;
const codeFor = (secret: string, at: number = Date.now()) => totpCodeAt(base32Decode(secret)!, totpStep(at));

const post = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, { method: "POST", headers: cookie ? { cookie } : {}, body: JSON.stringify(body) });
const passwordStep = (cookie?: string, password = PASSWORD) =>
  loginPOST(post("http://localhost/api/auth/login", { username: "admin", password }, cookie));
const codeStep = (code: string, cookie: string) =>
  twoFactorPOST(post("http://localhost/api/auth/login/2fa", { code }, cookie));

async function enrol(): Promise<{ secret: string; backupCodes: string[] }> {
  const secret = (await beginTotpSetup("admin-001"))!;
  const earlier = Date.now() - 60_000;
  const result = await confirmTotpSetup("admin-001", codeFor(secret, earlier), earlier);
  if (!result.ok) throw new Error("enrolment failed in test setup");
  return { secret, backupCodes: result.backupCodes };
}

const noted = () => vi.mocked(noteLoginEvent).mock.calls.map(([, step]) => step);
const ADMIN = { userId: "admin-001", username: "admin" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const anAttempt = expect.stringMatching(UUID);

beforeEach(() => {
  vi.clearAllMocks();
  loginIpLimiter.reset();
  db = createFakeTwoFactorDb([{ id: "admin-001", username: "admin", passwordHash: bcrypt.hashSync(PASSWORD, 4) }]);
});

describe("password-only account", () => {
  it("a login from a browser new to the account is one signed_in step, marked new", async () => {
    const res = await passwordStep();
    expect(res.status).toBe(200);
    expect(noted()).toEqual([{ ...ADMIN, outcome: "signed_in", method: "password", newDevice: true, attemptId: anAttempt }]);
    // The request itself goes along, for the address and browser.
    expect(vi.mocked(noteLoginEvent).mock.calls[0][0]).toBeInstanceOf(NextRequest);
  });

  it("a browser that has logged in as this account before is not new", async () => {
    const device = await issueLoginDeviceToken("admin");
    await passwordStep(`login_device=${device}`);
    expect(noted()).toEqual([{ ...ADMIN, outcome: "signed_in", method: "password", newDevice: false, attemptId: anAttempt }]);
  });

  it("a device cookie of ANOTHER account does not make the browser known", async () => {
    const device = await issueLoginDeviceToken("someone-else");
    await passwordStep(`login_device=${device}`);
    expect(noted()[0].newDevice).toBe(true);
  });

  it("a forged device cookie does not either", async () => {
    await passwordStep("login_device=not-a-token");
    expect(noted()[0].newDevice).toBe(true);
  });

  it("a wrong password is not a login step", async () => {
    const res = await passwordStep(undefined, "wrong");
    expect(res.status).toBe(401);
    expect(noteLoginEvent).not.toHaveBeenCalled();
  });
});

describe("two-factor account", () => {
  it("the password step is noted as password_ok — before any code — and the code step as signed_in by totp", async () => {
    const { secret } = await enrol();
    const res = await passwordStep();
    expect(await res.json()).toEqual({ twoFactorRequired: true });
    expect(noted()).toEqual([{ ...ADMIN, outcome: "password_ok", method: "password", newDevice: true, attemptId: anAttempt }]);

    const pending = `login_2fa=${cookiesOf(res).get("login_2fa")!.value}`;
    const done = await codeStep(codeFor(secret), pending);
    expect(done.status).toBe(200);
    // The SAME attempt id: it rode in the pending token from the password step.
    expect(noted()[1]).toEqual({ ...ADMIN, outcome: "signed_in", method: "totp", newDevice: true, attemptId: noted()[0].attemptId });
  });

  it("every attempt has its own id, and each code step carries its own attempt's", async () => {
    const { backupCodes } = await enrol();
    const first = await passwordStep();
    const second = await passwordStep();
    const [a, b] = noted().map((s) => s.attemptId);
    expect(a).not.toBe(b);
    // The second attempt finishes first: its code step names IT, not the latest-but-one.
    await codeStep(backupCodes[0], `login_2fa=${cookiesOf(second).get("login_2fa")!.value}`);
    await codeStep(backupCodes[1], `login_2fa=${cookiesOf(first).get("login_2fa")!.value}`);
    expect(noted().slice(2).map((s) => s.attemptId)).toEqual([b, a]);
  });

  it("a pending token without an attempt id is refused", async () => {
    await enrol();
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ un: "admin", ep: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("admin-001")
      .setAudience("login-2fa")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(`login-2fa:${process.env.SESSION_SECRET}`));
    const res = await codeStep("123456", `login_2fa=${forged}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ restart: true });
  });

  it("a backup code is noted as such", async () => {
    const { backupCodes } = await enrol();
    const res = await passwordStep();
    const pending = `login_2fa=${cookiesOf(res).get("login_2fa")!.value}`;
    await codeStep(backupCodes[0], pending);
    expect(noted()[1]).toMatchObject({ outcome: "signed_in", method: "backup" });
  });

  it("a wrong code adds nothing after the password step", async () => {
    await enrol();
    const res = await passwordStep();
    const pending = `login_2fa=${cookiesOf(res).get("login_2fa")!.value}`;
    const wrong = await codeStep("000000", pending);
    expect(wrong.status).toBe(401);
    expect(noted()).toHaveLength(1);
  });

  it("a browser trusted by an earlier full login is not new at either step", async () => {
    const { secret } = await enrol();
    const device = await issueLoginDeviceToken("admin");
    const res = await passwordStep(`login_device=${device}`);
    const pending = `login_2fa=${cookiesOf(res).get("login_2fa")!.value}; login_device=${device}`;
    await codeStep(codeFor(secret), pending);
    expect(noted().map((s) => s.newDevice)).toEqual([false, false]);
  });
});

describe("GET /api/auth/login-history", () => {
  it("refuses without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await historyGET();
    expect(res.status).toBe(401);
    expect(listLoginHistory).not.toHaveBeenCalled();
  });

  it("answers the lines, where the emails go (masked) and how long they are kept", async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: "admin-001", username: "admin" } as never);
    const line = { id: "x", username: "admin", at: "2026-11-04T07:00:00.000Z", result: "signed_in" };
    vi.mocked(listLoginHistory).mockResolvedValue([line] as never);
    const res = await historyGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [line], alertEmail: "am****@gmail.com", retentionDays: 365 });
  });
});
