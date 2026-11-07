import "server-only";
import type { ImageCheckResult } from "./missingImages";

// Is a Cloudinary file still there? One HEAD request each — the answer without
// the bytes, so a scan of every picture costs Cloudinary next to no bandwidth.
// Cloudinary answers 404 with an `x-cld-error: Resource not found - …` header
// for a file that is gone (pictures and raw PDFs alike).
//
// The URLs come from the browser (POST /api/admin/missing-images/check), so
// only Cloudinary's public delivery host is ever fetched, over https, and a
// redirect is never followed: this route must not become a way to make the
// server request an address of the caller's choosing.

/** Per file. Cloudinary normally answers in well under a second. */
export const CHECK_TIMEOUT_MS = 8_000;
/** Files checked at once, per request. */
export const CHECK_CONCURRENCY = 6;

export function isCheckableImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === "res.cloudinary.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

export async function checkImageUrl(url: string, timeoutMs: number = CHECK_TIMEOUT_MS): Promise<ImageCheckResult> {
  if (!isCheckableImageUrl(url)) return { url, status: "error", httpStatus: null, detail: "unsupported" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", cache: "no-store", signal: controller.signal });
    if (res.status >= 200 && res.status < 300) return { url, status: "ok", httpStatus: res.status };
    const cldError = res.headers.get("x-cld-error") ?? undefined;
    if (res.status === 404 || res.status === 410) return { url, status: "missing", httpStatus: res.status, detail: cldError };
    if (res.status >= 300 && res.status < 400) return { url, status: "error", httpStatus: res.status, detail: "redirect" };
    return { url, status: "error", httpStatus: res.status, detail: cldError };
  } catch {
    return { url, status: "error", httpStatus: null, detail: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Each URL's answer, in the order given, at most CHECK_CONCURRENCY at a time. */
export async function checkImageUrls(urls: readonly string[]): Promise<ImageCheckResult[]> {
  const results: ImageCheckResult[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      results[i] = await checkImageUrl(urls[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, urls.length) }, worker));
  return results;
}
