// @vitest-environment node
/**
 * Changing the admin password (/settings, logged in) and setting a new one
 * when it is forgotten (/forgot-password, public). Real bcrypt, real TOTP
 * codes, a database that runs the statements; only the mail is a stand-in,
 * so the test can read the code the admin would read in the inbox.
 *
 * The rules under test:
 *   - the 6-digit code goes to ONE fixed address, nowhere else;
 *   - changing needs the session AND the current password AND the code AND,
 *     with 2FA on, an authenticator/backup code — no subset is enough;
 *   - forgetting needs the code AND, with 2FA on, an authenticator/backup
 *     code — and tells a stranger nothing about which usernames exist;
 *   - a code is good for five guesses, ten minutes and ONE password;
 *   - afterwards every earlier session and trusted device is void.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createFakeTwoFactorDb, type FakeTwoFactorDb } from "../helpers/fakeTwoFactorDb";

let db: FakeTwoFactorDb;
let epoch = 0;

// after() needs a live request scope. Here it queues the work, and askCode
// runs it once the response is in hand — the order it happens in for real.
const { afterQueue } = vi.hoisted(() => ({ afterQueue: [] as Array<() => unknown> }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    afterQueue.push(fn);
  },
}));
async function runAfter() {
  while (afterQueue.length > 0) await afterQueue.shift()!();
}

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
vi.mock("@/app/lib/session", () => ({ createSession: vi.fn(), getSession: vi.fn(), deleteSession: vi.fn() }));
import { createSession, getSession } from "@/app/lib/session";
vi.mock("@/app/lib/mailer", () => ({
  isMailConfigured: vi.fn(() => true),
  sendPasswordOtpEmail: vi.fn(async () => undefined),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
}));
import { isMailConfigured, sendPasswordChangedEmail, sendPasswordOtpEmail } from "@/app/lib/mailer";

import { POST as changeOtpPOST } from "@/app/api/auth/password/otp/route";
import { POST as changePOST } from "@/app/api/auth/password/route";
import { POST as forgotOtpPOST } from "@/app/api/auth/forgot-password/otp/route";
import { POST as forgotPOST } from "@/app/api/auth/forgot-password/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import {
  PASSWORD_OTP_EMAIL,
  PASSWORD_OTP_NO_REQUEST,
  PASSWORD_RESET_SENT_MESSAGE,
  passwordResetIpLimiter,
  PASSWORD_RESET_OTP_REFUSED,
  RESET_OTP_DAILY_LIMIT,
} from "@/app/lib/passwordReset";
import { loginIpLimiter } from "@/app/lib/loginThrottle";
import { OTP_TOO_MANY_ATTEMPTS } from "@/app/lib/otpAttempts";
import { beginTotpSetup, confirmTotpSetup, regenerateBackupCodes } from "@/app/lib/twoFactor";
import { base32Decode, totpCodeAt, totpStep } from "@/app/lib/totp";

const OLD = "old-password-123";
const NEW = "brand-new-password-456";
const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() };

let ipSeq = 0;
const post = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "x-forwarded-for": `198.51.100.${(ipSeq++ % 250) + 1}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/** POST /api/auth/password/otp WITH a request, as Next calls it — so the
 *  same-origin guard runs (the handler itself reads nothing from it). */
const sendChangeOtp = () =>
  (changeOtpPOST as unknown as (req: NextRequest) => Promise<Response>)(post("/api/auth/password/otp"));

/** The code in the last email the admin received. */
const lastOtp = () => String(vi.mocked(sendPasswordOtpEmail).mock.calls.at(-1)![1]);
const passwordIs = (pw: string) => bcrypt.compareSync(pw, db.users.get("admin-001")!.passwordHash);
const codeFor = (secret: string, at: number = Date.now()) => totpCodeAt(base32Decode(secret)!, totpStep(at));

/** Turn 2FA on with a code from a minute ago, so the current one is unused. */
async function enrol(): Promise<string> {
  const secret = (await beginTotpSetup("admin-001"))!;
  const earlier = Date.now() - 60_000;
  await confirmTotpSetup("admin-001", codeFor(secret, earlier), earlier);
  return secret;
}

