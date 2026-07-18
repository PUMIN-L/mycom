import { NextRequest, NextResponse } from "next/server";
import { withRoute } from "../../../lib/apiHelpers";
import { purgeExpiredQuotations, purgeOldDocNos } from "../../../lib/quotationStore";

// GET /api/quotations/cleanup — invoked daily by Vercel Cron (see vercel.json)
// to delete quotations older than 30 days plus their uploaded Cloudinary images.
//
// Secured with CRON_SECRET: when that env var is set, Vercel sends it as
// `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is unset the endpoint
// fails closed (401), so auto-cleanup only runs once the secret is configured.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 30;
const DOCNO_RETENTION_DAYS = 2;

export const GET = withRoute(
  "ล้างใบเสนอราคาไม่สำเร็จ",
  async (request: NextRequest) => {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const deleted = await purgeExpiredQuotations(RETENTION_DAYS);
    const docNosPurged = await purgeOldDocNos(DOCNO_RETENTION_DAYS);
    return NextResponse.json({ deleted, docNosPurged });
  }
);
