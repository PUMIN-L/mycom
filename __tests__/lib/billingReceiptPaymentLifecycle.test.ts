// @vitest-environment node
/**
 * THE RECEIPT-PAYMENT STATE MACHINE, end to end through the store.
 *
 * A payment row minted by an ใบเสร็จรับเงิน is pushed around by three
 * independent lifecycles — the document's content (every save, including the
 * one /billing performs on every ดาวน์โหลด PDF), a HUMAN voiding it from the
 * history, and the document's own cancel / "แก้ไข (New Ver.)" — and the bugs
 * this file pins down all came from treating them as one.
 *
 * Unlike the other store suites, these tests do not assert a SQL string: they
 * run the real statements against a tiny in-memory stand-in for the two tables
 * and then ask the only question that matters — HOW MUCH IS THE INVOICE
 * CREDITED. The stand-in follows the SQL it is given, including whether the
 * receipt upsert's ON DUPLICATE KEY UPDATE list mentions `voidedAt`, so putting
 * that clause back makes these tests fail rather than quietly pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import { withTransaction } from '@/app/lib/db';
import { saveBillingDocumentAtomic, cancelBillingDocument } from '@/app/lib/billingStore';
import {
  voidBillingPayment,
  RECEIPT_CANCELLED_VOID_REASON,
  RECEIPT_SUPERSEDED_VOID_REASON,
  RECEIPT_UNLINKED_VOID_REASON,
} from '@/app/lib/billingPayments';
import { buildReceivablesLedger, type ReceivableRow } from '@/app/lib/receivables';

// ── The stand-in ────────────────────────────────────────────────────────────

interface FakeDoc {
  id: string;
  cancelledAt: string | null;
  supersededById: string | null;
}
interface FakePayment {
  id: string;
  billingDocumentId: string;
  amount: number;
  voidedAt: string | null;
  voidReason: string | null;
}

function makeDb() {
  const docs = new Map<string, FakeDoc>();
  const payments = new Map<string, FakePayment>();
  const paidAmount = new Map<string, number>();

  conn.query.mockImplementation(async (rawSql: string, rawParams?: unknown[]) => {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    const params = (rawParams ?? []) as never[];
    const p = (i: number) => params[i] as unknown as string;

    if (sql.startsWith('INSERT INTO used_docnos')) return [{ affectedRows: 1 }];

    if (sql.startsWith('INSERT INTO billing_documents')) {
      // The upsert deliberately writes neither cancelledAt nor supersededById,
      // so an existing row keeps both — that is the behaviour under test.
      if (!docs.has(p(0))) {
        docs.set(p(0), { id: p(0), cancelledAt: null, supersededById: null });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE billing_documents SET supersededById = ?')) {
      const doc = docs.get(p(1));
      if (doc) doc.supersededById = p(0);
      return [{ affectedRows: doc ? 1 : 0 }];
    }
    if (sql.startsWith('UPDATE billing_documents SET cancelledAt = ?')) {
      const doc = docs.get(p(1));
      if (!doc) return [{ affectedRows: 0 }];
      doc.cancelledAt = (params[0] ?? null) as unknown as string | null;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE billing_documents SET paidAmount = ?')) {
      paidAmount.set(p(1), Number(params[0]));
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT cancelledAt, supersededById FROM billing_documents')) {
      const doc = docs.get(p(0));
      return [doc ? [{ cancelledAt: doc.cancelledAt, supersededById: doc.supersededById }] : []];
    }
    if (sql.startsWith('SELECT cancelledAt FROM billing_documents')) {
      const doc = docs.get(p(0));
      return [doc ? [{ cancelledAt: doc.cancelledAt }] : []];
    }
    if (sql.startsWith('SELECT newer.id')) {
      const doc = docs.get(p(0));
      const newer = doc?.supersededById ? docs.get(doc.supersededById) : undefined;
      return [newer && !newer.cancelledAt ? [{ liveSuccessorId: newer.id }] : []];
    }
    if (sql.startsWith('SELECT COALESCE(SUM(amount), 0)')) {
      let paid = 0;
      for (const row of payments.values()) {
        if (row.billingDocumentId === p(0) && !row.voidedAt) paid += row.amount;
      }
      // DECIMAL arrives from mysql2 as a STRING, like the real driver.
      return [[{ paid: paid.toFixed(2) }]];
    }
    if (sql.startsWith('SELECT billingDocumentId')) {
      const row = payments.get(p(0));
      return [
        row
          ? [
              {
                billingDocumentId: row.billingDocumentId,
                voidedAt: row.voidedAt,
                voidReason: row.voidReason,
              },
            ]
          : [],
      ];
    }
    if (sql.startsWith('INSERT INTO billing_payments')) {
      const existing = payments.get(p(0));
      if (!existing) {
        payments.set(p(0), {
          id: p(0),
          billingDocumentId: p(1),
          amount: Number(params[2]),
          voidedAt: null,
          voidReason: null,
        });
      } else {
        existing.billingDocumentId = p(1);
        existing.amount = Number(params[2]);
        // Follow the statement as written. The fix is that `voidedAt` is NOT in
        // the ON DUPLICATE KEY UPDATE list; if it ever returns, this resurrects
        // the row exactly as the real database would and the tests fail.
        if (/ON DUPLICATE KEY UPDATE.*voidedAt/.test(sql)) {
          existing.voidedAt = null;
          existing.voidReason = null;
        }
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE billing_payments SET voidedAt = NULL')) {
      const row = payments.get(p(0));
      if (row) {
        row.voidedAt = null;
        row.voidReason = null;
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('UPDATE billing_payments SET voidedAt = ?')) {
      const row = payments.get(p(2));
      if (row) {
        row.voidedAt = p(0);
        row.voidReason = p(1);
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  return { docs, payments, paidAmount };
}

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  db = makeDb();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

/** ยอดรวมสุทธิ ฿100,000, no VAT — the number the receipt's payment carries. */
const HUNDRED_K = { docDate: '2026-09-06', items: [{ qty: 1, unitPrice: 100000 }] };
const INVOICE = 'INV050926-22';

