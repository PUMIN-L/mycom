// @vitest-environment node
/**
 * The lockout ("5 wrong answers → 15 minutes") under a BURST of parallel
 * requests — the attack it used to lose to. It read "locked yet?", checked the
 * answer, and only then counted a wrong one; every request in a burst passed
 * the read before the first count landed, so 20 wrong codes sent at once were
 * all checked. Against a 6-digit code that is the whole of 2FA's protection.
 *
 * Now the attempt is TAKEN before the answer is checked, under the row lock
 * (takeLoginAttempt). The database here has real-ish latency (5 ms a round
 * trip) and serialises transactions the way SELECT … FOR UPDATE serialises
 * them on one row — without that lock, no code could be correct, and with
 * the latency, the old code demonstrably lost (20 of 20 checked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { createFakeTwoFactorDb, type FakeTwoFactorDb } from "../helpers/fakeTwoFactorDb";

let db: FakeTwoFactorDb;
const LATENCY_MS = 5;
const slow = async (sql: string, params?: unknown[]) => {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  return db.run(sql, params);
};
// One transaction at a time — what the row lock does to transactions on the
// same settings row.
let txQueue: Promise<unknown> = Promise.resolve();
vi.mock("@/app/lib/db", () => ({
  query: (sql: string, params?: unknown[]) => slow(sql, params),
  withTransaction: (fn: (conn: unknown) => Promise<unknown>) => {
    const run = txQueue.then(() => fn({ query: slow }));
    txQueue = run.catch(() => undefined);
    return run;
  },
}));
vi.mock("@/app/lib/settingsStore", () => ({
  getSetting: vi.fn(async (key: string) => {
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    return db.settings.get(key) ?? null;
  }),
  setSetting: vi.fn(async (key: string, value: string) => {
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    db.settings.set(key, value);
  }),
  getSessionEpoch: vi.fn(async () => 0),
  MAINTENANCE_MODE_SETTING: "maintenance_mode",
  isMaintenanceMode: vi.fn(async () => false),
}));
vi.mock("@/app/lib/session", () => ({ createSession: vi.fn(), getSession: vi.fn(), deleteSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
import { PUT as maintenancePUT } from "@/app/api/settings/maintenance/route";
import { takeOtpAttempt } from "@/app/lib/otpAttempts";

import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as twoFactorPOST } from "@/app/api/auth/login/2fa/route";
import { POST as disablePOST } from "@/app/api/auth/2fa/disable/route";
import { loginIpLimiter, takeLoginAttempt, refundLoginAttempt, LOGIN_FAILURE_LIMIT } from "@/app/lib/loginThrottle";
import { beginTotpSetup, confirmTotpSetup } from "@/app/lib/twoFactor";
import { base32Decode, totpCodeAt, totpStep } from "@/app/lib/totp";
import type { NextResponse } from "next/server";

const N = 20;
const post = (url: string, body: unknown, ip: string, cookie?: string) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
/** Each request from its own address, as a botnet would send them. */
const ipFor = (i: number) => `203.0.113.${i + 1}`;
const tally = (statuses: number[]) => ({
  checked: statuses.filter((s) => s !== 429).length,
  refused: statuses.filter((s) => s === 429).length,
});

async function enrol(): Promise<string> {
  const secret = (await beginTotpSetup("admin-001"))!;
  const earlier = Date.now() - 60_000;
  await confirmTotpSetup("admin-001", totpCodeAt(base32Decode(secret)!, totpStep(earlier)), earlier);
  return secret;
}

beforeEach(() => {
  vi.clearAllMocks();
  loginIpLimiter.reset();
  txQueue = Promise.resolve();
  db = createFakeTwoFactorDb([{ id: "admin-001", username: "admin", passwordHash: bcrypt.hashSync("right-pw", 4) }]);
});

