/**
 * ผู้เสนอราคา (us) doesn't get a hand-filled date line under the signature —
 * the document's own docDate already says when it was issued, so a second
 * blank date there was redundant and, in practice, never filled in. ผู้สั่งซื้อ
 * (the customer) keeps one: that's their actual signing date, which nothing
 * else on the page records.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QuotationPage from '@/app/quotation/page';

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
  );
});

/** The signature block whose bold title line matches `title` exactly. */
function signatureBlockFor(title: string): HTMLElement {
  const container = document.querySelector('#quote-signatures');
  if (!container) throw new Error('no #quote-signatures rendered');
  const titleEl = Array.from(container.querySelectorAll('.font-bold')).find(
    (el) => el.textContent?.trim() === title
  );
  if (!titleEl?.parentElement) throw new Error(`no signature block titled "${title}"`);
  return titleEl.parentElement as HTMLElement;
}

describe('quotation printout — signature block dates', () => {
  it('shows no date line under ผู้เสนอราคา', async () => {
    render(<QuotationPage />);
    await waitFor(() => expect(document.querySelector('#quote-signatures')).not.toBeNull());
    expect(signatureBlockFor('ผู้เสนอราคา').textContent).not.toContain('วันที่');
  });

  it('still shows a date line under ผู้สั่งซื้อ (ลูกค้า)', async () => {
    render(<QuotationPage />);
    await waitFor(() => expect(document.querySelector('#quote-signatures')).not.toBeNull());
    expect(signatureBlockFor('ผู้สั่งซื้อ (ลูกค้า)').textContent).toContain(
      'วันที่ ______ / ______ / ______'
    );
  });
});
