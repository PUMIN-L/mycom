// @vitest-environment node
/**
 * purgeExpiredLoginFailures — the nightly delete of login lockout rows whose
 * window has ended. Run against a stand-in `settings` table that evaluates the
 * statements the function sends (LIKE with its ESCAPE, the keyset page, the
 * guarded DELETE), so what is asserted is which rows survive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let table: Map<string, string>;
/** Runs between the page read and its DELETE — a login landing mid-purge. */
let beforeDelete: (() => void) | null;

function likeToRegExp(pattern: string, escape: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === escape) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}

vi.mock("@/app/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT name, value FROM settings WHERE name LIKE ? ESCAPE '!' AND name > ? ORDER BY name LIMIT ?")) {
      const [like, after, limit] = params as [string, string, number];
      const re = likeToRegExp(like, "!");
      const rows = [...table.entries()]
        .filter(([name]) => re.test(name) && name > after)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, limit)
        .map(([name, value]) => ({ name, value }));
      return [rows];
    }
    if (sql.startsWith("DELETE FROM settings WHERE ")) {
      beforeDelete?.();
      beforeDelete = null;
      const pairs = params as string[];
      expect(sql.match(/\(name = \? AND value = \?\)/g)).toHaveLength(pairs.length / 2);
      let affectedRows = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        if (table.get(pairs[i]) === pairs[i + 1]) {
          table.delete(pairs[i]);
          affectedRows++;
        }
      }
      return [{ affectedRows }];
    }
    throw new Error(`Unhandled SQL in test: ${sql}`);
  }),
}));
import { query } from "@/app/lib/db";
import { purgeExpiredLoginFailures, parseLoginFailState, LOGIN_FAIL_PREFIX } from "@/app/lib/loginThrottle";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  table = new Map();
  beforeDelete = null;
});

describe("purgeExpiredLoginFailures", () => {
  it("deletes rows whose window has ended and keeps the ones still counting", async () => {
    table.set("login_fail_admin", `5|${NOW + 60_000}`); // locked right now
    table.set("login_fail_sales", `2|${NOW + 1}`); // counting, not locked yet
    table.set("login_fail_ghost-user-8812", `1|${NOW - 1}`); // made-up name, window over
    table.set("login_fail_admin2", "0|0"); // left by a successful login
    table.set("login_fail_dev_3f2a", `5|${NOW}`); // ends exactly now: already open again
    table.set("login_fail_dev_9b1c", `3|${NOW + 5_000}`);

    expect(await purgeExpiredLoginFailures(NOW)).toBe(3);
    expect([...table.keys()].sort()).toEqual(["login_fail_admin", "login_fail_dev_9b1c", "login_fail_sales"]);
  });

  it("never touches other settings, even ones an unescaped _ would match", async () => {
    table.set("otp_code_maintenance", "123456|0");
    table.set("company_profile", "{}");
    table.set("loginXfailXadmin", "0|0");
    table.set("login_failures_note", "0|0"); // "login_fail_%" with _ as a wildcard matches this
    table.set("login_fail_x", "0|0");

    expect(await purgeExpiredLoginFailures(NOW)).toBe(1);
    expect([...table.keys()].sort()).toEqual([
      "company_profile",
      "loginXfailXadmin",
      "login_failures_note",
      "otp_code_maintenance",
    ]);
  });

  it("keeps a row that a failed login rewrote between the read and the delete", async () => {
    table.set("login_fail_admin", `4|${NOW - 1}`);
    table.set("login_fail_old", `1|${NOW - 1}`);
    // A new failure after the window ended starts a fresh one: 1|now+15min.
    beforeDelete = () => table.set("login_fail_admin", `1|${NOW + 900_000}`);

    expect(await purgeExpiredLoginFailures(NOW)).toBe(1);
    expect(table.get("login_fail_admin")).toBe(`1|${NOW + 900_000}`);
    expect(table.has("login_fail_old")).toBe(false);
  });

  it("works through a flooded table a page at a time", async () => {
    for (let i = 0; i < 1234; i++) table.set(`login_fail_junk${String(i).padStart(5, "0")}`, `1|${NOW - 1}`);
    table.set("login_fail_zz-live", `5|${NOW + 60_000}`);

    expect(await purgeExpiredLoginFailures(NOW)).toBe(1234);
    expect([...table.keys()]).toEqual(["login_fail_zz-live"]);

    const selects = vi.mocked(query).mock.calls.filter(([sql]) => String(sql).startsWith("SELECT"));
    expect(selects).toHaveLength(3); // 500 + 500 + 235
    for (const [, params] of selects) expect((params as unknown[])[2]).toBe(500);
  });

  it("sends no DELETE when nothing has expired", async () => {
    table.set("login_fail_admin", `5|${NOW + 60_000}`);
    expect(await purgeExpiredLoginFailures(NOW)).toBe(0);
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).startsWith("DELETE"))).toBe(false);
  });

  it("treats an unreadable value as no failures, like the login route does", async () => {
    table.set("login_fail_weird", "garbage");
    expect(await purgeExpiredLoginFailures(NOW)).toBe(1);
  });
});

describe("parseLoginFailState", () => {
  it("reads count|expiresAt and falls back to 0|0", () => {
    expect(parseLoginFailState(`3|${NOW}`)).toEqual({ count: 3, expiresAt: NOW });
    expect(parseLoginFailState(null)).toEqual({ count: 0, expiresAt: 0 });
    expect(parseLoginFailState("x|y")).toEqual({ count: 0, expiresAt: 0 });
  });

  it("the prefix is the one the route's lock keys start with", () => {
    expect(LOGIN_FAIL_PREFIX).toBe("login_fail_");
  });
});
