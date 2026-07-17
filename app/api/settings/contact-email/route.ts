import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getContactEmail,
  setSetting,
  CONTACT_EMAIL_SETTING,
} from "../../../lib/settingsStore";

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
    await setSetting(CONTACT_EMAIL_SETTING, value);
    return NextResponse.json({ email: value });
  }
);
