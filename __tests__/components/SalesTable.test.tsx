import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SalesTable from '@/app/dashboard/SalesTable';
import type { SalesRecord } from '@/app/lib/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRecord(over: Partial<SalesRecord> = {}): SalesRecord {
  return {
    id: 'sale-1',
    salespersonId: 'sp-1',
    customerId: 'c-1',
    companyId: 'co-1',
    productId: 'p-1',
    productName: 'เครื่องชั่ง XA-220',
    categoryId: 1,
    qty: 1,
    unitPrice: 120000,
    totalAmount: 300000,
    costAmount: 207000,
    saleType: 'equipment',
    saleDate: '2026-03-10',
    quotationRef: 'QT-2026-001',
    poRef: '',
    deliveryRef: '',
    invoiceRef: '',
    receiptRef: '',
    warrantyStartDate: null,
    warrantyEndDate: null,
    equipmentId: null,
    note: '',
    createdAt: '2026-03-10T00:00:00.000Z',
    salespersonName: 'สมชาย',
    customerName: 'คุณเอ',
    companyName: 'บริษัท เอ จำกัด',
    ...over,
  };
}

const ITEMS_BODY = {
  salesRecordId: 'sale-1',
  quotationId: 'q-77',
  quotationRef: 'QT-2026-001',
  items: [
    { id: 'i1', productName: 'เครื่องชั่ง XA-220', qty: 1, unitPrice: 120000, totalAmount: 120000, costAmount: 80000 },
    { id: 'i2', productName: 'เครื่องชั่ง PS-1000', qty: 2, unitPrice: 45000, totalAmount: 90000, costAmount: 60000 },
    { id: 'i3', productName: 'ตู้อบ OV-50', qty: 1, unitPrice: 90000, totalAmount: 90000, costAmount: 55000 },
  ],
  equipments: [
    {
      id: 'e1', productName: 'เครื่องชั่ง XA-220', serialNumber: 'SN-001',
      warrantyType: 'ประกันศูนย์', warrantyStartDate: '2026-03-10', warrantyEndDate: '2027-03-09', status: 'Active',
    },
  ],
};

function renderTable(props: Partial<React.ComponentProps<typeof SalesTable>> = {}) {
  const onView = vi.fn();
  const utils = render(
    <SalesTable
      records={[makeRecord()]}
      recordSearch=""
      setRecordSearch={vi.fn()}
      recordMonth=""
      setRecordMonth={vi.fn()}
      recordYear=""
      setRecordYear={vi.fn()}
      onView={onView}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onHide={vi.fn()}
      {...props}
    />
  );
  return { ...utils, onView };
}

const expandButton = () => screen.getByRole('button', { name: 'ดูรายการสินค้าในบิล' });

