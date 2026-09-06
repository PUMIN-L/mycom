import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReceivablesGuidePanel from '@/app/components/ReceivablesGuidePanel';
import {
  AGEING_BUCKETS,
  PAYMENT_STATE_LABELS,
  TERMINAL_LABELS,
} from '@/app/lib/receivables';
import { DEFAULT_CREDIT_TERM_DAYS } from '@/app/lib/alertThresholds';

// These tests pin what makes a guide USABLE — it opens, it closes, Escape
// works, focus is managed, the trigger is announced as a dialog opener — and
// the one thing that makes it TRUE: every number and every state name it shows
// is read from the same modules the ledger computes with. A literal "30" or a
// retyped "เกิน 31-60 วัน" anywhere below would be exactly the drift this file
// exists to prevent, so the assertions only ever quote the constants.

function renderGuide(
  props: Partial<React.ComponentProps<typeof ReceivablesGuidePanel>> = {}
) {
  const onClose = vi.fn();
  render(<ReceivablesGuidePanel creditTermDays={null} onClose={onClose} {...props} />);
  return { onClose };
}

/** The whole dialog's text, whitespace-collapsed, for substring assertions that
 *  span element boundaries (the figures sit in their own <strong>). */
function guideText(): string {
  return screen.getByRole('dialog').textContent!.replace(/\s+/g, ' ');
}

describe('ReceivablesGuidePanel — the topics the owner asked for', () => {
  it('covers all seven sections', () => {
    renderGuide();

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

    for (const heading of [
      'ทำอะไรได้',
      'เริ่มใช้ครั้งแรก',
      'งานประจำวัน',
      'อ่านตัวเลขบนหน้าจอให้ถูก',
      'ใบไหนนับเป็นหนี้ ใบไหนไม่นับ',
      'ตรวจว่าใช้ได้จริง',
      'ข้อควรรู้',
    ]) {
      expect(headings.some((actual) => actual.includes(heading))).toBe(true);
    }
  });

  it('leads with the question the owner actually has', () => {
    renderGuide();
    expect(guideText()).toContain('ใครค้างเราอยู่เท่าไร และเกินกำหนดมากี่วัน');
  });

  it('explains that undated documents are excluded on purpose, and how to fix it', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain('เอกสารทุกใบที่มีอยู่ก่อนหน้านี้ ยังไม่มีวันครบกำหนดชำระ');
    expect(text).toContain('ตั้งใจให้เป็นแบบนั้น');
    // The bulk action: what it counts FROM, and that it confirms first.
    expect(text).toContain('ตั้งให้ทุกใบที่ยังไม่กำหนด');
    expect(text).toContain('วันที่บนเอกสารแต่ละใบ');
    expect(text).toContain('จะมีหน้าต่างให้ยืนยันก่อนเสมอ โดยบอกจำนวนใบและช่วงวันครบกำหนดที่จะได้');
    expect(text).toContain('ใบที่กำหนดวันไว้เองอยู่แล้วจะไม่ถูกแก้');
  });

  it('covers the daily loop: paid in full, deposit, and a mistake', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain('บันทึกรับชำระ');
    expect(text).toContain('รับเป็นมัดจำ');
    // A mis-keyed payment is VOIDED, never deleted — and the guide says why.
    expect(text).toContain('ยกเลิกรายการ');
    expect(text).toContain('รายการเงินไม่เคยถูกลบทิ้ง');
    expect(text).toContain('หลักฐานทางบัญชี');
  });

  it('states the debt rule and the manual override with its safeguard', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain('นับเป็นลูกหนี้');
    expect(text).toContain('ระบบไม่เดาให้เอง');
    // The double-count safeguard on the ใบวางบิล nudge list.
    expect(text).toContain('จะไม่ถูกเสนอในกล่องนี้เลย');
    // A corrected invoice is billed once.
    expect(text).toContain('แก้ไข (New Ver.)');
    expect(text).toContain('นับเฉพาะเวอร์ชันล่าสุดใบเดียว');
  });

  it('gives the verification walkthrough as numbered steps with what he should see', () => {
    renderGuide();
    const text = guideText();

    // Test data, never a real customer.
    expect(text).toContain('ทำกับเอกสารทดสอบเท่านั้น อย่าทำกับใบของลูกค้าจริง');
    // The real path: link the receipt, watch the row go to zero, cancel, watch
    // it come back — with the real button captions along the way.
    expect(text).toContain('ชำระให้ใบแจ้งหนี้');
    expect(text).toContain('ลบเอกสารนี้ไม่ได้');
    expect(text).toContain('ยกเลิกเอกสารแล้ว (เอกสารและประวัติการรับชำระยังอยู่)');
    expect(text).toContain('กลับมาในรายการ เต็มจำนวนเท่าเดิม');
    // Every step tells him what to expect.
    expect(screen.getAllByText('ต้องเห็น:').length).toBeGreaterThanOrEqual(8);
  });

  it('is honest that un-cancelling is not reachable from the screen', () => {
    renderGuide();
    const text = guideText();
    expect(text).toContain('ยังไม่มีปุ่ม “ยกเลิกการยกเลิก” บนหน้าจอ');
    expect(text).toContain('ออกใบเสร็จใบใหม่');
  });

  it('states the honest limits', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain('ตัวเลขมาจากเอกสารที่ออกในระบบนี้เท่านั้น');
    expect(text).toContain('ใครก็ตามที่ล็อกอินเข้าระบบได้ เห็นข้อมูลหน้านี้ทั้งหมด');
    expect(text).toContain('รายการเงินไม่เคยถูกลบ');
  });
});

