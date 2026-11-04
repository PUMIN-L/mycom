import "server-only";
import { after, userAgent, type NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "./db";
import { clientKey } from "./rateLimit";
import { isMailConfigured, sendNewDeviceLoginEmail } from "./mailer";
import { PASSWORD_OTP_EMAIL } from "./passwordReset";
import {
  LOGIN_ALERT_STATUSES,
  LOGIN_METHODS,
  LOGIN_OUTCOMES,
  mergeLoginSteps,
  type LoginAlertStatus,
  type LoginHistoryEntry,
  type LoginMethod,
  type LoginOutcome,
  type LoginStepRecord,
} from "./loginHistory";

// Login history (schema v49, table login_events) and the new-device email.
//
// Every step of a login that got past the password is stored: a session
// issued on the password alone, a right password on a two-factor account
// (still waiting for the code), and the code step that then issues the
// session. Wrong passwords are NOT stored — the lockout counts those
// (lib/loginThrottle.ts), and a table anyone could add rows to by typing made-up
// usernames would be a way to fill the database.
//
// The email: when the PASSWORD step succeeds in a browser that has no valid
// device cookie for this account (lib/loginDevice.ts — never logged in here,
// cookies cleared, or logged out by "ออกจากระบบอุปกรณ์อื่นทั้งหมด" / a password
// change), lib/passwordReset.ts's FIXED address is told at once. Fixed for the
// same reason the password codes go there: the contact email can be changed
// from a stolen session, and the alert must not be. It goes at the password
// step even on a two-factor account, because a right password with no code to
// follow is exactly the case to hear about: the password has leaked. The code
// step never emails again — one email per login.

export const LOGIN_HISTORY_RETENTION_DAYS = 365;
/** At most this many emails an hour / a day. Someone who has the password could
 *  otherwise log in over and over and spend the mailbox's daily sending limit
 *  — the same mailbox the password-reset codes come from. Past the cap the step
 *  is still stored, marked "capped". */
export const LOGIN_ALERTS_PER_HOUR = 5;
export const LOGIN_ALERTS_PER_DAY = 20;
/** Stored steps the history reads (it pairs them into fewer lines). */
export const LOGIN_HISTORY_LIST_LIMIT = 100;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface LoginStep {
  userId: string;
  username: string;
  outcome: LoginOutcome;
  method: LoginMethod;
  /** No valid device cookie for this account came with the request. */
  newDevice: boolean;
  /** The login attempt (a UUID): the password step makes it, and the pending
   *  token carries it to the code step, which stores the same one. */
  attemptId: string;
}

export interface LoginRequestDetails {
  ip: string | null;
  location: string | null;
  userAgent: string | null;
}

function decodedHeader(headers: Headers, name: string): string {
  const raw = headers.get(name)?.trim() ?? "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw; // a malformed %-sequence: show it as sent
  }
}

/**
 * "Bangkok, TH" from Vercel's geolocation headers (the city is URL-encoded).
 * Approximate and for reading only — nothing decides anything from it. null
 * when there are none (local development).
 */
export function locationOf(headers: Headers): string | null {
  const label = [decodedHeader(headers, "x-vercel-ip-city"), decodedHeader(headers, "x-vercel-ip-country")]
    .filter(Boolean)
    .join(", ");
  return label ? label.slice(0, 160) : null;
}

/** What the request says about where it came from — read before the response goes. */
export function loginRequestDetails(request: { headers: Headers }): LoginRequestDetails {
  const ip = clientKey(request);
  return {
    ip: ip === "unknown" ? null : ip.slice(0, 64),
    location: locationOf(request.headers),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
  };
}

/** "Chrome บน Windows", "Mobile Safari บน iOS (Apple iPhone)" — Next's own user-agent parser. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "ไม่ทราบอุปกรณ์";
  const { browser, os, device } = userAgent({ headers: new Headers({ "user-agent": ua }) });
  const model = [device.vendor, device.model].filter(Boolean).join(" ");
  const system = os.name ? ` บน ${os.name}${model ? ` (${model})` : ""}` : model ? ` บน ${model}` : "";
  const name = browser.name ?? (system ? "เบราว์เซอร์ไม่ทราบชื่อ" : "");
  return name ? `${name}${system}` : "ไม่ทราบอุปกรณ์";
}

/** Whether the step gets the new-device email: the password step, from a new browser. */
export function loginAlertDue(step: LoginStep): boolean {
  return step.newDevice && step.method === "password";
}

/**
 * Store the step, and send the new-device email when one is due, once the
 * response has gone (after()) — the login waits for neither, and neither can
 * fail it. Call it only once the step has succeeded.
 */
