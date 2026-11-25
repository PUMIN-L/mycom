import "server-only";
import { randomInt, randomUUID, timingSafeEqual } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { getSetting, setSetting } from "../settingsStore";
import { claimOtpIssue, clearOtpAttempts, OTP_TOO_MANY_ATTEMPTS, resetOtpAttempts, takeOtpAttempt } from "../otpAttempts";
import { isMailConfigured } from "../mailer";
import { writeAudit } from "./audit";
import { DEFAULT_COMMISSION_RULES, FIRST_EFFECTIVE_MONTH, rateRulesProblems, type RateRules, type RateSet } from "./commission";
import { cleanRateChange, effectiveMonthLabel, rateChangeProblems, type RateChange } from "./commissionRateChange";
import { notifyRatesChanged, sendRatesCodeEmail } from "./commissionEmails";

// The commission rate table, stored (ARCHITECTURE.md §8h), schema v59.
//
// Sets by the month they start (the 1st — the owner's rule). Append-only:
// every save is a row and so is a removal; the newest row of a month is that
// month's set, so the history is the table itself. Nothing stored yet = the
// owner's table, from the beginning.
//
// Changed ONLY with a 6-digit code emailed to the owner's fixed inbox (the
// owner, 2026-11-25), the OTP rules of the rest of the site (otpAttempts.ts):
// asking stores the code WITH the change it is for — the code approves exactly
// what its email showed, whatever the confirming request carries; at most one
// code a minute and five an hour; a guess is taken before it is compared
// (five, the fifth wrong one wipes the code); the code is spent in the same
// transaction that saves, so two tabs with one code save once. After the save,
// the latest tables are emailed (a failure there never undoes the save).

interface Actor {
  userId: string;
  username: string;
}

export const RATES_OTP_TTL_MINUTES = 15;
const OTP_KEY = "commission_rates_otp";
const STATE_KEY = `${OTP_KEY}_state`;
const HISTORY_LIMIT = 50;

export interface RateSetView extends RateSet {
  /** When this set was last saved, and by whom — null for the owner's table nobody saved over. */
  savedAt: string | null;
  savedBy: string | null;
}

export interface RateHistoryEntry {
  id: string;
  effectiveMonth: string;
  removed: boolean;
  savedAt: string;
  savedBy: string;
}

export interface RatesState {
  /** The sets in force, in month order — always one from the beginning. */
  sets: RateSetView[];
  /** Every save and removal, newest first. */
  history: RateHistoryEntry[];
}

export async function loadRates(): Promise<RatesState> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, effectiveMonth, rulesJson, removed, createdAt, createdBy FROM acc_commission_rates ORDER BY createdAt ASC, id ASC LIMIT 2000"
  );
  const byMonth = new Map<string, RateSetView>();
  for (const r of rows) {
    const month = String(r.effectiveMonth);
    if (Number(r.removed) === 1) {
      byMonth.delete(month);
      continue;
    }
    let rules: RateRules | null = null;
    try {
      rules = JSON.parse(String(r.rulesJson)) as RateRules;
    } catch {
      rules = null;
    }
    if (!rules || rateRulesProblems(rules).length > 0) {
      console.error(`[commission] rate set ${String(r.id)} cannot be read — left out`);
      continue;
    }
    byMonth.set(month, { id: String(r.id), effectiveMonth: month, rules, savedAt: String(r.createdAt), savedBy: String(r.createdBy) });
  }
  if (!byMonth.has(FIRST_EFFECTIVE_MONTH)) {
    byMonth.set(FIRST_EFFECTIVE_MONTH, { id: null, effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: DEFAULT_COMMISSION_RULES, savedAt: null, savedBy: null });
  }
  const sets = [...byMonth.values()].sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : a.effectiveMonth > b.effectiveMonth ? 1 : 0));
  const history = [...rows]
    .reverse()
    .slice(0, HISTORY_LIMIT)
    .map((r) => ({
      id: String(r.id),
      effectiveMonth: String(r.effectiveMonth),
      removed: Number(r.removed) === 1,
      savedAt: String(r.createdAt),
      savedBy: String(r.createdBy),
    }));
  return { sets, history };
}

/** The sets in force, for working commissions out. */
export async function currentRateSets(): Promise<RateSet[]> {
  return (await loadRates()).sets.map(({ id, effectiveMonth, rules }) => ({ id, effectiveMonth, rules }));
}

/**
 * Emails a code for `change`. Refused (400) when the change is wrong, or
 * changes nothing — before a code is used up; 503 without mail; `allowed:
 * false` when codes are asked for too often. A code whose email failed is
 * withdrawn (502).
 */
