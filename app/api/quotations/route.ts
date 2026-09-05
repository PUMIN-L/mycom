import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import {
  saveQuotationAtomic,
  DocNoConflictError,
  listQuotations,
} from "../../lib/quotationStore";
import { computeQuoteTotals, hasNegativeLineItem } from "../../lib/quotationTotals";

// GET /api/quotations (login required) — list saved quotations (summary only).
//
// `?search=` / `?limit=` filter server-side. Retention is now 2 years, so the
// list can genuinely exceed the store's safety cap and older-but-still-live
// quotations would drop off the bottom unseen; the picker searches in SQL
// instead of relying on one page holding everything. Both params are optional
// and omitting them returns the previous unfiltered newest-first page.
export const GET = withRoute(
  "โหลดรายการใบเสนอราคาไม่สำเร็จ",
  async (request?: NextRequest) => {
    await requireAuth();
    const params = request ? new URL(request.url).searchParams : null;
    const rawLimit = Number(params?.get("limit"));
    return NextResponse.json(
      await listQuotations({
        search: params?.get("search") || undefined,
        limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
      })
    );
  }
);

// POST /api/quotations (login required) — save/upsert a quotation so it can be
// deleted from the "keep or delete?" prompt and auto-purged once it is past the
// retention window (2 years — RETENTION_DAYS in the cleanup route).
export const POST = withRoute(
  "บันทึกใบเสนอราคาไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (JSON.stringify(body).length > 200000) {
      return NextResponse.json({ error: "ข้อมูลมีขนาดใหญ่เกินไป (สูงสุด 200KB)" }, { status: 413 });
    }

    const docNo = String(body?.docNo ?? "").slice(0, 255);
    const data = body?.data ?? {};

    // `data` is otherwise opaque client state, but the grand total feeds
    // real business documents — a negative one (from a negative qty/price
    // line item) must never be silently accepted and saved.
    if (hasNegativeLineItem(data) || computeQuoteTotals(data).grandTotal < 0) {
      return NextResponse.json(
        { error: "ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า" },
        { status: 400 }
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

    const createdAt = new Date().toISOString();
    // Save + reserve the docNo atomically. A docNo already owned by a DIFFERENT
    // quotation aborts the whole transaction (409) — re-saving the same id is an
    // update, not a dup. The ledger survives quote deletion, so a number stays
    // reserved ~2 days even after the quote is gone.
    try {
      await saveQuotationAtomic({
        id,
        docNo,
        data,
        uploadedImages,
        createdAt,
      });
    } catch (err) {
      if (err instanceof DocNoConflictError) {
        return NextResponse.json(
          { error: "เลขที่ใบเสนอราคานี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่" },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({ id });
  }
);
