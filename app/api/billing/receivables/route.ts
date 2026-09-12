import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  listReceivableRows,
  listUndatedReceivables,
  backfillBillingDerivedColumns,
  BILLING_BACKFILL_SETTING,
  BILLING_BACKFILL_VERSION,
} from "../../../lib/billingStore";
import { getSetting, setSetting, getCreditTermDays } from "../../../lib/settingsStore";
import { buildReceivablesLedger } from "../../../lib/receivables";
import { bangkokDateString } from "../../../lib/dateFormat";

/**
 * GET /api/billing/receivables — everything the ลูกหนี้ค้างชำระ screen shows.
 *
 * ONE query returns the rows without their `data` blob and JS does the
 * classification, the ageing and the per-customer subtotals
 * (`buildReceivablesLedger`) — one pure function behind the tiles, the buckets
 * and the row badges, so they can never disagree. This mirrors how getAlerts()
 * already lets the query select and the caller classify.
 *
 * getAlerts() itself does NOT call this function: the bell filters in SQL, for
 * its own snooze join and its own lead-time window. The two therefore have to
 * be kept saying the same thing BY HAND — in particular what "ถูกแทนที่" means
 * (replaced by a row that is STILL ALIVE, so a cancelled correction revives the
 * original debt). When they drifted, the ledger screen counted a revived debt
 * that the bell could never raise.
 *
 * It also carries the lazy backfill of the derived columns. That lives here and
 * NOT in bootstrapSchemaOnce because the bootstrap is DDL-only and returns
 * early on Vercel preview deploys, which share the production database — a
 * backfill placed there would never run against the environment that matters.
 * It is bounded, idempotent, and stops for good once the settings row is
 * stamped, so an ordinary page load pays for it at most once.
 */
export const GET = withRoute("โหลดข้อมูลลูกหนี้ไม่สำเร็จ", async () => {
  await requireAuth();

  const backfillState = await getSetting(BILLING_BACKFILL_SETTING);
  if (backfillState !== BILLING_BACKFILL_VERSION) {
    // A few bounded batches per request, not an unbounded loop: the whole thing
    // has to finish inside one serverless invocation's budget, and a database
    // with more documents than this simply converges over the next few loads.
    for (let pass = 0; pass < 5; pass += 1) {
      const result = await backfillBillingDerivedColumns();
      if (result.done) {
        await setSetting(BILLING_BACKFILL_SETTING, BILLING_BACKFILL_VERSION);
        break;
      }
    }
  }

  // The SAME Bangkok calendar day the alert feed flags with, so a laptop set to
  // another timezone cannot disagree with what the bell says.
  const today = bangkokDateString(new Date());
  const [rows, creditTermDays, undated] = await Promise.all([
    listReceivableRows(),
    getCreditTermDays(),
    listUndatedReceivables(),
  ]);

  return NextResponse.json({
    today,
    creditTermDays,
    ...buildReceivablesLedger(rows, today),
    /** The bulk "ตั้งให้ทุกใบที่ยังไม่กำหนด" target set — the ConfirmDialog in
     *  front of that action states this count and the resulting date range. */
    undatedTargets: undated,
  });
});
