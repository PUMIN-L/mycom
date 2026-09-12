// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// deriveBillingColumns is the SAVE PATH's money, and it is exercised below
// against the ledger's arithmetic so the two can be shown to agree. It lives in
// billingStore, which imports the driver — stubbed here, since nothing in this
// file touches the database.
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import {
  isDebtCarrier,
  resolveReceivableStatus,
  receivableAgeingBucket,
  buildReceivablesLedger,
  baseDocNo,
  docNoVersion,
  SATANG_TOLERANCE,
  REVIVED_SUPERSEDE_LABEL,
  type ReceivableRow,
} from '@/app/lib/receivables';
import { computeQuoteTotals, round2 } from '@/app/lib/quotationTotals';
import { deriveBillingColumns } from '@/app/lib/billingStore';

const TODAY = '2026-09-06';

function status(partial: Partial<Parameters<typeof resolveReceivableStatus>[0]>, today = TODAY) {
  return resolveReceivableStatus(
    {
      docType: 'invoice',
      totalAmount: 100000,
      paidAmount: 0,
      dueDate: null,
      cancelledAt: null,
      supersededById: null,
      receivableOverride: null,
      ...partial,
    },
    today
  );
}

// ── WHICH DOCUMENT CARRIES THE DEBT ─────────────────────────────────────────
// The whole feature turns on this. Counting an ใบวางบิล next to the invoice it
// bundles doubles a customer's debt; counting an ใบเสร็จ triples it.
describe('isDebtCarrier — the invoice carries the debt, nothing else by default', () => {
  it('counts an invoice', () => {
    expect(isDebtCarrier({ docType: 'invoice', receivableOverride: null })).toBe(true);
  });

  it('does NOT count an ใบวางบิล — its money is already owed on the invoice it bundles', () => {
    expect(isDebtCarrier({ docType: 'billing_note', receivableOverride: null })).toBe(false);
  });

  it('does NOT count an ใบเสร็จ — a receipt DISCHARGES debt, it never creates it', () => {
    expect(isDebtCarrier({ docType: 'receipt', receivableOverride: null })).toBe(false);
  });

  it('an explicit override of 1 forces an ใบวางบิล in (billed with no invoice ever raised)', () => {
    expect(isDebtCarrier({ docType: 'billing_note', receivableOverride: 1 })).toBe(true);
  });

  it('an explicit override of 0 forces an INVOICE out, beating the docType default', () => {
    expect(isDebtCarrier({ docType: 'invoice', receivableOverride: 0 })).toBe(false);
  });

  it('treats a missing override exactly like NULL — which is what every pre-existing row is', () => {
    expect(isDebtCarrier({ docType: 'invoice' })).toBe(true);
    expect(isDebtCarrier({ docType: 'billing_note' })).toBe(false);
  });
});

// ── TERMINAL FLAGS, first match wins ────────────────────────────────────────
describe('resolveReceivableStatus — terminal flags', () => {
  it('ยกเลิก wins over everything, and such a row is never open', () => {
    const s = status({ cancelledAt: '2026-09-01T00:00:00.000Z', supersededById: 'x', dueDate: '2020-01-01' });
    expect(s.terminal).toBe('cancelled');
    expect(s.isOpen).toBe(false);
  });

  it('ถูกแทนที่ — a superseded row is not a receivable, so a corrected invoice is not billed twice', () => {
    const s = status({ supersededById: 'v2-id', dueDate: '2020-01-01' });
    expect(s.terminal).toBe('superseded');
    expect(s.isOpen).toBe(false);
  });

  it('ถูกแทนที่ needs a LIVE replacement — a cancelled newer version terminates nothing', () => {
    // Otherwise BOTH rows are terminal and the debt is in no list, no bucket
    // and no headline, with nothing on screen to say where it went.
    const s = status({
      supersededById: 'v2-id',
      supersededByCancelled: true,
      dueDate: '2020-01-01',
    });
    expect(s.terminal).toBeNull();
    expect(s.isOpen).toBe(true);
    expect(s.revivedFromCancelledSuccessor).toBe(true);
  });

  it('still reads a supersede as terminal when the caller cannot see the other row', () => {
    const s = status({ supersededById: 'v2-id', supersededByCancelled: false });
    expect(s.terminal).toBe('superseded');
    expect(status({ supersededById: 'v2-id' }).terminal).toBe('superseded');
  });

  it('ยกเลิก on the row ITSELF still wins, even when its replacement was cancelled too', () => {
    const s = status({
      cancelledAt: '2026-09-01T00:00:00.000Z',
      supersededById: 'v2-id',
      supersededByCancelled: true,
    });
    expect(s.terminal).toBe('cancelled');
    expect(s.isOpen).toBe(false);
  });

  it('an ใบวางบิล with no override is excluded as not_debt_carrier, not as zero_total', () => {
    expect(status({ docType: 'billing_note' }).terminal).toBe('not_debt_carrier');
  });

  it('ไม่มียอด — a ฿0 invoice (saved before any lines were imported) is not a debt', () => {
    const s = status({ totalAmount: 0 });
    expect(s.terminal).toBe('zero_total');
    expect(s.isOpen).toBe(false);
  });

  it('a NEGATIVE total (a row written before the negative-total guard) becomes ไม่มียอด, never a negative debt', () => {
    const s = status({ totalAmount: -5000, dueDate: '2020-01-01' });
    expect(s.terminal).toBe('zero_total');
    expect(s.outstanding).toBe(0);
    expect(s.isOpen).toBe(false);
  });

  it('a live, unpaid, overdue invoice carries NO terminal flag and IS open', () => {
    const s = status({ dueDate: '2026-08-01' });
    expect(s.terminal).toBeNull();
    expect(s.isOpen).toBe(true);
  });
});

