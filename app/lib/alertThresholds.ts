/**
 * Every numeric threshold the CRM alert feed is built on, in ONE place.
 *
 * Why this file exists (tasks.md 18.14): the in-page guide on /crm/alerts has
 * to tell the owner "a warranty alert appears N days before it ends" — and that
 * N must be the same N `getAlerts()` puts in its WHERE clause, forever. Any
 * number retyped into the guide's prose drifts silently the next time someone
 * widens a window, and the guide then lies about the system it documents.
 *
 * It has NO imports on purpose. `crmStore.ts` (server, pulls in mysql2) reads
 * these for its queries and the guide panel (a client component) reads the same
 * constants for its text, so the two can never disagree. Putting them in
 * crmStore itself would drag the DB driver into the browser bundle — the same
 * reason CALIBRATION_VALIDITY_MONTHS already lives in types.ts rather than
 * next to the query that uses it.
 */

/** Default width of the "ประกันใกล้หมด" window, in days: an alert fires while
 *  `warrantyEndDate` sits between today and today + this. Overridable per
 *  request via `?warrantyDays=`, so the guide renders what the page ASKED for
 *  on this load, not this default. */
export const ALERT_WARRANTY_DAYS = 30;

/** Default width of the equipment-scoped "กำหนดการ" window, in days.
 *  Overridable via `?scheduleDays=`. Customer-scoped follow-up calls
 *  deliberately have NO window at all — do not apply this to them. */
export const ALERT_SCHEDULE_DAYS = 7;

/** How long before the calibration anniversary the alert starts, in months.
 *  Used as `CALIBRATION_VALIDITY_MONTHS - CALIBRATION_ALERT_LEAD_MONTHS` =
 *  months elapsed since `calibrationDate` at which the alert fires. There is no
 *  upper bound: nothing "completes" a calibration except a NEW date. */
export const CALIBRATION_ALERT_LEAD_MONTHS = 2;

/** Row cap on the alert categories that have no date window to bound them
 *  (incomplete equipment, customer follow-up calls). The LIST is capped; the
 *  `*Total` counts alongside it are the true totals, which is exactly the
 *  distinction the guide has to explain. */
export const ALERT_LIST_DISPLAY_LIMIT = 100;

/** "เอกสารค้าง", case A: an equipment sale with no delivery-note number this
 *  many days after the sale date. */
export const MISSING_DELIVERY_DOC_DAYS = 20;

/** "เอกสารค้าง", case B: a sale that has an invoice number but still no
 *  receipt number this many days after the sale date. */
export const MISSING_RECEIPT_DOC_DAYS = 30;
