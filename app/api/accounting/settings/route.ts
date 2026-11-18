import { NextRequest } from "next/server";
import { withRoute } from "../../../lib/apiHelpers";
import { requirePassword } from "../../../lib/twoFactorReauth";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import {
  getAccountingSettings,
  saveAccountingOptions,
  saveSellerProfile,
} from "../../../lib/accounting/settings";
import {
  cleanSellerProfile,
  creditDaysProblem,
  firstProblem,
  sellerProfileProblems,
  vatRateProblem,
} from "../../../lib/accounting/sellerProfile";

// GET /api/accounting/settings — our company as it prints, VAT, default
// credit and the bank accounts.
export const GET = withRoute("โหลดการตั้งค่าบัญชีไม่สำเร็จ", async () => {
  await requireAccountingUser();
  return noStoreJson(await getAccountingSettings());
});

// PUT /api/accounting/settings — { seller, vatRate, creditDays, password }.
// The password is asked again: this is what every tax invoice prints, and a
// stolen session must not be able to change it.
export const PUT = withRoute("บันทึกการตั้งค่าบัญชีไม่สำเร็จ", async (request: NextRequest) => {
  const { user, actor } = await requireAccountingUser();
  const body = (await request.json()) as Record<string, unknown>;

  const seller = cleanSellerProfile((body.seller ?? {}) as Record<string, unknown>);
  const problems: Record<string, string | undefined> = { ...sellerProfileProblems(seller) };
  const vat = vatRateProblem(body.vatRate);
  if (vat) problems.vatRate = vat;
  const credit = creditDaysProblem(body.creditDays);
  if (credit) problems.creditDays = credit;
  const first = firstProblem(problems);
  if (first) return noStoreJson({ error: first, fields: problems }, { status: 400 });

  const denied = await requirePassword(user, body.password);
  if (denied) return denied;

  await saveSellerProfile(seller, actor);
  await saveAccountingOptions({ vatRate: Number(body.vatRate), creditDays: Number(body.creditDays) }, actor);
  return noStoreJson(await getAccountingSettings());
});
