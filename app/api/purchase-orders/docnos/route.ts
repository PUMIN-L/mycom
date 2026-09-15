import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, ApiError } from "../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import {
  listDocNosByBase,
  listRecentDocNos,
  type UsedDocNo,
} from "../../../lib/quotationStore";

// GET /api/purchase-orders/docnos (login required) — the reserved PO numbers.
//
// Deliberately reuses quotationStore's ledger functions rather than a second
// PO-specific implementation: `used_docnos` is the ONE shared ledger every
// document type in this app mints from (see quotationNumber.ts's header for
// why a windowed read is fine for warning about a duplicate but never for
// minting one, and quotationStore.ts's listDocNosByBase for why minting must
// use the non-windowed lookup).
//
// `?base=` may repeat (up to MAX_DOCNO_BASES) — same contract as
// /api/quotations/docnos.
const MAX_DOCNO_BASES = 4;

export const GET = withRoute(
  "โหลดเลขที่ที่ใช้แล้วไม่สำเร็จ",
  async (request?: NextRequest) => {
    await requireAuth();
    const bases = (request?.nextUrl?.searchParams.getAll("base") ?? [])
      .map((b) => sanitizePlainText(b).trim())
      .filter((b) => b.length > 0);

    if (bases.length === 0) {
      return NextResponse.json(await listRecentDocNos());
    }
    if (bases.length > MAX_DOCNO_BASES) {
      throw new ApiError(
        400,
        `ขอเลขที่ได้สูงสุด ${MAX_DOCNO_BASES} ชุดต่อหนึ่งคำขอ กรุณาแยกคำขอ`
      );
    }

    const unique = Array.from(new Set(bases));
    const lists = await Promise.all(unique.map((b) => listDocNosByBase(b)));
    const byDocNo = new Map<string, UsedDocNo>();
    for (const row of lists.flat()) {
      if (!byDocNo.has(row.docNo)) byDocNo.set(row.docNo, row);
    }
    return NextResponse.json(Array.from(byDocNo.values()));
  }
);