export async function requestRatesCode(
  change: RateChange,
  actor: Actor
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const before = await currentRateSets();
  const problems = rateChangeProblems(change, before);
  if (problems.length > 0) throw new ApiError(400, problems[0]);
  if (!isMailConfigured()) throw new ApiError(503, "ระบบอีเมลยังไม่ได้ตั้งค่า จึงส่งรหัสยืนยันไม่ได้");
  const claim = await claimOtpIssue(OTP_KEY);
  if (!claim.allowed) return claim;
  const now = Date.now();
  const otp = randomInt(100000, 1000000).toString();
  await setSetting(STATE_KEY, JSON.stringify({ otp, expiresAt: now + RATES_OTP_TTL_MINUTES * 60 * 1000, pending: change, userId: actor.userId }));
  await resetOtpAttempts(OTP_KEY);
  try {
    await sendRatesCodeEmail({ otp, change, before, username: actor.username, at: new Date(now).toISOString(), minutes: RATES_OTP_TTL_MINUTES });
  } catch (error) {
    console.error("[commission] the rate code email failed:", error);
    await setSetting(STATE_KEY, "");
    throw new ApiError(502, "ส่งอีเมลรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่");
  }
  return { allowed: true };
}

const NO_REQUEST = "ไม่มีคำขอแก้ตารางอัตรา หรือรหัสหมดอายุแล้ว กรุณาขอรหัสใหม่";

function sameCode(expected: string, typed: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(typed);
  return a.length === b.length && timingSafeEqual(a, b);
}

function auditDetail(change: RateChange, before: readonly RateSet[]): string {
  const label = effectiveMonthLabel(change.effectiveMonth);
  if (change.kind === "remove") return `ลบตารางอัตราค่าคอม ${label}`;
  const isNew = change.effectiveMonth !== FIRST_EFFECTIVE_MONTH && !before.some((s) => s.effectiveMonth === change.effectiveMonth);
  return `${isNew ? "เพิ่ม" : "แก้"}ตารางอัตราค่าคอม ${label}`;
}

/**
 * The code typed: saves the change STORED with it (never anything the request
 * carries), spending the code in the same transaction, then emails the latest
 * tables — `summaryEmailSent` false when that email did not go.
 */
export async function confirmRatesChange(typed: unknown, actor: Actor): Promise<RatesState & { summaryEmailSent: boolean }> {
  if (typeof typed !== "string" || !/^\d{6}$/.test(typed.trim())) throw new ApiError(400, "กรุณากรอกรหัส 6 หลักจากอีเมล");
  const code = typed.trim();
  const raw = await getSetting(STATE_KEY);
  let state: { otp?: unknown; expiresAt?: unknown; pending?: unknown; userId?: unknown } | null = null;
  try {
    state = raw ? JSON.parse(raw) : null;
  } catch {
    state = null;
  }
  const pending = state ? cleanRateChange(state.pending) : null;
  if (!raw || !state || !pending || state.userId !== actor.userId || typeof state.otp !== "string" || !(Number(state.expiresAt) > Date.now())) {
    throw new ApiError(400, NO_REQUEST);
  }
  // The guess is taken BEFORE comparing, so a burst cannot get more than five.
  const attempt = await takeOtpAttempt(OTP_KEY);
  const wrong = !sameCode(state.otp, code);
  if (!attempt.allowed || (wrong && attempt.last)) {
    await setSetting(STATE_KEY, "");
    throw new ApiError(400, OTP_TOO_MANY_ATTEMPTS);
  }
  if (wrong) throw new ApiError(400, "รหัสยืนยันไม่ถูกต้อง");

  // The tables may have changed since the code was sent.
  const before = await currentRateSets();
  const problems = rateChangeProblems(pending, before);
  if (problems.length > 0) {
    await setSetting(STATE_KEY, "");
    throw new ApiError(409, problems[0]);
  }
  const at = new Date().toISOString();
  await withTransaction(async (conn) => {
    // Spent only if it is still the code that was read: two requests with it save once.
    const [result] = await conn.query<ResultSetHeader>("UPDATE settings SET value = '' WHERE name = ? AND value = ?", [STATE_KEY, raw]);
    if (result.affectedRows !== 1) throw new ApiError(409, "รหัสนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่");
    await conn.query(
      "INSERT INTO acc_commission_rates (id, effectiveMonth, rulesJson, removed, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), pending.effectiveMonth, pending.kind === "save" ? JSON.stringify(pending.rules) : "{}", pending.kind === "remove" ? 1 : 0, at, actor.username]
    );
    await writeAudit(conn, { ...actor, action: "commission.rates", detail: auditDetail(pending, before) });
  });
  await clearOtpAttempts(OTP_KEY);
  const now = await loadRates();
  const summaryEmailSent = await notifyRatesChanged({ change: pending, before, after: now.sets, username: actor.username, at });
  return { ...now, summaryEmailSent };
}