// ── PAYMENT AXIS — decimal space, satang tolerance, never float equality ────
describe('resolveReceivableStatus — payment axis', () => {
  it('ยังไม่ชำระ when nothing has been received', () => {
    expect(status({ paidAmount: 0 }).paymentState).toBe('unpaid');
  });

  it('ชำระบางส่วน for a deposit, with the balance as the outstanding', () => {
    const s = status({ totalAmount: 100000, paidAmount: 30000 });
    expect(s.paymentState).toBe('partial');
    expect(s.outstanding).toBe(70000);
  });

  it('ชำระครบ within half a satang — VAT dust must never leave an invoice that can never be closed', () => {
    // 7% VAT on an odd base leaves float dust; `paid === total` would fail here
    // forever and the alert would never clear.
    const s = status({ totalAmount: 1070.0, paidAmount: 1069.996 });
    expect(s.paymentState).toBe('paid');
    expect(s.isOpen).toBe(false);
  });

  it('a gap larger than the tolerance is still ชำระบางส่วน, not ชำระครบ', () => {
    const s = status({ totalAmount: 1070.0, paidAmount: 1069.98 });
    expect(s.paymentState).toBe('partial');
    expect(s.isOpen).toBe(true);
  });

  it('dust BELOW the tolerance does not make an untouched invoice look part-paid', () => {
    expect(status({ paidAmount: SATANG_TOLERANCE }).paymentState).toBe('unpaid');
  });

  it('ชำระเกิน is flagged, but outstanding is FLOORED so it cannot subtract from the company total', () => {
    const s = status({ totalAmount: 100000, paidAmount: 105000 });
    expect(s.paymentState).toBe('overpaid');
    expect(s.overpaidBy).toBe(5000);
    expect(s.outstanding).toBe(0);
    expect(s.isOpen).toBe(false);
  });

  it('a total edited DOWN below what was already paid flips to ชำระเกิน rather than going negative', () => {
    // The blob stays editable forever, so this is a real state, not a bug.
    const s = status({ totalAmount: 20000, paidAmount: 30000 });
    expect(s.paymentState).toBe('overpaid');
    expect(s.outstanding).toBe(0);
  });
});

