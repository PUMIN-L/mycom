import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import QuotationPage from '@/app/quotation/page';

/**
 * Where a NEW quotation number comes from.
 *
 * `used_docnos` is never purged, and a day's current DDMMYY prefix is another
 * day's legacy YYMMDD prefix a year earlier — 25 Oct 2026 and 26 Oct 2025 are
 * both "QT251026-". So the 7-day window (`GET /api/quotations/docnos` with no
 * base) cannot see last year's numbers, and minting from it hands the admin a
 * number the PRIMARY KEY already owns: the save is refused, nothing had warned
 * him, and pressing เซฟ again used to hand back the SAME number forever.
 *
 * Everything below is about that: the mint reads the UNWINDOWED ledger for both
 * of the day's prefixes, the duplicate warning reads the very same list, and a
 * number the server refuses moves the document FORWARD.
 */

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

interface DocRow {
  docNo: string;
  quotationId: string;
}

/** `used_docnos`, keyed by the prefix a `?base=` lookup would find it under. */
let ledgerByBase: Record<string, DocRow[]> = {};
/** What the (useless for minting) 7-day window answers. */
let recentWindow: DocRow[] = [];
/** Make the unwindowed lookup fail, so "I could not read it" is reachable. */
let baseLookupFails = false;
/** Queued responses for POST /api/quotations, in order. */
let saveResponses: Array<{ status: number; body: unknown }> = [];

const docnosUrls: string[] = [];
const postedDocNos: string[] = [];

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/quotations/docnos')) {
      docnosUrls.push(url);
      const bases = new URLSearchParams(url.split('?')[1] ?? '').getAll('base');
      if (bases.length === 0) return { ok: true, status: 200, json: async () => recentWindow };
      if (baseLookupFails) return { ok: false, status: 500, json: async () => ({}) };
      const merged = new Map<string, DocRow>();
      for (const base of bases) {
        for (const row of ledgerByBase[base] ?? []) merged.set(row.docNo, row);
      }
      return { ok: true, status: 200, json: async () => Array.from(merged.values()) };
    }
    if (url === '/api/quotations' && init?.method === 'POST') {
      postedDocNos.push(JSON.parse(String(init.body)).docNo);
      const next = saveResponses.shift() ?? { status: 200, body: {} };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
      };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The two prefixes 25 Oct 2026 may legitimately carry (current, then legacy). */
const CURRENT_PREFIX = 'QT251026-';
const LEGACY_PREFIX = 'QT261025-';

/** Numbers issued on 26 Oct 2025 under the LEGACY shape — same prefix string. */
function lastYearsNumbers(...trailing: number[]): DocRow[] {
  return trailing.map((n) => ({
    docNo: `${CURRENT_PREFIX}${n}`,
    quotationId: `quote-2025-${n}`,
  }));
}

/** Scoped to the FORM: the printed A4 sheet repeats these labels verbatim. */
const fieldInput = (label: string) => {
  const lab = Array.from(document.querySelectorAll('.quote-form label')).find(
    (l) => l.textContent?.trim() === label
  );
  const el = lab?.parentElement?.querySelector('input');
  if (!el) throw new Error(`no input under ${label}`);
  return el as HTMLInputElement;
};
const docNoInput = () => fieldInput('เลขที่ (No.)');
const dateInput = () => fieldInput('วันที่ (Date)');
const saveButton = () => screen.getByRole('button', { name: '💾 เซฟ' });

/** Render, then move the document onto 25 Oct 2026 the way an admin would. */
async function openOn25Oct2026() {
  render(<QuotationPage />);
  await waitFor(() => expect(docNoInput().value).not.toBe(''));
  fireEvent.change(dateInput(), { target: { value: '2026-10-25' } });
  await waitFor(() =>
    expect(docnosUrls.some((u) => u.includes(`base=${CURRENT_PREFIX}`))).toBe(true)
  );
}

