/**
 * The /assets and /stock pages: the free-text-with-suggestions field, the
 * supplier field (list or typed), the status fields, the register page
 * (search, totals, many-at-once, Excel), adding pieces, one piece's page, and
 * the sticker page. Spec: openspec/changes/add-inventory-tracking.
 */
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InventoryGroup, InventoryItem, InventoryEvent } from '@/app/lib/types';

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/stock',
  useSearchParams: () => searchParams,
}));
vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));
vi.mock('@/app/lib/xlsxExport', () => ({ downloadExcel: vi.fn(async () => {}) }));
import { downloadExcel } from '@/app/lib/xlsxExport';
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') } }));
import QRCode from 'qrcode';

import SuggestField from '@/app/components/SuggestField';
import { SupplierField, StatusFields, missingStatusField } from '@/app/components/inventory/InventoryFields';
import InventoryListPage from '@/app/components/inventory/InventoryListPage';
import AddItemsModal from '@/app/components/inventory/AddItemsModal';
import InventoryItemPage, { describeEvent } from '@/app/components/inventory/InventoryItemPage';
import InventoryLabelsPage from '@/app/components/inventory/InventoryLabelsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  sessionStorage.clear();
});

/** Open a SearchableDropdown by its trigger's text and type into its search box. */
function openAndType(triggerText: string | RegExp, text?: string) {
  fireEvent.click(screen.getByRole('button', { name: triggerText }));
  if (text !== undefined) fireEvent.change(screen.getByPlaceholderText('ค้นหา...'), { target: { value: text } });
}

// ── Fields ────────────────────────────────────────────────────────────────────