// ── DUE AXIS ────────────────────────────────────────────────────────────────
describe('resolveReceivableStatus — due axis', () => {
  it('NULL dueDate is NEVER overdue — nobody agreed a term, so nothing is late', () => {
    const s = status({ dueDate: null });
    expect(s.dueState).toBe('no_due_date');
    expect(s.daysOverdue).toBeNull();
  });

  it('ครบกำหนดวันนี้ when the due date IS today', () => {
    const s = status({ dueDate: TODAY });
    expect(s.dueState).toBe('due_today');
    expect(s.daysOverdue).toBe(0);
  });

  it('ยังไม่ถึงกำหนด with a negative daysOverdue for a future date', () => {
    const s = status({ dueDate: '2026-09-09' });
    expect(s.dueState).toBe('not_due');
    expect(s.daysOverdue).toBe(-3);
  });

  it('เกินกำหนด N วัน counts whole Bangkok calendar days', () => {
    const s = status({ dueDate: '2026-08-25' });
    expect(s.dueState).toBe('overdue');
    expect(s.daysOverdue).toBe(12);
  });

  it('THE TWO AXES COMBINE: a part-paid invoice can still be overdue on its balance', () => {
    // Modelling ชำระบางส่วน as mutually exclusive with เกินกำหนด is how a
    // deposit becomes an invoice nobody ever chases.
    const s = status({ totalAmount: 100000, paidAmount: 30000, dueDate: '2026-08-25' });
    expect(s.paymentState).toBe('partial');
    expect(s.dueState).toBe('overdue');
    expect(s.daysOverdue).toBe(12);
    expect(s.outstanding).toBe(70000);
    expect(s.isOpen).toBe(true);
  });

  it('honours a dueDate EARLIER than the docDate literally — backdated terms are real', () => {
    expect(status({ dueDate: '2020-01-01' }).dueState).toBe('overdue');
  });
});

// ── AGEING BUCKETS — inclusive at the top, non-overlapping, exhaustive ─────
describe('receivableAgeingBucket — every boundary', () => {
  const cases: [number | null, string][] = [
    [null, 'no_due_date'],
    [-1, 'not_due'],
    // Money due TODAY is not late today.
    [0, 'not_due'],
    [1, 'd1_30'],
    [30, 'd1_30'],
    [31, 'd31_60'],
    [60, 'd31_60'],
    [61, 'd61_90'],
    [90, 'd61_90'],
    [91, 'd90_plus'],
    [365, 'd90_plus'],
  ];

  for (const [daysOverdue, expected] of cases) {
    it(`daysOverdue ${daysOverdue} -> ${expected}`, () => {
      expect(receivableAgeingBucket({ daysOverdue })).toBe(expected);
    });
  }

  it('agrees with resolveReceivableStatus for the same document (one rule, one place)', () => {
    // 30 days before today: the last day of the 1-30 bucket.
    expect(receivableAgeingBucket(status({ dueDate: '2026-08-07' }))).toBe('d1_30');
    // 31 days: the first day of the next one.
    expect(receivableAgeingBucket(status({ dueDate: '2026-08-06' }))).toBe('d31_60');
  });
});

// ── VERSION CLONES ──────────────────────────────────────────────────────────
describe('docNo version helpers — the clone flow doubles the debt without them', () => {
  it('strips every version suffix shape the two builders can produce', () => {
    expect(baseDocNo('INV260810-01v2')).toBe('INV260810-01');
    expect(baseDocNo('INV260810-01V2')).toBe('INV260810-01');
    expect(baseDocNo('INV260810-01-v3')).toBe('INV260810-01');
    expect(baseDocNo('INV260810-01-V3')).toBe('INV260810-01');
  });

  it('leaves an unversioned original alone (and calls it version 0)', () => {
    expect(baseDocNo('INV260810-01')).toBe('INV260810-01');
    expect(docNoVersion('INV260810-01')).toBe(0);
    expect(docNoVersion('INV260810-01v2')).toBe(2);
  });

  it('does not mistake the running number for a version', () => {
    // "-01" is the NN within the day, not a version.
    expect(baseDocNo('INV260810-01')).toBe('INV260810-01');
  });
});

// ── THE LEDGER ──────────────────────────────────────────────────────────────
function row(partial: Partial<ReceivableRow>): ReceivableRow {
  return {
    id: 'id',
    docNo: 'INV260801-01',
    docType: 'invoice',
    docDate: '2026-08-01',
    dueDate: '2026-08-31',
    customerName: 'บริษัท ก',
    customerPhone: '02-000-0000',
    linkedQuotationId: null,
    totalAmount: 100000,
    paidAmount: 0,
    receivableOverride: null,
    cancelledAt: null,
    supersededById: null,
    settlesDocId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  };
}