beforeEach(() => {
  vi.clearAllMocks();
  afterQueue.length = 0;
  vi.mocked(isMailConfigured).mockReturnValue(true);
  epoch = 0;
  passwordResetIpLimiter.reset();
  loginIpLimiter.reset();
  db = createFakeTwoFactorDb([{ id: "admin-001", username: "admin", passwordHash: bcrypt.hashSync(OLD, 4) }]);
  vi.mocked(getSession).mockResolvedValue(admin as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the code goes to ONE fixed address", () => {
  it("is ampumin@gmail.com — and nothing a session or a stranger can change", () => {
    expect(PASSWORD_OTP_EMAIL).toBe("ampumin@gmail.com");
  });

  it("both flows send it there, and say so only to the logged-in admin, masked", async () => {
    const change = await sendChangeOtp();
    expect(change.status).toBe(200);
    expect(await change.json()).toMatchObject({ sentTo: "am****@gmail.com", twoFactorRequired: false });
    const forgot = await forgotOtpPOST(post("/api/auth/forgot-password/otp", { username: "admin" }));
    await runAfter();
    expect(await forgot.json()).toEqual({ success: true, message: PASSWORD_RESET_SENT_MESSAGE });

    const recipients = vi.mocked(sendPasswordOtpEmail).mock.calls.map((c) => c[0]);
    expect(recipients).toEqual(["ampumin@gmail.com", "ampumin@gmail.com"]);
    expect(vi.mocked(sendPasswordOtpEmail).mock.calls.map((c) => c[2])).toEqual(["change", "reset"]);
  });
});

// ── เปลี่ยนรหัสผ่าน (logged in) ──────────────────────────────────────────────

describe("POST /api/auth/password — change, logged in", () => {
  const change = (body: Record<string, unknown>) => changePOST(post("/api/auth/password", body));
  async function sendCode(): Promise<string> {
    expect((await sendChangeOtp()).status).toBe(200);
    return lastOtp();
  }

  it("both steps need a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await sendChangeOtp()).status).toBe(401);
    expect((await change({ currentPassword: OLD, newPassword: NEW, otp: "123456" })).status).toBe(401);
    expect(sendPasswordOtpEmail).not.toHaveBeenCalled();
  });

  it("with the current password and the code: changes it, voids every other session, keeps this one", async () => {
    const otp = await sendCode();
    const res = await change({ currentPassword: OLD, newPassword: NEW, otp });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(passwordIs(NEW)).toBe(true);
    expect(passwordIs(OLD)).toBe(false);
    // Every session and device token issued before is void…
    expect(bumpSessionEpoch).toHaveBeenCalledTimes(1);
    // …and this browser gets new ones under the new epoch.
    expect(createSession).toHaveBeenCalledWith("admin-001", "admin", 1);
    expect((res as NextResponse).cookies.get("login_device")?.value).toBeTruthy();
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith("ampumin@gmail.com", "admin", "change");
  });

  it("the code is spent: the same code cannot set a second password", async () => {
    const otp = await sendCode();
    expect((await change({ currentPassword: OLD, newPassword: NEW, otp })).status).toBe(200);
    const again = await change({ currentPassword: NEW, newPassword: "a-third-password-789", otp });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe(PASSWORD_OTP_NO_REQUEST);
    expect(passwordIs(NEW)).toBe(true);
  });

  it("a wrong current password is refused — and does not spend the code", async () => {
    const otp = await sendCode();
    const wrong = await change({ currentPassword: "not-it-at-all", newPassword: NEW, otp });
    expect(wrong.status).toBe(403);
    expect(passwordIs(OLD)).toBe(true);
    expect((await change({ currentPassword: OLD, newPassword: NEW, otp })).status).toBe(200);
  });

  it("without asking for a code first, there is nothing to enter", async () => {
    const res = await change({ currentPassword: OLD, newPassword: NEW, otp: "123456" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PASSWORD_OTP_NO_REQUEST);
  });

  it("a code is good for ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const otp = await sendCode();
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    const res = await change({ currentPassword: OLD, newPassword: NEW, otp });
    expect((await res.json()).error).toBe(PASSWORD_OTP_NO_REQUEST);
    expect(passwordIs(OLD)).toBe(true);
  });

  it("five wrong codes wipe it — the right one is then refused too", async () => {
    const otp = await sendCode();
    const wrongCode = otp === "111111" ? "222222" : "111111";
    for (let i = 0; i < 4; i++) {
      expect((await change({ currentPassword: OLD, newPassword: NEW, otp: wrongCode })).status).toBe(400);
    }
    const fifth = await change({ currentPassword: OLD, newPassword: NEW, otp: wrongCode });
    expect((await fifth.json()).error).toBe(OTP_TOO_MANY_ATTEMPTS);
    const right = await change({ currentPassword: OLD, newPassword: NEW, otp });
    expect((await right.json()).error).toBe(PASSWORD_OTP_NO_REQUEST);
    expect(passwordIs(OLD)).toBe(true);
  });

  it("a code asked for on the forgot-password page does not work here", async () => {
    await forgotOtpPOST(post("/api/auth/forgot-password/otp", { username: "admin" }));
    await runAfter();
    const res = await change({ currentPassword: OLD, newPassword: NEW, otp: lastOtp() });
    expect((await res.json()).error).toBe(PASSWORD_OTP_NO_REQUEST);
  });

  it.each([
    ["too short", "short-pw", "อย่างน้อย 12"],
    ["over bcrypt's 72 bytes (25 Thai characters are 75)", "ก".repeat(25), "ยาวเกินไป"],
    ["the same as the current one", OLD, "ไม่ซ้ำกับรหัสผ่านเดิม"],
    ["padded with spaces", " brand-new-password ", "ช่องว่าง"],
  ])("refuses a new password that is %s, changing nothing", async (_label, newPassword, message) => {
    const otp = await sendCode();
    const res = await change({ currentPassword: OLD, newPassword, otp });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(passwordIs(OLD)).toBe(true);
  });

  it("asking for codes is throttled — one a minute", async () => {
    await sendCode();
    expect((await sendChangeOtp()).status).toBe(429);
    expect(sendPasswordOtpEmail).toHaveBeenCalledTimes(1);
  });

  it("without mail configured there is no code to send (503)", async () => {
    vi.mocked(isMailConfigured).mockReturnValue(false);
    expect((await sendChangeOtp()).status).toBe(503);
  });

  describe("with 2FA on, an authenticator code too", () => {
    it("says so when the code is sent, and refuses without one — the emailed code stays valid", async () => {
      const secret = await enrol();
      const sent = await sendChangeOtp();
      expect((await sent.json()).twoFactorRequired).toBe(true);
      const otp = lastOtp();

      expect((await change({ currentPassword: OLD, newPassword: NEW, otp })).status).toBe(400);
      expect((await change({ currentPassword: OLD, newPassword: NEW, otp, code: "000000" })).status).toBe(403);
      expect(passwordIs(OLD)).toBe(true);

      const ok = await change({ currentPassword: OLD, newPassword: NEW, otp, code: codeFor(secret) });
      expect(ok.status).toBe(200);
      expect(passwordIs(NEW)).toBe(true);
    });

    it("a backup code will do", async () => {
      await enrol();
      const [backup] = await regenerateBackupCodes("admin-001");
      const otp = await sendCode();
      expect((await change({ currentPassword: OLD, newPassword: NEW, otp, code: backup })).status).toBe(200);
    });
  });
});

