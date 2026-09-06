"use client";

import { useEffect, useRef } from "react";
import {
  AGEING_BUCKETS,
  PAYMENT_STATE_LABELS,
  TERMINAL_LABELS,
  dueStateLabel,
  type AgeingBucketId,
  type ReceivableDueState,
  type ReceivableStatus,
  type ReceivableTerminal,
} from "../lib/receivables";
import { DEFAULT_CREDIT_TERM_DAYS } from "../lib/alertThresholds";

/**
 * The in-page Thai user guide for ลูกหนี้ค้างชำระ.
 *
 * The owner asked for it in one line — "เขียนวิธีการใช้งานไว้ด้วย" — on a screen
 * that shipped without anyone being told what it counts. It is a structural copy
 * of `app/components/AlertsGuidePanel.tsx` and
 * `app/tools/pdf-editor/PdfEditorGuidePanel.tsx`, and keeps their four
 * contracts:
 *
 *   1. IT OWNS NO STATE BUT ITS OWN SCROLL. Opening and closing is a plain
 *      boolean in the page — no router push, no query string. The URL stays
 *      `/billing/receivables`, and the bucket tile, the customer filter and the
 *      "รวมที่ยังไม่กำหนดวันครบกำหนด" tick the owner was reading are all still
 *      exactly as he left them when the guide closes.
 *   2. NO THRESHOLD AND NO STATE LABEL IS EVER TYPED AS PROSE. The ageing
 *      boundaries are rendered from `AGEING_BUCKETS`, the payment wording from
 *      `PAYMENT_STATE_LABELS`, the "why it is not a receivable" wording from
 *      `TERMINAL_LABELS`, and the due-axis phrases by CALLING `dueStateLabel` —
 *      the very function the row renders with. The credit term is the one this
 *      page loaded from the settings row (prop), falling back to the same
 *      constant the billing builder falls back to. Move a boundary and the
 *      guide moves with it, instead of quietly lying about the screen.
 *   3. The dialog is a flex COLUMN with a NON-SCROLLING header, so the close
 *      button never scrolls out of reach, plus a second way out at the bottom.
 *      Escape closes, focus moves into the body on open and RETURNS to the
 *      trigger on close — the owner tabs straight back to where he was.
 *   4. One column at every width, `overscroll-contain` on the scroller, so a
 *      360px phone scrolls this box and never the ledger behind it.
 *
 * THE TWO SECTIONS THAT EARN THE FILE:
 *   • เริ่มใช้ครั้งแรก — every document that existed before this feature has NO
 *     due date, so all of them sit apart in ไม่ได้กำหนดวันครบกำหนด and are
 *     deliberately excluded from ยอดค้าง. Without that paragraph the first
 *     screen he ever sees looks broken.
 *   • ตรวจว่าใช้ได้จริง — he asked to be able to prove the number is real, so
 *     the steps name the REAL buttons in the REAL order, and stop honestly at
 *     the one thing the UI cannot yet do (there is no un-cancel button; the API
 *     supports it, nothing on screen calls it).
 */

interface ReceivablesGuidePanelProps {
  /**
   * The default credit term THIS page loaded, in days. Null while the ledger is
   * still loading or failed to load, in which case the guide falls back to the
   * same shared constant the billing builder falls back to.
   */
  creditTermDays: number | null;
  onClose: () => void;
}

/** A highlighted live figure, so the owner can see at a glance which parts of
 *  the guide are read from the system and which are prose. */
function Val({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-bold text-gray-900 bg-amber-100/70 rounded px-1 py-0.5 mx-0.5">
      {children}
    </strong>
  );
}

/** Wording taken from the screen itself — a button caption, a badge, a tile. */
function Ui({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-gray-900 bg-gray-100 rounded px-1 py-0.5 mx-0.5 whitespace-nowrap">
      {children}
    </strong>
  );
}

