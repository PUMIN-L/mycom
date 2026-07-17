import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getContactEmail,
  setSetting,
  CONTACT_EMAIL_SETTING,
} from "../../../lib/settingsStore";
import { isMailConfigured, sendContactRecipientChangedEmail } from "../../../lib/mailer";

// Admin-only: read/update where contact-form submissions are emailed.
// Both verbs require auth — the recipient address is operator config, not
// public data (the publicly displayed email lives in lib/contact.ts).

// Rejects <>"',; too — this value ends up in an SMTP To: header (mailer.ts).
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export const GET = withRoute("โหลดการตั้งค่าไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json({ email: await getContactEmail() });
});

export const PUT = withRoute(
  "บันทึกการตั้งค่าไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const { email } = await request.json();
    const value = String(email ?? "").trim();
    if (!value || value.length > 320 || !EMAIL_RE.test(value)) {
      return NextResponse.json(
        { error: "รูปแบบอีเมลไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const previous = await getContactEmail();
    await setSetting(CONTACT_EMAIL_SETTING, value);

    // On a real change, alert BOTH the old and new addresses. Best-effort: a
    // notification failure (e.g. SMTP unconfigured) must not fail the save.
    let notified = false;
    if (value !== previous && isMailConfigured()) {
      const recipients = Array.from(new Set([previous, value]));
      try {
        await sendContactRecipientChangedEmail(recipients, previous, value);
        notified = true;
      } catch (err) {
        console.error("Failed to send recipient-change notice:", err);
      }
    }

    return NextResponse.json({ email: value, changed: value !== previous, notified });
  }
);