describe('buildReceivablesLedger', () => {
  it('does NOT triple the debt when one deal produced INV + BN + RC from the same quotation', () => {
    const ledger = buildReceivablesLedger(
      [
        row({ id: 'inv', docType: 'invoice', docNo: 'INV260801-01', linkedQuotationId: 'q1' }),
        row({ id: 'bn', docType: 'billing_note', docNo: 'BN260801-01', linkedQuotationId: 'q1' }),
        row({ id: 'rc', docType: 'receipt', docNo: 'RC260801-01', linkedQuotationId: 'q1' }),
      ],
      TODAY
    );
    expect(ledger.entries.map((e) => e.id)).toEqual(['inv']);
    expect(ledger.totalOutstanding).toBe(100000);
  });

  it('does not bill a corrected invoice twice, EVEN WITHOUT supersededById (rows predating the column)', () => {
    const ledger = buildReceivablesLedger(
      [
        row({ id: 'v1', docNo: 'INV260801-01' }),
        row({ id: 'v2', docNo: 'INV260801-01v2' }),
      ],
      TODAY
    );
    expect(ledger.entries.map((e) => e.id)).toEqual(['v2']);
    expect(ledger.totalOutstanding).toBe(100000);
  });

  it('names the version that replaced an old row, so the ledger can explain itself', () => {
    const ledger = buildReceivablesLedger(
      [row({ id: 'v1', docNo: 'INV260801-01' }), row({ id: 'v2', docNo: 'INV260801-01v2' })],
      TODAY
    );
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].id).toBe('v2');
  });

  it('keeps the ไม่ได้กำหนด rows OUT of the headline and out of every overdue bucket', () => {
    const ledger = buildReceivablesLedger(
      [
        row({ id: 'dated', dueDate: '2026-08-01', totalAmount: 10000 }),
        row({ id: 'undated', docNo: 'INV260801-02', dueDate: null, totalAmount: 90000 }),
      ],
      TODAY
    );
    expect(ledger.totalOutstanding).toBe(10000);
    expect(ledger.undatedOutstanding).toBe(90000);
    expect(ledger.undatedCount).toBe(1);
    expect(ledger.totalOutstandingWithUndated).toBe(100000);
    expect(ledger.overdueOutstanding).toBe(10000);
    expect(ledger.overdueCount).toBe(1);
    const undatedBucket = ledger.buckets.find((b) => b.id === 'no_due_date')!;
    expect(undatedBucket.amount).toBe(90000);
    expect(undatedBucket.count).toBe(1);
  });

  it('sums the ageing buckets over the OUTSTANDING balance, not the document total', () => {
    const ledger = buildReceivablesLedger(
      [row({ totalAmount: 100000, paidAmount: 30000, dueDate: '2026-08-25' })],
      TODAY
    );
    expect(ledger.buckets.find((b) => b.id === 'd1_30')!.amount).toBe(70000);
    expect(ledger.totalOutstanding).toBe(70000);
  });

  it('groups by customer with a subtotal — one phone call settles four invoices', () => {
    const ledger = buildReceivablesLedger(
      [
        row({ id: 'a1', docNo: 'INV260801-01', customerName: 'บริษัท ก', totalAmount: 10000 }),
        row({ id: 'a2', docNo: 'INV260801-02', customerName: 'บริษัท ก', totalAmount: 20000 }),
        row({ id: 'b1', docNo: 'INV260801-03', customerName: 'บริษัท ข', totalAmount: 5000 }),
      ],
      TODAY
    );
    expect(ledger.customers).toHaveLength(2);
    expect(ledger.customers[0].customerName).toBe('บริษัท ก');
    expect(ledger.customers[0].outstanding).toBe(30000);
    expect(ledger.customers[0].count).toBe(2);
  });

  it('sorts most-overdue first, then largest outstanding', () => {
    const ledger = buildReceivablesLedger(
      [
        row({ id: 'small-old', docNo: 'INV260101-01', dueDate: '2026-01-01', totalAmount: 100 }),
        row({ id: 'big-recent', docNo: 'INV260901-01', dueDate: '2026-09-05', totalAmount: 999999 }),
        row({ id: 'same-day-bigger', docNo: 'INV260901-02', dueDate: '2026-09-05', totalAmount: 1000000 }),
      ],
      TODAY
    );
    expect(ledger.entries.map((e) => e.id)).toEqual(['small-old', 'same-day-bigger', 'big-recent']);
  });

  it('nudges about an ใบวางบิล whose quotation NO invoice covers — the debt would be invisible otherwise', () => {
    const ledger = buildReceivablesLedger(
      [row({ id: 'bn', docType: 'billing_note', docNo: 'BN260801-01', linkedQuotationId: 'q9' })],
      TODAY
    );
    expect(ledger.unlinkedBillingNotes.map((e) => e.id)).toEqual(['bn']);
  });

  it('nudges about an ใบวางบิล with NO linked quotation at all', () => {
    const ledger = buildReceivablesLedger(
      [row({ id: 'bn', docType: 'billing_note', docNo: 'BN260801-01', linkedQuotationId: null })],
      TODAY
    );
    expect(ledger.unlinkedBillingNotes.map((e) => e.id)).toEqual(['bn']);
  });

  it('NEVER offers the override for an ใบวางบิล whose invoice already exists — that is the double-count', () => {
    const ledger = buildReceivablesLedger(
      [
        row({ id: 'inv', docNo: 'INV260801-01', linkedQuotationId: 'q1' }),
        row({ id: 'bn', docType: 'billing_note', docNo: 'BN260801-01', linkedQuotationId: 'q1' }),
      ],
      TODAY
    );
    expect(ledger.unlinkedBillingNotes).toHaveLength(0);
  });

  it('stops nudging once the admin has ruled on that ใบวางบิล either way', () => {
    const forcedIn = buildReceivablesLedger(
      [row({ id: 'bn', docType: 'billing_note', docNo: 'BN260801-01', receivableOverride: 1 })],
      TODAY
    );
    expect(forcedIn.unlinkedBillingNotes).toHaveLength(0);
    expect(forcedIn.entries.map((e) => e.id)).toEqual(['bn']);

    const forcedOut = buildReceivablesLedger(
      [row({ id: 'bn', docType: 'billing_note', docNo: 'BN260801-01', receivableOverride: 0 })],
      TODAY
    );
    expect(forcedOut.unlinkedBillingNotes).toHaveLength(0);
    expect(forcedOut.entries).toHaveLength(0);
  });

  it('surfaces a ฿0 invoice under ตรวจสอบ instead of silently dropping it', () => {
    const ledger = buildReceivablesLedger([row({ id: 'empty', totalAmount: 0 })], TODAY);
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.zeroTotalInvoices.map((e) => e.id)).toEqual(['empty']);
  });

  it('does not nudge about a CANCELLED zero-total invoice — that one was dealt with', () => {
    const ledger = buildReceivablesLedger(
      [row({ id: 'empty', totalAmount: 0, cancelledAt: '2026-09-01T00:00:00.000Z' })],
      TODAY
    );
    expect(ledger.zeroTotalInvoices).toHaveLength(0);
  });

  it('drops a settled invoice out of the ledger entirely — paying clears it with no extra action', () => {
    const ledger = buildReceivablesLedger(
      [row({ totalAmount: 100000, paidAmount: 100000, dueDate: '2026-01-01' })],
      TODAY
    );
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.totalOutstanding).toBe(0);
  });

  // ── WHEN THE CORRECTION IS ITSELF CANCELLED ───────────────────────────────
  // The original resolved terminal "superseded" BEFORE anything checked whether
  // the row that superseded it was still alive, so ฿80,000 of real debt was
  // absent from entries, totalOutstanding, every bucket and the overdue
  // headline — and nothing surfaced it.
  describe('a cancelled newer version', () => {
    it('gives the debt back to the original instead of making it permanently terminal', () => {
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22', totalAmount: 80000, supersededById: 'v2' }),
          row({
            id: 'v2',
            docNo: 'INV050926-22v1',
            totalAmount: 80000,
            cancelledAt: '2026-09-05T00:00:00.000Z',
          }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v1']);
      expect(ledger.totalOutstanding).toBe(80000);
      expect(ledger.buckets.find((b) => b.id === 'd1_30')!.amount).toBe(80000);
      expect(ledger.overdueOutstanding).toBe(80000);
    });

    it('SAYS SO on the row — the debt is back, and an admin who cancelled v1 is told why', () => {
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22', supersededById: 'v2' }),
          row({ id: 'v2', docNo: 'INV050926-22v1', cancelledAt: '2026-09-05T00:00:00.000Z' }),
        ],
        TODAY
      );
      const entry = ledger.entries[0];
      expect(entry.status.revivedFromCancelledSuccessor).toBe(true);
      expect(entry.supersededByDocNo).toBe('INV050926-22v1');
      expect(ledger.revivedSupersededDocs.map((e) => e.id)).toEqual(['v1']);
      expect(REVIVED_SUPERSEDE_LABEL).toContain('เวอร์ชันใหม่');
    });

    it('does the same for rows that predate supersededById, detected by the docNo alone', () => {
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22' }),
          row({ id: 'v2', docNo: 'INV050926-22v1', cancelledAt: '2026-09-05T00:00:00.000Z' }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v1']);
      expect(ledger.entries[0].status.revivedFromCancelledSuccessor).toBe(true);
      expect(ledger.entries[0].supersededByDocNo).toBe('INV050926-22v1');
    });

    it('never revives a row that a LATER, LIVE version still replaces — that would bill it twice', () => {
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22' }),
          row({ id: 'v2', docNo: 'INV050926-22v1', cancelledAt: '2026-09-05T00:00:00.000Z' }),
          row({ id: 'v3', docNo: 'INV050926-22v2' }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v3']);
      expect(ledger.totalOutstanding).toBe(100000);
      expect(ledger.revivedSupersededDocs).toHaveLength(0);
    });

    it('hands the debt to the surviving MIDDLE version, not back to the original', () => {
      // v2 replaced v1 and is alive; v3 replaced v2 and was cancelled. Exactly
      // one row may carry the debt, and it is v2.
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22', supersededById: 'v2' }),
          row({ id: 'v2', docNo: 'INV050926-22v1', supersededById: 'v3' }),
          row({
            id: 'v3',
            docNo: 'INV050926-22v2',
            cancelledAt: '2026-09-05T00:00:00.000Z',
          }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v2']);
      expect(ledger.totalOutstanding).toBe(100000);
    });

    it('does the same by docNo alone: the middle version survives, and nothing is billed twice', () => {
      // The un-stamped path has to pick the highest LIVE version, not the
      // highest version: reading v2 as the replacement of both older rows would
      // revive BOTH of them and bill the customer twice.
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22' }),
          row({ id: 'v2', docNo: 'INV050926-22v1' }),
          row({
            id: 'v3',
            docNo: 'INV050926-22v2',
            cancelledAt: '2026-09-05T00:00:00.000Z',
          }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v2']);
      expect(ledger.totalOutstanding).toBe(100000);
      expect(ledger.revivedSupersededDocs.map((e) => e.id)).toEqual(['v2']);
    });

    it('cancelling the ORIGINAL instead leaves the live newer version carrying the debt, once', () => {
      const ledger = buildReceivablesLedger(
        [
          row({
            id: 'v1',
            docNo: 'INV050926-22',
            supersededById: 'v2',
            cancelledAt: '2026-09-05T00:00:00.000Z',
          }),
          row({ id: 'v2', docNo: 'INV050926-22v1' }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v2']);
      expect(ledger.totalOutstanding).toBe(100000);
    });

    it('keeps a stamped supersede terminal when the newer row is not in this page of results', () => {
      // LIMIT 2000: a row we cannot see cannot be judged, and wrongly reviving a
      // debt that IS covered elsewhere would bill the customer twice.
      const ledger = buildReceivablesLedger(
        [row({ id: 'v1', docNo: 'INV050926-22', supersededById: 'somewhere-else' })],
        TODAY
      );
      expect(ledger.entries).toHaveLength(0);
      expect(ledger.revivedSupersededDocs).toHaveLength(0);
    });

    it('never lets a row supersede ITSELF out of the ledger', () => {
      const ledger = buildReceivablesLedger(
        [row({ id: 'same', docNo: 'INV050926-22', supersededById: 'same' })],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['same']);
    });

    it('makes the revived invoice count as covering its quotation again (no duplicate ใบวางบิล nudge)', () => {
      const ledger = buildReceivablesLedger(
        [
          row({ id: 'v1', docNo: 'INV050926-22', linkedQuotationId: 'q1', supersededById: 'v2' }),
          row({
            id: 'v2',
            docNo: 'INV050926-22v1',
            linkedQuotationId: 'q1',
            cancelledAt: '2026-09-05T00:00:00.000Z',
          }),
          row({ id: 'bn', docType: 'billing_note', docNo: 'BN050926-22', linkedQuotationId: 'q1' }),
        ],
        TODAY
      );
      expect(ledger.entries.map((e) => e.id)).toEqual(['v1']);
      expect(ledger.unlinkedBillingNotes).toHaveLength(0);
    });
  });

  it('falls back to the docNo when a row has no customer name, so no row is ever anonymous', () => {
    const ledger = buildReceivablesLedger(
      [row({ customerName: '', docNo: 'INV260801-77' })],
      TODAY
    );
    expect(ledger.customers[0].customerName).toBe('INV260801-77');
  });
});

// ── THE MONEY, END TO END ───────────────────────────────────────────────────
// The whole chain in one place: a document built from a quotation carrying a
// per-line discount AND a document discount AND VAT, stored through the SAME
// deriveBillingColumns the save path uses, then a deposit and the balance.
//
// The two things that must hold, because the owner acts on them:
//  1. the stored `totalAmount` is the satang the PRINTED sheet shows — the
//     ledger and the paper can never name two different debts;
//  2. paying in full lands on EXACTLY 0, not 0.01 and not float dust, so an
//     invoice can actually be closed and its alert can actually clear.
describe('THE MONEY — a discounted, VAT-ed invoice paid by deposit then balance', () => {
  const data = {
    docDate: '2026-09-01',
    customerCompany: 'บริษัท ทดสอบ จำกัด',
    customerPhone: '02-123-4567',
    items: [
      // A per-line discount, on an odd base that leaves float dust.
      { qty: 3, unitPrice: 12345.67, discount: 7, discountType: 'percent' as const },
      { qty: 1, unitPrice: 8999.99 },
    ],
    discount: 5, // …and a document discount on top of it,
    discountType: 'percent' as const,
    vatEnabled: true, // …and 7% VAT on what is left.
  };

  it('stores the SAME satang the printed sheet prints', () => {
    const printed = computeQuoteTotals(data).grandTotal;
    const stored = deriveBillingColumns(data).totalAmount;
    // The sheet prints grandTotal at 2dp; the column holds it settled to 2dp.
    expect(stored.toFixed(2)).toBe(printed.toFixed(2));
    expect(stored).toBe(44161.24);
    // …and the raw float really was dusty, which is why round2 is needed here.
    expect(printed).not.toBe(stored);
  });

  it('a 50% deposit leaves exactly the printed balance outstanding', () => {
    const total = deriveBillingColumns(data).totalAmount;
    const deposit = round2(total / 2);
    const s = status({ totalAmount: total, paidAmount: deposit, dueDate: '2026-10-01' });
    expect(s.paymentState).toBe('partial');
    expect(s.outstanding.toFixed(2)).toBe('22080.62');
    expect(s.isOpen).toBe(true);
  });

  it('the balance closes it at EXACTLY zero — not 0.01, not dust', () => {
    const total = deriveBillingColumns(data).totalAmount;
    const deposit = round2(total / 2);
    const balance = round2(
      status({ totalAmount: total, paidAmount: deposit }).outstanding
    );
    // DECIMAL(12,2) SUM over the two stored payment rows.
    const paid = round2(deposit + balance);
    expect(paid).toBe(total);

    const done = status({ totalAmount: total, paidAmount: paid, dueDate: '2026-10-01' });
    expect(done.outstanding).toBe(0);
    expect(done.overpaidBy).toBe(0);
    expect(done.paymentState).toBe('paid');
    expect(done.isOpen).toBe(false);
  });

  // Not one lucky number: the deposit/balance round trip has to close on any
  // VAT base, or some invoices simply can never be marked paid.
  it('closes at zero for every odd VAT base, not just this one', () => {
    for (const unitPrice of [0.01, 7.77, 1234.56, 9999.99, 33333.33, 123456.78]) {
      const total = deriveBillingColumns({ items: [{ qty: 1, unitPrice }], vatEnabled: true })
        .totalAmount;
      const deposit = round2(total / 2);
      const balance = round2(status({ totalAmount: total, paidAmount: deposit }).outstanding);
      const done = status({ totalAmount: total, paidAmount: round2(deposit + balance) });
      expect([unitPrice, done.outstanding, done.paymentState]).toEqual([unitPrice, 0, 'paid']);
    }
  });
});
