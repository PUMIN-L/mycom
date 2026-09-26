// @vitest-environment node
/**
 * The Content-Security-Policy next.config.ts ships. 'unsafe-eval' is for
 * `next dev` only — React needs it there, and neither React nor Next.js use
 * eval in production. The shipped browser libraries were run in Chrome under
 * the production policy with results identical to the old one (see
 * ARCHITECTURE.md §6); this file stops the production policy drifting back.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

async function cspFor(nodeEnv: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const config = (await import("../next.config")).default;
  const headers = await config.headers!();
  return headers[0].headers.find((h) => h.key === "Content-Security-Policy")!.value;
}

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts Content-Security-Policy", () => {
  it("production script-src does not allow eval", async () => {
    const script = directive(await cspFor("production"), "script-src");
    expect(script).toBe("script-src 'self' 'unsafe-inline'");
    expect(script).not.toContain("unsafe-eval");
  });

  it("development still allows eval (React's dev tooling needs it)", async () => {
    expect(directive(await cspFor("development"), "script-src")).toContain("'unsafe-eval'");
  });

  it("keeps the rest of the policy intact", async () => {
    const csp = await cspFor("production");
    for (const d of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "worker-src 'self' blob:",
    ]) {
      expect(csp).toContain(d);
    }
  });

  it("applies the policy to every route", async () => {
    vi.resetModules();
    const config = (await import("../next.config")).default;
    const headers = await config.headers!();
    expect(headers[0].source).toBe("/:path*");
  });
});

describe("next.config.ts connect-src", () => {
  it("lets the browser upload large files straight to Cloudinary's API — that host only", async () => {
    const connect = directive(await cspFor("production"), "connect-src");
    expect(connect).toBe("connect-src 'self' https://res.cloudinary.com https://api.cloudinary.com");
    expect(connect).not.toContain("*");
  });
});

describe("next.config.ts img-src", () => {
  // The photo loading skeleton (lib/imageSkeleton.ts) is a data: SVG painted
  // as the <img>'s background — blocked without data: here, and silently: the
  // box would just sit empty again.
  it("allows data: images, which the photo loading skeleton is", async () => {
    const img = directive(await cspFor("production"), "img-src");
    expect(img.split(" ")).toContain("data:");
  });
});
