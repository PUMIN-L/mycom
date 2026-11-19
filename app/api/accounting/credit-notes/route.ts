import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../lib/apiHelpers";
import { isValidDateString } from "../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { issueCreditNote, listCreditNotes } from "../../../lib/accounting/creditNotes";
import { cleanCreditNoteInput } from "../../../lib/accounting/creditRules";

// GET /api/accounting/credit-notes[?from=YYYY-MM-DD&to=YYYY-MM-DD&q=…] — credit
// notes, newest first, each with its invoice; `to` exclusive.
export const GET = withRoute("โหลดรายการใบลดหนี้ไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) throw new ApiError(400, "ช่วงวันที่ไม่ถูกต้อง");
  return noStoreJson(await listCreditNotes({ from, to, q: (params.get("q") || "").slice(0, 100) }));
});

// POST /api/accounting/credit-notes — { invoiceId, issueDate, reason, lines }:
// a credit note against an issued invoice, issued at once (its number given).
export const POST = withRoute("ออกใบลดหนี้ไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  return noStoreJson(await issueCreditNote(cleanCreditNoteInput(await request.json()), actor), { status: 201 });
});
