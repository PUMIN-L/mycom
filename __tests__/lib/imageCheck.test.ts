// @vitest-environment node
/**
 * Is a Cloudinary file still there? (app/lib/imageCheck.ts) One HEAD request,
 * Cloudinary's host only, never following a redirect; 404 is "missing",
 * anything else that is not a 2xx is "could not tell"; at most 6 at a time.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CHECK_CONCURRENCY, checkImageUrl, checkImageUrls, isCheckableImageUrl } from "@/app/lib/imageCheck";

const URL_A = "https://res.cloudinary.com/demo/image/upload/v1/a.jpg";

function answer(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isCheckableImageUrl", () => {
  it("only Cloudinary's delivery host, over https, with no port or credentials", () => {
    expect(isCheckableImageUrl(URL_A)).toBe(true);
    expect(isCheckableImageUrl("https://res.cloudinary.com/demo/raw/upload/v1/a.pdf")).toBe(true);
    for (const bad of [
      "http://res.cloudinary.com/demo/image/upload/a.jpg",
      "https://res.cloudinary.com.evil.com/a.jpg",
      "https://evil.com/res.cloudinary.com/a.jpg",
      "https://api.cloudinary.com/v1_1/demo/resources",
      "https://res.cloudinary.com:8443/demo/a.jpg",
      "https://user:pw@res.cloudinary.com/demo/a.jpg",
      "https://user@res.cloudinary.com/demo/a.jpg",
      "https://:pw@res.cloudinary.com/demo/a.jpg",
      "https://169.254.169.254/latest/meta-data/",
      "javascript:alert(1)",
      "/local.png",
      "",
      `https://res.cloudinary.com/${"x".repeat(2100)}`,
    ]) {
      expect(isCheckableImageUrl(bad), bad).toBe(false);
    }
    expect(isCheckableImageUrl(42)).toBe(false);
    expect(isCheckableImageUrl(null)).toBe(false);
  });
});

describe("checkImageUrl", () => {
  it("asks with HEAD, follows no redirect, caches nothing", async () => {
    const fetchMock = vi.fn(async () => answer(200));
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkImageUrl(URL_A)).toEqual({ url: URL_A, status: "ok", httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledWith(URL_A, expect.objectContaining({ method: "HEAD", redirect: "manual", cache: "no-store" }));
  });

  it("404 is missing, with Cloudinary's own reason; 410 too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(404, { "x-cld-error": "Resource not found - demo/a" })));
    expect(await checkImageUrl(URL_A)).toEqual({ url: URL_A, status: "missing", httpStatus: 404, detail: "Resource not found - demo/a" });
    vi.stubGlobal("fetch", vi.fn(async () => answer(410)));
    expect(await checkImageUrl(URL_A)).toMatchObject({ status: "missing", httpStatus: 410 });
  });

  it("a refusal, a limit or a server error is 'could not tell', never 'missing'", async () => {
    for (const status of [401, 403, 420, 429, 500, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => answer(status, { "x-cld-error": "nope" })));
      expect(await checkImageUrl(URL_A)).toEqual({ url: URL_A, status: "error", httpStatus: status, detail: "nope" });
    }
  });

  it("a redirect is not followed — 'could not tell'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(302, { location: "https://evil.com/" })));
    expect(await checkImageUrl(URL_A)).toEqual({ url: URL_A, status: "error", httpStatus: 302, detail: "redirect" });
  });

  it("a network failure is 'could not tell'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await checkImageUrl(URL_A)).toEqual({ url: URL_A, status: "error", httpStatus: null, detail: "network" });
  });

  it("gives up after the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
      )
    );
    expect(await checkImageUrl(URL_A, 20)).toEqual({ url: URL_A, status: "error", httpStatus: null, detail: "timeout" });
  });

  it("never fetches an address that is not a Cloudinary file", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkImageUrl("http://169.254.169.254/")).toEqual({
      url: "http://169.254.169.254/",
      status: "error",
      httpStatus: null,
      detail: "unsupported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkImageUrls", () => {
  it("answers in the order asked, at most CHECK_CONCURRENCY at a time", async () => {
    let inFlight = 0;
    let most = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return answer(url.endsWith("7.jpg") ? 404 : 200);
      })
    );
    const urls = Array.from({ length: 20 }, (_, i) => `https://res.cloudinary.com/demo/image/upload/v1/${i}.jpg`);
    const results = await checkImageUrls(urls);
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(results.filter((r) => r.status === "missing").map((r) => r.url)).toEqual([urls[7], urls[17]]);
    expect(most).toBe(CHECK_CONCURRENCY);
  });

  it("nothing to check is nothing", async () => {
    expect(await checkImageUrls([])).toEqual([]);
  });
});
