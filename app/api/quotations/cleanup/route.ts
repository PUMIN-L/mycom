import { NextRequest, NextResponse } from "next/server";
import { withRoute } from "../../../lib/apiHelpers";
import { purgeExpiredQuotations } from "../../../lib/quotationStore";
import { purgeExpiredAlertSnoozes } from "../../../lib/crmStore";

// GET /api/quotations/cleanup — invoked daily by Vercel Cron (see vercel.json)
// to delete quotations past their retention window (RETENTION_DAYS below) plus
// their uploaded Cloudinary images.
//
// Secured with CRON_SECRET: when that env var is set, Vercel sends it as
// `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is unset the endpoint
// fails closed (401), so auto-cleanup only runs once the secret is configured —
// and says so in the log, because "the cron is switched off" otherwise looks
// exactly like "somebody knocked on the door". /api/health also names it in its
// admin-only `warnings`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 2 years. This business's sales cycle runs for months to years, so the old
// 30-day window purged the quotation right about when the customer decided to
// buy — leaving the sale form's quotation picker empty exactly when it matters.
const RETENTION_DAYS = 730;
// NOTE: the docNo ledger (used_docnos) is deliberately NOT purged here — it is
// kept for conversion-rate analytics (see app/lib/quotationStore.ts, the
// used_docnos section). There is no docNo retention constant and no
// purgeOldDocNos import in this route on purpose; if you ever reinstate it, its
// window is its OWN (~2 days, a docNo only has to outlive its date prefix) and
// must never be tied to RETENTION_DAYS.

export const GET = withRoute(
  "ล้างใบเสนอราคาไม่สำเร็จ",
  async (request: NextRequest) => {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");

    // Two different situations used to be one silent 401: "someone knocked
    // without the secret" and "this cron is switched off entirely". The second
    // one is an operator problem — Vercel's nightly call is rejected too, so
    // nothing is EVER purged and the Cloudinary images of dead quotations pile
    // up — and it has to be visible in the logs. Grep `cron:quotations-cleanup`.
    //
    // Logged on every unauthenticated hit rather than once per process. Note
    // what that exposes: middleware.ts gates no /api path, so ANY anonymous
    // caller can drive this line. That is acceptable, but not because the route
    // is unlisted — obscurity is not the argument. It is acceptable because
    // Vercel already writes a request log for every one of those hits, so the
    // marginal cost is one extra line per request rather than a new channel,
    // and because the string is a CONSTANT: nothing the caller sends (header,
    // query, body) reaches the log, so there is no log-injection surface. A
    // once-per-process guard would buy back that one line at the price of a
    // worse failure — the line missing from exactly the nightly run an operator
    // goes looking for.
    if (!secret) {
      console.error(
        "[cron:quotations-cleanup] DISABLED CRON_SECRET is not set — every caller (including Vercel Cron) gets 401, so NO quotation will ever be purged and their Cloudinary images will keep accumulating. Set CRON_SECRET in the Vercel project env to enable the nightly cleanup."
      );
    }

    // Fails closed either way, and the RESPONSE is byte-identical in both
    // cases: an unauthorised caller must not be able to probe whether
    // CRON_SECRET is configured. The distinction lives in the server log only.
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
      // Expired alert snoozes. A snoozed alert whose snooze has run out is
      // already being shown again by every query in crmStore — the row is dead
      // data nothing reads, and nothing has ever deleted one. The purge is
      // strictly conservative (see purgeExpiredAlertSnoozes): it only removes
      // rows the alert queries have already stopped honouring, so no alert
      // changes state because of this line.
      //
      // Deliberately NOT purged here, and not by accident:
      //   • `service_logs` — real service history, the record that a technician
      //     visited a customer. Never auto-deleted.
      //   • `used_docnos` — kept forever on purpose for conversion-rate
      //     analytics (see the NOTE at the top of this file).
      const snoozesPurged = await purgeExpiredAlertSnoozes();
      // Structured success line so a MISSING nightly run is detectable in logs.
      console.log(
        `[cron:quotations-cleanup] ok deleted=${deleted} billingDeleted=${billingDeleted} docNosPurged=${docNosPurged} snoozesPurged=${snoozesPurged}`
      );
      return NextResponse.json({ ok: true, deleted, billingDeleted, docNosPurged, snoozesPurged });
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
