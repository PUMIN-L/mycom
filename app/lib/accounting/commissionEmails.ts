import "server-only";
import { formatDisplayDate, formatDisplayDateTime } from "../dateFormat";
import { renderEmail } from "../emailHtml";
import { isMailConfigured, sendSystemHtmlEmail } from "../mailer";
import { PASSWORD_OTP_EMAIL } from "../passwordReset";
import { COMMISSION_KIND_LABELS, type CommissionKind } from "./commission";

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
