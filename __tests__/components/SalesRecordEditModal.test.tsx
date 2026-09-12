import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SalesRecordEditModal from '@/app/components/modals/SalesRecordEditModal';

/**
 * The one-product edit form vs. a bill that holds several products.
 *
 * `PUT /api/admin/sales/[id]` REFUSES a scalar money edit on a multi-line bill
 * (`SaleScalarsNotAttributableError` → 400), because there is no defensible way
 * to split one จำนวน / ราคา/หน่วย across two different products and accepting
 * it left `sales_records.totalAmount` and SUM(line items) disagreeing forever.
 * This form's job is to make that refusal visible BEFORE the admin types:
 * the money boxes are locked and the reason is on screen, in Thai, with where
 * to make the change instead.
 */

const LOOKUPS = {
  customers: [{ id: 'c-1', name: 'คุณเอ', companyId: 'co-1' }],
  companies: [{ id: 'co-1', name: 'บริษัท เอ จำกัด' }],
  products: [{ id: 'p-b', title_th: 'Scale B' }],
  salespeople: [{ id: 'sp-1', name: 'สมชาย' }],
};

/** The 2-line bill from the report: ฿30,000 + ฿50,000 = ฿80,000. */
const MULTI_LINE_ITEMS = [
  { id: 'i1', productName: 'Scale A', qty: 1, unitPrice: 30000, totalAmount: 30000 },
  { id: 'i2', productName: 'Scale B', qty: 1, unitPrice: 50000, totalAmount: 50000 },
];

const RECORD = {
  id: 'rec-multi',
  saleType: 'equipment',
  salespersonId: 'sp-1',
  customerId: 'c-1',
  companyId: 'co-1',
  productId: 'p-b',
  productName: 'Scale B',
  categoryId: 1,
  qty: 2,
  unitPrice: 50000,
  totalAmount: 80000,
  saleDate: '2026-09-05',
  quotationRef: 'QT-9',
  poRef: 'PO-9',
  deliveryRef: '',
  invoiceRef: '',
  receiptRef: '',
  warrantyStartDate: '2026-09-05',
  warrantyEndDate: '2027-09-04',
  equipments: [],
  note: '',
};

/** Answers exactly the three requests the modal makes for an existing record. */
function installFetch(items: unknown[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/items')) {
      return { ok: true, json: async () => ({ items }) } as Response;
    }
    if (url.endsWith('/costs')) {
      return { ok: true, json: async () => ({ items: [] }) } as Response;
    }
    return { ok: true, json: async () => RECORD } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderModal() {
  return render(
    <SalesRecordEditModal
      editingId="rec-multi"
      onClose={vi.fn()}
      onSaveSuccess={vi.fn()}
      {...LOOKUPS}
    />
  );
}

describe('SalesRecordEditModal — a bill this form cannot describe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('locks the money boxes on a MULTI-line bill and says why, and where to go', async () => {
    installFetch(MULTI_LINE_ITEMS);
    renderModal();

    // The reason is on screen before anything is typed.
    expect(await screen.findByText('ใบขายนี้มีสินค้า 2 รายการ')).toBeInTheDocument();
    expect(screen.getByText(/ให้ลบใบขายนี้แล้วสร้างใหม่จากใบเสนอราคาเดิม/)).toBeInTheDocument();

    // ...and every field whose truth lives in the line items is read-only.
    expect(screen.getByDisplayValue('Scale B')).toBeDisabled(); // ชื่อสินค้าที่แสดง
    expect(screen.getByPlaceholderText('1')).toBeDisabled(); // จำนวน
    expect(screen.getByDisplayValue('50,000')).toBeDisabled(); // ราคาต่อหน่วย
    expect(screen.getByDisplayValue('80,000')).toBeDisabled(); // ยอดรวม

    // Everything the admin legitimately opens this form for stays editable —
    // a blanket refusal would block filling in the invoice number.
    expect(screen.getByPlaceholderText('เลขที่ใบ Invoice')).not.toBeDisabled();
    expect(screen.getByDisplayValue('PO-9')).not.toBeDisabled();
  });

  it('leaves a SINGLE-line bill exactly as it was — nothing locked, no notice', async () => {
    installFetch([MULTI_LINE_ITEMS[1]]);
    renderModal();

    expect(await screen.findByDisplayValue('Scale B')).not.toBeDisabled();
    expect(screen.getByPlaceholderText('1')).not.toBeDisabled();
    expect(screen.getByDisplayValue('50,000')).not.toBeDisabled();
    expect(screen.getByDisplayValue('80,000')).not.toBeDisabled();
    expect(screen.queryByText(/ใบขายนี้มีสินค้า/)).not.toBeInTheDocument();
  });

  it('leaves the fields editable when the line lookup fails — the PUT is the authority', async () => {
    // A hint that cannot be loaded must not silently lock a perfectly ordinary
    // single-product sale out of being edited.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/items')) return { ok: false, json: async () => ({}) } as Response;
        if (url.endsWith('/costs')) return { ok: true, json: async () => ({ items: [] }) } as Response;
        return { ok: true, json: async () => RECORD } as Response;
      })
    );
    renderModal();

    await waitFor(() => expect(screen.getByPlaceholderText('1')).not.toBeDisabled());
    expect(screen.queryByText(/ใบขายนี้มีสินค้า/)).not.toBeInTheDocument();
  });
});
