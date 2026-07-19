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
    try {
      const deleted = await purgeExpiredQuotations(RETENTION_DAYS);
      const docNosPurged = await purgeOldDocNos(DOCNO_RETENTION_DAYS);
      // Structured success line so a MISSING nightly run is detectable in logs.
      console.log(
        `[cron:quotations-cleanup] ok deleted=${deleted} docNosPurged=${docNosPurged}`
      );
      return NextResponse.json({ ok: true, deleted, docNosPurged });
    } catch (err) {
      // Log then rethrow so withRoute returns 500 → Vercel marks the cron run
      // FAILED instead of the failure disappearing silently. (Note: withRoute
      // converts this into a 500 Response, so Next's onRequestError hook does NOT
      // fire for it — the structured log here + the failed-run status are the
      // signals; a future tracker should hook withRoute's 500 branch, not rely on
      // onRequestError for route handlers.)
      console.error("[cron:quotations-cleanup] FAILED", err);
      throw err;
    }
  }
);
