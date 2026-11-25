import "server-only";
import { formatDisplayDate, formatDisplayDateTime } from "../dateFormat";
import { renderEmail } from "../emailHtml";
import { isMailConfigured, sendSystemHtmlEmail } from "../mailer";
import { PASSWORD_OTP_EMAIL } from "../passwordReset";
import { COMMISSION_KIND_LABELS, type CommissionKind, type RateSet } from "./commission";
import { rateChangeTable, rateSetTable, type RateChange } from "./commissionRateChange";

// The commission module's emails (ARCHITECTURE.md §8h). They go to the owner's
// own inbox ONLY (the owner, 2026-11-25: "อีเมล ampumin@gmail.com เท่านั้น") —
// the fixed address the password codes use, which changes only with a deploy,
// never the contact email an admin session can change: an alert sent where the
// one it warns about can redirect it warns nobody.

export const COMMISSION_EMAIL = PASSWORD_OTP_EMAIL;

const IF_NOT_YOU = "ถ้าไม่ใช่คุณเป็นคนเปลี่ยน ให้ตรวจสอบความปลอดภัยของบัญชีผู้ดูแลระบบทันที";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** A PO's commission switched from one person to the other. */
export interface OwnerChange {
  customerPoNo: string;
  buyerName: string;
  issueDate: string;
  from: CommissionKind;
  to: CommissionKind;
  username: string;
  /** When — an ISO instant, shown in Thai time. */
  at: string;
}

/** What the owner is told when a PO changes hands — no money in it (the screen has the figures). */
export function commissionOwnerChangedEmail(c: OwnerChange): BuiltEmail {
  const to = COMMISSION_KIND_LABELS[c.to];
  const { html, text } = renderEmail({
    title: "เปลี่ยนค่าคอมของ PO",
    intro: "มีการเปลี่ยนว่า PO ใบนี้เป็นค่าคอมของใคร",
    blocks: [
      { kind: "change", label: "ค่าคอมของ", from: COMMISSION_KIND_LABELS[c.from], to },
      {
        kind: "facts",
        rows: [
          ["เลขที่ PO ลูกค้า", c.customerPoNo],
          ["ลูกค้า", c.buyerName],
          ["วันที่ PO", formatDisplayDate(c.issueDate)],
          ["เปลี่ยนโดย", c.username],
          ["เวลา", `${formatDisplayDateTime(c.at)} (เวลาไทย)`],
        ],
      },
      { kind: "note", text: "ค่าคอมของ PO ใบนี้ และของ PO ลูกค้าฟอร์ดใบอื่นในเดือนเดียวกัน อาจเปลี่ยนตาม ดูได้ที่หน้า ค่าคอมมิชชั่น ในระบบบัญชี" },
    ],
    warning: IF_NOT_YOU,
  });
  return { subject: `แจ้งเตือน: PO ${c.customerPoNo} เปลี่ยนเป็นค่าคอมของ ${to}`, html, text };
}

/** Sends `email` to the owner's inbox: false — never a throw — when mail is not set up or the send failed (logged). */
async function sendToOwner(email: BuiltEmail): Promise<boolean> {
  if (!isMailConfigured()) return false;
  try {
    await sendSystemHtmlEmail(COMMISSION_EMAIL, email.subject, email.html, email.text);
    return true;
  } catch (error) {
    console.error("[commission] email failed:", error);
    return false;
  }
}

export function notifyCommissionOwnerChanged(c: OwnerChange): Promise<boolean> {
  return sendToOwner(commissionOwnerChangedEmail(c));
}

// ── The rate table: the code, then what was saved ─────────────────────────────

export interface RatesCodeInput {
  otp: string;
  change: RateChange;
  /** The sets in force when the code was asked for — what the change is set against. */
  before: readonly RateSet[];
  username: string;
  at: string;
  minutes: number;
}

