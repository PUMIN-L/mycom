import { NextRequest } from "next/server";
import { withRoute } from "../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { createBankAccount, listBankAccounts } from "../../../lib/accounting/settings";
import { bankAccountProblems, cleanBankAccount, firstProblem } from "../../../lib/accounting/sellerProfile";

// GET /api/accounting/bank-accounts — the accounts payments come into.
export const GET = withRoute("โหลดบัญชีธนาคารไม่สำเร็จ", async () => {
  await requireAccountingUser();
  return noStoreJson(await listBankAccounts());
});

// POST /api/accounting/bank-accounts — { bankName, accountNo, accountName }.
export const POST = withRoute("เพิ่มบัญชีธนาคารไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const input = cleanBankAccount((await request.json()) as Record<string, unknown>);
  const problems = bankAccountProblems(input);
  const first = firstProblem(problems);
  if (first) return noStoreJson({ error: first, fields: problems }, { status: 400 });
  return noStoreJson(await createBankAccount(input, actor), { status: 201 });
});