/** Queues one JSON response per call, in order. */
function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  const fetchMock = vi.fn();
  responses.forEach((r) =>
    fetchMock.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body ?? {},
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SalesTable — expandable sale rows', () => {
  it('fires no detail request for rows nobody expanded', () => {
    const fetchMock = mockFetchSequence([]);
    const records = Array.from({ length: 50 }, (_, i) =>
      makeRecord({ id: `sale-${i}`, productName: `สินค้า ${i}` })
    );
    renderTable({ records });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expanding loads the line items and the machines of that bill', async () => {
    mockFetchSequence([
      { ok: true, body: ITEMS_BODY },
      { ok: true, body: { id: 'q-77' } }, // quotation existence probe
    ]);
    renderTable();

    fireEvent.click(expandButton());

    expect(await screen.findByText('รายการสินค้าในบิล (3)')).toBeInTheDocument();
    expect(screen.getByText('เครื่องชั่ง PS-1000')).toBeInTheDocument();
    expect(screen.getByText('฿45,000.00')).toBeInTheDocument(); // unit price
    expect(screen.getByText('เครื่องในบิลนี้ (1)')).toBeInTheDocument();
    expect(screen.getByText('SN-001')).toBeInTheDocument();
    expect(screen.getByText('2027-03-09')).toBeInTheDocument(); // warranty end
  });

  it('fetches once per row and serves the cache on re-expand', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { ...ITEMS_BODY, quotationId: null } },
    ]);
    renderTable();

    fireEvent.click(expandButton());
    await screen.findByText('รายการสินค้าในบิล (3)');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายการในบิล' }));
    fireEvent.click(expandButton());

    await screen.findByText('รายการสินค้าในบิล (3)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/sales/sale-1/items');
  });

  it('expanding does not open the view modal (row click still does)', async () => {
    mockFetchSequence([{ ok: true, body: { ...ITEMS_BODY, quotationId: null } }]);
    const { onView } = renderTable();

    fireEvent.click(expandButton());
    await screen.findByText('รายการสินค้าในบิล (3)');
    expect(onView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('คุณเอ'));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('a legacy backfilled sale expands to exactly one line, not an error', async () => {
    mockFetchSequence([
      {
        ok: true,
        body: {
          salesRecordId: 'sale-1', quotationId: null, quotationRef: '',
          items: [{ id: 'i1', productName: 'เครื่องเก่า', qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 30000 }],
          equipments: [],
        },
      },
    ]);
    renderTable();

    fireEvent.click(expandButton());

    expect(await screen.findByText('รายการสินค้าในบิล (1)')).toBeInTheDocument();
    expect(screen.getByText('เครื่องเก่า')).toBeInTheDocument();
    expect(screen.queryByText('โหลดรายการสินค้าในใบขายไม่สำเร็จ')).not.toBeInTheDocument();
    // No machines is a normal state for this bill, explained rather than blank.
    expect(screen.getByText('ไม่มีเครื่อง/Serial number ที่ผูกกับใบขายนี้')).toBeInTheDocument();
  });

  it('offers the source quotation when the sale has one and it still exists', async () => {
    mockFetchSequence([
      { ok: true, body: ITEMS_BODY },
      { ok: true, body: { id: 'q-77' } },
    ]);
    renderTable();

    fireEvent.click(expandButton());

    const link = await screen.findByRole('link', { name: /เปิดใบเสนอราคาต้นทาง/ });
    expect(link).toHaveAttribute('href', '/quotation?id=q-77&view=1');
  });

  it('disables the button with "ใบเสนอราคาถูกลบแล้ว" when the quotation was purged', async () => {
    mockFetchSequence([
      { ok: true, body: ITEMS_BODY },
      { ok: false, status: 404, body: { error: 'ไม่พบใบเสนอราคา' } },
    ]);
    renderTable();

    fireEvent.click(expandButton());

    expect(await screen.findByText('ใบเสนอราคาถูกลบแล้ว')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เปิดใบเสนอราคาต้นทาง' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /เปิดใบเสนอราคาต้นทาง/ })).not.toBeInTheDocument();
  });

  it('does not claim a deletion when the probe itself failed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ITEMS_BODY })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    renderTable();

    fireEvent.click(expandButton());

    expect(await screen.findByText('ตรวจสอบใบเสนอราคาไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เปิดใบเสนอราคาต้นทาง' })).toBeDisabled();
    expect(screen.queryByText('ใบเสนอราคาถูกลบแล้ว')).not.toBeInTheDocument();
  });

  it('says so when the sale has no source quotation, and still lists the bill', async () => {
    mockFetchSequence([{ ok: true, body: { ...ITEMS_BODY, quotationId: null } }]);
    renderTable();

    fireEvent.click(expandButton());

    expect(await screen.findByText('ใบขายนี้ไม่ได้มาจากใบเสนอราคาในระบบ')).toBeInTheDocument();
    expect(screen.getByText('ตู้อบ OV-50')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /เปิดใบเสนอราคาต้นทาง/ })).not.toBeInTheDocument();
  });

  it('keeps a failed detail fetch inside the expanded area, with a retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...ITEMS_BODY, quotationId: null }) });
    vi.stubGlobal('fetch', fetchMock);
    renderTable({ records: [makeRecord(), makeRecord({ id: 'sale-2', productName: 'แถวข้างบน' })] });

    fireEvent.click(screen.getAllByRole('button', { name: 'ดูรายการสินค้าในบิล' })[0]);

    expect(await screen.findByText('โหลดรายการสินค้าในใบขายไม่สำเร็จ')).toBeInTheDocument();
    // The rest of the table survives.
    expect(screen.getByText('แถวข้างบน')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'ดูรายการสินค้าในบิล' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(await screen.findByText('รายการสินค้าในบิล (3)')).toBeInTheDocument();
  });

  it('shows a spinner while the detail is in flight', async () => {
    let resolve: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    vi.stubGlobal('fetch', fetchMock);
    renderTable();

    fireEvent.click(expandButton());
    expect(screen.getByText('กำลังโหลดรายการในบิล...')).toBeInTheDocument();

    resolve({ ok: true, status: 200, json: async () => ({ ...ITEMS_BODY, quotationId: null }) });
    await waitFor(() => expect(screen.queryByText('กำลังโหลดรายการในบิล...')).not.toBeInTheDocument());
  });

  it('collapses and drops the cache when the records list is refreshed', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, body: { ...ITEMS_BODY, quotationId: null } },
      { ok: true, body: { ...ITEMS_BODY, quotationId: null } },
    ]);
    const { rerender } = renderTable();

    fireEvent.click(expandButton());
    await screen.findByText('รายการสินค้าในบิล (3)');

    // Parent refetched after an edit: same id, new array identity.
    rerender(
      <SalesTable
        records={[makeRecord({ totalAmount: 290000 })]}
        recordSearch="" setRecordSearch={vi.fn()}
        recordMonth="" setRecordMonth={vi.fn()}
        recordYear="" setRecordYear={vi.fn()}
        onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onHide={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.queryByText('รายการสินค้าในบิล (3)')).not.toBeInTheDocument());
    fireEvent.click(expandButton());
    await screen.findByText('รายการสินค้าในบิล (3)');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders one detail panel per expanded row, independently', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...ITEMS_BODY, quotationId: null }) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          salesRecordId: 'sale-2', quotationId: null, quotationRef: '',
          items: [{ id: 'x', productName: 'สินค้าใบที่สอง', qty: 1, unitPrice: 10, totalAmount: 10, costAmount: 5 }],
          equipments: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    renderTable({ records: [makeRecord(), makeRecord({ id: 'sale-2' })] });

    const buttons = screen.getAllByRole('button', { name: 'ดูรายการสินค้าในบิล' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await screen.findByText('รายการสินค้าในบิล (3)');
    await screen.findByText('สินค้าใบที่สอง');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(within(document.body).getAllByText(/รายการสินค้าในบิล/)).toHaveLength(2);
  });
});
