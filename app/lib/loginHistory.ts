// Login history — the lines /settings shows, and the rule that builds them
// from the stored steps (lib/loginEvents.ts writes those). Pure, no server
// imports: the API builds the list with it and the settings page reads its
// types and labels.
//
// A login to a two-factor account is TWO requests, and each is stored as its
// own step: the password (outcome "password_ok") and then the code
// ("signed_in" by totp / backup). Shown as stored, every such login would be
// two lines, and the one line that matters — a right password that no code
// ever followed, i.e. someone who has the password but not the phone — would
// look like half of an ordinary login. mergeLoginSteps pairs them — by the
// login attempt id the pending token carries from one step to the other
// (lib/twoFactorPending.ts), never by time: one account can have several
// attempts open at once (a shared account, or a stranger with the password
// typing it while the owner logs in), and a guess by time joined the owner's
// code to the stranger's password step — leaving the warning line showing the
// OWNER's device and address.

export type LoginOutcome = "signed_in" | "password_ok";
/** What completed the step: the password alone, or a code after it. */
export type LoginMethod = "password" | "totp" | "backup";
/**
 * The new-device email for the step. null: none was due (a known browser, or
 * the code step — the email goes out at the password step only).
 */
export type LoginAlertStatus = "pending" | "sent" | "failed" | "capped" | "no_smtp";

export const LOGIN_OUTCOMES: readonly LoginOutcome[] = ["signed_in", "password_ok"];
export const LOGIN_METHODS: readonly LoginMethod[] = ["password", "totp", "backup"];
export const LOGIN_ALERT_STATUSES: readonly LoginAlertStatus[] = ["pending", "sent", "failed", "capped", "no_smtp"];

/** One stored step (a row of login_events), with the device already named. */
export interface LoginStepRecord {
  id: string;
  userId: string;
  username: string;
  outcome: LoginOutcome;
  method: LoginMethod;
  newDevice: boolean;
  alert: LoginAlertStatus | null;
  ip: string | null;
  location: string | null;
  /** "Chrome บน Windows" — see loginEvents.deviceLabel. */
  device: string;
  /** The login attempt: the same on a password step and its code step. */
  attemptId: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/** One line of the history. */
export interface LoginHistoryEntry {
  id: string;
  username: string;
  /** When it ended: the session was issued, or (awaiting_2fa) the password step. */
  at: string;
  /**
   * "signed_in": a session was issued. "awaiting_2fa": the password was right
   * on a two-factor account and no code followed (yet — the pending cookie
   * lives five minutes).
   */
  result: "signed_in" | "awaiting_2fa";
  method: LoginMethod;
  newDevice: boolean;
  alert: LoginAlertStatus | null;
  ip: string | null;
  location: string | null;
  device: string;
}

function entryOf(step: LoginStepRecord): LoginHistoryEntry {
  return {
    id: step.id,
    username: step.username,
    at: step.createdAt,
    result: step.outcome === "password_ok" ? "awaiting_2fa" : "signed_in",
    method: step.method,
    newDevice: step.newDevice,
    alert: step.alert,
    ip: step.ip,
    location: step.location,
    device: step.device,
  };
}

/**
 * The stored steps as history lines, newest first. A code step joins the
 * password step of the SAME login attempt (attemptId); the line takes its
 * time and device from the code step and its "new device" and email status
 * from the password step, where that email was decided. A password step
 * nothing joined stays a line of its own ("awaiting_2fa"). A code step whose
 * password step is not in `steps` (older than the list reaches, or never
 * stored) is shown as it is.
 */
export function mergeLoginSteps(steps: readonly LoginStepRecord[]): LoginHistoryEntry[] {
  const isCodeStep = (s: LoginStepRecord) => s.outcome === "signed_in" && s.method !== "password";
  const finished = new Set(steps.filter(isCodeStep).map((s) => s.attemptId).filter(Boolean));
  const passwordStepOf = new Map<string, LoginStepRecord>();
  for (const s of steps) if (s.outcome === "password_ok" && s.attemptId) passwordStepOf.set(s.attemptId, s);

  const entries: LoginHistoryEntry[] = [];
  for (const step of steps) {
    if (step.outcome === "password_ok") {
      // Shown through its code step when one came; as a line of its own otherwise.
      if (!step.attemptId || !finished.has(step.attemptId)) entries.push(entryOf(step));
      continue;
    }
    const passwordStep = isCodeStep(step) && step.attemptId ? passwordStepOf.get(step.attemptId) : undefined;
    entries.push(
      passwordStep ? { ...entryOf(step), newDevice: passwordStep.newDevice, alert: passwordStep.alert } : entryOf(step)
    );
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

/** "เข้าสู่ระบบสำเร็จ (รหัสผ่าน + รหัสจากแอป)", or the warning for a login left at its password step. */
export function loginResultLabel(entry: Pick<LoginHistoryEntry, "result" | "method">): string {
  if (entry.result === "awaiting_2fa") return "ใส่รหัสผ่านถูก แต่ไม่ได้ใส่รหัสยืนยัน 2 ขั้นต่อ";
  if (entry.method === "totp") return "เข้าสู่ระบบสำเร็จ (รหัสผ่าน + รหัสจากแอป)";
  if (entry.method === "backup") return "เข้าสู่ระบบสำเร็จ (รหัสผ่าน + รหัสสำรอง)";
  return "เข้าสู่ระบบสำเร็จ (รหัสผ่าน)";
}

/** What became of the new-device email; null when none was due. */
export function loginAlertLabel(alert: LoginAlertStatus | null): string | null {
  switch (alert) {
    case "sent":
      return "ส่งอีเมลแจ้งเตือนแล้ว";
    case "failed":
      return "ส่งอีเมลแจ้งเตือนไม่สำเร็จ";
    case "capped":
      return "ไม่ได้ส่งอีเมลแจ้งเตือน (แจ้งเตือนถี่เกินไป)";
    case "no_smtp":
      return "ไม่ได้ส่งอีเมลแจ้งเตือน (ยังไม่ได้ตั้งค่าอีเมลของระบบ)";
    case "pending":
      return "กำลังส่งอีเมลแจ้งเตือน";
    default:
      return null;
  }
}
