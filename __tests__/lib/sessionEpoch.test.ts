// @vitest-environment node
/**
 * Session revocation ("ออกจากระบบอุปกรณ์อื่นทั้งหมด"). Sessions are stateless
 * JWTs; each carries the epoch it was issued under and getSession() rejects one
 * older than the current epoch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let currentEpoch = 0;
vi.mock("@/app/lib/settingsStore", () => ({
  getSessionEpoch: vi.fn(async () => currentEpoch),
}));
import { getSessionEpoch } from "@/app/lib/settingsStore";

let cookieValue: string | undefined;
const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue ? { value: cookieValue } : undefined),
    set: setCookie,
    delete: vi.fn(),
  })),
}));

import { encrypt, decrypt, getSession, createSession } from "@/app/lib/session";

const tokenAt = (epoch?: number) =>
  encrypt({ userId: "1", username: "admin", expiresAt: new Date(Date.now() + 86400000), ...(epoch === undefined ? {} : { epoch }) });

beforeEach(() => {
  vi.clearAllMocks();
  currentEpoch = 0;
  cookieValue = undefined;
});

describe("getSession — session epoch", () => {
  it("accepts a token issued under the current epoch", async () => {
    currentEpoch = 2;
    cookieValue = await tokenAt(2);
    expect((await getSession())?.username).toBe("admin");
  });

  it("rejects a token issued before the last 'log out other devices'", async () => {
    currentEpoch = 3;
    cookieValue = await tokenAt(2);
    expect(await getSession()).toBeNull();
  });

  it("keeps sessions issued before epochs existed valid until the first bump", async () => {
    cookieValue = await tokenAt(undefined); // no epoch claim at all
    expect(await getSession()).not.toBeNull();
    currentEpoch = 1;
    expect(await getSession()).toBeNull();
  });

  it("never reads the epoch for a visitor without a session cookie", async () => {
    expect(await getSession()).toBeNull();
    expect(getSessionEpoch).not.toHaveBeenCalled();
  });

  it("never reads the epoch for a forged cookie either", async () => {
    cookieValue = "forged.token.value";
    expect(await getSession()).toBeNull();
    expect(getSessionEpoch).not.toHaveBeenCalled();
  });
});

describe("createSession — stamps the epoch", () => {
  async function issuedEpoch(): Promise<number | undefined> {
    const token = setCookie.mock.calls[0][1] as string;
    return (await decrypt(token))?.epoch;
  }

  it("uses the current epoch by default", async () => {
    currentEpoch = 7;
    await createSession("1", "admin");
    expect(await issuedEpoch()).toBe(7);
  });

  it("uses an explicit epoch without reading the (possibly stale) cached one", async () => {
    currentEpoch = 7;
    await createSession("1", "admin", 8);
    expect(await issuedEpoch()).toBe(8);
    expect(getSessionEpoch).not.toHaveBeenCalled();
  });
});