export function noteLoginEvent(request: NextRequest, step: LoginStep): void {
  const details = loginRequestDetails(request);
  const at = new Date().toISOString();
  try {
    after(() => recordLoginEvent(step, details, at));
  } catch (error) {
    // after() needs a live request scope. Outside one the login still stands.
    console.error("[login-history] could not schedule the record:", error);
  }
}

async function overAlertCap(at: string): Promise<boolean> {
  const now = Date.parse(at);
  try {
    const [rows] = await query<RowDataPacket[]>(
      "SELECT COUNT(*) AS lastDay, COALESCE(SUM(createdAt >= ?), 0) AS lastHour" +
        " FROM login_events WHERE alert = 'sent' AND createdAt >= ?",
      [new Date(now - HOUR_MS).toISOString(), new Date(now - DAY_MS).toISOString()]
    );
    return (
      Number(rows[0]?.lastHour) >= LOGIN_ALERTS_PER_HOUR || Number(rows[0]?.lastDay) >= LOGIN_ALERTS_PER_DAY
    );
  } catch (error) {
    // A failed count must not cost the owner a warning.
    console.error("[login-history] could not count recent alerts — sending anyway:", error);
    return false;
  }
}

async function sendAlert(step: LoginStep, details: LoginRequestDetails, at: string): Promise<LoginAlertStatus> {
  if (!isMailConfigured()) {
    console.error("[login-history] new-device alert not sent — SMTP is not configured");
    return "no_smtp";
  }
  if (await overAlertCap(at)) {
    console.warn(
      `[login-history] new-device alert not sent — over ${LOGIN_ALERTS_PER_HOUR}/hour or ${LOGIN_ALERTS_PER_DAY}/day`
    );
    return "capped";
  }
  try {
    await sendNewDeviceLoginEmail(PASSWORD_OTP_EMAIL, {
      username: step.username,
      awaitingCode: step.outcome === "password_ok",
      at,
      device: deviceLabel(details.userAgent),
      ip: details.ip,
      location: details.location,
    });
    return "sent";
  } catch (error) {
    console.error("[login-history] new-device alert failed:", error);
    return "failed";
  }
}

/**
 * The work noteLoginEvent schedules. Each part stands alone: a step that could
 * not be stored still gets its email, and a failed email is still stored.
 * Also drops the steps older than the retention period.
 */
export async function recordLoginEvent(step: LoginStep, details: LoginRequestDetails, at: string): Promise<void> {
  const id = crypto.randomUUID();
  const due = loginAlertDue(step);
  let stored = false;
  try {
    await query(
      "INSERT INTO login_events (id, userId, username, outcome, method, newDevice, alert, attemptId, ip, location, userAgent, createdAt)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        step.userId,
        step.username,
        step.outcome,
        step.method,
        step.newDevice ? 1 : 0,
        due ? "pending" : null,
        step.attemptId,
        details.ip,
        details.location,
        details.userAgent,
        at,
      ]
    );
    stored = true;
  } catch (error) {
    console.error("[login-history] could not record a login:", error);
  }

  if (due) {
    const status = await sendAlert(step, details, at);
    if (stored) {
      try {
        await query("UPDATE login_events SET alert = ? WHERE id = ?", [status, id]);
      } catch (error) {
        console.error("[login-history] could not record the alert status:", error);
      }
    }
  }

  try {
    const cutoff = new Date(Date.parse(at) - LOGIN_HISTORY_RETENTION_DAYS * DAY_MS).toISOString();
    await query("DELETE FROM login_events WHERE createdAt < ?", [cutoff]);
  } catch (error) {
    console.error("[login-history] could not drop old records:", error);
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function stepOf(row: RowDataPacket): LoginStepRecord | null {
  const outcome = oneOf(row.outcome, LOGIN_OUTCOMES);
  const method = oneOf(row.method, LOGIN_METHODS);
  if (!outcome || !method) return null;
  return {
    id: String(row.id),
    userId: String(row.userId),
    username: String(row.username),
    outcome,
    method,
    newDevice: Number(row.newDevice) === 1,
    alert: oneOf(row.alert, LOGIN_ALERT_STATUSES),
    ip: row.ip ? String(row.ip) : null,
    location: row.location ? String(row.location) : null,
    device: deviceLabel(row.userAgent ? String(row.userAgent) : null),
    attemptId: row.attemptId ? String(row.attemptId) : null,
    createdAt: String(row.createdAt),
  };
}

/** The newest logins, every account, as /settings shows them. */
export async function listLoginHistory(): Promise<LoginHistoryEntry[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, userId, username, outcome, method, newDevice, alert, attemptId, ip, location, userAgent, createdAt" +
      ` FROM login_events ORDER BY createdAt DESC LIMIT ${LOGIN_HISTORY_LIST_LIMIT}`
  );
  return mergeLoginSteps(rows.map(stepOf).filter((s): s is LoginStepRecord => s !== null));
}
