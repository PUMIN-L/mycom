import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
  return url;
}

export async function GET(request: NextRequest) {
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
    headers.set(
      "Content-Disposition",
      isDownload
        ? 'attachment; filename="document.pdf"'
        : 'inline; filename="document.pdf"'
    );

    return new NextResponse(response.body, { headers });
  } catch (error) {
    console.error("Proxy error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
