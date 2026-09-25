// @vitest-environment node
/**
 * The login route only takes strings. mysql2's `query()` inlines a non-string
 * parameter into the SQL as-is, so `"username": [0]` — truthy, so it passed
 * the old `!username` check — became `WHERE username = 0`, which MySQL/TiDB
 * evaluate by casting every non-numeric username to 0: it matched EVERY user.
 * Its failures were filed under the lock key String([0]) = "0", not the
 * username's, so each such shape was a separate 5-guess allowance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

const conn = { query: vi.fn().mockResolvedValue([[{ value: "0|0" }]]) };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  getDbConnection: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query } from "@/app/lib/db";

vi.mock("@/app/lib/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));
import { createSession } from "@/app/lib/session";

import { POST as login } from "@/app/api/auth/login/route";

const rawReq = (raw: string) => new NextRequest("http://localhost", { method: "POST", body: raw });

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockResolvedValue([[{ value: "0|0" }]]);
});

describe("login — rejects anything but non-empty strings, before touching the database", () => {
  it.each([
    ["username [0] — matched every user via `username = 0`", { username: [0], password: "guess" }],
    ["username [false]", { username: [false], password: "guess" }],
    ["username as an object", { username: { username: 1 }, password: "guess" }],
    ["username as a number", { username: 7, password: "guess" }],
    ["username true", { username: true, password: "guess" }],
    ["password as an array", { username: "admin", password: ["guess"] }],
    ["password as an object", { username: "admin", password: { a: 1 } }],
    ["password as a number", { username: "admin", password: 1234 }],
    ["empty username", { username: "", password: "guess" }],
    ["missing password", { username: "admin" }],
  ])("%s → 400", async (_label, body) => {
    const res = await login(rawReq(JSON.stringify(body)));
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["null", "null"],
    ["an array", "[]"],
    ["a bare string", '"admin"'],
  ])("a JSON body that is %s is a 400, not a 500", async (_label, raw) => {
    const res = await login(rawReq(raw));
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("a normal string login still reaches the credential check", async () => {
    const passwordHash = bcrypt.hashSync("correct-horse", 4);
    vi.mocked(query).mockResolvedValue([[{ id: "1", username: "admin", passwordHash }]] as never);

    const res = await login(rawReq(JSON.stringify({ username: "admin", password: "correct-horse" })));

    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith("1", "admin");
  });
});

// The database decides "equal" by its collation, which is looser than the lock
// key. TiDB's default, utf8mb4_bin, is PAD SPACE: "admin", "admin ",
// "admin  "… all find the admin row, yet each was counted under its own lock
// key — five more guesses per trailing space. The mock stands in for that
// collation by returning the admin row whatever was typed.
describe("login — an input the database only stretched to match cannot log in", () => {
  const passwordHash = bcrypt.hashSync("correct-horse", 4);
  const attempt = (username: string) =>
    login(rawReq(JSON.stringify({ username, password: "correct-horse" })));

  beforeEach(() => {
    vi.mocked(query).mockResolvedValue([[{ id: "1", username: "admin", passwordHash }]] as never);
  });

  it.each([
    ["a trailing space (PAD SPACE)", "admin "],
    ["many trailing spaces", "admin" + " ".repeat(40)],
    ["an accent (an _ai_ collation)", "ádmin"],
  ])("%s → 401, even with the right password", async (_label, username) => {
    const res = await attempt(username);
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a case variant still logs in — the lock key is lowercased, so it shares the bucket", async () => {
    const res = await attempt("ADMIN");
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith("1", "admin");
  });
});
