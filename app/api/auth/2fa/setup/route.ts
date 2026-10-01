import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { beginTotpSetup, TWO_FACTOR_ISSUER } from "../../../../lib/twoFactor";
import { otpauthUri } from "../../../../lib/totp";
import { NO_STORE } from "../../../../lib/twoFactorReauth";

// POST /api/auth/2fa/setup (login required) — start turning 2FA on: a fresh
// secret, stored as PENDING (logging in is unchanged until it is confirmed),
// returned as a QR code for the authenticator app plus the same secret as
// text for typing in by hand.
//
// ⚠️ The QR code is drawn HERE, by the `qrcode` package, never by an online
// QR service (like the api.qrserver.com one the LINE QR uses): this image IS
// the secret, and sending it to a third party would hand it over.
//
// No password is asked yet — a pending secret changes nothing. It is asked at
// /enable, the step that does.
export const POST = withRoute(
  "เริ่มตั้งค่าการยืนยันตัวตน 2 ขั้นไม่สำเร็จ",
  // No parameter: nothing is read from the request. withRoute still receives
  // it at runtime, so the same-origin guard applies all the same.
  async () => {
    const session = await requireAuth();
    const secret = await beginTotpSetup(session.userId);
    if (!secret) {
      return NextResponse.json(
        { error: "เปิดการยืนยันตัวตน 2 ขั้นอยู่แล้ว ต้องปิดก่อนจึงจะตั้งค่าใหม่ได้" },
        { status: 409 }
      );
    }
    const qrDataUrl = await QRCode.toDataURL(otpauthUri(secret, session.username, TWO_FACTOR_ISSUER), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });
    return NextResponse.json({ secret, qrDataUrl }, { headers: NO_STORE });
  }
);
