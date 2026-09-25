// @vitest-environment node
/**
 * Login lockout vs. the trusted-device cookie.
 *
 * The lockout counts failures per username, so anyone could keep the admin
 * locked out by failing 5 times every 15 minutes. A browser that has logged in
 * successfully now carries a signed device cookie; with it, its attempts are
 * counted in its own bucket. The attacker locks the username; the admin's own
 * browser still gets in — and the attacker, having no cookie, still gets only
 * 5 guesses per 15 minutes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

// Shared settings-table state, driven by both the plain getSetting/setSetting
// calls and the transactional counter — same harness as login-rate-limit.test.
let state: Map<string, string>;
const conn = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO settings")) {
      const [key] = params as [string];
      if (!state.has(key)) state.set(key, "0|0");
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("SELECT value FROM settings")) {
      const v = state.get((params as [string])[0]);
      return [v !== undefined ? [{ value: v }] : []];
    }
    if (sql.includes("UPDATE settings")) {
      const [value, key] = params as [string, string];
      state.set(key, value);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled SQL in test: ${sql}`);
  }),
};
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
  getDbConnection: vi.fn(),
}));
import { query } from "@/app/lib/db";

vi.mock("@/app/lib/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
import { createSession } from "@/app/lib/session";

// The session epoch ("log out other devices"); device tokens issued under an
// older one stop being trusted.
let epoch = 0;
vi.mock("@/app/lib/settingsStore", () => ({
  getSessionEpoch: vi.fn(async () => epoch),
  getSetting: vi.fn(async (key: string) => state.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    state.set(key, value);
  }),
}));

import { POST as login } from "@/app/api/auth/login/route";
import { issueLoginDeviceToken } from "@/app/lib/loginDevice";

const PASSWORD = "correct-horse";
const req = (body: unknown, deviceCookie?: string) =>
  new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: deviceCookie ? { cookie: `login_device=${deviceCookie}` } : {},
  });

async function lockUsernameAsAttacker(username = "admin") {
  for (let i = 0; i < 5; i++) await login(req({ username, password: "WRONG" }));
  // Sanity: the username bucket really is locked for anyone without a cookie.
  const blocked = await login(req({ username, password: PASSWORD }));
  expect(blocked.status).toBe(429);
}

beforeEach(async () => {
  vi.clearAllMocks();
  state = new Map();
  epoch = 0;
  const passwordHash = bcrypt.hashSync(PASSWORD, 4);
  vi.mocked(query).mockResolvedValue([[{ id: "1", username: "admin", passwordHash }]] as never);
});

describe("login lockout — trusted device cookie", () => {
  it("the admin's trusted browser still logs in while an attacker keeps the username locked", async () => {
    const device = await issueLoginDeviceToken("admin");
    await lockUsernameAsAttacker();

    const res = await login(req({ username: "admin", password: PASSWORD }, device));

    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith("1", "admin");
  });

  it("a trusted login does not reopen the username's lock for everyone else", async () => {
    const device = await issueLoginDeviceToken("admin");
    await lockUsernameAsAttacker();
    await login(req({ username: "admin", password: PASSWORD }, device));

    const attacker = await login(req({ username: "admin", password: PASSWORD }));
    expect(attacker.status).toBe(429);
  });

  it("a trusted device's own failures lock only that device, and never touch the username's count", async () => {
    const device = await issueLoginDeviceToken("admin");
    for (let i = 0; i < 5; i++) await login(req({ username: "admin", password: "WRONG" }, device));

    const sameDevice = await login(req({ username: "admin", password: PASSWORD }, device));
    expect(sameDevice.status).toBe(429);
    // The username bucket was never written, so a plain login still works.
    expect(state.has("login_fail_admin")).toBe(false);
    const other = await login(req({ username: "admin", password: PASSWORD }));
    expect(other.status).toBe(200);
  });

  it.each([
    ["another user's device cookie", async () => issueLoginDeviceToken("someone-else")],
    ["a forged cookie", async () => "not-a-real-token"],
    [
      "a cookie signed with the SESSION key instead of the device key",
      async () =>
        new SignJWT({ userId: "1", username: "admin" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject("admin")
          .setAudience("login-device")
          .setJti("x")
          .setExpirationTime("1d")
          .sign(new TextEncoder().encode(process.env.SESSION_SECRET!)),
    ],
    [
      "an expired device cookie",
      async () =>
        new SignJWT({})
          .setProtectedHeader({ alg: "HS256" })
          .setSubject("admin")
          .setAudience("login-device")
          .setJti("expired")
          .setIssuedAt(Math.floor(Date.now() / 1000) - 200 * 86400)
          .setExpirationTime(Math.floor(Date.now() / 1000) - 86400)
          .sign(new TextEncoder().encode(`login-device:${process.env.SESSION_SECRET}`)),
    ],
  ])("%s gets no exemption from the username lock", async (_label, makeCookie) => {
    await lockUsernameAsAttacker();
    const res = await login(req({ username: "admin", password: PASSWORD }, await makeCookie()));
    expect(res.status).toBe(429);
  });

  it("a successful login issues a device cookie scoped to the login endpoint only", async () => {
    const res = await login(req({ username: "admin", password: PASSWORD }));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^login_device=[^;]+/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api\/auth\/login/);
    expect(setCookie).toMatch(/SameSite=strict/i);
    expect(setCookie).toMatch(/Max-Age=15552000/); // 180 days
  });

  it("stops trusting a device after 'log out other devices' bumps the epoch", async () => {
    const device = await issueLoginDeviceToken("admin"); // issued at epoch 0
    epoch = 1;
    await lockUsernameAsAttacker();

    const res = await login(req({ username: "admin", password: PASSWORD }, device));
    expect(res.status).toBe(429);
  });

  it("trusts a device issued under the current epoch", async () => {
    epoch = 3;
    const device = await issueLoginDeviceToken("admin");
    await lockUsernameAsAttacker();

    const res = await login(req({ username: "admin", password: PASSWORD }, device));
    expect(res.status).toBe(200);
  });

  it("a failed login issues no device cookie", async () => {
    const res = await login(req({ username: "admin", password: "WRONG" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