beforeEach(() => {
  ledgerByBase = {};
  recentWindow = [];
  baseLookupFails = false;
  saveResponses = [];
  docnosUrls.length = 0;
  postedDocNos.length = 0;
  vi.clearAllMocks();
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quotation builder — minting the running number', () => {
  it('asks the unwindowed ledger for BOTH of the day’s prefixes', async () => {
    await openOn25Oct2026();
    const mintLookup = docnosUrls.find((u) => u.includes(`base=${CURRENT_PREFIX}`));
    expect(mintLookup).toBeDefined();
    // The legacy shape of the SAME day goes in the same request, or a number
    // issued before the DDMMYY switchover would be invisible and the day's
    // sequence would restart on top of it.
    expect(mintLookup).toContain(`base=${LEGACY_PREFIX}`);
  });

  it('continues past numbers the 7-day window cannot see (the cross-year collision)', async () => {
    // QT251026-22 … -25 were issued on 26 Oct 2025, a year outside the window.
    recentWindow = [];
    ledgerByBase[CURRENT_PREFIX] = lastYearsNumbers(22, 23, 24, 25);

    await openOn25Oct2026();

    // Not QT251026-22 — that one is already with a customer and the
    // used_docnos PRIMARY KEY would refuse the save with nothing said first.
    await waitFor(() => expect(docNoInput().value).toBe('QT251026-26'));
  });

  it('does not mint at all until the ledger for THIS date has been read', async () => {
    let release!: (rows: DocRow[]) => void;
    const pending = new Promise<DocRow[]>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/quotations/docnos?')) {
        return { ok: true, status: 200, json: async () => pending };
      }
      if (url.startsWith('/api/quotations/docnos')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuotationPage />);
    await waitFor(() => expect(docNoInput().value).not.toBe(''));
    fireEvent.change(dateInput(), { target: { value: '2026-10-25' } });

    // Nothing is minted while the answer is outstanding. An unread ledger is
    // "I do not know", never "nothing is taken", so QT251026-22 must NOT be
    // handed out on the strength of a list nobody has read yet.
    await new Promise((r) => setTimeout(r, 60));
    expect(docNoInput().value).not.toBe('QT251026-22');

    release(lastYearsNumbers(22, 23));
    await waitFor(() => expect(docNoInput().value).toBe('QT251026-24'));
  });

  it('warns about a duplicate from the SAME list it mints from', async () => {
    recentWindow = []; // the window knows nothing about 2025
    ledgerByBase[CURRENT_PREFIX] = lastYearsNumbers(30);

    await openOn25Oct2026();
    fireEvent.change(docNoInput(), { target: { value: 'QT251026-30' } });

    // Warned BEFORE saving, instead of being blocked afterwards by a ledger the
    // warning could not see.
    await waitFor(() =>
      expect(screen.getByText(/เลขที่นี้ซ้ำกับใบที่บันทึกไว้/)).toBeInTheDocument()
    );
    expect(saveButton()).toBeDisabled();
  });

  it('says so in Thai when the ledger could not be read at all', async () => {
    baseLookupFails = true;
    await openOn25Oct2026();
    await waitFor(() =>
      expect(screen.getByText(/ยังยืนยันไม่ได้ว่าเลขที่นี้ว่าง/)).toBeInTheDocument()
    );
  });
});

describe('quotation builder — a number the server refuses', () => {
  it('advances onto a free number instead of handing the same one back', async () => {
    ledgerByBase[CURRENT_PREFIX] = []; // nothing taken when the page minted
    await openOn25Oct2026();
    await waitFor(() => expect(docNoInput().value).toBe('QT251026-22'));

    // Meanwhile another admin issues -22 AND -23.
    ledgerByBase[CURRENT_PREFIX] = [
      { docNo: 'QT251026-22', quotationId: 'other-a' },
      { docNo: 'QT251026-23', quotationId: 'other-b' },
    ];
    saveResponses = [{ status: 409, body: { error: 'เลขที่นี้ถูกใช้แล้ว' } }];

    fireEvent.click(saveButton());
    await waitFor(() => expect(postedDocNos).toEqual(['QT251026-22']));

    // Past BOTH of the other admin's numbers in one go — advancing one at a
    // time would just bounce off -23 next.
    await waitFor(() => expect(docNoInput().value).toBe('QT251026-24'));
    expect(
      screen.getByText(/ระบบเปลี่ยนเป็น QT251026-24/)
    ).toBeInTheDocument();

    // And pressing เซฟ again really does post the NEW number.
    saveResponses = [{ status: 200, body: {} }];
    fireEvent.click(saveButton());
    await waitFor(() => expect(postedDocNos).toHaveLength(2));
    expect(postedDocNos[1]).toBe('QT251026-24');
  });

  it('continues a VERSION number as a version, never as a day number', async () => {
    ledgerByBase[CURRENT_PREFIX] = [];
    await openOn25Oct2026();
    fireEvent.change(docNoInput(), { target: { value: 'QT251026-23v1' } });

    // v1 was taken between load and save; the base lookup now shows it.
    ledgerByBase['QT251026-23v1'] = [{ docNo: 'QT251026-23v1', quotationId: 'other' }];
    ledgerByBase['QT251026-23'] = [
      { docNo: 'QT251026-23', quotationId: 'orig' },
      { docNo: 'QT251026-23v1', quotationId: 'other' },
    ];
    saveResponses = [{ status: 409, body: { error: 'เลขที่นี้ถูกใช้แล้ว' } }];

    fireEvent.click(saveButton());
    await waitFor(() => expect(docNoInput().value).toBe('QT251026-23v2'));
  });
});
