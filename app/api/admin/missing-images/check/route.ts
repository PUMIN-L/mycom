import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";
import { checkImageUrls } from "../../../../lib/imageCheck";
import { CHECK_BATCH_SIZE } from "../../../../lib/missingImages";
import { createRateLimiter } from "../../../../lib/rateLimit";

// POST /api/admin/missing-images/check — body { urls: string[] } (at most
// CHECK_BATCH_SIZE). Answers whether each file is still on Cloudinary: one
// HEAD request per file, Cloudinary's host only (lib/imageCheck.ts). An
// address that is not a Cloudinary file is answered "error / unsupported"
// without being fetched.

// A batch of 20 at 6 at a time, 8 s each at the very worst: about half a minute.
export const maxDuration = 60;

// Per admin. A scan sends a batch every second or two; this only stops a
// runaway loop from spending Cloudinary requests without end.
const rateLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000 });

export const POST = withRoute("ตรวจรูปไม่สำเร็จ", async (request: NextRequest) => {
  const session = await requireAuth();
  const limit = rateLimiter.check(session.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "ตรวจถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json();
  const urls = (body as { urls?: unknown } | null)?.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > CHECK_BATCH_SIZE) {
    return NextResponse.json(
      { error: `ต้องส่งรายการลิงก์รูป 1–${CHECK_BATCH_SIZE} รายการ` },
      { status: 400 }
    );
  }
  if (!urls.every((u) => typeof u === "string")) {
    return NextResponse.json({ error: "ลิงก์รูปต้องเป็นข้อความ" }, { status: 400 });
  }

  return NextResponse.json({ results: await checkImageUrls(urls as string[]) });
});
