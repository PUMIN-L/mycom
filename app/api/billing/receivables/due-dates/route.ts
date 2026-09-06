import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { setDueDatesForUndatedReceivables } from "../../../../lib/billingStore";
import { getCreditTermDays, MAX_CREDIT_TERM_DAYS } from "../../../../lib/settingsStore";

/**
 * POST /api/billing/receivables/due-dates — "ตั้งให้ทุกใบที่ยังไม่กำหนด".
 *
 * Gives every eligible receivable that has no ครบกำหนดชำระ one, `docDate + term`.
 * NOTHING IS EVER AUTO-STAMPED: this runs only when the owner presses the
 * button and confirms the count and date range the ledger showed him.
 * Auto-stamping a term onto a two-year-old invoice would invent an overdue debt
 * nobody ever agreed to, which is why the migration leaves dueDate NULL and
 * every overdue predicate carries `dueDate IS NOT NULL`.
 *
 * `termDays` is optional and falls back to the configured default, so the
 * button works even if the client's copy of the setting is stale.
 */
export const POST = withRoute(
  "ตั้งวันครบกำหนดไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json().catch(() => ({}));

    const raw = Number(body?.termDays);
    const termDays = Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 0), MAX_CREDIT_TERM_DAYS)
      : await getCreditTermDays();

    const updated = await setDueDatesForUndatedReceivables(termDays);
    return NextResponse.json({ updated, termDays });
  }
);
