import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../lib/apiHelpers";
import { isValidDateString } from "../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { createBillingNote, listBillingNotes } from "../../../lib/accounting/billingNotes";
import { cleanBillingNoteInput } from "../../../lib/accounting/billingRules";

// GET /api/accounting/billing-notes[?from=YYYY-MM-DD&to=YYYY-MM-DD&q=…] —
// billing notes, newest first, each with how its invoices stand now; `to` exclusive.
export const GET = withRoute("โหลดรายการใบวางบิลไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) throw new ApiError(400, "ช่วงวันที่ไม่ถูกต้อง");
  return noStoreJson(await listBillingNotes({ from, to, q: (params.get("q") || "").slice(0, 100) }));
});

// POST /api/accounting/billing-notes — { companyId | buyerName, invoiceIds,
// issueDate, dueDate, note }: a billing note for one customer's open invoices,
// numbered at once.
export const POST = withRoute("ออกใบวางบิลไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  return noStoreJson(await createBillingNote(cleanBillingNoteInput(await request.json()), actor), { status: 201 });
});