/** The 6-digit code — big, how long it lasts, and exactly the change it approves. */
export function commissionRatesCodeEmail(c: RatesCodeInput): BuiltEmail {
  const table = rateChangeTable(c.change, c.before);
  const { html, text } = renderEmail({
    title: "ยืนยันการแก้ตารางอัตราค่าคอมมิชชั่น",
    intro: "มีการขอแก้ตารางอัตราค่าคอมมิชชั่น ถ้าเป็นคุณเอง ให้นำรหัสด้านล่างไปกรอกในหน้าค่าคอมมิชชั่น",
    blocks: [
      { kind: "code", code: c.otp, note: `ใช้ได้ ${c.minutes} นาที และใช้ได้ครั้งเดียว · อย่าบอกรหัสนี้กับใคร` },
      {
        kind: "facts",
        rows: [
          ["ชุดที่จะเปลี่ยน", table.title],
          ["ขอโดย", c.username],
          ["เวลา", `${formatDisplayDateTime(c.at)} (เวลาไทย)`],
        ],
      },
      { kind: "table", title: table.title, head: table.head, rows: table.rows, alignRight: table.alignRight },
      { kind: "note", text: "รหัสนี้ยืนยันได้เฉพาะการเปลี่ยนที่แสดงในอีเมลฉบับนี้เท่านั้น" },
    ],
    warning: "ถ้าไม่ใช่คุณเป็นคนขอ อย่ากรอกรหัสนี้ที่ไหน และตรวจสอบความปลอดภัยของบัญชีผู้ดูแลระบบทันที",
  });
  return { subject: "[รหัสยืนยัน] แก้ตารางอัตราค่าคอมมิชชั่น", html, text };
}

export interface RatesChangedInput {
  change: RateChange;
  before: readonly RateSet[];
  /** The sets in force now. */
  after: readonly RateSet[];
  username: string;
  at: string;
}

/** After a change was saved: who, when, what changed — and every table now in force (the owner, 2026-11-25). */
export function commissionRatesChangedEmail(c: RatesChangedInput): BuiltEmail {
  const table = rateChangeTable(c.change, c.before);
  const { html, text } = renderEmail({
    title: "ตารางอัตราค่าคอมมิชชั่นถูกแก้แล้ว",
    intro: "สรุปตารางอัตราค่าคอมมิชชั่นล่าสุด หลังการแก้ครั้งนี้",
    blocks: [
      {
        kind: "facts",
        rows: [
          ["ชุดที่เปลี่ยน", table.title],
          ["แก้โดย", c.username],
          ["เวลา", `${formatDisplayDateTime(c.at)} (เวลาไทย)`],
        ],
      },
      { kind: "table", title: `สิ่งที่เปลี่ยน: ${table.title}`, head: table.head, rows: table.rows, alignRight: table.alignRight },
      { kind: "text", text: "ตารางที่ใช้อยู่ตอนนี้" },
      ...c.after.map((set) => {
        const t = rateSetTable(set);
        return { kind: "table" as const, title: t.title, head: t.head, rows: t.rows, alignRight: t.alignRight };
      }),
      { kind: "note", text: "ยอดค่าคอมที่บันทึกว่าจ่ายแล้ว ไม่เปลี่ยนตามตารางใหม่" },
    ],
    warning: IF_NOT_YOU,
  });
  return { subject: "แจ้งเตือน: ตารางอัตราค่าคอมมิชชั่นถูกแก้แล้ว", html, text };
}

/** The code email — it MUST go, so a failure throws (the code is then withdrawn). */
export async function sendRatesCodeEmail(c: RatesCodeInput): Promise<void> {
  const email = commissionRatesCodeEmail(c);
  await sendSystemHtmlEmail(COMMISSION_EMAIL, email.subject, email.html, email.text);
}

export function notifyRatesChanged(c: RatesChangedInput): Promise<boolean> {
  return sendToOwner(commissionRatesChangedEmail(c));
}
