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
    // ⚠️ `jobNo` is NOT read off the body, on purpose, and must never be added
    // back. The number is minted by the store inside the transaction that
    // writes the row (see route.ts's own contract and claimJobNo): it is a
    // claim on `used_docnos`, the never-purged ledger quotations and billing
    // documents share, so a client string can burn a number belonging to
    // another document family and two clients can pick the same one.
    //
    // Order is meaning here — it is the order the machines print in.
    equipmentIds: rawEquipments.map((id) => clean(id, 36)).filter(Boolean),
    // Absent key → `undefined`, which tells the store to leave the column
    // alone on an edit. Present → the full replacement list. Folding the two
    // together would make every save from a client that has no typed-machine
    // UI erase the ones another client wrote.
    customEquipments: cleanCustomEquipments(body.customEquipments),
  };
}

/** The typed (unregistered) machines off the wire, sanitized, or `undefined`
 *  when the caller sent no such key. Entries with neither a name nor a serial
 *  are dropped — they would print as a blank row on the paper. */
function cleanCustomEquipments(
  raw: unknown
): { productName: string; serialNumber: string }[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        productName: clean(row.productName, 255),
        serialNumber: clean(row.serialNumber, 255),
      };
    })
    .filter((entry) => entry.productName || entry.serialNumber);
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
  // A sheet needs at least one machine on it, but a TYPED one counts: the
  // store permits equipmentIds: [] when there are custom entries, so refusing
  // it here would make the v39 typed-machine feature unreachable through the
  // only API there is.
  const machineCount =
    (input.equipmentIds?.length ?? 0) + (input.customEquipments?.length ?? 0);
  if (machineCount === 0) {
    return jsonError("กรุณาเลือกหรือเพิ่มเครื่องอย่างน้อย 1 เครื่อง", 400);
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
