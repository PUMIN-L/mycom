import { after, NextRequest, NextResponse } from "next/server";
import { withRoute } from "../../../../lib/apiHelpers";
import { clientKey } from "../../../../lib/rateLimit";
import { isMailConfigured, sendPasswordOtpEmail } from "../../../../lib/mailer";
import {
  findUserByUsername,
  issuePasswordOtp,
  PASSWORD_RESET_SENT_MESSAGE,
  PASSWORD_OTP_EMAIL,
  PASSWORD_OTP_TTL_MINUTES,
  passwordResetIpLimiter,
} from "../../../../lib/passwordReset";

// POST /api/auth/forgot-password/otp — step one of "ลืมรหัสผ่าน", PUBLIC.
//
// Body: { username }. Emails a 6-digit code for that account to the fixed
// address (lib/passwordReset.ts) — never to anything the requester types.
//
// The answer is the SAME whether the account exists or not, and whether a
// code went out or the issue throttle (one a minute, five an hour) held it
// back: anything else would tell a stranger which usernames are real. The
// admin learns the outcome from the inbox; the page says to wait a minute
// and ask again if nothing arrives. A failed send is logged, not reported,
// for the same reason.
//
// It takes the same TIME too: issuing the code and sending the email run in
// after(), once the response has gone. Done before it, a real username was
// answered a second or two later than a made-up one — the SMTP round trip —
// which said the same thing as a different message would have.
export const POST = withRoute(
  "ส่งรหัส OTP ไม่สำเร็จ",
  async (request: NextRequest) => {
    const ipLimit = passwordResetIpLimiter.check(clientKey(request));
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "มีการขอจากเครือข่ายนี้บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const body: unknown = await request.json();
    const username = (body as { username?: unknown } | null)?.username;
    if (typeof username !== "string" || !username || username.length > 100) {
      return NextResponse.json({ error: "กรุณากรอกชื่อผู้ใช้ (username)" }, { status: 400 });
    }
    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "ระบบอีเมลยังไม่ได้ตั้งค่า จึงไม่สามารถส่งรหัสได้ กรุณาติดต่อผู้ดูแลระบบ" },
        { status: 503 }
      );
    }

    const user = await findUserByUsername(username);
    if (user) {
      after(async () => {
        try {
          const issue = await issuePasswordOtp("reset", user.id);
          if (issue.allowed) {
            await sendPasswordOtpEmail(PASSWORD_OTP_EMAIL, issue.otp, "reset", user.username, PASSWORD_OTP_TTL_MINUTES);
          }
        } catch (error) {
          console.error("[forgot-password] issuing or emailing the code failed:", error);
        }
      });
    }
    return NextResponse.json({ success: true, message: PASSWORD_RESET_SENT_MESSAGE });
  }
);
