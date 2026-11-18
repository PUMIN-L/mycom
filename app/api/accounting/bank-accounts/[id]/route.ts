import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { removeBankAccount, updateBankAccount } from "../../../../lib/accounting/settings";
import { bankAccountProblems, cleanBankAccount, firstProblem } from "../../../../lib/accounting/sellerProfile";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/accounting/bank-accounts/[id] — { bankName, accountNo, accountName, isActive }.
export const PUT = withRoute("แก้ไขบัญชีธนาคารไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const input = cleanBankAccount(body);
  const problems = bankAccountProblems(input);
  const first = firstProblem(problems);
  if (first) return noStoreJson({ error: first, fields: problems }, { status: 400 });
  // isActive only when sent as a yes/no: left out, the account stays as it is.
  const isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;
  const found = await updateBankAccount(id, { ...input, isActive }, actor);
  if (!found) return jsonError("ไม่พบบัญชีธนาคารนี้", 404);
  return noStoreJson({ success: true });
});

// DELETE /api/accounting/bank-accounts/[id] — removed; or, when a payment
// names it, only switched off (the answer says which).
export const DELETE = withRoute("ลบบัญชีธนาคารไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const outcome = await removeBankAccount(id, actor);
  if (outcome === "missing") return jsonError("ไม่พบบัญชีธนาคารนี้", 404);
  return noStoreJson({ outcome });
});
