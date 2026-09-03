import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { getCompanyProfile, updateCompanyProfile, getSetting, setSetting, type CompanyProfile } from "../../../lib/settingsStore";
import { recordOtpFailure, clearOtpAttempts } from "../../../lib/otpAttempts";
import { COMPANY_PROFILE_FIELD_LIMITS } from "../../../lib/companyProfileValidation";

export const GET = withRoute("โหลดข้อมูลบริษัทไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json(await getCompanyProfile());
});

export const PUT = withRoute("บันทึกข้อมูลบริษัทไม่สำเร็จ", async (request: NextRequest) => {
  await requireAuth();
  const body = await request.json();
  const providedOtp = String(body.otp ?? "").trim();

  if (!providedOtp || providedOtp.length !== 6) {
    return NextResponse.json({ error: "รหัส OTP ไม่ถูกต้อง" }, { status: 400 });
  }

  // otp/expiresAt/pending live in ONE settings row so this is a single
  // consistent read — three independent reads could otherwise interleave
  // with a second, superseding OTP request and let a stale OTP authorize a
  // pending change it was never issued for.
  const stateRaw = await getSetting("company_profile_otp_state");
  if (!stateRaw) {
    return NextResponse.json(
      { error: "ไม่มีคำขอเปลี่ยนข้อมูลบริษัท (OTP อาจจะหมดอายุแล้ว)" },
      { status: 400 }
    );
  }

  let state: { otp: string; expiresAt: number; pending: Partial<CompanyProfile> };
  try {
    state = JSON.parse(stateRaw);
  } catch {
    return NextResponse.json({ error: "ข้อมูลที่รออนุมัติเสียหาย กรุณาขอรหัสใหม่" }, { status: 400 });
  }

  if (Date.now() > state.expiresAt) {
    return NextResponse.json({ error: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่" }, { status: 400 });
  }

  if (state.otp !== providedOtp) {
    // The 2nd arg only needs a key name recordOtpFailure can wipe on
    // lockout — the real combined state is cleared explicitly below instead,
    // since its "0" numeric-expiry wipe format doesn't fit the JSON blob here.
    const { locked } = await recordOtpFailure("company_profile_otp", "company_profile_otp_legacy_expires_unused");
    if (locked) await setSetting("company_profile_otp_state", "");
    return NextResponse.json(
      { error: locked ? "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่" : "รหัส OTP ไม่ถูกต้อง" },
      { status: 400 }
    );
  }

  // Defensive re-check: only apply keys this route actually recognizes, in
  // case the stored JSON predates a field-set change.
  const safePartial: Partial<CompanyProfile> = {};
  for (const field of Object.keys(COMPANY_PROFILE_FIELD_LIMITS) as (keyof CompanyProfile)[]) {
    if (state.pending[field] !== undefined) safePartial[field] = state.pending[field];
  }

  await updateCompanyProfile(safePartial);
  revalidateTag("company-info", { expire: 0 });

  await setSetting("company_profile_otp_state", "");
  await clearOtpAttempts("company_profile_otp");

  return NextResponse.json(await getCompanyProfile());
});