const base = {
  docNo: '',
  linkedQuotationId: null,
  paymentMethod: 'โอนเงิน',
  paymentDate: '2026-09-06',
  paymentRef: 'TRF-1',
};

/** Saves the ใบแจ้งหนี้ the receipts below settle. */
async function saveInvoice() {
  await saveBillingDocumentAtomic({
    ...base,
    id: INVOICE,
    docType: 'invoice',
    data: HUNDRED_K,
    createdAt: '2026-09-06T01:00:00.000Z',
  } as never);
}

/** Saves an ใบเสร็จรับเงิน for ฿100,000 against that invoice. */
async function saveReceipt(
  id: string,
  extra: { supersedesId?: string; createdAt?: string; settlesDocId?: string | null } = {}
) {
  await saveBillingDocumentAtomic({
    ...base,
    id,
    docType: 'receipt',
    data: HUNDRED_K,
    settlesDocId: extra.settlesDocId === undefined ? INVOICE : extra.settlesDocId,
    supersedesId: extra.supersedesId ?? null,
    createdAt: extra.createdAt ?? '2026-09-06T02:00:00.000Z',
  } as never);
}

const paid = () => db.paidAmount.get(INVOICE) ?? 0;
const live = () => [...db.payments.values()].filter((p) => !p.voidedAt).map((p) => p.id);

