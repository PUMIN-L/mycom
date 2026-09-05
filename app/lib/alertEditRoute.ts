/**
 * Where the "แก้ไข" button on an alert card has to go.
 *
 * This lived inline in `app/crm/alerts/page.tsx` as a chain of `if`s, and it
 * carried a real bug: the `schedule` branch assumed every schedule is attached
 * to a machine and fetched `/api/admin/equipments/${target.data.equipmentId}`
 * unconditionally. A CUSTOMER-scoped follow-up call has no `equipmentId`, so
 * that request went to `/api/admin/equipments/undefined` and failed 100% of the
 * time — the admin got "โหลดข้อมูลอุปกรณ์ไม่สำเร็จ" and no way to edit the call.
 *
 * The decision is pulled out here as a pure function so it can be unit tested
 * (tasks.md 17.5) without rendering the page: React-free, fetch-free, and it
 * only ever returns a description of what the page should do next.
 *
 * Spec: openspec/changes/add-crm-task-board — tasks 10.1-10.5, 17.5.
 */

/** What the page should open. Nothing here performs the action. */
export type AlertEditRoute =
  /** Open `SalesRecordEditModal` for this sales record (เอกสารค้าง). */
  | { kind: "sales_record"; salesRecordId: string }
  /** Load the equipment by id, THEN open `EquipmentDetailsModal`. The load can
   * genuinely fail, and when it does the page still says
   * "โหลดข้อมูลอุปกรณ์ไม่สำเร็จ" — the fix must not swallow that. */
  | { kind: "equipment_fetch"; equipmentId: string }
  /** Open the schedule edit form (วันที่นัด / ผู้รับผิดชอบ / โน้ต) straight
   * away. No equipment is involved, so nothing is fetched first. */
  | { kind: "schedule_form"; scheduleId: string }
  /** `target.data` IS the equipment row already (ประกัน / สอบเทียบ /
   * ข้อมูลไม่ครบ) — open `EquipmentEditModal` with it as-is. */
  | { kind: "equipment_inline" }
  /** Nothing sensible to open (no target, or a row with no usable id). */
  | { kind: "none" };

/** The alert categories whose card carries an edit button. */
export type AlertEditTargetType =
  | "schedule"
  | "customer_call"
  | "warranty"
  | "calibration"
  | "incomplete"
  | "missing_doc";

export interface AlertEditTarget {
  type?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * An id is usable only when it is a non-empty string of something other than
 * the words JavaScript prints when a value is missing. `String(undefined)` is
 * exactly how `/api/admin/equipments/undefined` got built in the first place,
 * so those two spellings are rejected explicitly rather than trusted.
 */
function usableId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
  return trimmed;
}

/**
 * Decide what the edit button opens for one alert card.
 *
 * Schedules split on `equipmentId` and nothing else:
 *   - present → the original path, unchanged (fetch the machine, open its
 *     details modal);
 *   - absent → the schedule form, with NO equipment request at all.
 * `customer_call` rows are customer-scoped by definition, so they always take
 * the second path (tasks 10.2 and 10.5 are the same code path on purpose).
 */
export function resolveAlertEditRoute(
  target: AlertEditTarget | null | undefined
): AlertEditRoute {
  if (!target || !target.type) return { kind: "none" };
  const data = (target.data ?? {}) as Record<string, unknown>;

  if (target.type === "missing_doc") {
    const salesRecordId = usableId(data.id);
    return salesRecordId ? { kind: "sales_record", salesRecordId } : { kind: "none" };
  }

  if (target.type === "schedule" || target.type === "customer_call") {
    const equipmentId = usableId(data.equipmentId);
    if (equipmentId) return { kind: "equipment_fetch", equipmentId };
    const scheduleId = usableId(data.id);
    return scheduleId ? { kind: "schedule_form", scheduleId } : { kind: "none" };
  }

  // warranty / calibration / incomplete — `data` is already the equipment row.
  return { kind: "equipment_inline" };
}