describe("takeLoginAttempt", () => {
  it("gives exactly LIMIT attempts to a burst, however many ask at once", async () => {
    const results = await Promise.all(Array.from({ length: N }, () => takeLoginAttempt("login_fail_x")));
    expect(results.filter(Boolean)).toHaveLength(LOGIN_FAILURE_LIMIT);
    expect(db.settings.get("login_fail_x")?.startsWith(`${LOGIN_FAILURE_LIMIT}|`)).toBe(true);
  });

  it("a refused take leaves the count where it was", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) await takeLoginAttempt("login_fail_x");
    const before = db.settings.get("login_fail_x");
    expect(await takeLoginAttempt("login_fail_x")).toBe(false);
    expect(db.settings.get("login_fail_x")).toBe(before);
  });

  it("an ended window starts a fresh count", async () => {
    const now = Date.now();
    db.settings.set("login_fail_x", `${LOGIN_FAILURE_LIMIT}|${now - 1}`);
    expect(await takeLoginAttempt("login_fail_x", now)).toBe(true);
    expect(db.settings.get("login_fail_x")?.startsWith("1|")).toBe(true);
  });

  it("refund hands one back, never below zero, and leaves an ended window alone", async () => {
    const now = Date.now();
    await takeLoginAttempt("login_fail_x", now);
    await takeLoginAttempt("login_fail_x", now);
    await refundLoginAttempt("login_fail_x", now);
    expect(db.settings.get("login_fail_x")?.startsWith("1|")).toBe(true);
    await refundLoginAttempt("login_fail_x", now);
    await refundLoginAttempt("login_fail_x", now);
    expect(db.settings.get("login_fail_x")?.startsWith("0|")).toBe(true);
    db.settings.set("login_fail_y", `3|${now - 1}`);
    await refundLoginAttempt("login_fail_y", now);
    expect(db.settings.get("login_fail_y")).toBe(`3|${now - 1}`);
  });
});

describe("a burst of wrong answers is capped at five checks", () => {
  it("the password step", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    const statuses = (
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: `guess-${i}` }, ipFor(i)))
        )
      )
    ).map((r) => r.status);
    expect(tally(statuses)).toEqual({ checked: LOGIN_FAILURE_LIMIT, refused: N - LOGIN_FAILURE_LIMIT });
    // Refused ones never reach bcrypt either.
    expect(compare).toHaveBeenCalledTimes(LOGIN_FAILURE_LIMIT);
    compare.mockRestore();
  });

  it("the 2FA code step", async () => {
    await enrol();
    const step1 = await loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: "right-pw" }, "198.51.100.1"));
    const cookie = `login_2fa=${(step1 as NextResponse).cookies.get("login_2fa")!.value}`;
    // Count the codes actually CHECKED (each check reads the secret), not just
    // the statuses — checking all twenty and answering 429 to fifteen of them
    // afterwards would be the same hole with a polite face.
    const run = db.run;
    let secretReads = 0;
    db.run = (sql, params) => {
      if (sql.includes("SELECT totpEnabled, totpSecret FROM users")) secretReads++;
      return run(sql, params);
    };
    const statuses = (
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          twoFactorPOST(post("http://localhost/api/auth/login/2fa", { code: String(100000 + i) }, ipFor(i), cookie))
        )
      )
    ).map((r) => r.status);
    expect(tally(statuses)).toEqual({ checked: LOGIN_FAILURE_LIMIT, refused: N - LOGIN_FAILURE_LIMIT });
    expect(secretReads).toBe(LOGIN_FAILURE_LIMIT);
  });

  it("the password check behind a 2FA settings change", async () => {
    await enrol();
    vi.mocked(getSession).mockResolvedValue({ userId: "admin-001", username: "admin", expiresAt: new Date() } as never);
    const statuses = (
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          disablePOST(post("http://localhost/api/auth/2fa/disable", { password: `guess-${i}`, code: "123456" }, ipFor(i)))
        )
      )
    ).map((r) => r.status);
    expect(tally(statuses)).toEqual({ checked: LOGIN_FAILURE_LIMIT, refused: N - LOGIN_FAILURE_LIMIT });
  });
});