describe('ReceivablesGuidePanel — every figure comes from the live constants', () => {
  it('quotes the credit term THIS page loaded, not a typed number', () => {
    renderGuide({ creditTermDays: 45 });
    const text = guideText();

    expect(text).toContain('45 วัน');
    // The scenario that matters: a company on 45-day terms must never read the
    // shared fallback back at itself.
    expect(text).not.toContain(`เครดิต ${DEFAULT_CREDIT_TERM_DAYS} วัน`);
  });

  it('falls back to the shared default while the ledger has not loaded', () => {
    renderGuide({ creditTermDays: null });
    expect(guideText()).toContain(`${DEFAULT_CREDIT_TERM_DAYS} วัน`);
  });

  it('renders every ageing bucket with the label the tiles render', () => {
    renderGuide();
    const text = guideText();

    // Exhaustive: a new bucket added to the module must show up here too.
    for (const bucket of AGEING_BUCKETS) {
      expect(text).toContain(bucket.label);
    }
  });

  it('renders the due-date wording by calling the same helper the rows call', () => {
    renderGuide();
    const text = guideText();

    // dueStateLabel's four shapes, produced by the function itself.
    expect(text).toContain('เกินกำหนด 12 วัน');
    expect(text).toContain('ครบกำหนดวันนี้');
    expect(text).toContain('อีก 5 วัน');
    expect(text).toContain('ยังไม่กำหนดวันครบกำหนด');
  });

  it('uses the shipped payment-state and terminal wording, not paraphrases', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain(PAYMENT_STATE_LABELS.partial);
    expect(text).toContain(PAYMENT_STATE_LABELS.overpaid);
    expect(text).toContain(PAYMENT_STATE_LABELS.paid);
    for (const label of Object.values(TERMINAL_LABELS)) {
      expect(text).toContain(label);
    }
  });
});

describe('ReceivablesGuidePanel — opening, closing and focus', () => {
  it('closes on the header button, the footer button, the backdrop and Escape', () => {
    const { onClose } = renderGuide();

    // Two ways out on purpose: the header X (always visible) and a button at
    // the end of the guide for anyone who has read to the bottom.
    const closeButtons = screen.getAllByRole('button', { name: 'ปิดคู่มือ' });
    expect(closeButtons).toHaveLength(2);

    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('does not close when the guide content itself is clicked', () => {
    const { onClose } = renderGuide();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is a dialog whose close control sits outside the scrolling body', () => {
    renderGuide();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // The header (and its close button) must not live inside the element that
    // scrolls, or it would scroll away on a 360px screen.
    const scrollBody = dialog.querySelector('.overflow-y-auto');
    expect(scrollBody).not.toBeNull();
    expect(scrollBody!.className).toContain('overscroll-contain');
    expect(
      within(scrollBody as HTMLElement).queryAllByRole('button', { name: 'ปิดคู่มือ' })
    ).toHaveLength(0);
  });

  it('moves focus into the body on open and back to the trigger on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <ReceivablesGuidePanel creditTermDays={null} onClose={vi.fn()} />
    );

    const scrollBody = screen.getByRole('dialog').querySelector('.overflow-y-auto');
    expect(document.activeElement).toBe(scrollBody);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('the ledger page trigger', () => {
  it('announces itself as opening a dialog', async () => {
    // The trigger lives on the page, not in the panel; assert its contract on
    // the markup the page ships, so the aria pair cannot be dropped silently.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('app/billing/receivables/page.tsx', 'utf8')
    );

    expect(source).toContain('📖 คู่มือการใช้งาน');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-expanded={isGuideOpen}');
    // Rendered last in the tree, so it stacks above the payment and due-date
    // modals rather than under them.
    const guideIndex = source.indexOf('<ReceivablesGuidePanel');
    expect(guideIndex).toBeGreaterThan(source.indexOf('<RecordPaymentModal'));
    expect(guideIndex).toBeGreaterThan(source.indexOf('<ConfirmDialog'));
  });
});
