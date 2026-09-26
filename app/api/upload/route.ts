import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "../../lib/cloudinaryHelper";
import { requireAuth, withRoute } from "../../lib/apiHelpers";
import { createRateLimiter } from "../../lib/rateLimit";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  UPLOAD_FOLDER,
  isPdfFile,
} from "../../lib/uploadLimits";

// Keyed on the user id, not an IP: this route requires a session, so the thing
// worth throttling is the account. Per-instance like every in-memory limiter
// here — see app/lib/rateLimit.ts for what that does and does not guarantee.
const rateLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 1000,
});

// POST — upload an image or document to Cloudinary (login required)
export const POST = withRoute(
  "อัปโหลดไป Cloudinary ไม่สำเร็จ",
  async (request: NextRequest) => {
    const session = await requireAuth();
    
    // Rate Limiting: Prevent a compromised admin session from spamming uploads
    // and exhausting Cloudinary quotas or bandwidth.
    const limit = rateLimiter.check(session.userId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "อัปโหลดบ่อยเกินไป กรุณารอสักครู่ (Rate limit exceeded)" },
        { status: 429 }
      );
    }

    // Prevent DoS: Reject oversized payloads before parsing the body.
    const contentLengthStr = request.headers.get("content-length");
    if (contentLengthStr) {
      const contentLength = parseInt(contentLengthStr, 10);
      const MAX_PAYLOAD_BYTES = 30 * 1024 * 1024; // 30 MB absolute limit for the whole request
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return NextResponse.json(
          { error: `ข้อมูลที่ส่งมาใหญ่เกินไป (สูงสุด ${Math.round(MAX_PAYLOAD_BYTES / (1024 * 1024))}MB)` },
          { status: 413 }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const isDocument = formData.get("isDocument") === "true"; // flag to upload as both
    
    if (!file) {
      return NextResponse.json({ error: "ไม่พบไฟล์ที่อัปโหลด" }, { status: 400 });
    }

    // Reject oversized uploads BEFORE buffering the whole file into memory,
    // so a large body can't exhaust the server heap.
    // (Files over ~4 MB never get here on Vercel — its 4.5 MB body limit —
    // they go straight to Cloudinary through /api/upload/sign; see
    // lib/uploadLimits.ts. These limits are the same numbers, shared.)
    const maxBytes = isDocument ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${Math.round(maxBytes / (1024 * 1024))}MB)` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    if (isDocument) {
      if (!isPdfFile(file)) {
        return NextResponse.json({ error: "เอกสารต้องเป็นไฟล์ PDF เท่านั้น" }, { status: 400 });
      }
      // For PDFs: Upload twice. 
      // 1. As 'image' to generate cover image
      // 2. As 'raw' to allow downloading without 401 restrictions
      const rawPublicId = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
      const [imageUrl, rawUrl] = await Promise.all([
        uploadImage(buffer, UPLOAD_FOLDER, "image"),
        uploadImage(buffer, UPLOAD_FOLDER, "raw", rawPublicId)
      ]);
      
      return NextResponse.json({ url: rawUrl, coverUrl: imageUrl.replace(/\.pdf$/i, ".jpg") });
    }

    // Default behavior for normal images — validate the type and pin the
    // Cloudinary resource_type to "image" (never "auto"), so scriptable/unknown
    // asset types can't be introduced and later served from the CDN origin.
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "ไม่รองรับไฟล์รูปประเภทนี้ (รองรับ JPEG, PNG, WebP, GIF)" },
        { status: 400 }
      );
    }
    const url = await uploadImage(buffer, UPLOAD_FOLDER, "image");
    return NextResponse.json({ url });
  }
);
