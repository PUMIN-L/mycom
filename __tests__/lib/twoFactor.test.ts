// @vitest-environment node
/**
 * app/lib/twoFactor.ts — the storage side of two-factor login, run against an
 * in-memory database that executes its statements (helpers/fakeTwoFactorDb).
 * What matters here is what the NEXT request sees: a secret that is not in
 * the clear, a code that works once, a backup code that works once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeTwoFactorDb, type FakeTwoFactorDb } from "../helpers/fakeTwoFactorDb";

let db: FakeTwoFactorDb;
vi.mock("@/app/lib/db", () => ({
  query: (sql: string, params?: unknown[]) => db.run(sql, params),
  withTransaction: async (fn: (conn: unknown) => Promise<unknown>) =>
    fn({ query: (sql: string, params?: unknown[]) => db.run(sql, params) }),
}));

import {
  beginTotpSetup,
  confirmTotpSetup,
  countUnusedBackupCodes,
  decryptTotpSecret,
  disableTwoFactor,
  encryptTotpSecret,
  generateBackupCodes,
  getTwoFactorUser,
  hashBackupCode,
  normalizeBackupCode,
  regenerateBackupCodes,
  verifySecondFactor,
} from "@/app/lib/twoFactor";
import { base32Decode, totpCodeAt, totpStep } from "@/app/lib/totp";

const NOW = 1_800_000_000_000;
const codeFor = (secretBase32: string, at: number = NOW) => totpCodeAt(base32Decode(secretBase32)!, totpStep(at));

beforeEach(() => {
  db = createFakeTwoFactorDb([{ id: "admin-001", username: "admin", passwordHash: "x" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Set up and confirm 2FA for admin-001; returns the secret and backup codes. */
async function enrolled(): Promise<{ secret: string; backupCodes: string[] }> {
  const secret = (await beginTotpSetup("admin-001"))!;
  const result = await confirmTotpSetup("admin-001", codeFor(secret, NOW - 60_000), NOW - 60_000);
  if (!result.ok) throw new Error("enrolment failed in test setup");
  return { secret, backupCodes: result.backupCodes };
}

