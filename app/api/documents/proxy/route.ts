import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter, clientKey } from "../../../lib/rateLimit";

export const dynamic = "force-dynamic";

// Rate limit. This is a COST control, not a security fix: the route is public
// by design (the customer-facing catalog viewer at /document/[id] needs it) and
// it streams whole PDFs from Cloudinary through our own domain, so an
// unthrottled loop over it burns Vercel bandwidth — and only bandwidth. Nothing
// here is confidential; the allowlist and cloud-name pinning BELOW (which still
// run before every fetch) are what stop the SSRF and cross-account concerns.
//
// Sizing. A real reader must never see a 429, so the ceiling is worked from the
// worst LEGITIMATE case rather than the average one:
//   * One PDF open costs ONE request. The viewer is pdf.js via react-pdf
//     (app/document/[id]/PdfViewerClient.tsx) pointed straight at this route,
//     and because the response below is built from a FRESH header set it
//     carries no Accept-Ranges — so pdf.js streams the file in a single GET
//     instead of switching to chunked range requests. Clicking ดาวน์โหลด costs
//     a second one. A reader opening ten datasheets and downloading three is
//     therefore ~13 requests, not hundreds. (If anyone ever forwards upstream
//     headers here, that "1" becomes "one per chunk" and this number is void.)
//   * The key is an IP, and an IP is not a person. This catalog's audience —
//     Thai universities, hospitals and factories — leaves through one corporate
//     address, and Thai mobile networks sit behind carrier-grade NAT, so a
//     single key can be hundreds of unrelated readers. THAT is what sets the
//     ceiling, not the individual reader.
// 60/5min was the first number tried here and it was wrong: one CGNAT or campus
// address reaches it on ordinary daytime traffic, which would 429 the public
// catalog for real customers. 300 per 5 minutes (1/s sustained) leaves room for
// a busy shared address while still parking a scripted flood — which burns 300
// in a couple of seconds — for the rest of the window.
//
// See app/lib/rateLimit.ts for what this does and does not guarantee on
// serverless (per-instance, not global).
const rateLimiter = createRateLimiter({
  limit: 300,
  windowMs: 5 * 60 * 1000,
});

// Only these hosts may be proxied. Documents are stored on Cloudinary, so that
// is the only host this endpoint should ever fetch. Keeping the allowlist tight
// is what prevents the route from being abused as an open SSRF proxy into
// internal networks / cloud-metadata services (e.g. 169.254.169.254).
const ALLOWED_HOSTS = new Set(["res.cloudinary.com"]);

function parseAllowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  // Cloudinary is multi-tenant: every account shares the res.cloudinary.com
  // hostname, distinguished only by the /<cloud_name>/ path segment. Without
  // pinning that segment, this unauthenticated endpoint can be used to proxy
  // (and force-download, under our own domain) any file from ANY Cloudinary
  // account — not just ours.
  const cloud = process.env.CLOUDINARY_CLOUD_NAME ?? "";
  if (!cloud || !url.pathname.startsWith(`/${cloud}/`)) return null;
  return url;
}

export async function GET(request: NextRequest) {
  // Checked before anything else so a flood is rejected without an upstream
  // fetch — the fetch is the part that costs money.
  const limit = rateLimiter.check(clientKey(request));
  if (!limit.allowed) {
    // Plain text with a Retry-After, matching this route's existing plain-text
    // error style (the viewer treats any non-200 the same way).
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return new NextResponse("Missing URL", { status: 400 });
  }

  const url = parseAllowedUrl(rawUrl);
  if (!url) {
    return new NextResponse("URL not allowed", { status: 400 });
  }

  try {
    // redirect: "manual" so a 3xx from the upstream cannot bounce the request
    // to a host outside the allowlist (open-redirect -> SSRF bypass).
    const response = await fetch(url, { redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      return new NextResponse("Refusing to follow redirect", { status: 502 });
    }
    if (!response.ok) {
      return new NextResponse("Failed to fetch document", { status: response.status });
    }

    // Build a fresh header set rather than forwarding upstream headers, and
    // force inline/attachment PDF delivery.
    const isDownload = request.nextUrl.searchParams.get("download") === "1";
    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    // The type is already pinned above, so this is belt-and-braces: it stops a
    // browser that would otherwise sniff the bytes and render them as something
    // else (e.g. HTML) under our own origin.
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set(
      "Content-Disposition",
      isDownload
        ? 'attachment; filename="document.pdf"'
        : 'inline; filename="document.pdf"'
    );
    // robots.txt lets crawlers read the catalogs through here — their text is
    // mostly product names and specs — but only the inline copy should be
    // indexed: the download variant is the same file under a second URL.
    if (isDownload) headers.set("X-Robots-Tag", "noindex");

    return new NextResponse(response.body, { headers });
  } catch (error) {
    console.error("Proxy error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
