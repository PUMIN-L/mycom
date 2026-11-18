import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../lib/apiHelpers";
import { isValidDateString } from "../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { createInvoiceDraft, listAccDocuments } from "../../../lib/accounting/documents";
import { cleanInvoiceInput } from "../../../lib/accounting/invoiceRules";
import type { AccDocType } from "../../../lib/accounting/types";

const LISTABLE: readonly AccDocType[] = ["INV", "RE", "BN", "CN", "SO"];

// GET /api/accounting/documents?type=INV[&from=YYYY-MM-DD&to=YYYY-MM-DD&q=…]
// — one type's list, newest first; `to` is exclusive.
export const GET = withRoute("โหลดรายการเอกสารไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  const type = (params.get("type") || "INV") as AccDocType;
  if (!LISTABLE.includes(type)) throw new ApiError(400, "ประเภทเอกสารไม่ถูกต้อง");
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) throw new ApiError(400, "ช่วงวันที่ไม่ถูกต้อง");
  const q = (params.get("q") || "").slice(0, 100);
  return noStoreJson(await listAccDocuments({ type, from, to, q }));
});

// POST /api/accounting/documents — a new invoice DRAFT (no number until issued).
export const POST = withRoute("บันทึกร่างเอกสารไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const input = cleanInvoiceInput(await request.json());
  return noStoreJson(await createInvoiceDraft(input, actor), { status: 201 });
});
