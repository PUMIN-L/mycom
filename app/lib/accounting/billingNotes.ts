import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { bangkokDateString, formatDisplayDate } from "../dateFormat";
import { allocateDocNo } from "./numbering";
import { writeAudit } from "./audit";
import { getSellerProfile } from "./settings";
import { formatSatang } from "./money";
import { getAccDocument, likeEscape, type AccDocument } from "./documents";
import { recomputePaidSatang, syncSaleReceiptRef } from "./paymentLedger";
import {
  BILLING_LIMITS,
  billedOutstandingSatang,
  billingNoteProblems,
  billingStatusOf,
  firstBillingProblem,
  spreadBillingPayment,
  type BilledInvoice,
  type BillingNoteInput,
  type BillingStatus,
} from "./billingRules";
import { firstPaymentProblem, methodLabel, paymentProblems, receiptTitle, serviceBaseSatang, type PaymentInput } from "./paymentRules";
import { assertBankAccountUsable, insertPaymentTx, insertReceiptTx, listPaymentsWhere, vatOnLivePayments, type AccPayment } from "./payments";

// Billing notes (ใบวางบิล, docType BN) — step 7, ARCHITECTURE.md §8g.
//
// A BN gets its number when it is made (BN + month + running number; not a
// tax document) and lists the invoices it bills in `acc_billing_items`, with
// what each owed then. Money received against it is spread over those
// invoices, oldest first — one payment row per invoice (`billingNoteId`, one
// `groupId`), under ONE receipt, two when goods and services are mixed (the
// services' receipt is the tax invoice). Each row keeps its share of its
// invoice's VAT (`vatSatang`), as a receipt covering several invoices cannot.
//
// Locks: the billing note first, then its invoices (in one statement), then
// their payments and receipts. Voiding the group and deleting its receipt take
// the billing note first too, so they queue behind each other.

