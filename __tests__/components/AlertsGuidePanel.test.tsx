import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AlertsGuidePanel from '@/app/components/AlertsGuidePanel';
import { CALIBRATION_VALIDITY_MONTHS } from '@/app/lib/types';
import {
  CALIBRATION_ALERT_LEAD_MONTHS,
  ALERT_LIST_DISPLAY_LIMIT,
  MISSING_DELIVERY_DOC_DAYS,
  MISSING_RECEIPT_DOC_DAYS,
} from '@/app/lib/alertThresholds';

// The guide's whole reason for existing is that it must never disagree with the
// alert queries. These tests therefore assert the numbers ONLY through the same
// constants the queries import — a literal "30" here would be the exact drift
// the feature is meant to prevent (tasks.md 18.14).

function renderGuide(props: Partial<React.ComponentProps<typeof AlertsGuidePanel>> = {}) {
  const onClose = vi.fn();
  render(
    <AlertsGuidePanel
      warrantyDays={30}
      scheduleDays={7}
      onClose={onClose}
      {...props}
    />
  );
  return { onClose };
}

/** The whole dialog's text, whitespace-collapsed, for substring assertions
 *  that span element boundaries (the numbers sit in their own <strong>). */
function guideText(): string {
  return screen.getByRole('dialog').textContent!.replace(/\s+/g, ' ');
}

describe('AlertsGuidePanel — the seven required topics', () => {
  it('covers every alert category plus the board, the bell and the links', () => {
    renderGuide();
    const text = guideText();

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

    for (const heading of [
      'กำหนดการ (นัดที่ผูกกับเครื่อง)',
      'นัดโทรลูกค้า',
      'ประกันใกล้หมด',
      'ใกล้ถึงกำหนดสอบเทียบ',
      'ข้อมูลไม่ครบ',
      'เอกสารค้าง',
      'เลื่อนแจ้งเตือน คืออะไร',
      'กระดานงาน “สิ่งที่ต้องทำ”',
      'ตัวเลขบนกระดิ่ง นับอะไรบ้าง',
      'ลิงก์ที่ผูกไว้ในงาน',
    ]) {
      expect(headings.some((actual) => actual.includes(heading))).toBe(true);
    }

    // Every section answers all three questions, in the same order.
    expect(screen.getAllByText('ขึ้นเมื่อไร').length).toBe(10);
    expect(screen.getAllByText('เกณฑ์ที่ระบบใช้จริง').length).toBe(10);
    expect(screen.getAllByText('ทำอย่างไรถึงจะหายไป').length).toBe(10);
    expect(text.length).toBeGreaterThan(500);
  });
});

describe('AlertsGuidePanel — thresholds come from the live constants', () => {
  it('quotes the warranty and schedule windows the page actually requested', () => {
    renderGuide({ warrantyDays: 60, scheduleDays: 14 });
    const text = guideText();

    // The spec scenario: a page that asked for 60 days must not read "30 วัน".
    expect(text).toContain('60 วัน');
    expect(text).toContain('14 วัน');
    expect(text).not.toContain('30 วัน นับจากวันนี้');
  });

  it('derives the calibration wording from validity minus lead months', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain(`${CALIBRATION_VALIDITY_MONTHS} เดือน`);
    expect(text).toContain(`${CALIBRATION_ALERT_LEAD_MONTHS} เดือน`);
    expect(text).toContain(
      `${CALIBRATION_VALIDITY_MONTHS - CALIBRATION_ALERT_LEAD_MONTHS} เดือน`
    );
    // No upper bound is the part admins get wrong, so it has to be stated.
    expect(text).toContain('ไม่มีขอบบน');
  });

  it('quotes the missing-document day thresholds and the display cap', () => {
    renderGuide();
    const text = guideText();

    expect(text).toContain(`${MISSING_DELIVERY_DOC_DAYS} วัน`);
    expect(text).toContain(`${MISSING_RECEIPT_DOC_DAYS} วัน`);
    expect(text).toContain(String(ALERT_LIST_DISPLAY_LIMIT));
  });
});

describe('AlertsGuidePanel — the behaviours the owner asked to be spelled out', () => {
  it('says a customer call shows the moment it is created, however far off', () => {
    renderGuide();
    const text = guideText();
    expect(text).toContain('ทันทีที่กดบันทึก');
    expect(text).toContain('ไม่มีหน้าต่างวัน');
  });

  it('names the per-machine warranty switch as a reason a machine never alerts', () => {
    renderGuide();
    const text = guideText();
    expect(text).toContain('เตือนเมื่อประกันใกล้หมด');
    expect(text).toContain('ทำไมเครื่องนี้ไม่เคยเตือนประกันเลย?');
  });

  it('states the bell rule: only tasks whose due date has arrived', () => {
    renderGuide();
    const text = guideText();
    expect(text).toContain('เฉพาะงานที่ยังไม่เสร็จ และวันครบกำหนดถึงแล้ว');
    expect(text).toContain('ไม่ได้ใส่วันครบกำหนด');
    expect(text).toContain('ไม่ใช่ระบบพัง');
  });

  it('explains snooze as a temporary hide that fixes nothing', () => {
    renderGuide();
    const text = guideText();
    expect(text).toContain('ซ่อนการ์ดใบนั้นชั่วคราว');
    expect(text).toContain('ไม่ได้แก้ต้นเหตุ');
    expect(text).toContain('ระบบไม่เคยลบข้อมูลของคุณเองอัตโนมัติ');
  });

  it('marks the board as self-written, not an automatic alert', () => {
    renderGuide();
    const text = guideText();
    expect(text).toContain('คุณเขียนเอง');
    expect(text).toContain('ไม่ใช่แจ้งเตือนอัตโนมัติ');
  });

  it('lists all four link kinds and why one can read ถูกลบแล้ว', () => {
    renderGuide();
    const text = guideText();
    for (const kind of ['ลูกค้า', 'เครื่องจักร', 'ใบเสนอราคา', 'เอกสาร']) {
      expect(text).toContain(kind);
    }
    expect(text).toContain('ถูกลบแล้ว');
    expect(text).toContain('เกิน 2 ปี');
    expect(text).toContain('ตรวจสอบไม่สำเร็จ');
  });
});

describe('AlertsGuidePanel — closing', () => {
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
    // scrolls, or it would scroll away on a 360px screen (tasks.md 18.12).
    const scrollBody = dialog.querySelector('.overflow-y-auto');
    expect(scrollBody).not.toBeNull();
    expect(
      within(scrollBody as HTMLElement).queryAllByRole('button', { name: 'ปิดคู่มือ' })
    ).toHaveLength(0);
  });
});
