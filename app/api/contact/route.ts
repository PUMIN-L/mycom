import { NextRequest, NextResponse } from "next/server";
import { withRoute } from "../../lib/apiHelpers";
import { getContactEmail } from "../../lib/settingsStore";
import { sendContactEmail, isMailConfigured } from "../../lib/mailer";
import {
  saveContactMessage,
  markContactMessageEmailed,
} from "../../lib/contactMessageStore";

// Public contact-form endpoint. Validates, rate-limits, then emails the
// submission to the CMS-configured recipient (settings.contact_email).
//
// In-memory rate limit keyed on client IP. x-forwarded-for is spoofable, so
// this is spam mitigation, not a security boundary — worst case an attacker
// costs us a few emails. Entries are pruned per request and hard-capped.
const LIMIT_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TRACKED = 10_000;
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();

function prune(now: number) {
  for (const [key, rec] of rateLimitMap) {
    if (rec.expiresAt <= now) rateLimitMap.delete(key);
  }
  if (rateLimitMap.size > MAX_TRACKED) {
    let excess = rateLimitMap.size - MAX_TRACKED;
    for (const key of rateLimitMap.keys()) {
      if (excess-- <= 0) break;
      rateLimitMap.delete(key);
    }
  }
}

// Field caps — generous for real messages, tight enough to stop abuse.
const MAX_LEN = { name: 200, email: 320, subject: 300, message: 5000 } as const;
// Also rejects <>"',; — characters meaningful inside RFC 5322 address lists —
// as defense-in-depth against header address injection (mailer.ts).
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export const POST = withRoute(
  "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่",
  async (request: NextRequest) => {
    if (!isMailConfigured()) {
      // Surfaced when SMTP_USER/SMTP_PASS are missing — check /api/health.
      return NextResponse.json(
        { error: "ระบบส่งอีเมลยังไม่ถูกตั้งค่า กรุณาติดต่อผ่าน LINE" },
        { status: 503 }
      );
    }

    const now = Date.now();
    prune(now);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rec = rateLimitMap.get(ip);
    if (rec && rec.expiresAt > now && rec.count >= LIMIT_PER_WINDOW) {
      return NextResponse.json(
        { error: "ส่งข้อความบ่อยเกินไป กรุณารอสักครู่" },
        { status: 429 }
      );
    }

    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: "กรุณากรอกข้อมูลให้ครบทุกช่อง" },
        { status: 400 }
      );
    }
    if (
      name.length > MAX_LEN.name ||
      email.length > MAX_LEN.email ||
      subject.length > MAX_LEN.subject ||
      message.length > MAX_LEN.message
    ) {
      return NextResponse.json({ error: "ข้อความยาวเกินไป" }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "รูปแบบอีเมลไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    // Count the attempt before sending so failures still consume quota.
    rateLimitMap.set(ip, {
      count: (rec && rec.expiresAt > now ? rec.count : 0) + 1,
      expiresAt: rec && rec.expiresAt > now ? rec.expiresAt : now + WINDOW_MS,
    });

    // Persist the lead BEFORE sending, so an SMTP failure can never drop it.
    // If saving itself fails, withRoute turns it into a 500 (we genuinely
    // couldn't capture the lead) — the visitor can retry.
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await saveContactMessage({
      id,
      name,
      email,
      subject,
      message,
      createdAt,
      emailedOk: false,
    });

    // The lead is now safe. A send failure is logged and reported as
    // emailed:false, but the submission still succeeds (the admin sees it in the
    // inbox and can follow up) rather than 500-ing and telling the visitor it
    // failed.
    const to = await getContactEmail();
    let emailed = false;
    try {
      await sendContactEmail(to, { name, email, subject, message });
      emailed = true;
      await markContactMessageEmailed(id, true);
    } catch (err) {
      console.error("contact: lead saved but email delivery failed:", err);
    }

    return NextResponse.json({ success: true, emailed });
  }
);
