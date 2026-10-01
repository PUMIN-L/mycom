// @vitest-environment node
/**
 * /api/auth/2fa/* — turning two-factor login on and off from the settings
 * page. Real bcrypt, real TOTP codes, a database that runs the statements.
 *
 * The rule under test: a logged-in session is NOT enough. Someone holding a
 * stolen session cookie must not be able to switch 2FA on with his own phone
 * (locking the real admin out) or switch it off — so every change asks for
 * the password again, and once 2FA is on, a code too; both are lockout-counted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
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
  bumpSessionEpoch: vi.fn(async () => ++epoch),
  SESSION_EPOCH_TAG: "session_epoch",
}));
import { bumpSessionEpoch } from "@/app/lib/settingsStore";
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/app/lib/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
import { createSession, getSession } from "@/app/lib/session";

import { GET as statusGET } from "@/app/api/auth/2fa/route";
import { POST as setupPOST } from "@/app/api/auth/2fa/setup/route";
import { POST as enablePOST } from "@/app/api/auth/2fa/enable/route";
import { POST as disablePOST } from "@/app/api/auth/2fa/disable/route";
import { POST as backupPOST } from "@/app/api/auth/2fa/backup-codes/route";
import { decryptTotpSecret, verifySecondFactor } from "@/app/lib/twoFactor";
import { base32Decode, totpCodeAt, totpStep } from "@/app/lib/totp";

const PASSWORD = "correct-horse";
const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const codeFor = (secret: string, at: number = Date.now()) => totpCodeAt(base32Decode(secret)!, totpStep(at));

const post = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/** Start setup and return the secret the QR code carries. */
async function startSetup(): Promise<string> {
  const res = await setupPOST();
  expect(res.status).toBe(200);
  return (await res.json()).secret;
}

/** Start + confirm, with the code from a minute ago so "now" stays unused. */
async function turnOn(): Promise<{ secret: string; backupCodes: string[] }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Date.now();
  vi.setSystemTime(now - 60_000);
  const secret = await startSetup();
  const res = await enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: codeFor(secret) }));
  vi.useRealTimers();
  expect(res.status).toBe(200);
  vi.mocked(createSession).mockClear();
  vi.mocked(bumpSessionEpoch).mockClear();
  return { secret, backupCodes: (await res.json()).backupCodes };
}

beforeEach(() => {
  vi.clearAllMocks();
  epoch = 0;
  db = createFakeTwoFactorDb([
    { id: "admin-001", username: "admin", passwordHash: bcrypt.hashSync(PASSWORD, 4) },
  ]);
  vi.mocked(getSession).mockResolvedValue(admin);
});

describe("every 2FA settings route needs a session", () => {
  it.each([
    ["GET status", () => statusGET()],
    ["setup", () => setupPOST()],
    ["enable", () => enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: "123456" }))],
    ["disable", () => disablePOST(post("/api/auth/2fa/disable", { password: PASSWORD, code: "123456" }))],
    ["backup-codes", () => backupPOST(post("/api/auth/2fa/backup-codes", { password: PASSWORD, code: "123456" }))],
  ])("%s → 401 when logged out", async (_name, call) => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});

describe("GET /api/auth/2fa", () => {
  it("off, then on with ten backup codes", async () => {
    expect(await (await statusGET()).json()).toEqual({ enabled: false, backupCodesRemaining: 0 });
    await turnOn();
    expect(await (await statusGET()).json()).toEqual({ enabled: true, backupCodesRemaining: 10 });
  });
});

describe("POST /api/auth/2fa/setup", () => {
  it("returns a QR image drawn here and the same secret as text, never cached", async () => {
    const res = await setupPOST();
    const body = await res.json();
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(decryptTotpSecret(db.users.get("admin-001")!.totpPendingSecret)).toBe(body.secret);
    expect(db.users.get("admin-001")!.totpEnabled).toBe(0); // nothing changes yet
  });

  it("refuses while 2FA is on — a live secret is only replaced after turning it off", async () => {
    await turnOn();
    expect((await setupPOST()).status).toBe(409);
  });
});