/** The ledger's view of the invoice, given what the payments now say. */
function ledgerOutstanding() {
  const row: ReceivableRow = {
    id: INVOICE,
    docNo: INVOICE,
    docType: 'invoice',
    docDate: '2026-09-06',
    dueDate: '2026-09-30',
    customerName: 'บริษัท ก',
    customerPhone: '',
    linkedQuotationId: null,
    totalAmount: 100000,
    paidAmount: paid(),
    receivableOverride: null,
    cancelledAt: null,
    supersededById: null,
    settlesDocId: null,
    createdAt: '2026-09-06T01:00:00.000Z',
  };
  const ledger = buildReceivablesLedger([row], '2026-09-06');
  return {
    outstanding: ledger.entries[0]?.status.outstanding ?? 0,
    overpaidBy: ledger.entries[0]?.status.overpaidBy ?? 0,
    totalOutstanding: ledger.totalOutstanding,
  };
}

// ── FINDING 1: แก้ไข (New Ver.) on a receipt credited the invoice twice ──────

describe('แก้ไข (New Ver.) on an ใบเสร็จรับเงิน', () => {
  it('credits the invoice ONCE — the superseded receipt\'s payment is voided, not left live', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    expect(paid()).toBe(100000);

    // The clone: a NEW uuid, docNo …-22v1, `settlesDocId` carried forward, and
    // `supersedesId` naming the row it replaces — exactly what /billing posts.
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22', createdAt: '2026-09-07T02:00:00.000Z' });

    expect(paid()).toBe(100000); // was ฿200,000
    expect(live()).toEqual(['rc-22v1']);
    expect(db.payments.get('rc-22')).toMatchObject({
      voidedAt: '2026-09-07T02:00:00.000Z',
      voidReason: RECEIPT_SUPERSEDED_VOID_REASON,
    });
    // And nothing is ever deleted — the withdrawn record stays readable.
    expect(db.payments.size).toBe(2);

    const ledger = ledgerOutstanding();
    expect(ledger.overpaidBy).toBe(0); // was "ชำระเกิน ฿100,000"
    expect(ledger.outstanding).toBe(0);
  });

  it('a receipt superseded TWICE still leaves exactly one live payment', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });
    await saveReceipt('rc-22v2', { supersedesId: 'rc-22v1' });

    expect(live()).toEqual(['rc-22v2']);
    expect(paid()).toBe(100000);
  });

  it('re-saving the SUPERSEDED receipt (opening it and pressing ดาวน์โหลด PDF) does not re-credit', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });

    await saveReceipt('rc-22', { createdAt: '2026-09-08T02:00:00.000Z' });

    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22v1']);
    expect(db.payments.get('rc-22')?.voidReason).toBe(RECEIPT_SUPERSEDED_VOID_REASON);
  });

  it('a HUMAN void before the supersede is left exactly as the human left it', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await voidBillingPayment('rc-22', 'เงินไม่เข้าจริง', '2026-09-06T09:00:00.000Z');
    expect(paid()).toBe(0);

    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });

    // The supersede does not re-stamp the row: the reason is what decides who
    // may take a void back, and this one is the human's.
    expect(db.payments.get('rc-22')).toMatchObject({
      voidedAt: '2026-09-06T09:00:00.000Z',
      voidReason: 'เงินไม่เข้าจริง',
    });
    expect(live()).toEqual(['rc-22v1']);
    expect(paid()).toBe(100000);
  });

  it('a HUMAN void AFTER the supersede leaves the invoice unpaid — and a re-save cannot undo it', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });
    await voidBillingPayment('rc-22v1', 'พิมพ์ยอดผิด', '2026-09-08T09:00:00.000Z');
    expect(paid()).toBe(0);

    await saveReceipt('rc-22v1', { createdAt: '2026-09-09T02:00:00.000Z' });

    expect(paid()).toBe(0);
    expect(live()).toEqual([]);
    expect(ledgerOutstanding().outstanding).toBe(100000);
  });

  it('superseding an INVOICE never touches the deposit recorded against it', async () => {
    await saveInvoice();
    db.payments.set('dep-1', {
      id: 'dep-1',
      billingDocumentId: INVOICE,
      amount: 30000,
      voidedAt: null,
      voidReason: null,
    });
    await saveBillingDocumentAtomic({
      ...base,
      id: 'INV050926-22v1',
      docType: 'invoice',
      data: HUNDRED_K,
      supersedesId: INVOICE,
      createdAt: '2026-09-07T01:00:00.000Z',
    } as never);

    expect(db.payments.get('dep-1')?.voidedAt).toBeNull();
  });
});

