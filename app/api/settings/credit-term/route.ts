import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getCreditTermDays,
  setCreditTermDays,
  MAX_CREDIT_TERM_DAYS,
} from "../../../lib/settingsStore";

/**
 * เครดิตเทอมเริ่มต้น — the default credit term, in days.
 *
 * NOT OTP-GATED, unlike the contact email and the company profile next to it on
 * /settings. Those OTPs guard outward-facing IDENTITY: an attacker redirecting
 * where leads are emailed, or rewriting the address printed on the public site.
 * A credit term is internal and low blast radius — the worst a wrong value does
 * is pre-fill "45" instead of "30" into a box the admin can see and change on
 * the next document, and it never moves a due date already saved. An OTP round
 * trip for that is friction with no threat behind it. The /settings page still
 * uses the "click แก้ไข before the fields unlock" pattern, which is what
 * actually guards against a stray keystroke.
 */
export const GET = withRoute("โหลดค่าเครดิตเทอมไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json({ days: await getCreditTermDays() });
});

export const PUT = withRoute(
  "บันทึกค่าเครดิตเทอมไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json().catch(() => ({}));
    const days = Number(body?.days);
    if (!Number.isFinite(days) || days < 0 || days > MAX_CREDIT_TERM_DAYS) {
      return NextResponse.json(
        { error: `จำนวนวันต้องอยู่ระหว่าง 0 ถึง ${MAX_CREDIT_TERM_DAYS}` },
        { status: 400 }
      );
    }
    // Changing this NEVER moves a due date already saved: a due date is a term
    // agreed with that customer on that invoice, not a live formula. Only new
    // documents pick up the new default.
    return NextResponse.json({ days: await setCreditTermDays(days) });
  }
);