describe("the secret at rest", () => {
  it("round-trips, with a fresh nonce every time", () => {
    const a = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    const b = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(a)).toBe("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(b)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses a tampered, truncated or unknown-format value", () => {
    const stored = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 0x01;
    expect(decryptTotpSecret(`v1:${raw.toString("base64")}`)).toBeNull();
    expect(decryptTotpSecret("v1:AAAA")).toBeNull();
    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP")).toBeNull(); // plaintext is never accepted
    expect(decryptTotpSecret(null)).toBeNull();
  });

  // The documented cost of deriving the key from SESSION_SECRET.
  it("cannot be read once SESSION_SECRET changes", () => {
    const stored = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret-0123456789");
    expect(decryptTotpSecret(stored)).toBeNull();
  });
});

describe("backup codes", () => {
  it("are ten distinct ABCD-EFGH codes with no look-alike characters", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it("are read forgivingly: case, spaces and the dash do not matter", () => {
    expect(normalizeBackupCode(" ab3f-k2m9 ")).toBe("AB3FK2M9");
    expect(normalizeBackupCode("AB3F K2M9")).toBe("AB3FK2M9");
  });

  it("but not anything that cannot be one", () => {
    for (const bad of ["", "AB3F-K2M", "AB3F-K2M99", "AB3F-K2M0", "AB3F-K2MI", "123456"]) {
      expect(normalizeBackupCode(bad)).toBeNull();
    }
  });

  it("are hashed with a key — the same code under another SESSION_SECRET hashes differently", () => {
    const before = hashBackupCode("AB3FK2M9");
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBackupCode("AB3FK2M9")).toBe(before);
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret-0123456789");
    expect(hashBackupCode("AB3FK2M9")).not.toBe(before);
  });
});

describe("setting up", () => {
  it("stores the new secret as PENDING and encrypted — 2FA is not on yet", async () => {
    const secret = await beginTotpSetup("admin-001");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const row = db.users.get("admin-001")!;
    expect(row.totpEnabled).toBe(0);
    expect(row.totpSecret).toBeNull();
    expect(row.totpPendingSecret).not.toContain(secret!);
    expect(decryptTotpSecret(row.totpPendingSecret)).toBe(secret);
  });

  it("starting again replaces the pending secret — the first QR code stops working", async () => {
    const first = (await beginTotpSetup("admin-001"))!;
    const second = (await beginTotpSetup("admin-001"))!;
    expect(second).not.toBe(first);
    expect((await confirmTotpSetup("admin-001", codeFor(first), NOW)).ok).toBe(false);
    expect((await confirmTotpSetup("admin-001", codeFor(second), NOW)).ok).toBe(true);
  });

  it("a wrong code changes nothing", async () => {
    await beginTotpSetup("admin-001");
    expect(await confirmTotpSetup("admin-001", "000000", NOW)).toEqual({ ok: false, reason: "wrong_code" });
    expect(db.users.get("admin-001")!.totpEnabled).toBe(0);
    expect(db.backupCodes).toHaveLength(0);
  });

  it("refuses to confirm with nothing pending", async () => {
    expect(await confirmTotpSetup("admin-001", "123456", NOW)).toEqual({ ok: false, reason: "no_pending" });
  });

  it("the right code turns it on, and writes ten backup codes as hashes only", async () => {
    const { secret, backupCodes } = await enrolled();
    const row = db.users.get("admin-001")!;
    expect(row.totpEnabled).toBe(1);
    expect(decryptTotpSecret(row.totpSecret)).toBe(secret);
    expect(row.totpPendingSecret).toBeNull();
    expect(backupCodes).toHaveLength(10);
    expect(db.backupCodes).toHaveLength(10);
    const stored = db.backupCodes.map((c) => c.codeHash).join(" ");
    for (const code of backupCodes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(normalizeBackupCode(code)!);
    }
    expect(await countUnusedBackupCodes("admin-001")).toBe(10);
    expect((await getTwoFactorUser("admin-001"))?.totpEnabled).toBe(true);
  });

  it("refuses to start or confirm again while it is on — a live secret is only replaced by turning it off", async () => {
    await enrolled();
    expect(await beginTotpSetup("admin-001")).toBeNull();
    expect(await confirmTotpSetup("admin-001", "123456", NOW)).toEqual({ ok: false, reason: "already_enabled" });
  });
});

describe("verifySecondFactor — the authenticator code", () => {
  it("accepts the current code once, and refuses it the second time", async () => {
    const { secret } = await enrolled();
    const code = codeFor(secret);
    expect(await verifySecondFactor("admin-001", code, NOW)).toEqual({ ok: true, method: "totp" });
    expect(await verifySecondFactor("admin-001", code, NOW)).toEqual({ ok: false, reason: "replayed" });
  });

  it("the code used to confirm setup cannot be replayed at the login screen", async () => {
    const secret = (await beginTotpSetup("admin-001"))!;
    const code = codeFor(secret);
    expect((await confirmTotpSetup("admin-001", code, NOW)).ok).toBe(true);
    expect(await verifySecondFactor("admin-001", code, NOW)).toEqual({ ok: false, reason: "replayed" });
  });

  it("accepts the next code, but never an older one after a newer one", async () => {
    const { secret } = await enrolled();
    const later = NOW + 30_000;
    expect((await verifySecondFactor("admin-001", codeFor(secret, later), later)).ok).toBe(true);
    // The code for NOW is still inside the ±1 window at `later`, but its step
    // is behind the last one accepted.
    expect(await verifySecondFactor("admin-001", codeFor(secret, NOW), later)).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("refuses a wrong code", async () => {
    await enrolled();
    expect(await verifySecondFactor("admin-001", "000000", NOW)).toEqual({ ok: false, reason: "wrong" });
  });

  it("is unavailable when 2FA is off", async () => {
    expect(await verifySecondFactor("admin-001", "123456", NOW)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("is unavailable — and says why in the log — when the secret cannot be decrypted", async () => {
    const { secret } = await enrolled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret-0123456789");
    expect(await verifySecondFactor("admin-001", codeFor(secret), NOW)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(String(log.mock.calls[0][0])).toContain("SESSION_SECRET");
  });
});

describe("verifySecondFactor — backup codes", () => {
  it("each works exactly once, however it is typed", async () => {
    const { backupCodes } = await enrolled();
    const [first] = backupCodes;
    expect(await verifySecondFactor("admin-001", ` ${first.toLowerCase().replace("-", " ")} `, NOW)).toEqual({
      ok: true,
      method: "backup",
    });
    expect(await verifySecondFactor("admin-001", first, NOW)).toEqual({ ok: false, reason: "wrong" });
    expect(await countUnusedBackupCodes("admin-001")).toBe(9);
  });

  it("refuses a code that was never issued", async () => {
    await enrolled();
    expect(await verifySecondFactor("admin-001", "AAAA-AAAA", NOW)).toEqual({ ok: false, reason: "wrong" });
    expect(await verifySecondFactor("admin-001", "not a code", NOW)).toEqual({ ok: false, reason: "wrong" });
  });

  it("a new set makes every old code stop working", async () => {
    const { backupCodes: old } = await enrolled();
    const fresh = await regenerateBackupCodes("admin-001", NOW);
    expect(fresh).toHaveLength(10);
    expect(fresh.some((code) => old.includes(code))).toBe(false);
    expect((await verifySecondFactor("admin-001", old[0], NOW)).ok).toBe(false);
    expect((await verifySecondFactor("admin-001", fresh[0], NOW)).ok).toBe(true);
  });
});

describe("turning it off", () => {
  it("removes the secret, the replay marker and every backup code", async () => {
    const { secret, backupCodes } = await enrolled();
    await disableTwoFactor("admin-001");
    const row = db.users.get("admin-001")!;
    expect(row).toMatchObject({ totpEnabled: 0, totpSecret: null, totpPendingSecret: null, totpLastStep: null });
    expect(db.backupCodes).toHaveLength(0);
    expect((await verifySecondFactor("admin-001", codeFor(secret), NOW)).ok).toBe(false);
    expect((await verifySecondFactor("admin-001", backupCodes[0], NOW)).ok).toBe(false);
  });
});
