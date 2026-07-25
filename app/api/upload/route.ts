import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "../../lib/cloudinaryHelper";
import { requireAuth, withRoute } from "../../lib/apiHelpers";

const UPLOAD_LIMIT = 60; // 60 uploads per block window
const BLOCK_MS = 60 * 1000; // 1 minute window
const MAX_TRACKED = 10_000;

const uploadRateMap = new Map<string, { count: number; expiresAt: number }>();

function prune(now: number) {
  for (const [key, rec] of uploadRateMap) {
    if (rec.expiresAt <= now) uploadRateMap.delete(key);
  }
  if (uploadRateMap.size > MAX_TRACKED) {
    let excess = uploadRateMap.size - MAX_TRACKED;
    for (const key of uploadRateMap.keys()) {
      if (excess-- <= 0) break;
      uploadRateMap.delete(key);
    }
  }
}

// POST — upload an image or document to Cloudinary (login required)
export const POST = withRoute(
  "Failed to upload to Cloudinary",
  async (request: NextRequest) => {
    const session = await requireAuth();
    
    // Rate Limiting: Prevent a compromised admin session from spamming uploads
    // and exhausting Cloudinary quotas or bandwidth.
    const now = Date.now();
    prune(now);
    
    const limitRecord = uploadRateMap.get(session.userId);
    if (limitRecord && limitRecord.expiresAt > now && limitRecord.count >= UPLOAD_LIMIT) {
      return NextResponse.json(
        { error: "อัปโหลดบ่อยเกินไป กรุณารอสักครู่ (Rate limit exceeded)" },
        { status: 429 }
      );
    }
    
    if (limitRecord && limitRecord.expiresAt > now) {
      limitRecord.count++;
    } else {
      uploadRateMap.set(session.userId, { count: 1, expiresAt: now + BLOCK_MS });
    }

    // Prevent DoS: Reject oversized payloads before parsing the body.
    const contentLengthStr = request.headers.get("content-length");
    if (contentLengthStr) {
      const contentLength = parseInt(contentLengthStr, 10);
      const MAX_PAYLOAD_BYTES = 30 * 1024 * 1024; // 30 MB absolute limit for the whole request
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return NextResponse.json(
          { error: `Payload too large. Maximum ${Math.round(MAX_PAYLOAD_BYTES / (1024 * 1024))}MB.` },
          { status: 413 }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const isDocument = formData.get("isDocument") === "true"; // flag to upload as both
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Reject oversized uploads BEFORE buffering the whole file into memory,
    // so a large body can't exhaust the server heap.
    const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
    const maxBytes = isDocument ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `File too large. Maximum ${Math.round(maxBytes / (1024 * 1024))}MB.` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    if (isDocument) {
      if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
        return NextResponse.json({ error: "Only PDF files are allowed for documents" }, { status: 400 });
      }
      // For PDFs: Upload twice. 
      // 1. As 'image' to generate cover image
      // 2. As 'raw' to allow downloading without 401 restrictions
      const rawPublicId = `doc_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
      const [imageUrl, rawUrl] = await Promise.all([
        uploadImage(buffer, "samples/mycom", "image"),
        uploadImage(buffer, "samples/mycom", "raw", rawPublicId)
      ]);
      
      return NextResponse.json({ url: rawUrl, coverUrl: imageUrl.replace(/\.pdf$/i, ".jpg") });
    }

    // Default behavior for normal images — validate the type and pin the
    // Cloudinary resource_type to "image" (never "auto"), so scriptable/unknown
    // asset types can't be introduced and later served from the CDN origin.
    const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported image type. Allowed: JPEG, PNG, WebP, GIF." },
        { status: 400 }
      );
    }
    const url = await uploadImage(buffer, "samples/mycom", "image");
    return NextResponse.json({ url });
  }
);
