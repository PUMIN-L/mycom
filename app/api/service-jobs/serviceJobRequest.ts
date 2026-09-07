import { jsonError } from "../../lib/apiHelpers";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { isValidDateString } from "../../lib/dateFormat";
import { ServiceJobValidationError } from "../../lib/serviceJobStore";
import type { ServiceJobInput } from "../../lib/serviceJobStore";

// Shared request handling for the ใบ Job routes. NOT a route itself — only
// `route.ts` files are routed, so this sits beside them as plain module.

const clean = (value: unknown, max: number): string =>
  sanitizePlainText(value == null ? "" : String(value)).trim().substring(0, max);

/**
 * Every value off the wire, sanitized, in the shape the store expects.
 *
 * Sanitizing here as well as in the store is deliberate belt-and-braces: this
 * layer is the project-wide rule ("every incoming value goes through
 * sanitizePlainText"), and the store's own pass protects any future caller that
 * does not come through HTTP.
 */
export function sanitizeJobBody(data: unknown): ServiceJobInput {
  const body = (data ?? {}) as Record<string, unknown>;
  const rawEquipments = Array.isArray(body.equipmentIds) ? body.equipmentIds : [];
  return {
    companyId: clean(body.companyId, 255),
    customerId: clean(body.customerId, 255),
    jobDate: clean(body.jobDate, 20),
    technicianName: clean(body.technicianName, 255),
    scheduleId: clean(body.scheduleId, 36) || null,
    workSummary:
      body.workSummary === undefined || body.workSummary === null
        ? null
        : clean(body.workSummary, 10000),
    jobNo: clean(body.jobNo, 255) || undefined,
    // Order is meaning here — it is the order the machines print in.
    equipmentIds: rawEquipments.map((id) => clean(id, 36)).filter(Boolean),
  };
}

/**
 * The two shape checks worth answering before the store does, so the client
 * gets the same Thai 400 whether or not the request ever reaches a transaction.
 * Returns a response to send, or null to continue.
 */
export function badRequestForShape(input: ServiceJobInput): Response | null {
  if (!input.jobDate || !isValidDateString(input.jobDate)) {
    return jsonError("กรุณาระบุวันที่ให้ถูกต้อง (YYYY-MM-DD)", 400);
  }
  if (!input.equipmentIds || input.equipmentIds.length === 0) {
    return jsonError("กรุณาเลือกเครื่องอย่างน้อย 1 เครื่อง", 400);
  }
  return null;
}

/**
 * Turn a store-level validation refusal into a 400 carrying its THAI message —
 * the message IS the error the admin reads. Anything else is rethrown, so a
 * real fault still becomes a logged 500 instead of being dressed up as the
 * admin's mistake.
 */
export function respondToJobError(error: unknown): Response {
  if (error instanceof ServiceJobValidationError) {
    return jsonError(error.message, 400);
  }
  throw error;
}