describe('SuggestField', () => {
  const suggestions = ['คลัง A', 'คลัง B', 'Lab'];

  it('offers what was typed, then the matching suggestions', () => {
    const onChange = vi.fn();
    render(<SuggestField value="" onChange={onChange} suggestions={suggestions} />);
    openAndType('พิมพ์หรือเลือก…', 'คลัง');
    expect(screen.getByText('ใช้ “คลัง”')).toBeInTheDocument();
    expect(screen.getByText('คลัง B')).toBeInTheDocument();
    expect(screen.queryByText('Lab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('คลัง B'));
    expect(onChange).toHaveBeenCalledWith('คลัง B');
  });

  it('takes a new value as typed', () => {
    const onChange = vi.fn();
    render(<SuggestField value="" onChange={onChange} suggestions={suggestions} />);
    openAndType('พิมพ์หรือเลือก…', '  ห้องใหม่ ');
    fireEvent.click(screen.getByText('ใช้ “ห้องใหม่”'));
    expect(onChange).toHaveBeenCalledWith('ห้องใหม่');
  });

  it('shows the current value and can clear it', () => {
    const onChange = vi.fn();
    render(<SuggestField value="ห้องแล็บเก่า" onChange={onChange} suggestions={suggestions} />);
    openAndType('ห้องแล็บเก่า');
    fireEvent.click(screen.getByText('— ล้างค่า —'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('SupplierField — from Suppliers, or typed', () => {
  const suppliers = [{ id: 's1', companyName: 'Ohaus Thailand' }];

  it('picking a supplier keeps its id; typing keeps only the name', () => {
    const onChange = vi.fn();
    render(<SupplierField value={{ supplierId: null, supplierName: '' }} onChange={onChange} suppliers={suppliers} typedBefore={['ร้าน ก', 'ohaus thailand']} />);
    openAndType(/เลือกจาก Suppliers/);
    expect(screen.getByText('จากรายชื่อ Suppliers')).toBeInTheDocument();
    expect(screen.getByText('ร้าน ก')).toBeInTheDocument();
    // A typed name that IS a supplier is not offered twice.
    expect(screen.getAllByText(/ohaus thailand/i)).toHaveLength(1);
    fireEvent.click(screen.getByText('Ohaus Thailand'));
    expect(onChange).toHaveBeenLastCalledWith({ supplierId: 's1', supplierName: 'Ohaus Thailand' });

    openAndType(/เลือกจาก Suppliers/, 'ร้านใหม่');
    fireEvent.click(screen.getByText('ใช้ “ร้านใหม่”'));
    expect(onChange).toHaveBeenLastCalledWith({ supplierId: null, supplierName: 'ร้านใหม่' });
  });

  it('a linked supplier that is gone shows the name the piece carries', () => {
    render(<SupplierField value={{ supplierId: 'gone', supplierName: 'Old Co' }} onChange={vi.fn()} suppliers={suppliers} typedBefore={[]} />);
    expect(screen.getByRole('button', { name: 'Old Co' })).toBeInTheDocument();
  });
});

describe('StatusFields', () => {
  it('a new status starts with empty extra fields', () => {
    const onChange = vi.fn();
    render(<StatusFields kind="asset" value={{ status: 'repair', statusParty: 'ร้าน A', statusDate: '' }} onChange={onChange} partySuggestions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'ส่งซ่อม' }));
    fireEvent.click(screen.getByText('ยืมออก'));
    expect(onChange).toHaveBeenCalledWith({ status: 'loaned', statusParty: '', statusDate: '' });
  });

  it('shows the fields the status asks for', () => {
    render(<StatusFields kind="asset" value={{ status: 'loaned', statusParty: '', statusDate: '' }} onChange={vi.fn()} partySuggestions={[]} />);
    expect(screen.getByText('ผู้ยืม')).toBeInTheDocument();
    expect(screen.getByText('กำหนดคืน')).toBeInTheDocument();
  });

  it('missingStatusField names what is still empty', () => {
    expect(missingStatusField('asset', { status: 'loaned', statusParty: ' ', statusDate: '' })).toBe('กรุณาระบุผู้ยืม');
    expect(missingStatusField('stock', { status: 'sold', statusParty: '', statusDate: '' })).toBe('กรุณาระบุวันที่ขาย');
    expect(missingStatusField('stock', { status: '', statusParty: '', statusDate: '' })).toBe('กรุณาเลือกสถานะ');
    expect(missingStatusField('asset', { status: 'in_use', statusParty: '', statusDate: '' })).toBeNull();
  });
});

// ── Data for the pages ────────────────────────────────────────────────────────

const group = (id: string, name: string): InventoryGroup => ({
  id, kind: 'stock', name, brand: 'Ohaus', model: 'PX', category: 'เครื่องชั่ง', note: '', createdAt: 'c', updatedAt: 'u',
});
const piece = (id: string, groupId: string, seq: number, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id, kind: 'stock', groupId, code: `ST-${String(seq).padStart(4, '0')}`, seq, serialNumber: '', purchaseDate: '2026-09-01',
  price: 1000, supplierId: null, supplierName: '', location: 'คลัง A', custodian: '', warrantyUntil: null,
  status: 'available', statusParty: '', statusDate: null, note: '', createdAt: 'c', updatedAt: 'u', ...over,
});

const G1 = group('g1', 'เครื่องชั่ง');
const G2 = group('g2', 'ปิเปต');
const G3 = group('g3', 'รายการว่าง');
const P1 = piece('p1', 'g1', 1, { serialNumber: 'SN1' });
const P2 = piece('p2', 'g1', 2, { status: 'sold', statusDate: '2026-09-10' });
const P3 = piece('p3', 'g2', 3, { price: 250 });

type Call = { url: string; method: string; body: unknown };
function stubApi(handlers: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const key = `${method} ${url}`;
      const handler = handlers[key];
      if (!handler) return { ok: true, status: 200, json: async () => [] };
      const result = handler(body);
      if (result instanceof Response) return result;
      return { ok: true, status: 200, json: async () => result };
    })
  );
  return calls;
}

// ── The register page ─────────────────────────────────────────────────────────

describe('InventoryListPage', () => {
  beforeEach(() => {
    stubApi({ 'GET /api/admin/inventory/stock': () => ({ groups: [G1, G2, G3], items: [P1, P2, P3] }) });
  });

  it('shows groups, totals of what is still here, and status counts', async () => {
    render(<InventoryListPage kind="stock" />);
    expect(await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' })).toBeInTheDocument();
    expect(screen.getByText('ปิเปต', { selector: 'h2 button' })).toBeInTheDocument();
    expect(screen.getByText('รายการว่าง', { selector: 'h2 button' })).toBeInTheDocument();
    // 2 pieces still here (the sold one hidden), worth 1,250.
    const pieces = screen.getByText('ชิ้น', { selector: 'p' }).parentElement!;
    expect(within(pieces).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('฿1,250')).toBeInTheDocument();
    const soldCard = screen.getByRole('button', { name: /ขายแล้ว/ });
    expect(within(soldCard).getByText('1')).toBeInTheDocument();
  });

  it('search narrows to the matching group and opens it', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.change(screen.getByLabelText('ค้นหา'), { target: { value: 'sn1' } });
    expect(screen.queryByText('ปิเปต', { selector: 'h2 button' })).not.toBeInTheDocument();
    expect(screen.getByText('ST-0001')).toBeInTheDocument();
    expect(screen.queryByText('ST-0002')).not.toBeInTheDocument(); // sold: hidden
  });

  it('a search that only matches a piece that has left says so, and shows it on a tap', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.change(screen.getByLabelText('ค้นหา'), { target: { value: 'ST-0002' } });
    expect(screen.getByText('ไม่พบรายการที่ตรงกับการค้นหา')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/มี 1 ชิ้นที่ออกไปแล้วตรงกับการค้นหานี้/));
    expect(screen.getByText('ST-0002')).toBeInTheDocument();
  });

  it('each group heading holds a button that says whether it is open', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    const toggle = screen.getByRole('button', { name: 'เครื่องชั่ง' });
    expect(toggle.closest('h2')).not.toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'เครื่องชั่ง' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ST-0001')).toBeInTheDocument();
  });

  it('a group opened by a search can be closed with a tap', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.change(screen.getByLabelText('ค้นหา'), { target: { value: 'sn1' } });
    expect(screen.getByText('ST-0001')).toBeInTheDocument();
    fireEvent.click(screen.getByText('เครื่องชั่ง', { selector: 'h2 button' }));
    expect(screen.queryByText('ST-0001')).not.toBeInTheDocument();
  });

  it('a place filter still reads as set after every piece has left that place', async () => {
    let items = [P1, P3];
    stubApi({
      'GET /api/admin/inventory/stock': () => ({ groups: [G1, G2], items }),
      'POST /api/admin/inventory/stock/items/bulk': () => {
        items = items.map((i) => ({ ...i, location: 'คลัง C' }));
        return { updated: 2 };
      },
    });
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.click(screen.getByRole('button', { name: 'ทุกที่เก็บ' }));
    fireEvent.click(screen.getByText('คลัง A', { selector: 'span' }));
    fireEvent.click(screen.getByLabelText('เลือกทุกชิ้นของ เครื่องชั่ง'));
    fireEvent.click(screen.getByLabelText('เลือกทุกชิ้นของ ปิเปต'));
    fireEvent.click(screen.getByRole('button', { name: 'ย้ายที่เก็บ' }));
    openAndType('พิมพ์หรือเลือก…', 'คลัง C');
    fireEvent.click(screen.getByText('ใช้ “คลัง C”'));
    fireEvent.click(screen.getByRole('button', { name: 'ย้าย' }));
    expect(await screen.findByText('ไม่พบรายการที่ตรงกับการค้นหา')).toBeInTheDocument();
    // The box says why the list is empty — it does not fall back to "ทุกที่เก็บ".
    expect(screen.getByRole('button', { name: 'คลัง A' })).toBeInTheDocument();
  });

  it('a status card filters to that status, gone ones included', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.click(screen.getByRole('button', { name: /ขายแล้ว/ }));
    expect(screen.getByText('ST-0002')).toBeInTheDocument();
    expect(screen.queryByText('ปิเปต', { selector: 'h2 button' })).not.toBeInTheDocument();
  });

  it('"รวมรายการ" only when there is another group to merge into', async () => {
    stubApi({ 'GET /api/admin/inventory/stock': () => ({ groups: [G1], items: [P1] }) });
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    expect(screen.queryByRole('button', { name: 'รวมรายการ' })).not.toBeInTheDocument();
  });

  it('only an empty group offers "ลบรายการ"', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    expect(screen.getAllByRole('button', { name: 'ลบรายการ' })).toHaveLength(1);
  });

  it('pick pieces, move them: one bulk request, then a reload', async () => {
    const calls = stubApi({
      'GET /api/admin/inventory/stock': () => ({ groups: [G1, G2, G3], items: [P1, P2, P3] }),
      'POST /api/admin/inventory/stock/items/bulk': () => ({ updated: 2 }),
    });
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.click(screen.getByLabelText('เลือกทุกชิ้นของ เครื่องชั่ง'));
    fireEvent.click(screen.getByLabelText('เลือกทุกชิ้นของ ปิเปต'));
    expect(screen.getByText('เลือก 2 ชิ้น')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ย้ายที่เก็บ' }));
    openAndType('พิมพ์หรือเลือก…', 'คลัง C');
    fireEvent.click(screen.getByText('ใช้ “คลัง C”'));
    fireEvent.click(screen.getByRole('button', { name: 'ย้าย' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/admin/inventory/stock/items/bulk');
    expect(post.body).toEqual({ ids: ['p1', 'p3'], location: 'คลัง C' });
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/admin/inventory/stock').length).toBe(2));
  });

  it('exports what is shown to Excel', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.click(screen.getByRole('button', { name: 'ส่งออก Excel' }));
    await waitFor(() => expect(downloadExcel).toHaveBeenCalled());
    const [filename, sheets] = vi.mocked(downloadExcel).mock.calls[0];
    expect(filename).toMatch(/^สต็อกสินค้า_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheets[0].rows.map((r) => r['รหัส'])).toEqual(['ST-0001', 'ST-0003']);
  });

  it('stickers: the chosen pieces are handed to the sticker page', async () => {
    render(<InventoryListPage kind="stock" />);
    await screen.findByText('เครื่องชั่ง', { selector: 'h2 button' });
    fireEvent.click(screen.getByLabelText('เลือกทุกชิ้นของ ปิเปต'));
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์สติกเกอร์' }));
    expect(JSON.parse(sessionStorage.getItem('inventory-labels:stock')!)).toEqual(['p3']);
    expect(push).toHaveBeenCalledWith('/stock/labels');
  });
});

// ── Adding pieces ─────────────────────────────────────────────────────────────

describe('AddItemsModal', () => {
  it('warns about a serial already in use, asks, then sends one request', async () => {
    const calls = stubApi({
      'POST /api/admin/inventory/stock/items': (body) => ({
        group: G1,
        items: Array.from({ length: (body as { quantity: number }).quantity }, (_, i) => piece(`n${i}`, 'g1', 10 + i)),
      }),
    });
    const onAdded = vi.fn();
    render(<AddItemsModal kind="stock" groups={[G1, G2]} items={[P1]} suppliers={[]} presetGroupId="g1" onClose={vi.fn()} onAdded={onAdded} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('ซีเรียลชิ้นที่ 1'), { target: { value: 'sn1' } });
    fireEvent.change(screen.getByLabelText('ซีเรียลชิ้นที่ 2'), { target: { value: 'SN9' } });
    expect(screen.getByText('⚠ ซ้ำกับ ST-0001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก 2 ชิ้น' }));
    expect(screen.getByText('ซีเรียลอาจซ้ำ')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกต่อ' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('เพิ่ม 2 ชิ้นแล้ว (ST-0010 – ST-0011)'));
    expect(calls[0].body).toMatchObject({ groupId: 'g1', quantity: 2, serials: ['sn1', 'SN9'], status: 'available' });
  });

  it('a status that needs a detail is checked before sending', () => {
    const calls = stubApi({});
    render(<AddItemsModal kind="stock" groups={[G1]} items={[]} suppliers={[]} presetGroupId="g1" onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'พร้อมขาย' }));
    fireEvent.click(screen.getByText('จองแล้ว'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก 1 ชิ้น' }));
    // In the footer, beside the button just pressed — not at the foot of a long form.
    expect(screen.getByRole('alert')).toHaveTextContent('กรุณาระบุจองให้');
    expect(calls).toHaveLength(0);
  });

  it('a new group needs a name', () => {
    stubApi({});
    render(<AddItemsModal kind="stock" groups={[]} items={[]} suppliers={[]} onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก 1 ชิ้น' }));
    expect(screen.getByText('กรุณาระบุชื่อรายการ')).toBeInTheDocument();
  });
});

// ── One piece ─────────────────────────────────────────────────────────────────

describe('InventoryItemPage', () => {
  const events: InventoryEvent[] = [
    { id: 'e3', itemId: 'p1', eventType: 'location', fromValue: 'คลัง A', toValue: '', detail: '', createdAt: '2026-10-03T03:00:00.000Z' },
    { id: 'e2', itemId: 'p1', eventType: 'status', fromValue: 'available', toValue: 'reserved', detail: 'จองให้: บ. เอ', createdAt: '2026-10-02T03:00:00.000Z' },
    { id: 'e1', itemId: 'p1', eventType: 'created', fromValue: '', toValue: 'available', detail: 'ที่เก็บ: คลัง A', createdAt: '2026-10-01T03:00:00.000Z' },
  ];

  it('describeEvent puts each line in words', () => {
    expect(describeEvent('stock', events[0])).toBe('ย้ายที่เก็บ: คลัง A → ไม่ระบุ');
    expect(describeEvent('stock', events[1])).toBe('สถานะ: พร้อมขาย → จองแล้ว · จองให้: บ. เอ');
    expect(describeEvent('stock', events[2])).toBe('รับเข้า · พร้อมขาย · ที่เก็บ: คลัง A');
    expect(describeEvent('stock', { ...events[1], fromValue: 'reserved', toValue: 'reserved', detail: 'จองให้: บ. บี' })).toBe(
      'สถานะ: จองแล้ว · จองให้: บ. บี'
    );
  });

  it('shows the piece and its timeline; a status change is one PATCH', async () => {
    const calls = stubApi({
      'GET /api/admin/inventory/stock/items/p1': () => ({ item: P1, group: G1, events }),
      'PATCH /api/admin/inventory/stock/items/p1': () => P1,
    });
    render(<InventoryItemPage kind="stock" id="p1" />);
    expect(await screen.findByText('สถานะ: พร้อมขาย → จองแล้ว · จองให้: บ. เอ')).toBeInTheDocument();
    expect(screen.getByText('SN1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนสถานะ' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'พร้อมขาย' }));
    fireEvent.click(screen.getByText('ส่งซ่อม'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ status: 'repair', statusParty: '', statusDate: '' });
  });

  it('a piece that is not there says so', async () => {
    stubApi({ 'GET /api/admin/inventory/stock/items/nope': () => new Response('{}', { status: 404 }) });
    render(<InventoryItemPage kind="stock" id="nope" />);
    expect(await screen.findByText('ไม่พบชิ้นนี้ อาจถูกลบไปแล้ว')).toBeInTheDocument();
  });
});

// ── Stickers ──────────────────────────────────────────────────────────────────

describe('InventoryLabelsPage', () => {
  it('a QR per chosen piece pointing at its page, and the count', async () => {
    stubApi({ 'GET /api/admin/inventory/stock': () => ({ groups: [G1, G2], items: [P1, P2, P3] }) });
    searchParams = new URLSearchParams('ids=p3,p1');
    render(<InventoryLabelsPage kind="stock" />);
    expect(await screen.findByText(/2 ดวง · 1 หน้า/)).toBeInTheDocument();
    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledTimes(2));
    expect(vi.mocked(QRCode.toDataURL).mock.calls.map((c) => c[0])).toEqual([
      `${window.location.origin}/stock/item/p1`,
      `${window.location.origin}/stock/item/p3`,
    ]);
  });

  it('printing waits for the QR codes — and still works if drawing them fails', async () => {
    stubApi({ 'GET /api/admin/inventory/stock': () => ({ groups: [G1], items: [P1] }) });
    let finish!: (url: string) => void;
    vi.mocked(QRCode.toDataURL).mockImplementationOnce((() => new Promise<string>((r) => (finish = r))) as never);
    searchParams = new URLSearchParams('ids=p1');
    render(<InventoryLabelsPage kind="stock" />);
    const waiting = await screen.findByRole('button', { name: 'กำลังสร้าง QR…' });
    expect(waiting).toBeDisabled();
    finish('data:image/png;base64,QR');
    expect(await screen.findByRole('button', { name: 'พิมพ์' })).toBeEnabled();

    cleanup();
    vi.mocked(QRCode.toDataURL).mockRejectedValueOnce(new Error('no canvas'));
    render(<InventoryLabelsPage kind="stock" />);
    // Disabled while loading, then enabled once drawing the QR has failed.
    await waitFor(() => expect(screen.getByRole('button', { name: 'พิมพ์' })).toBeEnabled());
    expect(screen.getAllByText('ST-0001').length).toBeGreaterThan(0);
  });

  it('nothing chosen: says how to choose', async () => {
    stubApi({ 'GET /api/admin/inventory/stock': () => ({ groups: [G1], items: [P1] }) });
    render(<InventoryLabelsPage kind="stock" />);
    expect(await screen.findByText(/ยังไม่ได้เลือกชิ้นที่จะพิมพ์/)).toBeInTheDocument();
  });
});