// ── FINDING 2: a re-save resurrected a payment a human had voided ───────────

describe('a re-save is NOT a decision', () => {
  it('pressing ดาวน์โหลด PDF on a receipt does not un-void the payment an admin voided', async () => {
    await saveInvoice();
    // ฿30,000 deposit taken on the invoice itself...
    db.payments.set('dep-1', {
      id: 'dep-1',
      billingDocumentId: INVOICE,
      amount: 30000,
      voidedAt: null,
      voidReason: null,
    });
    await saveReceipt('rc-22');
    expect(paid()).toBe(130000);

    // ...the admin spots the double count and voids the receipt's payment.
    await voidBillingPayment('rc-22', 'ซ้ำกับมัดจำ', '2026-09-06T09:00:00.000Z');
    expect(paid()).toBe(30000);

    // ANYONE then opens the receipt (?view=1) and presses ดาวน์โหลด PDF, which
    // RE-POSTS the document. This used to walk into `voidedAt = NULL`.
    await saveReceipt('rc-22', { createdAt: '2026-09-10T02:00:00.000Z' });

    expect(paid()).toBe(30000);
    expect(db.payments.get('rc-22')).toMatchObject({
      voidedAt: '2026-09-06T09:00:00.000Z',
      voidReason: 'ซ้ำกับมัดจำ',
    });
    expect(ledgerOutstanding().outstanding).toBe(70000); // the ฿70,000 still owed
  });

  it('a CANCELLED receipt re-saved stays voided, and un-cancelling is what brings it back', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await cancelBillingDocument('rc-22', '2026-09-07T00:00:00.000Z');
    expect(paid()).toBe(0);
    expect(db.payments.get('rc-22')?.voidReason).toBe(RECEIPT_CANCELLED_VOID_REASON);

    await saveReceipt('rc-22', { createdAt: '2026-09-08T02:00:00.000Z' });
    expect(paid()).toBe(0);

    await cancelBillingDocument('rc-22', null);
    expect(paid()).toBe(100000);
  });
});

// ── The two lifecycles crossing ─────────────────────────────────────────────