function GuideSection({
  icon,
  title,
  tone,
  intro,
  children,
}: {
  icon: string;
  title: string;
  tone: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm border-l-4 ${tone}`}
    >
      <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-gray-900 mb-3">
        <span className="text-lg" aria-hidden="true">
          {icon}
        </span>
        <span className="wrap-break-word">{title}</span>
      </h3>
      {intro && (
        <p className="text-sm leading-relaxed text-gray-600 mb-3 wrap-break-word">{intro}</p>
      )}
      {children}
    </section>
  );
}

/** One "this row means that" line. */
function Row({ term, children }: { term: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 wrap-break-word">
      <span className="shrink-0 text-gray-300" aria-hidden="true">
        •
      </span>
      <span>
        <strong className="font-bold text-gray-900">{term}</strong> — {children}
      </span>
    </li>
  );
}

/** One numbered step. `expect` is what he should SEE after doing it. */
function Step({
  n,
  title,
  children,
  expect,
  tone = "violet",
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  expect?: React.ReactNode;
  tone?: "violet" | "emerald";
}) {
  return (
    <li className="flex gap-3 wrap-break-word">
      <span
        className={`shrink-0 w-6 h-6 rounded-full font-bold text-xs flex items-center justify-center ${
          tone === "emerald"
            ? "bg-emerald-100 text-emerald-700"
            : "bg-violet-100 text-violet-700"
        }`}
      >
        {n}
      </span>
      <span className="min-w-0">
        <strong className="font-bold text-gray-900">{title}</strong>
        <br />
        <span className="text-gray-700">{children}</span>
        {expect && (
          <span className="mt-1.5 flex gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs leading-relaxed text-emerald-900">
            <span className="shrink-0" aria-hidden="true">
              ✅
            </span>
            <span>
              <strong className="font-bold">ต้องเห็น:</strong> {expect}
            </span>
          </span>
        )}
      </span>
    </li>
  );
}

/** One honest limit. `severe` marks the ones he can lose money or time to. */
function Limit({ children, severe = false }: { children: React.ReactNode; severe?: boolean }) {
  return (
    <li
      className={`flex gap-2.5 wrap-break-word rounded-xl px-3 py-2 ${
        severe ? "bg-red-50 border border-red-100 text-red-900" : "text-gray-700"
      }`}
    >
      <span className="shrink-0" aria-hidden="true">
        {severe ? "⚠️" : "•"}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The due-axis phrase EXACTLY as a row renders it, produced by the same
 * function the row calls. Typing "เกินกำหนด N วัน" here by hand is precisely
 * the drift this file refuses.
 */
function dueSample(dueState: ReceivableDueState, daysOverdue: number | null): string {
  const status: ReceivableStatus = {
    terminal: null,
    paymentState: "unpaid",
    dueState,
    outstanding: 0,
    overpaidBy: 0,
    daysOverdue,
    isOpen: true,
  };
  return dueStateLabel(status);
}

/** Why each ageing tile matters. No number here on purpose: the boundary is in
 *  the tile's own label, which is read from AGEING_BUCKETS. */
const BUCKET_NOTE: Record<AgeingBucketId, React.ReactNode> = {
  not_due: (
    <>
      ยังไม่ถึงวันครบกำหนด <strong>รวมใบที่ครบกำหนดวันนี้ด้วย</strong> — ครบวันนี้ยังไม่ถือว่าสาย
    </>
  ),
  d1_30: <>เพิ่งเลยกำหนด ยังอยู่ในช่วงที่โทรเตือนได้ตามปกติ</>,
  d31_60: <>เริ่มเรื้อรัง ควรมีคนรับผิดชอบตามเป็นราย ๆ ไป</>,
  d61_90: <>ตามมาหลายรอบแล้วยังไม่เข้า ควรคุยเรื่องกำหนดชำระใหม่</>,
  d90_plus: <>ค้างนานที่สุด ควรถือเป็นกลุ่มเสี่ยงและตัดสินใจว่าจะตามต่ออย่างไร</>,
  no_due_date: (
    <>
      ใบที่ยังไม่ได้ตกลงวันครบกำหนดกัน <strong>ไม่ถูกนับรวมในยอดค้างทั้งหมด</strong>{" "}
      และไม่ถือว่าเกินกำหนด (ดูหัวข้อ “เริ่มใช้ครั้งแรก”)
    </>
  ),
};

/** Why a document is NOT in the list. Wording from TERMINAL_LABELS. */
const TERMINAL_NOTE: Record<ReceivableTerminal, React.ReactNode> = {
  cancelled: (
    <>
      ใบที่กด <Ui>ยกเลิกเอกสาร</Ui> ไปแล้ว เอกสารและประวัติการรับชำระยังอยู่ครบ แต่ไม่นับเป็นหนี้อีก
    </>
  ),
  superseded: (
    <>
      ใบเวอร์ชันเก่าที่ถูกแก้ด้วยปุ่ม <Ui>✏️ แก้ไข (New Ver.)</Ui> — นับเฉพาะเวอร์ชันล่าสุดใบเดียว
      ใบเดิมไม่ถูกนับซ้ำ
    </>
  ),
  not_debt_carrier: (
    <>
      ใบวางบิลและใบเสร็จตามปกติ รวมถึงใบวางบิลที่คุณกด <Ui>ไม่นับ</Ui> เอาไว้เอง
    </>
  ),
  zero_total: (
    <>
      ใบแจ้งหนี้ที่ยอดเป็น 0 มักเป็นใบที่ทำค้างไว้ ไม่ได้หายไปไหน — จะไปรออยู่ในกล่อง{" "}
      <Ui>🔎 ตรวจสอบ: ใบแจ้งหนี้ที่ยังไม่มียอด</Ui> ท้ายหน้า
    </>
  ),
};

export default function ReceivablesGuidePanel({
  creditTermDays,
  onClose,
}: ReceivablesGuidePanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** Whatever had focus when the guide opened — almost always the 📖 trigger. */
  const returnFocusRef = useRef<Element | null>(null);

  const term = creditTermDays ?? DEFAULT_CREDIT_TERM_DAYS;

  // Escape closes — the same gesture every other modal on this page answers to.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the scrolling body so the keyboard can page through the
  // guide immediately and a screen reader lands inside the dialog — then hand
  // focus back to the button that opened it, so closing the guide does not
  // dump the owner at the top of the ledger.
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    bodyRef.current?.focus();
    return () => {
      const trigger = returnFocusRef.current;
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-200 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-3xl h-[92vh] sm:h-auto sm:max-h-[88vh] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="คู่มือการใช้งานหน้าลูกหนี้ค้างชำระ"
      >
        {/* Header sits OUTSIDE the scroll area on purpose: the close button has
            to stay tappable at any scroll position, on any screen. */}
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100 bg-white">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span aria-hidden="true">📖</span>
              <span className="wrap-break-word">คู่มือการใช้งาน</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 wrap-break-word">
              ใครค้างเราอยู่เท่าไร เกินกำหนดมากี่วัน และต้องกดตรงไหน
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="ปิดคู่มือ"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* The single scrolling column. `overscroll-contain` keeps a flick at
            the end of the guide from scrolling the ledger underneath. */}
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-4 focus:outline-none"
        >
          <p className="text-sm leading-relaxed text-gray-600 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 wrap-break-word">
            หน้านี้ตอบคำถามเดียว: <strong className="font-bold text-gray-900">ใครค้างเราอยู่เท่าไร และเกินกำหนดมากี่วัน</strong>{" "}
            ตัวเลขทั้งหมดคำนวณจากเอกสารที่ออกในระบบนี้ ไม่ต้องเปิดเอกสารทีละใบ
            และตัวเลขเกณฑ์ทุกตัวในคู่มือนี้ดึงมาจากค่าที่ระบบใช้จริง
          </p>

          {/* ── 1. ทำอะไรได้ ──────────────────────────────────────────────── */}
          <GuideSection
            icon="✅"
            title="ทำอะไรได้"
            tone="border-l-emerald-500"
          >
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700">
              <Row term="เห็นยอดค้างทั้งหมดในบรรทัดเดียว">
                พร้อมบอกว่าในนั้น <strong>เกินกำหนดไปแล้วเท่าไร กี่ใบ</strong>
              </Row>
              <Row term="เห็นว่าหนี้เก่าแค่ไหน">
                แถบช่วงอายุหนี้ด้านบน กดที่ช่องไหนก็กรองเฉพาะช่วงนั้น กดซ้ำเพื่อยกเลิกการกรอง
              </Row>
              <Row term="เห็นเป็นราย “ลูกค้า” ไม่ใช่รายใบ">
                พร้อมเบอร์โทรที่กดโทรออกได้เลย เพราะโทรครั้งเดียวมักจบหลายใบ
              </Row>
              <Row term="บันทึกเงินที่เข้ามาได้จากหน้านี้เลย">
                ปุ่ม <Ui>บันทึกรับชำระ</Ui> ท้ายทุกแถว ไม่ต้องเปิดเอกสาร
              </Row>
            </ul>
          </GuideSection>

          {/* ── 2. เริ่มใช้ครั้งแรก ────────────────────────────────────────── */}
          <GuideSection
            icon="🚀"
            title="เริ่มใช้ครั้งแรก (อ่านข้อนี้ก่อน)"
            tone="border-l-amber-500"
            intro={
              <>
                <strong className="text-gray-900">
                  เอกสารทุกใบที่มีอยู่ก่อนหน้านี้ ยังไม่มีวันครบกำหนดชำระ
                </strong>{" "}
                ทั้งหมดจึงไปกองรวมอยู่ในช่อง{" "}
                <Ui>{AGEING_BUCKETS.find((b) => b.id === "no_due_date")!.label}</Ui>{" "}
                และ <strong>ไม่ถูกนับ</strong> ในยอดค้างทั้งหมดและยอดเกินกำหนด —{" "}
                <strong>ตั้งใจให้เป็นแบบนั้น</strong> ไม่ใช่ระบบนับตกหล่น
                เพราะถ้าไปใส่วันครบกำหนดให้ใบเก่าเองโดยไม่ถาม
                ก็เท่ากับสร้างหนี้เกินกำหนดที่ไม่เคยมีใครตกลงกันไว้ ทางแก้อยู่ข้างล่างนี้
              </>
            }
          >
            <ol className="space-y-3 text-sm leading-relaxed">
              <Step
                n={1}
                title="ตั้งเครดิตเทอมเริ่มต้นให้ถูกก่อน (ทำครั้งเดียว)"
                expect={
                  <>
                    กล่อง <Ui>⏳ เครดิตเทอมเริ่มต้น</Ui> แสดงจำนวนวันที่คุณตั้ง
                    และเอกสารใหม่ทุกใบจะเติมวันครบกำหนดให้เอง
                  </>
                }
              >
                ไปที่หน้าตั้งค่า กด <Ui>✏️ แก้ไข</Ui> ในกล่อง <Ui>⏳ เครดิตเทอมเริ่มต้น</Ui>{" "}
                ใส่จำนวนวันที่ให้เครดิตลูกค้าตามปกติ แล้วกด <Ui>💾 บันทึกเครดิตเทอม</Ui> —
                ตอนนี้ระบบใช้ค่า <Val>{term} วัน</Val> การเปลี่ยนค่านี้{" "}
                <strong>ไม่ย้อนไปแก้เอกสารที่บันทึกไว้แล้ว</strong>
              </Step>
              <Step
                n={2}
                title="เห็นใบที่ยังไม่กำหนดก่อน"
                expect={
                  <>
                    ใบที่ยังไม่มีวันครบกำหนดโผล่ขึ้นมาในรายการ ตรงบรรทัดวันจะเขียนว่า{" "}
                    <Ui>ครบกำหนด ยังไม่กำหนด</Ui> และมีปุ่ม <Ui>ตั้งวันครบกำหนด</Ui> ให้กด
                  </>
                }
              >
                ติ๊กช่อง <Ui>รวมที่ยังไม่กำหนดวันครบกำหนด</Ui> ในแถบตัวกรอง หรือกดที่ช่อง{" "}
                <Ui>{AGEING_BUCKETS.find((b) => b.id === "no_due_date")!.label}</Ui> ก็ได้
                (กดช่องนี้จะติ๊กให้เอง) ปกติใบพวกนี้จะถูกซ่อนไว้ ไม่ให้ปนกับยอดที่ตกลงกันแล้ว
              </Step>
              <Step
                n={3}
                title="ตั้งวันครบกำหนด — ทีละใบ หรือทีเดียวทั้งหมด"
                expect={
                  <>
                    ใบที่ตั้งวันแล้วจะย้ายออกจากช่อง{" "}
                    <Ui>{AGEING_BUCKETS.find((b) => b.id === "no_due_date")!.label}</Ui>{" "}
                    ไปเข้าช่วงอายุหนี้ตามจริง และถ้าเอาติ๊ก{" "}
                    <Ui>รวมที่ยังไม่กำหนดวันครบกำหนด</Ui> ออก
                    ยอดค้างทั้งหมดจะสูงขึ้นเท่ากับยอดที่เพิ่งนับเข้ามา
                  </>
                }
              >
                <strong>ทีละใบ:</strong> กด <Ui>ตั้งวันครบกำหนด</Ui> ที่ท้ายแถวนั้น
                ช่องวันจะถูกเติมมาให้แล้วเป็น <strong>วันที่เอกสาร + เครดิต</strong>{" "}
                <Val>{term} วัน</Val> แก้เป็นวันอื่นก็ได้ แล้วกด <Ui>บันทึก</Ui>
                <br />
                <strong>ทีเดียวทั้งหมด:</strong> กด <Ui>ตั้งให้ทุกใบที่ยังไม่กำหนด</Ui>{" "}
                มุมขวาของแถบตัวกรอง — ปุ่มนี้ทำกับ{" "}
                <strong>ทุกใบที่ยังไม่กำหนดในระบบ ไม่ใช่เฉพาะที่กรองค้างไว้อยู่</strong>{" "}
                ระบบนับจาก <strong>วันที่บนเอกสารแต่ละใบ</strong>{" "}
                (ไม่ใช่วันนี้ ไม่ใช่วันที่บันทึก) บวก <Val>{term} วัน</Val>{" "}
                <strong>
                  จะมีหน้าต่างให้ยืนยันก่อนเสมอ โดยบอกจำนวนใบและช่วงวันครบกำหนดที่จะได้
                </strong>{" "}
                ถ้าตัวเลขไม่ถูก กดยกเลิกได้ ยังไม่มีอะไรถูกเปลี่ยน —{" "}
                <strong>ใบที่กำหนดวันไว้เองอยู่แล้วจะไม่ถูกแก้</strong>
              </Step>
            </ol>
            <p className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 wrap-break-word">
              💡 ใบที่ <strong>ไม่มีวันที่บนเอกสาร</strong> ปุ่มตั้งทีเดียวทั้งหมดจะข้ามให้
              เพราะไม่มีวันตั้งต้นให้บวก ใบพวกนี้ต้องกด <Ui>ตั้งวันครบกำหนด</Ui> ทีละใบเอง
              และช่องวันจะว่างเปล่า (ไม่มีวันตั้งต้นให้เติม) ต้องเลือกวันเองก่อนถึงจะกด{" "}
              <Ui>บันทึก</Ui> ได้ — ถ้าเหลือแต่ใบแบบนี้
              กดปุ่มตั้งทีเดียวทั้งหมดแล้วจะไม่มีหน้าต่างอะไรขึ้นมา
            </p>
          </GuideSection>

          {/* ── 3. งานประจำวัน ────────────────────────────────────────────── */}
          <GuideSection
            icon="💵"
            title="งานประจำวัน: เงินเข้า → บันทึก"
            tone="border-l-green-500"
            intro="วงจรที่จะทำซ้ำทุกวัน มีแค่นี้"
          >
            <ol className="space-y-3 text-sm leading-relaxed">
              <Step
                n={1}
                tone="emerald"
                title="จ่ายเต็มจำนวน — กดครั้งเดียวจบ"
                expect={
                  <>
                    ข้อความ <Ui>บันทึกรับชำระ ฿… แล้ว</Ui> แล้วแถวนั้น{" "}
                    <strong>หายออกจากรายการ</strong> (หนี้จบแล้วจึงไม่ต้องตามอีก)
                    และยอดค้างทั้งหมดลดลงเท่ากับยอดที่รับมา
                  </>
                }
              >
                กด <Ui>บันทึกรับชำระ</Ui> ท้ายแถว ช่อง <Ui>จำนวนเงิน</Ui>{" "}
                เติมยอดคงค้างมาให้แล้ว วันที่เป็นวันนี้ ช่องทางเป็นค่าที่ใช้บ่อย —
                ถ้าถูกทั้งหมดก็กด <Ui>ยืนยัน</Ui> ได้เลย (ช่อง{" "}
                <Ui>เลขอ้างอิง (ไม่บังคับ)</Ui> ไว้ใส่เลขที่โอนหรือเลขเช็ค จะไม่ใส่ก็ได้)
              </Step>
              <Step
                n={2}
                tone="emerald"
                title="มัดจำก่อน ที่เหลือทีหลัง — ปุ่มเดิม ไม่ต้องตั้งงวด"
                expect={
                  <>
                    ตอนพิมพ์ยอดจะขึ้นบรรทัด <Ui>รับเป็นมัดจำ — จะเหลือค้าง ฿…</Ui>{" "}
                    พอบันทึกแล้วแถวนั้นยังอยู่ในรายการ แต่เหลือเฉพาะยอดที่ค้าง
                    พร้อมป้าย <Ui>{PAYMENT_STATE_LABELS.partial}</Ui> และบรรทัด{" "}
                    <Ui>ชำระแล้ว ฿… จาก ฿…</Ui>
                  </>
                }
              >
                ทำเหมือนข้อ 1 แต่ <strong>พิมพ์ยอดที่ได้รับจริง</strong> ทับลงไป
                พอเงินก้อนที่เหลือเข้ามาวันหลัง ก็กด <Ui>บันทึกรับชำระ</Ui> ที่แถวเดิมอีกครั้ง
                ระบบเติมยอดที่เหลือมาให้เอง กด <Ui>ยืนยัน</Ui> จบ —{" "}
                ไม่ต้องตั้งงวด ไม่ต้องคำนวณเอง
              </Step>
              <Step
                n={3}
                tone="emerald"
                title="บันทึกผิด — ยกเลิกรายการ ไม่ใช่ลบ"
                expect={
                  <>
                    หน้าต่างยืนยันบอกไว้ตรง ๆ ว่า{" "}
                    <Ui>รายการจะไม่ถูกลบ แต่จะถูกขีดฆ่าไว้ในประวัติและไม่นับรวมในยอดที่ชำระแล้ว</Ui>{" "}
                    ยอดค้างของใบนั้นกลับขึ้นมาทันที
                  </>
                }
              >
                เปิด <Ui>บันทึกรับชำระ</Ui> ของใบนั้น กดแถบ <Ui>ประวัติการรับชำระ</Ui>{" "}
                แล้วกด <Ui>ยกเลิกรายการ</Ui> ที่รายการผิด จากนั้นบันทึกรายการที่ถูกเข้าไปใหม่{" "}
                <strong>รายการเงินไม่เคยถูกลบทิ้ง</strong> เพราะเป็นหลักฐานทางบัญชี
                ต้องตรวจย้อนหลังได้ว่าเคยลงอะไรไว้
              </Step>
            </ol>
            <p className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 wrap-break-word">
              💡 แถบ <Ui>ประวัติการรับชำระ</Ui> จะโผล่ก็ต่อเมื่อใบนั้นมีรายการรับชำระ{" "}
              <strong>ที่ยังไม่ถูกยกเลิก ตั้งแต่ 2 รายการขึ้นไป</strong> ถ้าใบนั้นมีรายการเดียวและลงผิด
              จะยังไม่มีปุ่มยกเลิกให้กดจากหน้านี้ — ดูหัวข้อ “ข้อควรรู้” ท้ายคู่มือ
            </p>
          </GuideSection>

          {/* ── 4. อ่านตัวเลขบนหน้าจอ ─────────────────────────────────────── */}
          <GuideSection
            icon="🔢"
            title="อ่านตัวเลขบนหน้าจอให้ถูก"
            tone="border-l-blue-500"
            intro="คำที่ยกมาข้างล่างนี้คือคำเดียวกับที่ขึ้นบนหน้าจอจริง"
          >
            <p className="text-xs font-bold text-gray-500 mb-2">ยอดบนสุด</p>
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700 mb-4">
              <Row term="ยอดค้างทั้งหมด">
                เงินที่ยังไม่ได้เก็บ ปกตินับเฉพาะใบที่ <strong>มีวันครบกำหนดแล้ว</strong>{" "}
                จนกว่าจะติ๊ก <Ui>รวมที่ยังไม่กำหนดวันครบกำหนด</Ui> ตัวเลขนี้ถึงจะรวมใบที่ยังไม่กำหนดเข้ามาด้วย
              </Row>
              <Row term="ในนั้นเกินกำหนดแล้ว ฿… (… ใบ)">
                ส่วนที่เลยวันครบกำหนดมาแล้วจริง ๆ ถ้าไม่มีเลยจะขึ้นว่า{" "}
                <Ui>ยังไม่มีใบที่เกินกำหนด</Ui>
              </Row>
              <Row term="ไม่รวมอีก … ใบ (฿…) ที่ยังไม่ได้กำหนดวันครบกำหนด">
                บรรทัดเตือนว่ายังมีเงินอีกก้อนที่ไม่ได้ถูกนับ ติ๊ก{" "}
                <Ui>รวมที่ยังไม่กำหนดวันครบกำหนด</Ui> เพื่อรวมเข้ามา
              </Row>
            </ul>

            <p className="text-xs font-bold text-gray-500 mb-2">
              ช่วงอายุหนี้ (แถบ {AGEING_BUCKETS.length} ช่องใต้ยอดรวม กดเพื่อกรอง)
            </p>
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700 mb-4">
              {AGEING_BUCKETS.map((bucket) => (
                <Row key={bucket.id} term={bucket.label}>
                  {BUCKET_NOTE[bucket.id]}
                </Row>
              ))}
            </ul>

            <p className="text-xs font-bold text-gray-500 mb-2">บรรทัดวันในแต่ละแถว</p>
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700 mb-4">
              <Row term={dueSample("overdue", 12)}>
                เลยกำหนดมาแล้ว ตัวเลขคือจำนวนวัน ขึ้นเป็น <strong>สีแดง</strong>{" "}
                (ตัวอย่างนี้แสดงที่ 12 วัน)
              </Row>
              <Row term={dueSample("due_today", 0)}>
                ครบกำหนดวันนี้พอดี — <strong>ยังไม่นับว่าสาย</strong>
              </Row>
              <Row term={dueSample("not_due", -5)}>ยังไม่ถึงกำหนด เหลืออีกกี่วันตามตัวเลข</Row>
              <Row term={dueSample("no_due_date", null)}>
                ยังไม่ได้ตกลงวันกัน จะมีปุ่ม <Ui>ตั้งวันครบกำหนด</Ui> ให้ที่ท้ายแถว
              </Row>
            </ul>

            <p className="text-xs font-bold text-gray-500 mb-2">ป้ายและยอดในแต่ละแถว</p>
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700">
              <Row term={`ป้าย ${PAYMENT_STATE_LABELS.partial}`}>
                ได้เงินมาบางส่วนแล้ว ใต้ป้ายจะบอกว่า <Ui>ชำระแล้ว ฿… จาก ฿…</Ui>{" "}
                ส่วนตัวเลขใหญ่ทางขวาคือ <strong>ยอดที่ยังค้าง</strong> ไม่ใช่ยอดเต็มของใบ
              </Row>
              <Row term={PAYMENT_STATE_LABELS.overpaid}>
                รับเงินมาเกินยอดของใบนั้น ใบแบบนี้ถือว่าเก็บครบแล้ว จึง{" "}
                <strong>หายออกจากหน้านี้เหมือนใบที่เก็บครบ</strong> —
                หน้านี้ไม่ได้ค้างตัวเลขส่วนเกินไว้ให้ดู คำเตือนมีครั้งเดียวตอนกำลังบันทึก
                (ขึ้นว่า <Ui>ยอดนี้เกินยอดคงค้าง ฿…</Ui> แล้วถามยืนยันอีกรอบ) ถ้าจะคืนเงินหรือหักกับงานหน้า
                ต้องจดไว้เอง
              </Row>
              <Row term="ป้าย ใบวางบิล (นับเป็นลูกหนี้)">
                ใบวางบิลที่คุณสั่งให้นับเองเป็นกรณีพิเศษ (ดูหัวข้อถัดไป)
              </Row>
              <Row term={`ใบที่${PAYMENT_STATE_LABELS.paid}แล้ว`}>
                <strong>หายออกจากหน้านี้</strong> ไม่ได้ขึ้นป้ายอะไรค้างไว้ —
                หน้านี้แสดงเฉพาะเงินที่ยังเก็บไม่ได้ เอกสารยังอยู่ครบที่หน้า{" "}
                <Ui>📋 เอกสารที่บันทึกไว้</Ui>
              </Row>
              <Row term="🎉 ไม่มีลูกหนี้ค้างชำระตามตัวกรองนี้">
                ไม่มีใบไหนเข้าเงื่อนไข <strong>ที่กรองอยู่ตอนนี้</strong> —
                ถ้ายังกรองช่วงอายุหนี้หรือกรองชื่อลูกค้าค้างไว้ ให้กด{" "}
                <Ui>ล้างตัวกรองช่วงอายุหนี้</Ui> หรือเลือก <Ui>ลูกค้าทั้งหมด</Ui> ก่อนสรุปว่าไม่มีหนี้
              </Row>
            </ul>
          </GuideSection>

          {/* ── 5. ใบไหนนับเป็นหนี้ ───────────────────────────────────────── */}
          <GuideSection
            icon="🧾"
            title="ใบไหนนับเป็นหนี้ ใบไหนไม่นับ"
            tone="border-l-purple-500"
            intro={
              <>
                นี่คือข้อที่เดาเองไม่ได้ และเป็นข้อที่จะสงสัยแน่ ๆ ตอนตัวเลขไม่ตรงกับที่คิดไว้
              </>
            }
          >
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700">
              <Row term="ใบแจ้งหนี้">
                <strong>นับเป็นหนี้ — มีแค่ใบนี้แบบเดียว</strong> ที่ระบบนับให้เอง
              </Row>
              <Row term="ใบวางบิล">
                <strong>ไม่นับ</strong> เพราะเป็นใบปะหน้าไปเก็บเงินของหนี้ก้อนเดิมที่อยู่บนใบแจ้งหนี้
                ถ้านับด้วย หนี้ก้อนเดียวจะกลายเป็นสองเท่า
              </Row>
              <Row term="ใบเสร็จรับเงิน">
                <strong>ไม่สร้างหนี้ แต่ไปลดหนี้</strong> เพราะเป็นหลักฐานว่าเงินเข้าแล้ว
                ยอดที่ไปลดคือ <strong>ยอดรวมของใบเสร็จใบนั้น</strong> และลดให้เฉพาะใบแจ้งหนี้ที่ผูกไว้ในช่อง{" "}
                <Ui>ชำระให้ใบแจ้งหนี้</Ui>
              </Row>
            </ul>

            <p className="text-xs font-bold text-gray-500 mt-4 mb-2">
              กรณีพิเศษ: ลูกค้าที่วางบิลอย่างเดียว ไม่เคยออกใบแจ้งหนี้
            </p>
            <p className="text-sm leading-relaxed text-gray-700 wrap-break-word">
              หนี้แบบนี้จะมองไม่เห็นเลยถ้าดูตามกฎด้านบน ท้ายหน้าจึงมีกล่อง{" "}
              <Ui>📋 ใบวางบิลที่ยังไม่มีใบแจ้งหนี้</Ui> ให้คุณตัดสินใจเอง กด{" "}
              <Ui>นับเป็นลูกหนี้</Ui> แล้วใบนั้นจะขึ้นในรายการพร้อมป้าย{" "}
              <Ui>ใบวางบิล (นับเป็นลูกหนี้)</Ui> หรือกด <Ui>ไม่นับ</Ui> เพื่อเอาออกจากกล่อง{" "}
              <strong>ระบบไม่เดาให้เอง</strong> เพราะการเดาเรื่องเงินคือที่มาของยอดค้างที่ไม่มีใครอธิบายได้
            </p>
            <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs leading-relaxed text-emerald-900 wrap-break-word">
              🛡️ <strong>กันนับซ้ำให้แล้ว:</strong>{" "}
              ใบวางบิลที่มาจากใบเสนอราคาเดียวกับใบแจ้งหนี้ที่ออกไว้แล้ว (ไม่ว่าใบแจ้งหนี้นั้นจะเก็บเงินครบหรือยัง){" "}
              <strong>จะไม่ถูกเสนอในกล่องนี้เลย</strong> เพราะหนี้ก้อนนั้นถูกนับที่ใบแจ้งหนี้ไปแล้ว
              กล่องนี้จึงมีแต่ใบที่ยังไม่มีใครนับหนี้ให้
            </p>

            <p className="text-xs font-bold text-gray-500 mt-4 mb-2">
              ใบที่ไม่ขึ้นในรายการ: นอกจากใบที่เก็บเงินครบแล้ว ยังมีอีก{" "}
              {Object.keys(TERMINAL_LABELS).length} กรณี
            </p>
            <ul className="space-y-2 text-sm leading-relaxed text-gray-700">
              {(Object.keys(TERMINAL_LABELS) as ReceivableTerminal[]).map((key) => (
                <Row key={key} term={TERMINAL_LABELS[key]}>
                  {TERMINAL_NOTE[key]}
                </Row>
              ))}
            </ul>
            <p className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 wrap-break-word">
              💡 <strong>ใบที่แก้แล้วไม่ถูกเก็บเงินสองรอบ:</strong> เวลาแก้เอกสารด้วย{" "}
              <Ui>✏️ แก้ไข (New Ver.)</Ui> จะได้เลขที่ใหม่ต่อท้ายเป็น v2 v3 ไปเรื่อย ๆ
              หน้านี้นับเฉพาะเวอร์ชันล่าสุดใบเดียว ใบเก่าถือว่า{" "}
              {TERMINAL_LABELS.superseded} — <strong>ไม่ใช่หนี้อีกก้อน</strong>
            </p>
          </GuideSection>

          {/* ── 6. ตรวจว่าใช้ได้จริง ──────────────────────────────────────── */}
          <GuideSection
            icon="🧪"
            title="ตรวจว่าใช้ได้จริง (ลองกับเอกสารทดสอบ)"
            tone="border-l-indigo-500"
            intro={
              <>
                <strong className="text-red-700">
                  ทำกับเอกสารทดสอบเท่านั้น อย่าทำกับใบของลูกค้าจริง
                </strong>{" "}
                ตั้งชื่อลูกค้าว่า “ทดสอบ” จะได้หาเจอและลบทิ้งง่าย ทำตามลำดับนี้แล้วดูว่าตัวเลขตรงตามที่เขียนไว้ไหม
              </>
            }
          >
            <ol className="space-y-3 text-sm leading-relaxed">
              <Step
                n={1}
                title="ออกใบแจ้งหนี้ทดสอบ"
                expect={
                  <>
                    ช่อง <Ui>ครบกำหนดชำระ</Ui> ถูกเติมวันมาให้เอง ใต้ช่องเขียนว่า{" "}
                    <Ui>ค่าเริ่มต้น: เครดิต {term} วัน</Ui>
                  </>
                }
              >
                หน้า <Ui>📋 เอกสารที่บันทึกไว้</Ui> → <Ui>+ สร้างเอกสารใหม่</Ui> →{" "}
                <Ui>ใบแจ้งหนี้ / ใบกำกับภาษี</Ui> ใส่ชื่อทดสอบในช่อง <Ui>บริษัท/ชื่อลูกค้า</Ui>{" "}
                ใส่รายการหนึ่งบรรทัด เช่น 1,000 บาท แล้วกด <Ui>💾 บันทึก</Ui>
              </Step>
              <Step
                n={2}
                title="เปิดหน้าลูกหนี้ค้างชำระ"
                expect={
                  <>
                    เห็นชื่อลูกค้าทดสอบเป็นกล่องหนึ่ง ยอดทางขวาเท่ากับยอดบนใบพอดี
                    และยอดค้างทั้งหมดด้านบนเพิ่มขึ้นเท่ากันนั้น
                  </>
                }
              >
                กด <Ui>💰 ลูกหนี้ค้างชำระ</Ui> จากหน้าเอกสารที่บันทึกไว้
              </Step>
              <Step
                n={3}
                title="ออกใบเสร็จ แล้วผูกกับใบแจ้งหนี้ใบนั้น"
                expect={
                  <>
                    ในช่อง <Ui>ชำระให้ใบแจ้งหนี้</Ui> ใบแจ้งหนี้เมื่อกี้ต้องอยู่ในรายการ
                    พร้อมยอดค้างในวงเล็บ ถ้าปล่อยว่างไว้จะขึ้นเตือนสีส้มว่า{" "}
                    <Ui>ใบเสร็จนี้ยังไม่ได้ผูกกับใบแจ้งหนี้ — ยอดค้างของลูกค้าจะยังไม่ลดลง</Ui>
                  </>
                }
              >
                <Ui>+ สร้างเอกสารใหม่</Ui> → <Ui>ใบเสร็จรับเงิน</Ui> →{" "}
                <strong>ใส่รายการให้ยอดรวมของใบเสร็จเท่ากับใบแจ้งหนี้ (1,000 บาท)</strong>{" "}
                เพราะยอดที่ระบบบันทึกเป็นเงินเข้าคือยอดรวมของใบเสร็จใบนี้ ไม่ใช่ยอดของใบแจ้งหนี้ →
                ในกล่อง <Ui>💳 ข้อมูลการชำระเงิน</Ui> เลือกใบแจ้งหนี้เมื่อกี้ในช่อง{" "}
                <Ui>ชำระให้ใบแจ้งหนี้</Ui> แล้วกด <Ui>💾 บันทึก</Ui>{" "}
                <strong>การผูกช่องนี้คือสิ่งที่ทำให้ออกใบเสร็จ = บันทึกเงินเข้า ในครั้งเดียว</strong>
              </Step>
              <Step
                n={4}
                title="กลับมาดูยอดค้าง"
                expect={
                  <>
                    <strong>ยอดค้างของใบนั้นเป็น 0</strong> — แถวและกล่องลูกค้าทดสอบ{" "}
                    <strong>หายไปจากรายการ</strong> และยอดค้างทั้งหมดลดลงเท่ากับยอดใบนั้น
                    (ถ้ามีแต่ลูกค้าทดสอบรายเดียว จะขึ้น{" "}
                    <Ui>🎉 ไม่มีลูกหนี้ค้างชำระตามตัวกรองนี้</Ui>)
                  </>
                }
              >
                เปิดหน้า <Ui>💰 ลูกหนี้ค้างชำระ</Ui> อีกครั้ง (หน้านี้ไม่ได้อัปเดตเอง
                ต้องเข้ามาใหม่หรือโหลดหน้าใหม่)
              </Step>
              <Step
                n={5}
                title="ยกเลิกใบเสร็จ"
                expect={
                  <>
                    ระบบ <strong>ไม่ยอมให้ลบ</strong> — ขึ้นหน้าต่าง <Ui>ลบเอกสารนี้ไม่ได้</Ui>{" "}
                    บอกว่ามีการรับชำระเงินแล้ว พอกด <Ui>ยกเลิกเอกสาร</Ui> จะได้ข้อความ{" "}
                    <Ui>ยกเลิกเอกสารแล้ว (เอกสารและประวัติการรับชำระยังอยู่)</Ui>
                  </>
                }
              >
                หน้า <Ui>📋 เอกสารที่บันทึกไว้</Ui> → หาแถวใบเสร็จทดสอบ → กด <Ui>🗑️ ลบ</Ui> →{" "}
                ยืนยัน <Ui>ลบ</Ui> → พอระบบปฏิเสธ ให้กด <Ui>ยกเลิกเอกสาร</Ui>{" "}
                <strong>นี่คือทางเดียวที่ยกเลิกใบเสร็จได้ตอนนี้</strong> และเป็นการยกเลิกที่ไม่ลบอะไรทิ้ง
              </Step>
              <Step
                n={6}
                title="ดูว่าหนี้กลับมา"
                expect={
                  <>
                    ลูกค้าทดสอบ <strong>กลับมาในรายการ เต็มจำนวนเท่าเดิม</strong> —
                    เพราะใบเสร็จที่ถูกยกเลิกไม่ถือเป็นหลักฐานว่าเงินเข้าอีกต่อไป
                  </>
                }
              >
                เปิดหน้า <Ui>💰 ลูกหนี้ค้างชำระ</Ui> อีกครั้ง
              </Step>
              <Step
                n={7}
                title="จะให้กลับไปเป็น 0 อีกครั้ง"
                expect={
                  <>
                    ยอดค้างกลับเป็น 0 และแถวหายจากรายการอีกครั้ง เหมือนข้อ 4 ทุกอย่าง
                  </>
                }
              >
                <strong>ตอนนี้ยังไม่มีปุ่ม “ยกเลิกการยกเลิก” บนหน้าจอ</strong>{" "}
                ใบเสร็จที่ยกเลิกไปแล้วจึงเรียกกลับมาไม่ได้ วิธีที่ทำได้จริงคือ{" "}
                <strong>ออกใบเสร็จใบใหม่</strong> แล้วผูกกับใบแจ้งหนี้เดิม (ทำเหมือนข้อ 3)
              </Step>
              <Step
                n={8}
                title="เก็บกวาดของทดสอบ"
                expect={
                  <>
                    ใบทดสอบหายจากหน้า <Ui>📋 เอกสารที่บันทึกไว้</Ui> และไม่มีลูกค้าทดสอบค้างอยู่ในหน้าลูกหนี้แล้ว
                  </>
                }
              >
                ยกเลิกใบเสร็จทดสอบก่อน (ตามข้อ 5) แล้วค่อยกด <Ui>🗑️ ลบ</Ui>{" "}
                ทั้งใบเสร็จและใบแจ้งหนี้ทดสอบ — พอไม่มีเงินผูกอยู่แล้ว ระบบจะยอมให้ลบ
              </Step>
            </ol>
          </GuideSection>

          {/* ── 7. ข้อควรรู้ ──────────────────────────────────────────────── */}
          <GuideSection
            icon="⚠️"
            title="ข้อควรรู้"
            tone="border-l-red-500"
            intro="ข้อจำกัดจริงของหน้านี้ อ่านไว้จะได้ไม่เข้าใจผิดว่าตัวเลขผิด"
          >
            <ul className="space-y-2 text-sm leading-relaxed">
              <Limit severe>
                <strong>ตัวเลขมาจากเอกสารที่ออกในระบบนี้เท่านั้น</strong> —
                งานที่ตกลงกับลูกค้าแล้วแต่ไม่ได้ออกเอกสารที่นี่ จะไม่ปรากฏในหน้านี้เลย
                ไม่ใช่ระบบนับตก แต่ระบบไม่รู้ว่ามีงานนั้นอยู่
              </Limit>
              <Limit severe>
                <strong>ใครก็ตามที่ล็อกอินเข้าระบบได้ เห็นข้อมูลหน้านี้ทั้งหมด</strong> —
                ยอดหนี้ ชื่อลูกค้า เบอร์โทร และยอดของทุกใบ ยังไม่มีการแยกสิทธิ์ว่าใครดูได้แค่ไหน
              </Limit>
              <Limit>
                <strong>รายการเงินไม่เคยถูกลบ</strong> ยกเลิกได้อย่างเดียว
                และรายการที่ยกเลิกจะยังอยู่ในประวัติแบบขีดฆ่า เพื่อให้ตรวจย้อนหลังได้เสมอว่าเคยลงอะไรไว้
              </Limit>
              <Limit>
                <strong>
                  ยกเลิกรายการรับชำระได้ ก็ต่อเมื่อใบนั้นมีรายการที่ยังไม่ถูกยกเลิก ตั้งแต่ 2 รายการขึ้นไป
                </strong>{" "}
                — ถ้าลงผิดและมีอยู่รายการเดียว แถบ <Ui>ประวัติการรับชำระ</Ui> จะยังไม่โผล่ให้กด
                วิธีที่ทำได้ตอนนี้คือกด <Ui>ยกเลิกเอกสาร</Ui> ทั้งใบแทน
              </Limit>
              <Limit>
                <strong>ยังไม่มีปุ่ม “ยกเลิกการยกเลิก” บนหน้าจอ</strong> —
                เอกสารที่กดยกเลิกไปแล้ว เรียกกลับมานับเป็นหนี้ใหม่จากหน้าจอไม่ได้ ต้องออกใบใหม่แทน
                ให้แน่ใจก่อนกดยกเลิก
              </Limit>
              <Limit>
                <strong>
                  ในกล่องใบวางบิล ทั้ง <Ui>นับเป็นลูกหนี้</Ui> และ <Ui>ไม่นับ</Ui> เป็นทางเดียว
                </strong>{" "}
                — กดแล้วใบนั้นจะหายจากกล่อง และยังไม่มีปุ่มบนหน้าจอที่กดกลับเป็นเหมือนเดิมได้
                (ใบที่กด <Ui>นับเป็นลูกหนี้</Ui> ไปแล้ว ถ้าจะเอาออกจากยอดค้างต้องกด{" "}
                <Ui>ยกเลิกเอกสาร</Ui> ทั้งใบ) ถ้าไม่แน่ใจ ปล่อยไว้ก่อนดีกว่า
              </Limit>
              <Limit>
                <strong>ใบเสร็จที่ไม่ได้ผูกกับใบแจ้งหนี้ ไม่ลดยอดค้าง</strong> —
                ตอนสร้างใบเสร็จจะมีเตือนสีส้มไว้ให้แล้ว ถ้าเห็นว่ายอดไม่ลดหลังออกใบเสร็จ
                ให้กลับไปดูช่อง <Ui>ชำระให้ใบแจ้งหนี้</Ui> ก่อนเป็นอย่างแรก
              </Limit>
              <Limit>
                <strong>เปลี่ยนเครดิตเทอมเริ่มต้น ไม่ย้อนไปแก้เอกสารเก่า</strong> —
                วันครบกำหนดคือเงื่อนไขที่ตกลงกับลูกค้าไว้ในใบนั้นแล้ว ค่าที่เปลี่ยนมีผลกับเอกสารที่สร้างใหม่เท่านั้น
              </Limit>
              <Limit>
                <strong>หน้านี้ไม่ได้อัปเดตเอง</strong> — ตัวเลขเป็นภาพ ณ ตอนที่เปิดหน้า
                ถ้ามีคนอื่นบันทึกรับชำระระหว่างนั้น ต้องโหลดหน้าใหม่ถึงจะเห็น
              </Limit>
              <Limit>
                <strong>ใบที่เก็บเงินครบแล้วจะหายไปจากหน้านี้</strong> ไม่ใช่ข้อมูลหาย —
                หน้านี้แสดงเฉพาะเงินที่ยังเก็บไม่ได้ เอกสารทั้งหมดยังดูได้ที่{" "}
                <Ui>📋 เอกสารที่บันทึกไว้</Ui>
              </Limit>
              <Limit severe>
                <strong>รับเงินเกิน ระบบไม่ยกไปหักใบอื่นให้ และไม่เตือนซ้ำทีหลัง</strong> —
                มีเตือนครั้งเดียวตอนกำลังบันทึก พอบันทึกไปแล้วใบนั้นถือว่าเก็บครบ
                หายออกจากหน้านี้ ไม่มีที่ไหนค้างยอดส่วนเกินไว้ให้ดู
                ถ้าจะคืนเงินหรือหักกับงานหน้า ต้องจดไว้เอง
              </Limit>
            </ul>
          </GuideSection>

          <p className="text-xs text-gray-400 text-center pt-2 pb-1 wrap-break-word">
            ตัวเลขเกณฑ์และชื่อสถานะในคู่มือนี้อ่านจากค่าที่ระบบใช้จริง ถ้ามีการปรับในอนาคต คู่มือจะเปลี่ยนตามเอง
          </p>
        </div>

        {/* A second way out, for anyone who has scrolled to the bottom. */}
        <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto sm:ml-auto sm:block px-5 py-2.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-all text-sm shadow-sm"
          >
            ปิดคู่มือ
          </button>
        </div>
      </div>
    </div>
  );
}
