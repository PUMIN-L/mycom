import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import { saveQuotation } from "../../lib/quotationStore";

// POST /api/quotations (login required) — save/upsert a quotation so it can be
// deleted from the "keep or delete?" prompt and auto-purged after 30 days.
export const POST = withRoute(
  "บันทึกใบเสนอราคาไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Server backstop for the image-deletion safety invariant: only accept URLs
    // on OUR Cloudinary cloud. Anything else (foreign host, garbage) is dropped
    // so it can never reach cloudinary.destroy(). deleteQuotation additionally
    // refuses to delete any URL still referenced by a product/content.
    const cloud = process.env.CLOUDINARY_CLOUD_NAME ?? "";
    const cloudPrefix = `https://res.cloudinary.com/${cloud}/`;
    const uploadedImages: string[] = Array.isArray(body?.uploadedImages)
      ? body.uploadedImages.filter(
          (u: unknown): u is string =>
            typeof u === "string" && cloud !== "" && u.startsWith(cloudPrefix)
        )
      : [];

    await saveQuotation({
      id,
      docNo: String(body?.docNo ?? "").slice(0, 255),
      data: body?.data ?? {},
      uploadedImages,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ id });
  }
);
