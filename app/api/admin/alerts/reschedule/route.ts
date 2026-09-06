import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../../lib/sanitizeHtml";
import { isValidDateString } from "../../../../lib/dateFormat";
import { rescheduleDatedAlerts } from "../../../../lib/alertSearchStore";
import {
  RESCHEDULE_MODES,
  validateItemCount,
  validateShiftDays,
} from "../../../../lib/alertDateSearch";
import type { RescheduleItemInput, RescheduleMode } from "../../../../lib/alertDateSearch";

/**
 * POST /api/admin/alerts/reschedule
 *
 * Body: `{ mode: "set" | "shift", targetDate?, shiftDays?, items: [{ kind, id,
 * expectedDate }] }`
 *
 * A greyed-out checkbox is a courtesy, not a control. This route enforces the
 * same rule for itself, from the same pure function the table greys the box
 * with (`evaluateMovability`), against the status it reads from the database
 * rather than anything the client asserted — so a hand-built request cannot
 * move a warranty date or reopen a closed appointment's calendar entry.
 *
 * THE ROUTE WRITES NOTHING ITSELF. It validates the envelope and delegates the
 * single transaction to `alertSearchStore.rescheduleDatedAlerts`, whose only
 * write statements touch `service_schedules.scheduledDate` and
 * `crm_tasks.dueDate`. There is no statement anywhere on this path that writes
 * `customer_equipments` or `billing_documents`.
 *
 * Refusals are PER ITEM, never per batch: every submitted item gets its own
 * entry in `results`, in submission order, with a Thai reason.
 */
export const POST = withRoute(
  "เลื่อนวันที่ของรายการที่เลือกไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
    }
    const payload = (body ?? {}) as Record<string, unknown>;

    // ── Envelope. A malformed envelope is a plain 400: there is no per-item
    //    report to give when the request itself does not parse.
    const mode = sanitizePlainText(String(payload.mode ?? "")).trim() as RescheduleMode;
    if (!RESCHEDULE_MODES.includes(mode)) {
      return jsonError(
        'โหมดการย้ายวันไม่ถูกต้อง ต้องเป็น "ตั้งเป็นวันที่เดียว" (set) หรือ "เลื่อน ±N วัน" (shift)',
        400
      );
    }

    let targetDate: string | null = null;
    let shiftDays: number | null = null;

    if (mode === "set") {
      targetDate = sanitizePlainText(String(payload.targetDate ?? "")).trim();
      if (!isValidDateString(targetDate)) {
        return jsonError(
          "กรุณาเลือกวันที่ปลายทางให้ถูกต้อง (รูปแบบ ปปปป-ดด-วว เช่น 2026-06-12)",
          400
        );
      }
    } else {
      // Not `Number(...)`: "7abc" and "" must not become a shift. The Thai
      // message names the actual limits so nobody has to guess from a 400.
      const shiftError = validateShiftDays(payload.shiftDays);
      if (shiftError) return jsonError(shiftError, 400);
      shiftDays = Number(payload.shiftDays);
    }

    const rawItems = payload.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return jsonError("กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการเลื่อนวัน", 400);
    }

    // The cap is a REFUSAL, never a trim. Silently doing the first 200 of 240
    // and reporting success is the worst possible answer: the admin walks away
    // believing the whole batch moved and finds out by missing an appointment.
    // Nothing is written when this fires.
    const countError = validateItemCount(rawItems.length);
    if (countError) return jsonError(countError, 400);

    const items: RescheduleItemInput[] = rawItems.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        kind: sanitizePlainText(String(item.kind ?? "")).trim(),
        id: sanitizePlainText(String(item.id ?? "")).trim(),
        expectedDate: sanitizePlainText(String(item.expectedDate ?? "")).trim(),
      };
    });

    const report = await rescheduleDatedAlerts({ mode, targetDate, shiftDays, items });

    // 400 with the SAME BODY SHAPE when every item was refused: the screen has
    // to render the reasons, not a success toast for a batch where nothing
    // happened. Partial success stays a 200 — success with a report attached.
    // A batch that was entirely `unchanged` is also a 200: nothing was
    // refused, and nothing needed moving, which is a true and unremarkable
    // outcome rather than an error.
    const everythingRefused =
      report.results.length > 0 && report.results.every((r) => r.status === "refused");

    return NextResponse.json(report, { status: everythingRefused ? 400 : 200 });
  }
);