interface Actor {
  userId: string;
  username: string;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;

type Exec = Pick<PoolConnection, "query"> | null;
async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

// ── Open invoices to bill ────────────────────────────────────────────────────

export interface OpenInvoice {
  id: string;
  docNo: string | null;
  issueDate: string;
  dueDate: string | null;
  totalSatang: number;
  paidSatang: number;
  outstandingSatang: number;
  /** Open billing notes it is on already (it may be billed again — a lost one). */
  billedOn: { id: string; docNo: string | null }[];
}

/** A customer's invoices still owing, oldest first — by the customer record, or the printed name for one typed by hand. */
export async function openInvoicesFor(customer: { companyId: string; buyerName: string }): Promise<OpenInvoice[]> {
  const byCompany = Boolean(customer.companyId);
  const name = customer.buyerName.trim().toLowerCase();
  if (!byCompany && !name) return [];
  const rows = await run(
    null,
    `SELECT id, docNo, issueDate, dueDate, totalSatang, paidSatang FROM acc_documents
      WHERE docType = 'INV' AND status = 'issued' AND paidSatang < totalSatang
        AND ${byCompany ? "companyId = ?" : "(companyId IS NULL OR companyId = '') AND LOWER(TRIM(buyerName)) = ?"}
      ORDER BY issueDate ASC, docNo ASC LIMIT 500`,
    [byCompany ? customer.companyId : name]
  );
  const ids = rows.map((r) => String(r.id));
  const billed = new Map<string, { id: string; docNo: string | null }[]>();
  if (ids.length > 0) {
    const refs = await run(
      null,
      `SELECT bi.invoiceId, b.id, b.docNo FROM acc_billing_items bi JOIN acc_documents b ON b.id = bi.billingNoteId
        WHERE bi.invoiceId IN (${marks(ids.length)}) AND b.status = 'issued'`,
      ids
    );
    for (const r of refs) {
      const key = String(r.invoiceId);
      billed.set(key, [...(billed.get(key) ?? []), { id: String(r.id), docNo: strOrNull(r.docNo) }]);
    }
  }
  return rows.map((r) => ({
    id: String(r.id),
    docNo: strOrNull(r.docNo),
    issueDate: str(r.issueDate),
    dueDate: strOrNull(r.dueDate),
    totalSatang: num(r.totalSatang),
    paidSatang: num(r.paidSatang),
    outstandingSatang: Math.max(0, num(r.totalSatang) - num(r.paidSatang)),
    billedOn: billed.get(String(r.id)) ?? [],
  }));
}

// ── Make / cancel ────────────────────────────────────────────────────────────

const sameName = (a: unknown, b: unknown) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();

/**
 * Makes a billing note for one customer's open invoices: its number, the
 * customer as on the latest of them, what each owes now (read under their
 * locks), in ONE transaction.
 */
export async function createBillingNote(input: BillingNoteInput, actor: Actor): Promise<AccDocument> {
  const problem = firstBillingProblem(billingNoteProblems(input));
  if (problem) throw new ApiError(400, problem);
  // It prints our company as it is now — and keeps pointing at that version.
  const { versionId } = await getSellerProfile();
  if (!versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร — ไปที่ ตั้งค่าบัญชี ก่อน");
  const id = await withTransaction(async (conn) => {
    const rows = await run(
      conn,
      `SELECT id, docType, status, docNo, issueDate, companyId, customerId, salespersonId, buyerName, buyerAddress, buyerTaxId, buyerBranch,
              vatRate, totalSatang, paidSatang
         FROM acc_documents WHERE id IN (${marks(input.invoiceIds.length)}) FOR UPDATE`,
      input.invoiceIds
    );
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const invoices = input.invoiceIds.map((invoiceId) => {
      const r = byId.get(invoiceId);
      if (!r || r.docType !== "INV") throw new ApiError(404, "ไม่พบใบแจ้งหนี้บางใบ — กรุณาเปิดหน้านี้ใหม่");
      if (r.status !== "issued") throw new ApiError(409, `ใบแจ้งหนี้ ${str(r.docNo) || "ร่าง"} ยังไม่ได้ออกหรือถูกยกเลิกแล้ว`);
      if (num(r.paidSatang) >= num(r.totalSatang)) throw new ApiError(409, `ใบแจ้งหนี้ ${str(r.docNo)} ชำระครบแล้ว`);
      const ours = input.companyId ? str(r.companyId) === input.companyId : !str(r.companyId) && sameName(r.buyerName, input.buyerName);
      if (!ours) throw new ApiError(400, `ใบแจ้งหนี้ ${str(r.docNo)} เป็นของลูกค้ารายอื่น — ใบวางบิลหนึ่งใบเป็นของลูกค้ารายเดียว`);
      return r;
    });
    // The customer as printed on the latest of the invoices.
    const latest = [...invoices].sort((a, b) => str(b.issueDate).localeCompare(str(a.issueDate)))[0];
    const amounts = invoices.map((r) => num(r.totalSatang) - num(r.paidSatang));
    const total = amounts.reduce((s, a) => s + a, 0);
    const docNo = await allocateDocNo(conn, "BN", input.issueDate);
    const docId = crypto.randomUUID();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      id: docId,
      docType: "BN",
      docNo,
      status: "issued",
      source: "internal",
      isTaxInvoice: 0,
      issueDate: input.issueDate,
      dueDate: input.dueDate || null,
      creditDays: 0,
      companyId: strOrNull(latest.companyId),
      customerId: strOrNull(latest.customerId),
      salespersonId: strOrNull(latest.salespersonId),
      buyerName: str(latest.buyerName),
      buyerAddress: str(latest.buyerAddress),
      buyerTaxId: str(latest.buyerTaxId),
      buyerBranch: str(latest.buyerBranch),
      sellerVersionId: versionId,
      priceMode: "exclusive",
      vatRate: num(latest.vatRate),
      totalSatang: total,
      note: input.note,
      issuedAt: now,
      issuedBy: actor.username,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
    };
    const keys = Object.keys(row);
    await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
    const cols = ["id", "billingNoteId", "invoiceId", "sortOrder", "amountSatang"];
    await conn.query(
      `INSERT INTO acc_billing_items (${cols.join(", ")}) VALUES ${invoices.map(() => `(${marks(cols.length)})`).join(", ")}`,
      invoices.flatMap((r, i) => [crypto.randomUUID(), docId, String(r.id), i, amounts[i]])
    );
    await writeAudit(conn, {
      ...actor,
      action: "doc.issue",
      documentId: docId,
      docNo,
      detail: `ออกใบวางบิล · ${str(latest.buyerName)} · ${invoices.length} ใบแจ้งหนี้ · ${formatSatang(total)} บาท${input.dueDate ? ` · นัดชำระ ${formatDisplayDate(input.dueDate)}` : ""}`,
    });
    return docId;
  });
  return (await getAccDocument(id))!;
}

export const BILLING_VOID_REASON_MAX = BILLING_LIMITS.voidReason;

/** Cancels a billing note — with a reason; refused once money was received against it (void that first). */
export async function voidBillingNote(id: string, reasonText: string, actor: Actor): Promise<AccDocument> {
  const reason = String(reasonText ?? "").trim();
  if (!reason) throw new ApiError(400, "กรุณาบอกเหตุผลที่ยกเลิก");
  if (reason.length > BILLING_LIMITS.voidReason) throw new ApiError(400, `เหตุผลยาวเกิน ${BILLING_LIMITS.voidReason} ตัวอักษร`);
  await withTransaction(async (conn) => {
    const [bn] = await run(conn, "SELECT docType, status, docNo FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
    if (!bn || bn.docType !== "BN") throw new ApiError(404, "ไม่พบใบวางบิลนี้");
    if (bn.status === "void") throw new ApiError(409, "ใบวางบิลนี้ถูกยกเลิกไปแล้ว");
    const [live] = await run(conn, "SELECT COUNT(*) AS n FROM acc_payments WHERE billingNoteId = ? AND voidedAt IS NULL FOR UPDATE", [id]);
    if (num(live?.n) > 0) throw new ApiError(409, "ใบวางบิลนี้มีการรับชำระแล้ว — ยกเลิกรายการรับชำระก่อนจึงจะยกเลิกได้");
    const now = new Date().toISOString();
    await conn.query("UPDATE acc_documents SET status = 'void', voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ? WHERE id = ?", [reason, now, actor.username, now, id]);
    await writeAudit(conn, { ...actor, action: "doc.void", documentId: id, docNo: strOrNull(bn.docNo), detail: `ยกเลิกใบวางบิล · เหตุผล: ${reason}` });
  });
  return (await getAccDocument(id))!;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface BillingNoteRow {
  id: string;
  docNo: string | null;
  status: string;
  billingStatus: BillingStatus;
  issueDate: string;
  dueDate: string | null;
  buyerName: string;
  totalSatang: number;
  /** What its invoices still owe now. */
  outstandingSatang: number;
  invoiceCount: number;
}

/** Billed invoices of `noteIds`, with how they stand now — read in one go. */
async function itemsOf(noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, { invoiceId: string; billedSatang: number; totalSatang: number; paidSatang: number; status: string }[]>();
  const rows = await run(
    null,
    `SELECT bi.billingNoteId, bi.invoiceId, bi.amountSatang, i.totalSatang, i.paidSatang, i.status
       FROM acc_billing_items bi JOIN acc_documents i ON i.id = bi.invoiceId
      WHERE bi.billingNoteId IN (${marks(noteIds.length)}) ORDER BY bi.sortOrder ASC`,
    noteIds
  );
  const of = new Map<string, { invoiceId: string; billedSatang: number; totalSatang: number; paidSatang: number; status: string }[]>();
  for (const r of rows) {
    const key = String(r.billingNoteId);
    of.set(key, [
      ...(of.get(key) ?? []),
      { invoiceId: String(r.invoiceId), billedSatang: num(r.amountSatang), totalSatang: num(r.totalSatang), paidSatang: num(r.paidSatang), status: str(r.status) },
    ]);
  }
  return of;
}

/** Billing notes, newest first — in [from, to) by date when given, matching `q` (number, customer). */
export async function listBillingNotes(opts: { from?: string; to?: string; q?: string }): Promise<BillingNoteRow[]> {
  const where = ["docType = 'BN'"];
  const params: unknown[] = [];
  if (opts.from) {
    where.push("issueDate >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("issueDate < ?");
    params.push(opts.to);
  }
  const q = (opts.q ?? "").trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push("(docNo LIKE ? ESCAPE '!' OR buyerName LIKE ? ESCAPE '!')");
    params.push(like, like);
  }
  const rows = await run(
    null,
    `SELECT id, docNo, status, issueDate, dueDate, buyerName, totalSatang FROM acc_documents WHERE ${where.join(" AND ")} ORDER BY issueDate DESC, docNo DESC LIMIT 1000`,
    params
  );
  const items = await itemsOf(rows.map((r) => String(r.id)));
  return rows.map((r) => {
    const its = items.get(String(r.id)) ?? [];
    return {
      id: String(r.id),
      docNo: strOrNull(r.docNo),
      status: str(r.status),
      billingStatus: billingStatusOf({ status: str(r.status) }, its),
      issueDate: str(r.issueDate),
      dueDate: strOrNull(r.dueDate),
      buyerName: str(r.buyerName),
      totalSatang: num(r.totalSatang),
      outstandingSatang: its.reduce((s, i) => s + (i.status === "issued" ? Math.max(0, i.totalSatang - i.paidSatang) : 0), 0),
      invoiceCount: its.length,
    };
  });
}

export interface BillingNoteInvoice extends BilledInvoice {
  docNo: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  /** What it owed when billed. */
  billedSatang: number;
  outstandingSatang: number;
}

export interface BillingNoteDetail {
  note: AccDocument;
  billingStatus: BillingStatus;
  invoices: BillingNoteInvoice[];
  /** What its invoices still owe now — the most a payment against it may be. */
  outstandingSatang: number;
  /** Money received against it (live). */
  receivedSatang: number;
  /** The payments received against it — voided ones too — and the receipts they got. */
  payments: AccPayment[];
  defaultWhtPercent: number;
}

/** A billing note's invoices with how each stands now — `conn` reads them locked, in the note's order. */
async function billedInvoices(conn: Exec, noteId: string): Promise<BillingNoteInvoice[]> {
  const items = await run(null, "SELECT invoiceId, amountSatang FROM acc_billing_items WHERE billingNoteId = ? ORDER BY sortOrder ASC", [noteId]);
  if (items.length === 0) return [];
  const ids = items.map((r) => String(r.invoiceId));
  const rows = await run(
    conn,
    `SELECT id, docNo, status, issueDate, dueDate, isTaxInvoice, totalSatang, vatSatang, vatBaseSatang, paidSatang
       FROM acc_documents WHERE id IN (${marks(ids.length)})${conn ? " FOR UPDATE" : ""}`,
    ids
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const lines = await run(null, `SELECT documentId, lineType, amountSatang FROM acc_document_lines WHERE documentId IN (${marks(ids.length)})`, ids);
  const linesOf = new Map<string, { lineType: string; amountSatang: number }[]>();
  for (const l of lines) linesOf.set(String(l.documentId), [...(linesOf.get(String(l.documentId)) ?? []), { lineType: str(l.lineType), amountSatang: num(l.amountSatang) }]);
  return items.flatMap((it) => {
    const r = byId.get(String(it.invoiceId));
    if (!r) return [];
    const total = num(r.totalSatang);
    const paid = num(r.paidSatang);
    return [
      {
        id: String(r.id),
        docNo: strOrNull(r.docNo),
        status: str(r.status),
        issueDate: str(r.issueDate),
        dueDate: strOrNull(r.dueDate),
        billedSatang: num(it.amountSatang),
        totalSatang: total,
        vatSatang: num(r.vatSatang),
        paidSatang: paid,
        vatPaidSatang: 0,
        outstandingSatang: r.status === "issued" ? Math.max(0, total - paid) : 0,
        serviceBaseSatang: serviceBaseSatang({ vatBaseSatang: num(r.vatBaseSatang), lines: linesOf.get(String(r.id)) ?? [] }),
        receiptIsTaxInvoice: Number(r.isTaxInvoice) !== 1,
      },
    ];
  });
}

export async function billingNoteDetail(id: string): Promise<BillingNoteDetail | null> {
  const note = await getAccDocument(id);
  if (!note || note.docType !== "BN") return null;
  const invoices = await billedInvoices(null, id);
  const payments = await listPaymentsWhere("p.billingNoteId = ?", [id]);
  let defaultWhtPercent = 0;
  if (note.companyId) {
    const [company] = await run(null, "SELECT whtPercent FROM companies WHERE id = ? LIMIT 1", [note.companyId]);
    defaultWhtPercent = num(company?.whtPercent);
  }
  return {
    note,
    billingStatus: billingStatusOf(note, invoices),
    invoices,
    outstandingSatang: note.status === "issued" ? billedOutstandingSatang(invoices.filter((i) => i.status === "issued")) : 0,
    receivedSatang: payments.filter((p) => !p.voidedAt).reduce((s, p) => s + p.amountSatang, 0),
    payments,
    defaultWhtPercent,
  };
}

// ── Money received against it ───────────────────────────────────────────────

export interface RecordedBillingPayment {
  receipts: { id: string; docNo: string; title: string }[];
  groupId: string;
}

/**
 * Money received against a billing note: spread over its invoices that still
 * owe (in its order), one payment row each, under one receipt per kind (a
 * plain one for goods, the tax invoice for services) — unless an outside
 * receipt's number is given. All in ONE transaction, under the note's lock
 * and its invoices' locks; never more than they owe now.
 */
export async function recordBillingPayment(noteId: string, input: PaymentInput, actor: Actor): Promise<RecordedBillingPayment> {
  const detail = await billingNoteDetail(noteId);
  if (!detail) throw new ApiError(404, "ไม่พบใบวางบิลนี้");
  if (detail.note.status !== "issued") throw new ApiError(409, "ใบวางบิลนี้ถูกยกเลิกแล้ว — รับชำระไม่ได้");
  const problem = firstPaymentProblem(paymentProblems(input, { outstandingSatang: detail.outstandingSatang, today: bangkokDateString(new Date()) }));
  if (problem) throw new ApiError(400, problem);
  await assertBankAccountUsable(input.bankAccountId);
  const issuing = !input.externalReceiptNo;
  const versionId = issuing ? (await getSellerProfile()).versionId : null;
  if (issuing && !versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนใบเสร็จ — ไปที่ ตั้งค่าบัญชี ก่อน");
  const note = detail.note;

  return withTransaction(async (conn) => {
    const [bn] = await run(conn, "SELECT status FROM acc_documents WHERE id = ? FOR UPDATE", [noteId]);
    if (!bn || bn.status !== "issued") throw new ApiError(409, "ใบวางบิลนี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่");
    const invoices = (await billedInvoices(conn, noteId)).filter((i) => i.status === "issued");
    if (invoices.length === 0) throw new ApiError(409, "ใบแจ้งหนี้ในใบวางบิลนี้ไม่มียอดค้างชำระแล้ว");
    const ids = invoices.map((i) => i.id);
    const live = await run(
      conn,
      `SELECT id, documentId, amountSatang, receiptId, vatSatang FROM acc_payments WHERE documentId IN (${marks(ids.length)}) AND voidedAt IS NULL FOR UPDATE`,
      ids
    );
    for (const inv of invoices) {
      const own = live.filter((p) => String(p.documentId) === inv.id);
      inv.paidSatang = own.reduce((s, p) => s + num(p.amountSatang), 0);
      inv.vatPaidSatang = await vatOnLivePayments(conn, own, inv);
    }
    const owed = billedOutstandingSatang(invoices);
    if (input.amountSatang > owed) {
      throw new ApiError(409, owed > 0 ? `ยอดเกินยอดค้างชำระของใบวางบิล — ตอนนี้ค้างอยู่ ${formatSatang(owed)} บาท` : "ใบแจ้งหนี้ในใบวางบิลนี้ไม่มียอดค้างชำระแล้ว");
    }
    const shares = spreadBillingPayment(invoices, input);
    const now = new Date().toISOString();
    const groupId = crypto.randomUUID();

    // One receipt per kind: the goods' plain receipt, the services' tax invoice.
    const receiptOf = new Map<boolean, { id: string; docNo: string; title: string }>();
    if (issuing) {
      for (const kind of [false, true]) {
        const mine = shares.filter((s) => s.receiptIsTaxInvoice === kind);
        if (mine.length === 0) continue;
        const amount = mine.reduce((s, x) => s + x.amountSatang, 0);
        const receipt = await insertReceiptTx(conn, {
          pays: note,
          relatedDocId: noteId,
          paidDate: input.paidDate,
          amountSatang: amount,
          vatSatang: mine.reduce((s, x) => s + x.vatSatang, 0),
          isTaxInvoice: kind,
          versionId: versionId!,
          actor,
          now,
        });
        const title = receiptTitle(kind);
        receiptOf.set(kind, { ...receipt, title });
        await writeAudit(conn, {
          ...actor,
          action: "doc.issue",
          documentId: receipt.id,
          docNo: receipt.docNo,
          detail: `ออก${title} · ${note.buyerName} · ${formatSatang(amount)} บาท · ตามใบวางบิล ${note.docNo} (${mine.length} ใบแจ้งหนี้)`,
        });
      }
    }

    const docNoOf = new Map(invoices.map((i) => [i.id, i.docNo]));
    for (const s of shares) {
      const receipt = receiptOf.get(s.receiptIsTaxInvoice) ?? null;
      await insertPaymentTx(conn, {
        documentId: s.invoiceId,
        receiptId: receipt?.id ?? null,
        input: {
          ...input,
          amountSatang: s.amountSatang,
          whtSatang: s.whtSatang,
          whtPercent: s.whtSatang > 0 ? input.whtPercent : 0,
          feeSatang: s.feeSatang,
        },
        actor,
        now,
        vatSatang: s.vatSatang,
        billingNoteId: noteId,
        groupId,
      });
      await recomputePaidSatang(conn, s.invoiceId);
      const [inv] = await run(conn, "SELECT salesRecordId FROM acc_documents WHERE id = ?", [s.invoiceId]);
      await syncSaleReceiptRef(conn, strOrNull(inv?.salesRecordId), s.invoiceId);
      await writeAudit(conn, {
        ...actor,
        action: "payment.create",
        documentId: s.invoiceId,
        docNo: docNoOf.get(s.invoiceId) ?? null,
        detail: `รับชำระ ${formatSatang(s.amountSatang)} บาท ตามใบวางบิล ${note.docNo}${receipt ? ` · ใบเสร็จ ${receipt.docNo}` : ` · ใบเสร็จจากที่อื่น ${input.externalReceiptNo}`}`,
      });
    }
    const receipts = [...receiptOf.values()];
    const parts = [
      `รับชำระ ${formatSatang(input.amountSatang)} บาท (${methodLabel(input.method)} ${formatDisplayDate(input.paidDate)}) · ${shares.length} ใบแจ้งหนี้`,
      input.whtSatang > 0 ? `หัก ณ ที่จ่าย ${input.whtPercent}% ${formatSatang(input.whtSatang)}` : null,
      input.feeSatang > 0 ? `ค่าธรรมเนียม ${formatSatang(input.feeSatang)}` : null,
      receipts.length > 0 ? `ใบเสร็จ ${receipts.map((r) => r.docNo).join(", ")}` : `ใบเสร็จจากที่อื่น ${input.externalReceiptNo}`,
    ].filter(Boolean);
    await writeAudit(conn, { ...actor, action: "payment.create", documentId: noteId, docNo: note.docNo, detail: parts.join(" · ") });
    return { receipts, groupId };
  });
}
