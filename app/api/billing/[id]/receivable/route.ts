import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  setBillingDueDate,
  setReceivableOverride,
  cancelBillingDocument,
} from "../../../../lib/billingStore";
import { isValidDateString } from "../../../../lib/dateFormat";

/**
 * PATCH /api/billing/[id]/receivable — the three receivable decisions an admin
 * makes about ONE document, all of which are explicit human acts:
 *
 *   { dueDate: "YYYY-MM-DD" | null }   ตั้ง/ล้างวันครบกำหนด
 *   { receivableOverride: 0|1|null }   นับ/ไม่นับเป็นลูกหนี้
 *   { cancelled: true|false }          ยกเลิก/ยกเลิกการยกเลิกเอกสาร
 *
 * None of them is ever inferred by the code. Matching customer+total heuristics
 * on financial data is exactly how a wrong ยอดค้าง that nobody can explain gets
 * produced, so `receivableOverride` in particular is one click by the admin.
 *
 * `dueDate` is validated with isValidDateString BEFORE it touches the column:
 * these VARCHAR date columns are compared and sorted LEXICALLY, so a single
 * malformed value silently breaks every range query built on them.
 */
export const PATCH = withRoute(
  "อัปเดตข้อมูลลูกหนี้ไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    let touched = false;

    if ("dueDate" in body) {
      const raw = body.dueDate;
      if (raw === null || raw === "") {
        await setBillingDueDate(id, null);
      } else {
        const value = String(raw).trim();
        if (!isValidDateString(value)) {
          return NextResponse.json(
            { error: "รูปแบบวันครบกำหนดไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        await setBillingDueDate(id, value);
      }
      touched = true;
    }

    if ("receivableOverride" in body) {
      const raw = body.receivableOverride;
      if (raw !== null && raw !== 0 && raw !== 1) {
        return NextResponse.json(
          { error: "ค่าการนับเป็นลูกหนี้ไม่ถูกต้อง" },
          { status: 400 }
        );
      }
      await setReceivableOverride(id, raw as 0 | 1 | null);
      touched = true;
    }

    if ("cancelled" in body) {
      // Cancelling keeps the document, its payment history and its reserved
      // docNo — it is the non-destructive alternative to the 🗑️ button, which
      // now refuses outright once money is attached.
      await cancelBillingDocument(id, body.cancelled ? new Date().toISOString() : null);
      touched = true;
    }

    if (!touched) {
      return NextResponse.json({ error: "ไม่มีข้อมูลที่จะอัปเดต" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  }
);
