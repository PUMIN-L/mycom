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
      // Billing documents (invoice/billing note/receipt) are real financial
      // and tax records, unlike throwaway quotation drafts — they must NEVER
      // be auto-deleted, so there is no purge call for them here anymore
      // (the function that did this was removed from billingStore.ts).
      // `billingDeleted` is kept in the response shape for compatibility
      // with anything parsing this cron's JSON output.
      const billingDeleted = 0;
      const docNosPurged = 0; // Legacy: docNos are no longer purged to preserve conversion rate analytics.
      // Structured success line so a MISSING nightly run is detectable in logs.
      console.log(
        `[cron:quotations-cleanup] ok deleted=${deleted} billingDeleted=${billingDeleted} docNosPurged=${docNosPurged}`
      );
      return NextResponse.json({ ok: true, deleted, billingDeleted, docNosPurged });
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
