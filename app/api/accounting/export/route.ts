import { NextRequest } from "next/server";
import { withRoute } from "../../../lib/apiHelpers";
import { requirePassword } from "../../../lib/twoFactorReauth";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { writeAudit } from "../../../lib/accounting/audit";
import { monthlyWorkbookData } from "../../../lib/accounting/exportData";
import { accountantWorkbook, monthLabel, monthRange } from "../../../lib/accounting/exportRules";

// POST /api/accounting/export — { month: "YYYY-MM", password }: the month's
// workbook for the accountant (sales tax, the register, payments, withholding,
// receivables and deposits) as sheets of rows; the browser writes the .xlsx.
// Everything the company declares in one file: the password again first (the
// month checked before it, so a slip spends no try), and a line in the audit log.
export const POST = withRoute("ส่งออก Excel ไม่สำเร็จ", async (request: NextRequest) => {
  const { user, actor } = await requireAccountingUser();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const month = typeof body?.month === "string" ? body.month : "";
  if (!monthRange(month)) return noStoreJson({ error: "กรุณาเลือกเดือน" }, { status: 400 });
  const denied = await requirePassword(user, body?.password);
  if (denied) return denied;
  const workbook = accountantWorkbook(await monthlyWorkbookData(month));
  await writeAudit(null, { ...actor, action: "data.export", detail: `ส่งออก Excel สำหรับนักบัญชี เดือน ${monthLabel(month)}` });
  return noStoreJson(workbook);
});
