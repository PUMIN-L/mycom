import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { latestCompanyDefaults } from "../../../lib/quotationStore";
import { getCompanyProfile } from "../../../lib/settingsStore";

export const dynamic = "force-dynamic";

// GET — what a NEW quotation should start with in its "our company" lines
// (phone, e-mail, tax id): the latest values the saved quotations carried, and
// for the phone, the company profile's number when no quotation has one yet.
export const GET = withRoute("โหลดข้อมูลบริษัทไม่สำเร็จ", async () => {
  await requireAuth();
  const defaults = await latestCompanyDefaults();
  if (!defaults.companyPhone) {
    defaults.companyPhone = (await getCompanyProfile()).phone || "";
  }
  return NextResponse.json(defaults);
});
