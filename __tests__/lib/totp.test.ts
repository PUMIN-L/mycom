// @vitest-environment node
/**
 * TOTP against the published test vectors. If these pass, the codes this app
 * computes are the ones Google Authenticator & co. show for the same secret.
 */
import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  matchTotpStep,
  otpauthUri,
  totpCodeAt,
  totpStep,
} from "@/app/lib/totp";

// The RFC 4226 / RFC 6238 (SHA-1) test key: ASCII "12345678901234567890".
const RFC_KEY = new TextEncoder().encode("12345678901234567890");
const RFC_KEY_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("encodes the RFC key the way authenticator apps expect", () => {
    expect(base32Encode(RFC_KEY)).toBe(RFC_KEY_BASE32);
  });

  it("round-trips arbitrary bytes", () => {
    for (const length of [1, 5, 10, 16, 20, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });

  it("ignores spaces, dashes, case and padding — what a person copies by hand", () => {
    expect(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq==")).toEqual(RFC_KEY);
  });

  it("refuses a character base32 does not have", () => {
    expect(base32Decode("GEZD1NBV")).toBeNull(); // 1 is not base32
    expect(base32Decode("GEZD0NBV")).toBeNull(); // nor is 0
  });
});

describe("HOTP — RFC 4226 appendix D", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it.each(expected.map((code, counter) => [counter, code]))("counter %i → %s", (counter, code) => {
    expect(totpCodeAt(RFC_KEY, counter as number)).toBe(code);
  });
});

describe("TOTP — RFC 6238 appendix B (SHA-1)", () => {
  // The RFC lists 8-digit codes; a 6-digit code is the same number mod 10^6.
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("T = %i s → %s", (seconds, eightDigits) => {
    const step = totpStep(seconds * 1000);
    expect(totpCodeAt(RFC_KEY, step, 8)).toBe(eightDigits);
    expect(totpCodeAt(RFC_KEY, step)).toBe(eightDigits.slice(-6));
  });
});

describe("matchTotpStep", () => {
  const NOW = 1_234_567_890_000;
  const step = totpStep(NOW);
  const codeAt = (s: number) => totpCodeAt(RFC_KEY, s);

  it("accepts the current code and returns its step", () => {
    expect(matchTotpStep(RFC_KEY_BASE32, codeAt(step), NOW)).toBe(step);
  });

  it("accepts one step either side — phone clocks drift and typing takes time", () => {
    expect(matchTotpStep(RFC_KEY_BASE32, codeAt(step - 1), NOW)).toBe(step - 1);
    expect(matchTotpStep(RFC_KEY_BASE32, codeAt(step + 1), NOW)).toBe(step + 1);
  });

  it("refuses codes two steps away", () => {
    expect(matchTotpStep(RFC_KEY_BASE32, codeAt(step - 2), NOW)).toBeNull();
    expect(matchTotpStep(RFC_KEY_BASE32, codeAt(step + 2), NOW)).toBeNull();
  });

  it("refuses anything that is not six digits", () => {
    for (const bad of ["", "12345", "1234567", "12a456", "      ", "١٢٣٤٥٦"]) {
      expect(matchTotpStep(RFC_KEY_BASE32, bad, NOW)).toBeNull();
    }
  });

  it("tolerates spaces inside the code, as some apps display it ('123 456')", () => {
    const code = codeAt(step);
    expect(matchTotpStep(RFC_KEY_BASE32, `${code.slice(0, 3)} ${code.slice(3)}`, NOW)).toBe(step);
  });

  it("refuses everything when the secret itself is unreadable", () => {
    expect(matchTotpStep("not!base32", codeAt(step), NOW)).toBeNull();
    expect(matchTotpStep("", codeAt(step), NOW)).toBeNull();
  });
});

describe("generateTotpSecret", () => {
  it("is 160 random bits in base32, different every time", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });
});

describe("otpauthUri", () => {
  it("is what the QR code carries: issuer, account and the fixed parameters", () => {
    const uri = new URL(otpauthUri(RFC_KEY_BASE32, "admin", "PROFIN"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/PROFIN:admin");
    expect(uri.searchParams.get("secret")).toBe(RFC_KEY_BASE32);
    expect(uri.searchParams.get("issuer")).toBe("PROFIN");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
  });
});
