/**
 * An in-memory stand-in for the three tables two-factor login touches —
 * `users`, `user_backup_codes` and `settings` (the lockout rows) — that RUNS
 * the statements app/lib/twoFactor.ts and app/lib/loginThrottle.ts send.
 * Tests built on it assert what the next request would see (a code is gone
 * after one use, a step cannot be replayed), not which SQL strings went out.
 *
 * An unrecognised statement throws, so a query added without teaching it here
 * fails loudly instead of quietly returning nothing.
 */

export interface FakeUser {
  id: string;
  username: string;
  passwordHash: string;
  totpEnabled: number;
  totpSecret: string | null;
  totpPendingSecret: string | null;
  totpLastStep: number | null;
}

export interface FakeBackupCode {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: string | null;
  createdAt: string;
}

export interface FakeTwoFactorDb {
  users: Map<string, FakeUser>;
  backupCodes: FakeBackupCode[];
  settings: Map<string, string>;
  run: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
}

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();
const ok = (affectedRows: number) => [{ affectedRows }, undefined] as [unknown, unknown];
const rows = (r: unknown[]) => [r, undefined] as [unknown, unknown];

export function createFakeTwoFactorDb(users: Partial<FakeUser>[] = []): FakeTwoFactorDb {
  const db: FakeTwoFactorDb = {
    users: new Map(
      users.map((u) => [
        u.id!,
        {
          id: u.id!,
          username: u.username ?? "admin",
          passwordHash: u.passwordHash ?? "",
          totpEnabled: u.totpEnabled ?? 0,
          totpSecret: u.totpSecret ?? null,
          totpPendingSecret: u.totpPendingSecret ?? null,
          totpLastStep: u.totpLastStep ?? null,
        },
      ])
    ),
    backupCodes: [],
    settings: new Map(),
    run: async () => ok(0),
  };

  db.run = async (rawSql: string, params: unknown[] = []) => {
    const sql = norm(rawSql);
    const p = params;

    // ── users ──
    if (sql === "SELECT * FROM users WHERE username = ?") {
      const name = String(p[0]);
      return rows([...db.users.values()].filter((u) => u.username === name));
    }
    if (sql === "SELECT id, username, passwordHash, totpEnabled FROM users WHERE id = ? LIMIT 1") {
      const u = db.users.get(String(p[0]));
      return rows(u ? [{ id: u.id, username: u.username, passwordHash: u.passwordHash, totpEnabled: u.totpEnabled }] : []);
    }
    if (sql === "SELECT totpEnabled, totpSecret FROM users WHERE id = ? LIMIT 1") {
      const u = db.users.get(String(p[0]));
      return rows(u ? [{ totpEnabled: u.totpEnabled, totpSecret: u.totpSecret }] : []);
    }
    if (sql === "SELECT totpEnabled, totpPendingSecret FROM users WHERE id = ? FOR UPDATE") {
      const u = db.users.get(String(p[0]));
      return rows(u ? [{ totpEnabled: u.totpEnabled, totpPendingSecret: u.totpPendingSecret }] : []);
    }
    if (sql === "UPDATE users SET totpPendingSecret = ? WHERE id = ? AND totpEnabled = 0") {
      const u = db.users.get(String(p[1]));
      if (!u || u.totpEnabled !== 0) return ok(0);
      u.totpPendingSecret = String(p[0]);
      return ok(1);
    }
    if (
      sql ===
      "UPDATE users SET totpEnabled = 1, totpSecret = totpPendingSecret, totpPendingSecret = NULL, totpLastStep = ? WHERE id = ?"
    ) {
      const u = db.users.get(String(p[1]));
      if (!u) return ok(0);
      u.totpEnabled = 1;
      u.totpSecret = u.totpPendingSecret;
      u.totpPendingSecret = null;
      u.totpLastStep = Number(p[0]);
      return ok(1);
    }
    if (
      sql ===
      "UPDATE users SET totpEnabled = 0, totpSecret = NULL, totpPendingSecret = NULL, totpLastStep = NULL WHERE id = ?"
    ) {
      const u = db.users.get(String(p[0]));
      if (!u) return ok(0);
      Object.assign(u, { totpEnabled: 0, totpSecret: null, totpPendingSecret: null, totpLastStep: null });
      return ok(1);
    }
    if (
      sql ===
      "UPDATE users SET totpLastStep = ? WHERE id = ? AND totpEnabled = 1 AND (totpLastStep IS NULL OR totpLastStep < ?)"
    ) {
      const u = db.users.get(String(p[1]));
      const step = Number(p[0]);
      if (!u || u.totpEnabled !== 1 || (u.totpLastStep !== null && !(u.totpLastStep < Number(p[2])))) return ok(0);
      u.totpLastStep = step;
      return ok(1);
    }

    // ── user_backup_codes ──
    if (sql === "SELECT COUNT(*) AS n FROM user_backup_codes WHERE userId = ? AND usedAt IS NULL") {
      return rows([{ n: db.backupCodes.filter((c) => c.userId === String(p[0]) && c.usedAt === null).length }]);
    }
    if (sql === "DELETE FROM user_backup_codes WHERE userId = ?") {
      const before = db.backupCodes.length;
      db.backupCodes = db.backupCodes.filter((c) => c.userId !== String(p[0]));
      return ok(before - db.backupCodes.length);
    }
    if (sql.startsWith("INSERT INTO user_backup_codes (id, userId, codeHash, usedAt, createdAt) VALUES")) {
      for (let i = 0; i < p.length; i += 4) {
        db.backupCodes.push({
          id: String(p[i]),
          userId: String(p[i + 1]),
          codeHash: String(p[i + 2]),
          usedAt: null,
          createdAt: String(p[i + 3]),
        });
      }
      return ok(p.length / 4);
    }
    if (sql === "UPDATE user_backup_codes SET usedAt = ? WHERE userId = ? AND codeHash = ? AND usedAt IS NULL") {
      const code = db.backupCodes.find(
        (c) => c.userId === String(p[1]) && c.codeHash === String(p[2]) && c.usedAt === null
      );
      if (!code) return ok(0);
      code.usedAt = String(p[0]);
      return ok(1);
    }

    // ── settings (lockout buckets) ──
    if (sql === "INSERT INTO settings (name, value) VALUES (?, '0|0') ON DUPLICATE KEY UPDATE name = name") {
      if (!db.settings.has(String(p[0]))) db.settings.set(String(p[0]), "0|0");
      return ok(1);
    }
    // takeOtpAttempt's guess counter.
    if (sql === "INSERT INTO settings (name, value) VALUES (?, '0') ON DUPLICATE KEY UPDATE name = name") {
      if (!db.settings.has(String(p[0]))) db.settings.set(String(p[0]), "0");
      return ok(1);
    }
    if (sql === "SELECT value FROM settings WHERE name = ? FOR UPDATE") {
      const v = db.settings.get(String(p[0]));
      return rows(v === undefined ? [] : [{ value: v }]);
    }
    if (sql === "UPDATE settings SET value = ? WHERE name = ?") {
      db.settings.set(String(p[1]), String(p[0]));
      return ok(1);
    }

    throw new Error(`fakeTwoFactorDb: unhandled SQL: ${sql}`);
  };

  return db;
}
