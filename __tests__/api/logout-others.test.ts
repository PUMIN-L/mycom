// @vitest-environment node
/**
 * POST /api/auth/logout-others — "ออกจากระบบอุปกรณ์อื่นทั้งหมด". Bumps the
 * session epoch (voiding every session and login-device token) and re-issues
 * the caller's own session and device token under the new epoch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { decodeJwt } from "jose";

vi.mock("@/app/lib/session", () => ({ getSession: vi.fn(), createSession: vi.fn() }));
import { getSession, createSession } from "@/app/lib/session";

vi.mock("@/app/lib/settingsStore", () => ({
  bumpSessionEpoch: vi.fn(async () => 4),
  getSessionEpoch: vi.fn(async () => 3), // stale cache value — must NOT be used
  SESSION_EPOCH_TAG: "session_epoch",
}));
import { bumpSessionEpoch } from "@/app/lib/settingsStore";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from "next/cache";

import { POST } from "@/app/api/auth/logout-others/route";

const req = (origin = "http://localhost") =>
  new NextRequest("http://localhost/api/auth/logout-others", {
    method: "POST",
    headers: { origin, host: "localhost" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ userId: "1", username: "admin", expiresAt: new Date() });
});

describe("POST /api/auth/logout-others", () => {
  it("401s without a session and bumps nothing", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(bumpSessionEpoch).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request (CSRF)", async () => {
    const res = await POST(req("https://evil.example"));
    expect(res.status).toBe(403);
    expect(bumpSessionEpoch).not.toHaveBeenCalled();
  });

  it("bumps the epoch once and busts its cache immediately", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(bumpSessionEpoch).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("session_epoch", { expire: 0 });
  });

  it("keeps THIS browser logged in: a new session under the NEW epoch", async () => {
    await POST(req());
    expect(createSession).toHaveBeenCalledWith("1", "admin", 4);
  });

  it("re-issues this browser's device token under the new epoch too", async () => {
    const res = await POST(req());
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^login_device=/);
    expect(setCookie).toMatch(/Path=\/api\/auth\/login/);
    const token = /^login_device=([^;]+)/.exec(setCookie)![1];
    expect(decodeJwt(token)).toMatchObject({ sub: "admin", ep: 4, aud: "login-device" });
  });
});
