import { NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import { listImageReferences } from "../../../lib/imageReferences";
import { indexImageReferences } from "../../../lib/missingImages";
import { createRateLimiter } from "../../../lib/rateLimit";

// GET /api/admin/missing-images — every Cloudinary file the site shows and the
// pages it is on (lib/imageReferences.ts), each file once. The browser then
// checks the files a batch at a time (./check) and groups what is missing by
// page (lib/missingImages.ts). Reads the database only; changes nothing.

// It reads every quotation and billing document (a page of rows at a time),
// which on years of documents can outlast a function's default time limit.
export const maxDuration = 60;

// Per admin. A scan asks for the list once; this keeps a stolen session or a
// runaway script from making the database read every document over and over.
const rateLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

export const GET = withRoute("โหลดรายการรูปไม่สำเร็จ", async () => {
  const session = await requireAuth();
  const limit = rateLimiter.check(session.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "โหลดรายการรูปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  return NextResponse.json(indexImageReferences(await listImageReferences()));
});