describe("emailed OTP codes under a burst", () => {
  it("takeOtpAttempt gives exactly five guesses, however many ask at once", async () => {
    const results = await Promise.all(Array.from({ length: N }, () => takeOtpAttempt("maintenance_otp")));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => r.last)).toHaveLength(1);
  });

  // The attack, end to end: 19 wrong guesses and the RIGHT one, all at once.
  // Before, every request compared the code before any failure was counted,
  // so the right guess in the burst switched maintenance mode. Now only five
  // guesses are compared at all, and the right one past them is refused.
  it("the right code hidden in a burst past the fifth guess does nothing", async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: "admin-001", username: "admin", expiresAt: new Date() } as never);
    db.settings.set("maintenance_otp_state", JSON.stringify({ otp: "654321", expiresAt: Date.now() + 60_000, enable: true }));
    db.settings.set("maintenance_otp_attempts", "0");
    const put = (otp: string) =>
      maintenancePUT(
        new NextRequest("http://localhost/api/settings/maintenance", {
          method: "PUT",
          headers: { origin: "http://localhost", host: "localhost" },
          body: JSON.stringify({ otp }),
        })
      );
    const guesses = [...Array.from({ length: N - 1 }, (_, i) => String(100000 + i)), "654321"];
    const responses = await Promise.all(guesses.map(put));

    expect(responses.every((r) => r.status === 400)).toBe(true);
    expect(db.settings.get("maintenance_mode")).toBeUndefined(); // never switched
    expect(db.settings.get("maintenance_otp_state")).toBe(""); // the code is gone
    expect(db.settings.get("maintenance_otp_attempts")).toBe("5");
  });
});

describe("a right answer is not penalised by the counting", () => {
  it("a correct login resets the bucket it took from", async () => {
    await loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: "nope" }, ipFor(0)));
    expect(db.settings.get("login_fail_u_admin")?.startsWith("1|")).toBe(true);
    const ok = await loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: "right-pw" }, ipFor(1)));
    expect(ok.status).toBe(200);
    expect(db.settings.get("login_fail_u_admin")).toBe("0|0");
  });

  // Settings re-auth counts in its own bucket: neither touches the other.
  it("a correct password in settings leaves the login page's bucket exactly as strangers left it", async () => {
    await enrol();
    vi.mocked(getSession).mockResolvedValue({ userId: "admin-001", username: "admin", expiresAt: new Date() } as never);
    for (let i = 0; i < 3; i++) {
      await loginPOST(post("http://localhost/api/auth/login", { username: "admin", password: "nope" }, ipFor(i)));
    }
    expect(db.settings.get("login_fail_u_admin")?.startsWith("3|")).toBe(true);
    await disablePOST(post("http://localhost/api/auth/2fa/disable", { password: "right-pw", code: "000000" }, ipFor(9)));
    expect(db.settings.get("login_fail_u_admin")?.startsWith("3|")).toBe(true);
    expect(db.settings.get("login_fail_reauth_pw_admin-001")).toBe("0|0"); // right password: its own bucket reset
  });

  // The username is the one bucket name a stranger chooses. Unprefixed, the
  // username "2fa_admin-001" WAS the admin's code bucket.
  it.each(["2fa_admin-001", "reauth_pw_admin-001", "reauth_2fa_admin-001", "2fa_dev_x", "dev_x"])(
    "logging in as %p fills only that made-up name's bucket, never one of the admin's",
    // One wrong login is enough to see WHICH bucket it counts in. (Five, as
    // this was first written, ran a cost-12 bcrypt five times per case — an
    // unknown username is compared against a dummy hash, to keep its timing —
    // and timed out on a busy machine.)
    async (name) => {
      await loginPOST(post("http://localhost/api/auth/login", { username: name, password: "nope" }, ipFor(0)));
      expect(db.settings.get(`login_fail_u_${name}`)?.startsWith("1|")).toBe(true);
      expect(db.settings.has(`login_fail_${name}`)).toBe(false);
    }
  );
});
