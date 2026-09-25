// @vitest-environment node
/**
 * The device token and the session token must never be interchangeable:
 * getSession() and middleware only check a JWT's SIGNATURE, so a device token
 * that verified under the session key would be accepted as a login. The
 * device key is derived from SESSION_SECRET, not equal to it.
 */
import { describe, it, expect, vi } from "vitest";

// Tokens carry the session epoch; pinned so this never reaches the real store.
vi.mock("@/app/lib/settingsStore", () => ({ getSessionEpoch: vi.fn(async () => 0) }));
import { issueLoginDeviceToken, loginDeviceIdFor } from "@/app/lib/loginDevice";
import { encrypt, decrypt } from "@/app/lib/session";

describe("loginDevice tokens", () => {
  it("round-trips for the same user, case-insensitively, with a device id", async () => {
    const token = await issueLoginDeviceToken("Admin");
    const id = await loginDeviceIdFor(token, "admin");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives every issued token its own device id", async () => {
    const a = await loginDeviceIdFor(await issueLoginDeviceToken("admin"), "admin");
    const b = await loginDeviceIdFor(await issueLoginDeviceToken("admin"), "admin");
    expect(a).not.toBe(b);
  });

  it("is null for another user, a missing token, or garbage", async () => {
    const token = await issueLoginDeviceToken("admin");
    expect(await loginDeviceIdFor(token, "someone-else")).toBeNull();
    expect(await loginDeviceIdFor(undefined, "admin")).toBeNull();
    expect(await loginDeviceIdFor("a.b.c", "admin")).toBeNull();
  });

  it("a device token is NOT accepted as a session", async () => {
    const device = await issueLoginDeviceToken("admin");
    expect(await decrypt(device)).toBeNull();
  });

  it("a session token is NOT accepted as a device token", async () => {
    const session = await encrypt({ userId: "1", username: "admin", expiresAt: new Date(Date.now() + 86400000) });
    expect(await loginDeviceIdFor(session, "admin")).toBeNull();
  });
});