describe('cancel and supersede, in both orders', () => {
  it('cancelling the SUCCESSOR takes the credit back off the invoice — the debt reappears, visibly', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });

    await cancelBillingDocument('rc-22v1', '2026-09-09T00:00:00.000Z');

    // Neither receipt credits the invoice now: the newer one is withdrawn and
    // the older one was replaced. Showing the debt again is the direction an
    // admin can act on; silently keeping it settled is not.
    expect(paid()).toBe(0);
    expect(ledgerOutstanding().outstanding).toBe(100000);

    // ...and un-cancelling puts it back ONCE, not twice.
    await cancelBillingDocument('rc-22v1', null);
    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22v1']);
  });

  it('cancelling the ORIGINAL instead changes nothing — its payment is already out of the sum', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });

    await cancelBillingDocument('rc-22', '2026-09-09T00:00:00.000Z');
    expect(paid()).toBe(100000);
    // First void wins: the cancel does not re-stamp a reason that an un-cancel
    // would then be entitled to take back.
    expect(db.payments.get('rc-22')?.voidReason).toBe(RECEIPT_SUPERSEDED_VOID_REASON);

    await cancelBillingDocument('rc-22', null);
    expect(paid()).toBe(100000); // NOT ฿200,000
    expect(live()).toEqual(['rc-22v1']);
  });

  it('un-cancelling a receipt a LIVE newer version has replaced does not double-credit', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');
    await cancelBillingDocument('rc-22', '2026-09-07T00:00:00.000Z');
    expect(paid()).toBe(0);

    // The admin re-issues it as a new version instead...
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });
    expect(paid()).toBe(100000);

    // ...and then un-cancels the old one. The money arrived once.
    await cancelBillingDocument('rc-22', null);
    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22v1']);
  });

  it('RE-LINKING a superseded receipt to the invoice cannot bring its payment back', async () => {
    // The path the `superseded` read-back in saveBillingDocumentAtomic exists
    // for, and the only one that distinguishes it from a no-op.
    //
    // A void written by an UNLINK is the one void a save is allowed to take
    // back, because re-pointing ชำระให้ใบแจ้งหนี้ is the exact inverse human
    // edit. But once a NEWER VERSION carries the money, that inverse is no
    // longer safe: the successor's payment is already on the invoice, so
    // re-linking the replaced receipt would credit ฿100,000 that arrived once
    // for a second time. The supersede has to be read back from the ROW and
    // checked BEFORE the un-void, not inferred from the request.
    await saveInvoice();
    await saveReceipt('rc-22');
    expect(paid()).toBe(100000);

    // 1. The admin clears ชำระให้ใบแจ้งหนี้ on the receipt and saves.
    await saveReceipt('rc-22', { settlesDocId: null, createdAt: '2026-09-07T02:00:00.000Z' });
    expect(paid()).toBe(0);
    expect(db.payments.get('rc-22')?.voidReason).toBe(RECEIPT_UNLINKED_VOID_REASON);

    // 2. He re-issues the receipt as a new version, which settles the invoice.
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22', createdAt: '2026-09-08T02:00:00.000Z' });
    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22v1']);

    // 3. He then opens the OLD receipt and points it back at the invoice.
    await saveReceipt('rc-22', { createdAt: '2026-09-09T02:00:00.000Z' });

    // The money still arrived exactly once.
    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22v1']);
    expect(db.payments.get('rc-22')?.voidedAt).not.toBeNull();
    expect(ledgerOutstanding().overpaidBy).toBe(0);
    expect(ledgerOutstanding().outstanding).toBe(0);
  });

  it('...but re-linking is still allowed when the newer version was itself cancelled', async () => {
    // The mirror image, so the guard above cannot be "always refuse". A
    // successor that is cancelled carries nothing, so the original re-linking
    // is the only thing settling the invoice and MUST work.
    await saveInvoice();
    await saveReceipt('rc-22');
    await saveReceipt('rc-22', { settlesDocId: null, createdAt: '2026-09-07T02:00:00.000Z' });
    await saveReceipt('rc-22v1', { supersedesId: 'rc-22', createdAt: '2026-09-08T02:00:00.000Z' });
    await cancelBillingDocument('rc-22v1', '2026-09-08T09:00:00.000Z');
    expect(paid()).toBe(0);

    await saveReceipt('rc-22', { createdAt: '2026-09-09T02:00:00.000Z' });

    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22']);
  });
});

// ── withTransaction replays its callback ────────────────────────────────────

describe('a replayed transaction', () => {
  it('does not double-credit when the save runs twice (a lost commit acknowledgement)', async () => {
    await saveInvoice();
    await saveReceipt('rc-22');

    // withTransaction retries its callback up to 3 times on a transient
    // connection loss — INCLUDING after a commit whose ack was lost, so the
    // first attempt's writes may already be in the database.
    vi.mocked(withTransaction).mockImplementationOnce((async (
      fn: (c: typeof conn) => Promise<unknown>
    ) => {
      await fn(conn);
      return fn(conn);
    }) as never);

    await saveReceipt('rc-22v1', { supersedesId: 'rc-22' });

    expect(paid()).toBe(100000);
    expect(live()).toEqual(['rc-22v1']);
    expect(db.payments.get('rc-22')?.voidReason).toBe(RECEIPT_SUPERSEDED_VOID_REASON);
  });
});
