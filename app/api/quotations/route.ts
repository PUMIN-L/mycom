import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import { saveQuotation, listQuotations, isDocNoTaken } from "../../lib/quotationStore";

// GET /api/quotations (login required) — list saved quotations (summary only).
export const GET = withRoute("โหลดรายการใบเสนอราคาไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json(await listQuotations());
});

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

    // Reject a docNo already used by a DIFFERENT quotation (409). Re-saving the
    // same quotation (same id) keeps its own number — that's an update, not a dup.
    const docNo = String(body?.docNo ?? "").slice(0, 255);
    if (docNo && (await isDocNoTaken(docNo, id))) {
      return NextResponse.json(
        { error: "เลขที่ใบเสนอราคานี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่" },
        { status: 409 }
      );
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
      docNo,
      data: body?.data ?? {},
      uploadedImages,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ id });
  }
);
