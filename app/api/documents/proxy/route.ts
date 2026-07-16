import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Missing URL", { status: 400 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return new NextResponse("Failed to fetch document", { status: response.status });
    }

    const isDownload = request.nextUrl.searchParams.get("download") === "1";
    const headers = new Headers(response.headers);
    
    // Remove headers that might cause issues with proxying uncompressed body
    headers.delete("content-encoding");
    headers.delete("content-length");
    
    // Force the browser to treat it as an inline PDF rather than downloading
    headers.set("Content-Type", "application/pdf");
    if (isDownload) {
      headers.set("Content-Disposition", "attachment; filename=\"document.pdf\"");
    } else {
      headers.set("Content-Disposition", "inline; filename=\"document.pdf\"");
    }

    return new NextResponse(response.body, { headers });
  } catch (error) {
    console.error("Proxy error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
