import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getSetting,
  setSetting,
  MAINTENANCE_MODE_SETTING,
  isMaintenanceMode,
} from "../../../lib/settingsStore";
import { recordOtpFailure, clearOtpAttempts } from "../../../lib/otpAttempts";

// GET — public, no auth required. The MaintenanceOverlay component on every
// page polls this to decide whether to show the overlay.
export const GET = withRoute("โหลดสถานะโหมดปรับปรุงไม่สำเร็จ", async () => {
  const enabled = await isMaintenanceMode();
  return NextResponse.json({ enabled });
});

// PUT — admin-only. Verifies the OTP and toggles the flag.
export const PUT = withRoute(
  "สลับโหมดปรับปรุงไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();
    const providedOtp = String(body.otp ?? "").trim();

    if (!providedOtp || providedOtp.length !== 6) {
      return NextResponse.json(
        { error: "รหัส OTP ไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    // otp/expiresAt/enable live in ONE settings row so this is a single
    // consistent read — same pattern as company-profile OTP.
    const stateRaw = await getSetting("maintenance_otp_state");
    if (!stateRaw) {
      return NextResponse.json(
        { error: "ไม่มีคำขอเปลี่ยนโหมดปรับปรุง (OTP อาจจะหมดอายุแล้ว)" },
        { status: 400 }
      );
    }

    let state: { otp: string; expiresAt: number; enable: boolean };
    try {
      state = JSON.parse(stateRaw);
    } catch {
      return NextResponse.json(
        { error: "ข้อมูลที่รออนุมัติเสียหาย กรุณาขอรหัสใหม่" },
        { status: 400 }
      );
    }

    if (Date.now() > state.expiresAt) {
      return NextResponse.json(
        { error: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่" },
        { status: 400 }
      );
    }

    if (state.otp !== providedOtp) {
      const { locked } = await recordOtpFailure(
        "maintenance_otp",
        "maintenance_otp_legacy_expires_unused"
      );
      if (locked) await setSetting("maintenance_otp_state", "");
      return NextResponse.json(
        {
          error: locked
            ? "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่"
            : "รหัส OTP ไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    // OTP is correct — toggle the maintenance flag.
    await setSetting(
      MAINTENANCE_MODE_SETTING,
      state.enable ? "true" : "false"
    );

    // The flag is now read during SERVER render, so flipping the row is not
    // enough on its own:
    //   * "maintenance" busts the cached isMaintenanceMode() read;
    //   * every prerendered page holds a COPY of the flag in its HTML. The root
    //     layout reads it for the overlay, and Footer takes it as a prop on
    //     every page it appears on — which is deliberately more than the two
    //     paths the overlay blocks. /about and /catalog/layout are statically
    //     prerendered, so scoping this to MAINTENANCE_BLOCKED_PATHS would leave
    //     them serving the phone number and LINE id after maintenance was
    //     switched on, until the next deploy. "layout" on "/" invalidates the
    //     root layout and everything beneath it, which is exactly the blast
    //     radius of a flag read in that layout.
    revalidateTag("maintenance", { expire: 0 });
    revalidatePath("/", "layout");

    // Clean up: wipe the OTP state and reset the failure counter.
    await setSetting("maintenance_otp_state", "");
    await clearOtpAttempts("maintenance_otp");

    return NextResponse.json({
      enabled: state.enable,
      message: state.enable
        ? "เปิดโหมดปรับปรุงเว็บไซต์แล้ว"
        : "ปิดโหมดปรับปรุงเว็บไซต์แล้ว",
    });
  }
);