describe("POST /api/auth/2fa/enable", () => {
  it("needs the password — a session alone cannot turn 2FA on", async () => {
    const secret = await startSetup();
    const missing = await enablePOST(post("/api/auth/2fa/enable", { code: codeFor(secret) }));
    expect(missing.status).toBe(400);
    const wrong = await enablePOST(post("/api/auth/2fa/enable", { password: "guess", code: codeFor(secret) }));
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error).toBe("รหัสผ่านไม่ถูกต้อง");
    expect(db.users.get("admin-001")!.totpEnabled).toBe(0);
  });

  it("five wrong passwords lock it, in the same bucket as the login screen", async () => {
    const secret = await startSetup();
    for (let i = 0; i < 5; i++) {
      await enablePOST(post("/api/auth/2fa/enable", { password: "guess", code: codeFor(secret) }));
    }
    const res = await enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: codeFor(secret) }));
    expect(res.status).toBe(429);
    expect(db.settings.get("login_fail_admin")?.startsWith("5|")).toBe(true);
  });

  it("needs a code from the phone that scanned THIS QR", async () => {
    await startSetup();
    const res = await enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: "000000" }));
    expect(res.status).toBe(403);
    expect(db.users.get("admin-001")!.totpEnabled).toBe(0);
    expect(db.settings.get("login_fail_2fa_admin-001")?.startsWith("1|")).toBe(true);
  });

  it("says to start over when nothing is pending", async () => {
    const res = await enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("turns it on, hands the backup codes over once, and logs every other browser out", async () => {
    const secret = await startSetup();
    const res = await enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: codeFor(secret) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.backupCodes).toHaveLength(10);
    expect(db.users.get("admin-001")!.totpEnabled).toBe(1);

    // Sessions issued on the password alone are void from here on…
    expect(bumpSessionEpoch).toHaveBeenCalledTimes(1);
    // …and this browser is re-issued one under the new epoch.
    expect(createSession).toHaveBeenCalledWith("admin-001", "admin", 1);
    expect((res as NextResponse).cookies.get("login_device")?.value).toBeTruthy();
  });

  // A page on another site posting here with the admin's cookies attached.
  it("refuses a cross-site request before anything else", async () => {
    const secret = await startSetup();
    const res = await enablePOST(
      new NextRequest("http://localhost/api/auth/2fa/enable", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "localhost" },
        body: JSON.stringify({ password: PASSWORD, code: codeFor(secret) }),
      })
    );
    expect(res.status).toBe(403);
    expect(db.users.get("admin-001")!.totpEnabled).toBe(0);
  });

  it("refuses when already on", async () => {
    await turnOn();
    const res = await enablePOST(post("/api/auth/2fa/enable", { password: PASSWORD, code: "123456" }));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/auth/2fa/disable", () => {
  it("needs the password AND a code — neither alone switches it off", async () => {
    const { secret } = await turnOn();
    const noCode = await disablePOST(post("/api/auth/2fa/disable", { password: PASSWORD }));
    expect(noCode.status).toBe(400);
    const wrongCode = await disablePOST(post("/api/auth/2fa/disable", { password: PASSWORD, code: "000000" }));
    expect(wrongCode.status).toBe(403);
    const wrongPassword = await disablePOST(
      post("/api/auth/2fa/disable", { password: "guess", code: codeFor(secret) })
    );
    expect(wrongPassword.status).toBe(403);
    expect(db.users.get("admin-001")!.totpEnabled).toBe(1);
  });

  it("with both, turns it off and removes the backup codes", async () => {
    const { secret } = await turnOn();
    const res = await disablePOST(post("/api/auth/2fa/disable", { password: PASSWORD, code: codeFor(secret) }));
    expect(res.status).toBe(200);
    expect(db.users.get("admin-001")).toMatchObject({ totpEnabled: 0, totpSecret: null });
    expect(db.backupCodes).toHaveLength(0);
  });

  it("a backup code will do instead of the phone", async () => {
    const { backupCodes } = await turnOn();
    const res = await disablePOST(post("/api/auth/2fa/disable", { password: PASSWORD, code: backupCodes[3] }));
    expect(res.status).toBe(200);
  });

  it("refuses when 2FA is not on", async () => {
    expect((await disablePOST(post("/api/auth/2fa/disable", { password: PASSWORD, code: "123456" }))).status).toBe(409);
  });
});

describe("POST /api/auth/2fa/backup-codes", () => {
  it("needs the password and a code, then replaces every old code", async () => {
    const { secret, backupCodes: old } = await turnOn();
    const refused = await backupPOST(post("/api/auth/2fa/backup-codes", { password: "guess", code: codeFor(secret) }));
    expect(refused.status).toBe(403);

    const res = await backupPOST(post("/api/auth/2fa/backup-codes", { password: PASSWORD, code: codeFor(secret) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const fresh: string[] = (await res.json()).backupCodes;
    expect(fresh).toHaveLength(10);
    expect((await verifySecondFactor("admin-001", old[0])).ok).toBe(false);
    expect((await verifySecondFactor("admin-001", fresh[0])).ok).toBe(true);
  });

  it("refuses when 2FA is not on", async () => {
    expect(
      (await backupPOST(post("/api/auth/2fa/backup-codes", { password: PASSWORD, code: "123456" }))).status
    ).toBe(409);
  });
});
