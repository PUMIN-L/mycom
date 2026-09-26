import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import { createRateLimiter } from "../../../lib/rateLimit";
import { signUploadParams } from "../../../lib/cloudinaryHelper";
import { ALLOWED_IMAGE_FORMATS, UPLOAD_FOLDER } from "../../../lib/uploadLimits";

// POST /api/upload/sign — permission for the BROWSER to upload one file
// straight to Cloudinary (login required).
//
// Vercel refuses a request body over 4.5 MB before it reaches a function, so
// /api/upload can never receive a large catalog PDF or photo. Files over
// DIRECT_UPLOAD_THRESHOLD (lib/uploadLimits.ts) go to Cloudinary directly,
// with the signatures issued here. Cloudinary accepts an upload only with the
// exact parameters signed, so the browser gets no more than this route allows:
// our folder, an image type (or a PDF), a PDF's raw copy under a public id
// chosen here. Same shape of result as /api/upload once the browser is done
// (lib/uploadClient.ts), and the same two uploads for a PDF.
//
// Body: { kind: "image" | "document" }
// → { cloudName, apiKey, uploads: [{ resourceType, params, signature }] }

// Per account, like /api/upload: signing is cheap, the uploads it permits are
// not.
const rateLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 1000,
});

export const POST = withRoute(
  "ขอสิทธิ์อัปโหลดไม่สำเร็จ",
  async (request: NextRequest) => {
    const session = await requireAuth();
    if (!rateLimiter.check(session.userId).allowed) {
      return NextResponse.json(
        { error: "อัปโหลดบ่อยเกินไป กรุณารอสักครู่ (Rate limit exceeded)" },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const kind = (body as { kind?: unknown } | null)?.kind;
    if (kind !== "image" && kind !== "document") {
      return NextResponse.json({ error: "kind ต้องเป็น \"image\" หรือ \"document\"" }, { status: 400 });
    }

    // Cloudinary rejects a signature older than an hour; the upload starts
    // right after this answer.
    const timestamp = Math.floor(Date.now() / 1000);
    const specs: Array<{ resourceType: "image" | "raw"; params: Record<string, string | number> }> =
      kind === "image"
        ? [{ resourceType: "image", params: { folder: UPLOAD_FOLDER, timestamp, allowed_formats: ALLOWED_IMAGE_FORMATS } }]
        : [
            // The image copy makes the cover (…pdf → …jpg), as /api/upload does.
            { resourceType: "image", params: { folder: UPLOAD_FOLDER, timestamp, allowed_formats: "pdf" } },
            // The raw copy is the document itself; its name is chosen here.
            {
              resourceType: "raw",
              params: {
                folder: UPLOAD_FOLDER,
                timestamp,
                public_id: `doc_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
              },
            },
          ];

    const uploads = [];
    let cloud: { apiKey: string; cloudName: string } | null = null;
    for (const spec of specs) {
      const signed = signUploadParams(spec.params);
      if (!signed) {
        return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า Cloudinary" }, { status: 500 });
      }
      cloud = { apiKey: signed.apiKey, cloudName: signed.cloudName };
      uploads.push({ resourceType: spec.resourceType, params: spec.params, signature: signed.signature });
    }

    return NextResponse.json({ cloudName: cloud!.cloudName, apiKey: cloud!.apiKey, uploads });
  }
);
