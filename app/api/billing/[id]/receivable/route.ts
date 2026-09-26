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
 *
 * EVERY field is checked before ANY is written — a bad second field used to
 * answer 400 after the first had already been saved — and a document that
 * does not exist is a 404, not a "success" that changed nothing.
 */
export const PATCH = withRoute(
  "อัปเดตข้อมูลลูกหนี้ไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const parsed: unknown = await request.json().catch(() => null);
    // A string or number is valid JSON too, and `"dueDate" in "x"` throws.
    const body: Record<string, unknown> =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    let dueDate: string | null | undefined;
    if ("dueDate" in body) {
      const raw = body.dueDate;
      if (raw === null || raw === "") {
        dueDate = null;
      } else {
        const value = typeof raw === "string" ? raw.trim() : "";
        if (!isValidDateString(value)) {
          return NextResponse.json(
            { error: "รูปแบบวันครบกำหนดไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        dueDate = value;
      }
    }

    let receivableOverride: 0 | 1 | null | undefined;
    if ("receivableOverride" in body) {
      const raw = body.receivableOverride;
      if (raw !== null && raw !== 0 && raw !== 1) {
        return NextResponse.json(
          { error: "ค่าการนับเป็นลูกหนี้ไม่ถูกต้อง" },
          { status: 400 }
        );
      }
      receivableOverride = raw;
    }

    let cancelled: boolean | undefined;
    if ("cancelled" in body) {
      // Only a real true/false: any truthy value used to cancel — the string
      // "false" included.
      if (typeof body.cancelled !== "boolean") {
        return NextResponse.json(
          { error: "ค่าการยกเลิกเอกสารไม่ถูกต้อง" },
          { status: 400 }
        );
      }
      cancelled = body.cancelled;
    }

    if (dueDate === undefined && receivableOverride === undefined && cancelled === undefined) {
      return NextResponse.json({ error: "ไม่มีข้อมูลที่จะอัปเดต" }, { status: 400 });
    }

    // Each write matches the document by id, so the first one also tells
    // whether it exists; nothing after a miss would match either.
    let found = true;
    if (dueDate !== undefined) {
      found = await setBillingDueDate(id, dueDate);
    }
    if (found && receivableOverride !== undefined) {
      found = await setReceivableOverride(id, receivableOverride);
    }
    if (found && cancelled !== undefined) {
      // Cancelling keeps the document, its payment history and its reserved
      // docNo — it is the non-destructive alternative to the 🗑️ button, which
      // now refuses outright once money is attached.
      found = await cancelBillingDocument(id, cancelled ? new Date().toISOString() : null);
    }
    if (!found) {
      return NextResponse.json({ error: "ไม่พบเอกสารนี้" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  }
);