// ── ลืมรหัสผ่าน (public) ────────────────────────────────────────────────────

describe("POST /api/auth/forgot-password — reset, public", () => {
  const askCode = async (username: string) => {
    const res = await forgotOtpPOST(post("/api/auth/forgot-password/otp", { username }));
    await runAfter();
    return res;
  };
  const reset = (body: Record<string, unknown>) => forgotPOST(post("/api/auth/forgot-password", body));

  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(null); // nobody is logged in here
  });

  it("with the emailed code: sets the new password, voids every session, issues none", async () => {
    await askCode("admin");
    const res = await reset({ username: "admin", otp: lastOtp(), newPassword: NEW });
    expect(res.status).toBe(200);
    expect(passwordIs(NEW)).toBe(true);
    expect(bumpSessionEpoch).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith("ampumin@gmail.com", "admin", "reset");
  });

  it("then the login page takes the new password and not the old", async () => {
    await askCode("admin");
    await reset({ username: "admin", otp: lastOtp(), newPassword: NEW });
    const loginAs = (password: string) =>
      loginPOST(post("/api/auth/login", { username: "admin", password }));
    expect((await loginAs(OLD)).status).toBe(401);
    expect((await loginAs(NEW)).status).toBe(200);
  });

  it("clears the username's login lockout, so a locked-out admin can log in at once", async () => {
    db.settings.set("login_fail_u_admin", `5|${Date.now() + 10 * 60_000}`);
    await askCode("admin");
    await reset({ username: "admin", otp: lastOtp(), newPassword: NEW });
    expect(db.settings.get("login_fail_u_admin")).toBe("0|0");
  });

  describe("tells a stranger nothing about which usernames exist", () => {
    it("asking for a code answers the same for a real and a made-up username — and mails only for the real one", async () => {
      const real = await askCode("admin");
      const fake = await askCode("nobody-here");
      expect(real.status).toBe(fake.status);
      expect(await real.json()).toEqual(await fake.json());
      expect(sendPasswordOtpEmail).toHaveBeenCalledTimes(1);
    });

    it("asking again too soon answers the same too — the throttle is not a tell", async () => {
      const first = await askCode("admin");
      const second = await askCode("admin");
      expect(await second.json()).toEqual(await first.json());
      expect(second.status).toBe(200);
      expect(sendPasswordOtpEmail).toHaveBeenCalledTimes(1);
    });

    // The SMTP round trip used to happen before the answer, so a real
    // username was answered a second or two later than a made-up one.
    it("answers before any code is issued or mailed — the same work for a real username as a made-up one", async () => {
      const res = await forgotOtpPOST(post("/api/auth/forgot-password/otp", { username: "admin" }));
      expect(res.status).toBe(200);
      expect(sendPasswordOtpEmail).not.toHaveBeenCalled();
      expect(db.settings.has("password_reset_otp_state")).toBe(false);
      await runAfter();
      expect(sendPasswordOtpEmail).toHaveBeenCalledTimes(1);
      expect(db.settings.get("password_reset_otp_state")).toContain("admin-001");
    });

    it("a failed send answers the same too", async () => {
      vi.mocked(sendPasswordOtpEmail).mockRejectedValueOnce(new Error("smtp down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await askCode("admin");
      expect(await res.json()).toEqual({ success: true, message: PASSWORD_RESET_SENT_MESSAGE });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("resetting a made-up username answers exactly like a real one with no code asked for", async () => {
      const fake = await reset({ username: "nobody-here", otp: "123456", newPassword: NEW });
      const real = await reset({ username: "admin", otp: "123456", newPassword: NEW });
      expect(fake.status).toBe(400);
      expect(await fake.json()).toEqual(await real.json());
    });

    // The oracle this closes: ask for a code for a name, send a wrong one —
    // "wrong code" (rather than "no code asked for") meant the name was real.
    it("with a code asked for, a WRONG code for a real username answers exactly like a made-up username", async () => {
      await askCode("admin");
      const otp = lastOtp();
      const wrongCode = otp === "111111" ? "222222" : "111111";
      const real = await reset({ username: "admin", otp: wrongCode, newPassword: NEW });
      const fake = await reset({ username: "nobody-here", otp: wrongCode, newPassword: NEW });
      expect(real.status).toBe(fake.status);
      expect(await real.json()).toEqual(await fake.json());
    });

    it("…and so do five wrong codes, and a spent daily budget — states only a real account can reach", async () => {
      const fake = await (await reset({ username: "nobody-here", otp: "123456", newPassword: NEW })).json();
      await askCode("admin");
      const otp = lastOtp();
      const wrongCode = otp === "111111" ? "222222" : "111111";
      const answers = [];
      for (let i = 0; i < 6; i++) answers.push(await (await reset({ username: "admin", otp: wrongCode, newPassword: NEW })).json());
      db.settings.set("login_fail_reset_otp_admin-001", `10|${Date.now() + 60 * 60_000}`);
      answers.push(await (await reset({ username: "admin", otp, newPassword: NEW })).json());
      for (const answer of answers) expect(answer).toEqual(fake);
    });

    it("password rules are judged before the lookup — a weak password says the same for anyone", async () => {
      const fake = await reset({ username: "nobody-here", otp: "123456", newPassword: "short" });
      const real = await reset({ username: "admin", otp: "123456", newPassword: "short" });
      expect(await fake.json()).toEqual(await real.json());
    });
  });

  // Five guesses a code is not enough there alone: every new code resets it,
  // and anyone may ask for five codes an hour.
  describe("a daily budget of wrong codes, across every code asked for", () => {
    /** Ask for a fresh code (past the one-a-minute throttle) and guess it wrong `n` times. */
    async function wrongGuesses(n: number) {
      vi.setSystemTime(Date.now() + 61_000);
      await askCode("admin");
      const otp = lastOtp();
      const wrongCode = otp === "111111" ? "222222" : "111111";
      for (let i = 0; i < n; i++) await reset({ username: "admin", otp: wrongCode, newPassword: NEW });
    }

    it(`after ${RESET_OTP_DAILY_LIMIT} wrong codes in a day, even the right one on a NEW code is refused`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await wrongGuesses(4);
      await wrongGuesses(4);
      await wrongGuesses(2); // 10 wrong across three codes — none of them used up on its own
      vi.setSystemTime(Date.now() + 61_000);
      await askCode("admin");
      const res = await reset({ username: "admin", otp: lastOtp(), newPassword: NEW });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(PASSWORD_RESET_OTP_REFUSED); // the one message, on purpose
      expect(db.settings.get("login_fail_reset_otp_admin-001")?.startsWith(`${RESET_OTP_DAILY_LIMIT}|`)).toBe(true);
      expect(passwordIs(OLD)).toBe(true);

      // A day later it opens again.
      vi.setSystemTime(Date.now() + 24 * 60 * 60_000 + 1);
      await askCode("admin");
      expect((await reset({ username: "admin", otp: lastOtp(), newPassword: NEW })).status).toBe(200);
    });

    it("a right code costs nothing from the budget", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await wrongGuesses(3);
      vi.setSystemTime(Date.now() + 61_000);
      await askCode("admin");
      expect((await reset({ username: "admin", otp: lastOtp(), newPassword: NEW })).status).toBe(200);
      expect(db.settings.get("login_fail_reset_otp_admin-001")?.startsWith("3|")).toBe(true);
    });

    it("the logged-in change in /settings has no such budget to run out", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await wrongGuesses(4);
      await wrongGuesses(4);
      await wrongGuesses(2);
      vi.mocked(getSession).mockResolvedValue(admin as never);
      vi.setSystemTime(Date.now() + 61_000);
      await sendChangeOtp();
      const res = await changePOST(
        post("/api/auth/password", { currentPassword: OLD, newPassword: NEW, otp: lastOtp() })
      );
      expect(res.status).toBe(200);
    });
  });

  it("five wrong codes wipe it", async () => {
    await askCode("admin");
    const otp = lastOtp();
    const wrongCode = otp === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await reset({ username: "admin", otp: wrongCode, newPassword: NEW });
    const right = await reset({ username: "admin", otp, newPassword: NEW });
    expect(right.status).toBe(400);
    expect(passwordIs(OLD)).toBe(true);
  });

  it("two requests with the same right code set ONE password", async () => {
    await askCode("admin");
    const otp = lastOtp();
    const [a, b] = await Promise.all([
      reset({ username: "admin", otp, newPassword: "first-new-password-1" }),
      reset({ username: "admin", otp, newPassword: "second-new-password-2" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(passwordIs("first-new-password-1") !== passwordIs("second-new-password-2")).toBe(true);
  });

  describe("with 2FA on, the inbox alone is not enough", () => {
    it("asks for an authenticator code — but only of someone who has the emailed code", async () => {
      await enrol();
      await askCode("admin");
      const otp = lastOtp();
      const wrongOtp = otp === "111111" ? "222222" : "111111";

      const noOtp = await reset({ username: "admin", otp: wrongOtp, newPassword: NEW });
      expect((await noOtp.json()).twoFactorRequired).toBeUndefined();

      const noCode = await reset({ username: "admin", otp, newPassword: NEW });
      expect(noCode.status).toBe(400);
      expect((await noCode.json()).twoFactorRequired).toBe(true);
      expect(passwordIs(OLD)).toBe(true);
    });

    it("a wrong code is refused in the page's OWN bucket — never the login code step's", async () => {
      await enrol();
      await askCode("admin");
      const res = await reset({ username: "admin", otp: lastOtp(), newPassword: NEW, code: "000000" });
      expect(res.status).toBe(403);
      expect(db.settings.get("login_fail_reset_2fa_admin-001")?.startsWith("1|")).toBe(true);
      expect(db.settings.has("login_fail_2fa_admin-001")).toBe(false);
      expect(passwordIs(OLD)).toBe(true);
    });

    it("with the authenticator code it goes through, and the emailed code survived the wrong attempt", async () => {
      const secret = await enrol();
      await askCode("admin");
      const otp = lastOtp();
      await reset({ username: "admin", otp, newPassword: NEW, code: "000000" });
      const ok = await reset({ username: "admin", otp, newPassword: NEW, code: codeFor(secret) });
      expect(ok.status).toBe(200);
      expect(passwordIs(NEW)).toBe(true);
    });

    it("a backup code will do", async () => {
      await enrol();
      const [backup] = await regenerateBackupCodes("admin-001");
      await askCode("admin");
      expect((await reset({ username: "admin", otp: lastOtp(), newPassword: NEW, code: backup })).status).toBe(200);
    });
  });

  it("the public endpoints are braked per address", async () => {
    const fixed = () =>
      new NextRequest("http://localhost/api/auth/forgot-password/otp", {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ username: "nobody-here" }),
      });
    for (let i = 0; i < 10; i++) expect((await forgotOtpPOST(fixed())).status).toBe(200);
    expect((await forgotOtpPOST(fixed())).status).toBe(429);
  });
});
