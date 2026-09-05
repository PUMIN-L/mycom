"use client";
import { useEffect, useRef } from "react";
import { CALIBRATION_VALIDITY_MONTHS } from "../lib/types";
import {
  CALIBRATION_ALERT_LEAD_MONTHS,
  ALERT_LIST_DISPLAY_LIMIT,
  MISSING_DELIVERY_DOC_DAYS,
  MISSING_RECEIPT_DOC_DAYS,
} from "../lib/alertThresholds";

/**
 * The in-page user guide for /crm/alerts (tasks.md 18.1-18.14).
 *
 * The owner's complaint this answers: the page only ever showed what the system
 * computed, and nothing said WHY a card appeared or WHAT makes it go away — so
 * an alert that would not clear looked like a bug. Every section here therefore
 * answers the same three questions in the same order: ขึ้นเมื่อไร / เกณฑ์ที่ใช้ /
 * หายเมื่อไร.
 *
 * TWO RULES HOLD THIS FILE TOGETHER:
 *
 * 1. NO THRESHOLD IS EVER TYPED AS PROSE (18.14). Every number below is either
 *    a constant imported from `lib/alertThresholds` (the same module
 *    `getAlerts()` reads) or a prop carrying what THIS page actually requested
 *    on this load (`warrantyDays` / `scheduleDays`). Widening a window in one
 *    place therefore rewrites the guide too, instead of leaving it quietly
 *    lying about the system it documents.
 * 2. IT OWNS NO STATE BUT ITS OWN SCROLL (18.13). Opening and closing is a
 *    boolean in the page — no router push, no query string, no touch of the
 *    selected alert tab. The URL stays `/crm/alerts` and the tab the admin was
 *    reading is still selected when the guide closes.
 *
 * Narrow-screen contract (18.12): the dialog is a flex COLUMN — a fixed header
 * holding the close button, and one scrolling body under it. The close button
 * therefore never scrolls out of reach no matter how long the content grows,
 * and the body is a single column at every width (no grid, no table), so a
 * 360px phone scrolls this box and never the page sideways.
 */

interface AlertsGuidePanelProps {
  /** The warranty window this page's alert request actually used, in days. */
  warrantyDays: number;
  /** The equipment-schedule window this page's alert request actually used. */
  scheduleDays: number;
  onClose: () => void;
}

/** Months of grace before an overdue calibration starts shouting — derived,
 *  never typed: validity minus the lead time is exactly the interval the SQL
 *  puts in its DATE_ADD(). */
const CALIBRATION_ALERT_AFTER_MONTHS =
  CALIBRATION_VALIDITY_MONTHS - CALIBRATION_ALERT_LEAD_MONTHS;

/** A highlighted number. Its only job is to make the values that come from
 *  real constants stand out from the sentence around them, so the owner can
 *  see at a glance which parts of the guide are live figures. */
function Val({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-bold text-gray-900 bg-amber-100/70 rounded px-1 py-0.5 mx-0.5">
      {children}
    </strong>
  );
}

interface GuideSectionProps {
  icon: string;
  title: string;
  /** Tailwind classes for the section's left rail + icon chip. */
  tone: string;
  /** Optional badge next to the heading ("ใหม่", "ไม่ใช่แจ้งเตือน"). */
  badge?: { label: string; className: string };
  /** What makes a card of this kind appear. */
  appears: React.ReactNode;
  /** The exact rule/threshold behind it, rendered from live constants. */
  rule: React.ReactNode;
  /** Everything that makes it go away. One line each. */
  clears: React.ReactNode[];
  /** The gotcha the owner is most likely to hit. Optional. */
  note?: React.ReactNode;
}

function GuideSection({
  icon,
  title,
  tone,
  badge,
  appears,
  rule,
  clears,
  note,
}: GuideSectionProps) {
  return (
    <section className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm border-l-4 ${tone}`}>
      <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-gray-900 mb-3">
        <span className="text-lg" aria-hidden="true">
          {icon}
        </span>
        <span className="wrap-break-word">{title}</span>
        {badge && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${badge.className}`}>
            {badge.label}
          </span>
        )}
      </h3>

      <dl className="space-y-3 text-sm leading-relaxed text-gray-700">
        <div>
          <dt className="font-semibold text-gray-500 text-xs mb-1">ขึ้นเมื่อไร</dt>
          <dd className="wrap-break-word">{appears}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-500 text-xs mb-1">เกณฑ์ที่ระบบใช้จริง</dt>
          <dd className="wrap-break-word">{rule}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-500 text-xs mb-1">ทำอย่างไรถึงจะหายไป</dt>
          <dd>
            <ul className="space-y-1">
              {clears.map((line, index) => (
                <li key={index} className="flex gap-2 wrap-break-word">
                  <span className="text-emerald-600 shrink-0" aria-hidden="true">
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      {note && (
        <p className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs leading-relaxed text-amber-900 wrap-break-word">
          💡 {note}
        </p>
      )}
    </section>
  );
}

export default function AlertsGuidePanel({
  warrantyDays,
  scheduleDays,
  onClose,
}: AlertsGuidePanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Escape closes — the same gesture every other modal on this page answers to.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the scrolling body so the keyboard can page through the
  // guide immediately, and so a screen reader lands inside the dialog rather
  // than back at the top of the alert page behind it.
  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-200 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-3xl h-[92vh] sm:h-auto sm:max-h-[88vh] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="คู่มือการใช้งานศูนย์แจ้งเตือน"
      >
        {/* Header sits OUTSIDE the scroll area on purpose: the close button has
            to stay tappable at any scroll position, on any screen (18.12). */}
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100 bg-white">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span aria-hidden="true">📖</span>
              <span className="wrap-break-word">คู่มือการใช้งาน</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 wrap-break-word">
              แต่ละแจ้งเตือนขึ้นเพราะอะไร และต้องทำอะไรถึงจะหายไป
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="ปิดคู่มือ"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* The single scrolling column. `overscroll-contain` keeps a flick at
            the end of the list from scrolling the alert page underneath. */}
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-4 focus:outline-none"
        >
          <p className="text-sm leading-relaxed text-gray-600 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 wrap-break-word">
            หน้านี้มีของ <strong className="font-bold text-gray-900">2 แบบ</strong> ที่ไม่เหมือนกัน คือ{" "}
            <strong className="font-bold text-gray-900">แจ้งเตือนอัตโนมัติ</strong> ที่ระบบคำนวณให้เองจากข้อมูลเครื่องและใบขาย
            (การ์ดด้านบน แยกเป็นแท็บ) กับ{" "}
            <strong className="font-bold text-gray-900">กระดานงาน “สิ่งที่ต้องทำ”</strong> ที่เป็นโน้ตที่คุณพิมพ์เอง
            (บล็อกด้านล่าง) — ตัวเลขเกณฑ์ทุกตัวในคู่มือนี้ดึงมาจากค่าที่ระบบใช้จริงในการโหลดรอบนี้
          </p>

          {/* ── 1. กำหนดการ (18.2) ─────────────────────────────────────── */}
          <GuideSection
            icon="🔧"
            title="กำหนดการ (นัดที่ผูกกับเครื่อง)"
            tone="border-l-blue-500"
            appears={
              <>
                เมื่อมีนัดหมาย (เช่น นัดเข้าไปเซอร์วิส) ที่ <strong>ผูกกับเครื่องของลูกค้า</strong>{" "}
                สถานะยังเป็น “รอดำเนินการ” และวันนัดใกล้เข้ามาแล้ว หรือเลยวันนัดไปแล้ว
              </>
            }
            rule={
              <>
                วันนัดอยู่ภายใน <Val>{scheduleDays} วัน</Val> นับจากวันนี้ หรือเลยกำหนดมาแล้ว
                (นัดที่เลยกำหนดจะขึ้นป้าย “เลยกำหนด” สีแดง และจะค้างอยู่ตลอดจนกว่าจะปิดงาน)
              </>
            }
            clears={[
              <>
                กด <strong>“เสร็จแล้ว”</strong> แล้วบันทึกผลงาน — ระบบบังคับให้มีบันทึกผลเสมอ
                จึงปิดงานโดยไม่บันทึกผลไม่ได้
              </>,
              <>ยกเลิกนัดนั้น (ถ้าไม่ต้องทำแล้ว)</>,
              <>
                กด <strong>“เลื่อนแจ้งเตือน” ⏱️</strong> — ซ่อนชั่วคราวเท่านั้น เดี๋ยวกลับมา (ดูหัวข้อเลื่อนแจ้งเตือนด้านล่าง)
              </>,
            ]}
            note={
              <>
                นัดที่วันนัดอยู่ไกลกว่า <Val>{scheduleDays} วัน</Val> จะ <strong>ยังไม่ขึ้น</strong> ในหน้านี้
                ไม่ได้แปลว่าหายไป — นัดยังอยู่ในประวัติของเครื่องนั้น และจะโผล่มาเองเมื่อใกล้ถึงวัน
              </>
            }
          />

          {/* ── 2. นัดโทรลูกค้า (18.3) ──────────────────────────────────── */}
          <GuideSection
            icon="📞"
            title="นัดโทรลูกค้า"
            tone="border-l-violet-500"
            badge={{ label: "ใหม่", className: "bg-violet-100 text-violet-700" }}
            appears={
              <>
                เมื่อสร้างนัดโทรที่ผูกกับ <strong>ลูกค้า</strong> (ไม่ได้ผูกกับเครื่องเครื่องไหน) —
                จะขึ้นบนหน้านี้ <strong>ทันทีที่กดบันทึก</strong>
              </>
            }
            rule={
              <>
                <strong>ไม่มีหน้าต่างวัน</strong> จะนัดไว้อีกกี่เดือนก็ขึ้นตั้งแต่วันที่สร้าง
                และค้างอยู่จนกว่าจะปิดงาน (เมื่อเลยวันนัดจะเพิ่มป้าย “เลยกำหนด” ให้ แต่ไม่ได้หายไปไหน)
                รายการแสดงสูงสุด <Val>{ALERT_LIST_DISPLAY_LIMIT}</Val> รายการต่อครั้ง
                แต่ตัวเลขบนแท็บและบนกระดิ่งเป็นยอดจริงทั้งหมด
              </>
            }
            clears={[
              <>
                กด <strong>“เสร็จแล้ว”</strong> เมื่อโทรเรียบร้อย
              </>,
              <>ยกเลิกนัดโทรนั้น</>,
              <>เลื่อนแจ้งเตือน (ชั่วคราว)</>,
            ]}
            note={
              <>
                นี่คือจุดที่ต่างจาก “กำหนดการ” ด้านบน: เมื่อก่อนจองนัดโทรล่วงหน้าไว้แล้วเหมือนระบบไม่ทำอะไรเลย
                เพราะต้องรอจนใกล้ถึงวันถึงจะโผล่ ตอนนี้เห็นทันทีตั้งแต่วันที่จอง
              </>
            }
          />

          {/* ── 3. ประกันใกล้หมด (18.4) ─────────────────────────────────── */}
          <GuideSection
            icon="🛡️"
            title="ประกันใกล้หมด"
            tone="border-l-amber-500"
            appears={
              <>
                เมื่อเครื่องของลูกค้ามี <strong>วันหมดประกัน</strong> ใกล้เข้ามาแล้ว
                และเครื่องนั้นยังเปิดสวิตช์ <strong>“เตือนเมื่อประกันใกล้หมด”</strong> อยู่
              </>
            }
            rule={
              <>
                วันหมดประกันอยู่ระหว่าง <strong>วันนี้</strong> ถึง <strong>อีก</strong>{" "}
                <Val>{warrantyDays} วัน</Val> ข้างหน้า และสถานะเครื่อง <strong>ยังไม่ใช่ “Expired”</strong>
                {" "}(เครื่องที่เลยวันหมดประกันไปแล้วจะไม่อยู่ในหมวดนี้)
              </>
            }
            clears={[
              <>บันทึกวันหมดประกันใหม่ (เช่น ต่อประกันให้ลูกค้า)</>,
              <>
                เปลี่ยนสถานะเครื่องเป็น <strong>Expired</strong> เมื่อยอมรับว่าประกันจบแล้ว
              </>,
              <>
                <strong>ปิดสวิตช์ “เตือนเมื่อประกันใกล้หมด”</strong> ของเครื่องนั้น
                (อยู่ในหน้าแก้ไขข้อมูลเครื่อง)
              </>,
              <>เลื่อนแจ้งเตือน (ชั่วคราว)</>,
            ]}
            note={
              <>
                <strong>“ทำไมเครื่องนี้ไม่เคยเตือนประกันเลย?”</strong> — เกือบทุกครั้งคือสวิตช์
                “เตือนเมื่อประกันใกล้หมด” ของเครื่องนั้นถูกปิดไว้ (มักเป็นเครื่องที่ลูกค้าซื้อมาเองจากที่อื่น)
                ให้เปิดสวิตช์ในหน้าแก้ไขเครื่อง — สวิตช์นี้ปิดเฉพาะ <strong>เตือนประกัน</strong> เท่านั้น
                ไม่ได้ซ่อนเครื่อง และไม่กระทบเตือนสอบเทียบหรือข้อมูลไม่ครบ
              </>
            }
          />

          {/* ── 4. ใกล้ถึงกำหนดสอบเทียบ (18.5) ──────────────────────────── */}
          <GuideSection
            icon="🎯"
            title="ใกล้ถึงกำหนดสอบเทียบ"
            tone="border-l-purple-500"
            appears={
              <>
                เมื่อเครื่องที่มี <strong>วันสอบเทียบล่าสุด</strong> บันทึกไว้ ใกล้ครบรอบสอบเทียบ
              </>
            }
            rule={
              <>
                ระบบถืออายุการสอบเทียบ <Val>{CALIBRATION_VALIDITY_MONTHS} เดือน</Val> และเตือนล่วงหน้า{" "}
                <Val>{CALIBRATION_ALERT_LEAD_MONTHS} เดือน</Val> — จึงเริ่มเตือนเมื่อผ่านไปแล้ว{" "}
                <Val>{CALIBRATION_ALERT_AFTER_MONTHS} เดือน</Val> นับจากวันสอบเทียบล่าสุด{" "}
                <strong>และไม่มีขอบบน</strong> คือเลยกำหนดไปนานแค่ไหนก็ยังเตือนอยู่อย่างนั้น
              </>
            }
            clears={[
              <>
                <strong>บันทึกวันสอบเทียบใหม่</strong> ให้เครื่องนั้น — ทางเดียวที่ทำให้หายจริง
              </>,
              <>เลื่อนแจ้งเตือน (ชั่วคราว ไม่ได้แก้ต้นเหตุ)</>,
            ]}
            note={
              <>
                หมวดนี้ไม่มีคำว่า “เสร็จแล้ว” ให้กด และการตั้งสถานะเครื่องเป็น Expired
                หรือปิดสวิตช์เตือนประกัน <strong>ไม่ช่วย</strong> — ตราบใดที่วันสอบเทียบล่าสุดยังเป็นวันเดิม
                รายการนี้จะอยู่ต่อไป
              </>
            }
          />

          {/* ── 5. ข้อมูลไม่ครบ (18.6) ──────────────────────────────────── */}
          <GuideSection
            icon="📋"
            title="ข้อมูลไม่ครบ"
            tone="border-l-slate-400"
            appears={
              <>
                เมื่อเครื่องของลูกค้า <strong>ไม่มีหมายเลขเครื่อง (serial number)</strong> หรือ{" "}
                <strong>ไม่มีวันเริ่มประกัน</strong> อย่างใดอย่างหนึ่งหรือทั้งสองอย่าง
              </>
            }
            rule={
              <>
                ขาดช่องใดช่องหนึ่งก็ขึ้นแล้ว รายการนี้ <strong>แสดงสูงสุด</strong>{" "}
                <Val>{ALERT_LIST_DISPLAY_LIMIT}</Val> รายการต่อครั้งเพื่อไม่ให้หน้าช้า
                แต่ <strong>ตัวเลขบนแท็บคือยอดจริงทั้งหมด</strong> ถ้าตัวเลขมากกว่าจำนวนการ์ดที่เห็น
                แปลว่ายังมีค้างอยู่อีก ไม่ใช่ระบบนับผิด
              </>
            }
            clears={[
              <>กรอกหมายเลขเครื่องให้ครบ</>,
              <>กรอกวันเริ่มประกันให้ครบ (ต้องครบทั้งสองอย่างถึงจะหาย)</>,
              <>เลื่อนแจ้งเตือน (ชั่วคราว)</>,
            ]}
          />

          {/* ── 6. เอกสารค้าง (18.7) ────────────────────────────────────── */}
          <GuideSection
            icon="🧾"
            title="เอกสารค้าง"
            tone="border-l-rose-500"
            appears={
              <>
                เมื่อใบขายเลยวันขายมานานพอสมควรแล้ว แต่ยัง <strong>ไม่ได้กรอกเลขที่เอกสาร</strong>{" "}
                ที่ควรจะมี มี 2 กรณี
              </>
            }
            rule={
              <ul className="space-y-1.5 mt-1">
                <li className="wrap-break-word">
                  <strong>1) ใบส่งของ</strong> — ใบขายที่เป็นการขาย <strong>อุปกรณ์</strong>{" "}
                  ยังไม่มีเลขที่ใบส่งของ และผ่านวันขายมาแล้วตั้งแต่ <Val>{MISSING_DELIVERY_DOC_DAYS} วัน</Val> ขึ้นไป
                </li>
                <li className="wrap-break-word">
                  <strong>2) ใบเสร็จ</strong> — ใบขายที่มีเลขที่ใบแจ้งหนี้แล้ว แต่ยังไม่มีเลขที่ใบเสร็จ
                  และผ่านวันขายมาแล้วตั้งแต่ <Val>{MISSING_RECEIPT_DOC_DAYS} วัน</Val> ขึ้นไป
                </li>
              </ul>
            }
            clears={[
              <>
                <strong>กรอกเลขที่เอกสารที่ขาด</strong> ลงในใบขายนั้น (กดที่การ์ดเพื่อเปิดใบขายขึ้นมาแก้ได้เลย)
              </>,
              <>เลื่อนแจ้งเตือน (ชั่วคราว)</>,
            ]}
          />

          {/* ── 7. เลื่อนแจ้งเตือน (18.8) ───────────────────────────────── */}
          <GuideSection
            icon="⏱️"
            title="เลื่อนแจ้งเตือน คืออะไร"
            tone="border-l-amber-400"
            appears={<>เมื่อคุณกดปุ่ม ⏱️ บนการ์ดแจ้งเตือนอัตโนมัติใบใดก็ตาม แล้วเลือกวันที่</>}
            rule={
              <>
                เป็นการ <strong>ซ่อนการ์ดใบนั้นชั่วคราว</strong> จนถึงวันที่เลือกไว้ ใช้ได้กับทุกหมวดอัตโนมัติ
                และ <strong>ไม่ได้แก้ต้นเหตุ</strong> — ไม่ได้ปิดงาน ไม่ได้ต่อประกัน ไม่ได้กรอกเอกสารให้
              </>
            }
            clears={[
              <>พอถึงวันที่เลื่อนไว้ การ์ดจะกลับมาเองอัตโนมัติ ถ้าต้นเหตุยังไม่ถูกแก้</>,
              <>ถ้าแก้ต้นเหตุระหว่างนั้น การ์ดก็จะไม่กลับมาอีก</>,
            ]}
            note={
              <>
                <strong>ระบบไม่เคยลบข้อมูลของคุณเองอัตโนมัติ</strong> การ์ดที่หายไปจากหน้านี้คือ
                “สถานะเปลี่ยน” หรือ “ถูกซ่อนชั่วคราว” เท่านั้น ข้อมูลเครื่อง ใบขาย และนัดหมายยังอยู่ครบ
              </>
            }
          />

          {/* ── 8. กระดานงาน (18.9) ─────────────────────────────────────── */}
          <GuideSection
            icon="📝"
            title="กระดานงาน “สิ่งที่ต้องทำ”"
            tone="border-l-indigo-500"
            badge={{ label: "คุณเขียนเอง", className: "bg-indigo-100 text-indigo-700" }}
            appears={
              <>
                เมื่อ <strong>คุณกดสร้างเอง</strong> เท่านั้น — เป็นโน้ตส่วนตัวแบบกระดาษโพสต์อิท
                เช่น “โทรหาเจ้านี้” “ทำใบเสนอราคาให้เจ้านั้น”
                <strong> ไม่ใช่แจ้งเตือนอัตโนมัติ</strong> ระบบจะไม่สร้างงานขึ้นมาเองเด็ดขาด
                จึงไม่มีอยู่ในแท็บด้านบน และการ์ดงานไม่มีปุ่ม “เลื่อนแจ้งเตือน”
              </>
            }
            rule={
              <>
                ทุกงานต้องมี <strong>หัวข้อ</strong> และ <strong>ชื่องาน</strong>{" "}
                ส่วน <strong>วันครบกำหนดจะใส่หรือไม่ใส่ก็ได้</strong> งานที่ไม่ใส่วันจะขึ้นว่า “ไม่มีกำหนด”
                และอยู่บนกระดานไปเรื่อยๆ จนกว่าจะกดว่าเสร็จ
              </>
            }
            clears={[
              <>
                <strong>สร้าง:</strong> ปุ่ม “✏️ สร้างงานใหม่” ใส่หัวข้อ ชื่องาน รายละเอียด และวันครบกำหนด (ถ้ามี)
              </>,
              <>
                <strong>แก้ไข:</strong> กดปุ่มแก้ไขบนการ์ดงาน เปลี่ยนได้ทุกช่องรวมทั้งหัวข้อและลิงก์
              </>,
              <>
                <strong>เสร็จ / เปิดใหม่:</strong> กด “✓ เสร็จแล้ว” แล้วงานจะย้ายไปเก็บในฝั่ง “เสร็จแล้ว”
                (สลับดูได้ที่ปุ่ม “ที่ต้องทำ / เสร็จแล้ว” เหนือกระดาน) ถ้ากดผิดกด “↩️ เปิดใหม่”
                ดึงกลับมาได้ ไม่มีอะไรหาย
              </>,
              <>
                <strong>ลบ:</strong> ลบได้ แต่ต้องยืนยันก่อนเสมอ และลบแล้วไม่ย้อนกลับ —
                ถ้าแค่ทำเสร็จแล้วให้กด “เสร็จแล้ว” ดีกว่าลบ
              </>,
            ]}
            note={
              <>
                <strong>หัวข้องานเพิ่มเองได้:</strong> ปุ่มจัดการหัวข้อให้คุณ <strong>เพิ่ม</strong> หัวข้อใหม่{" "}
                <strong>เปลี่ยนชื่อ</strong> เปลี่ยนไอคอน/สี จัดลำดับ และ <strong>ซ่อน</strong> หัวข้อที่เลิกใช้
                (ซ่อนแล้วงานเก่ายังอยู่ครบ แค่ไม่ให้เลือกตอนสร้างงานใหม่) หัวข้อที่ยังมีงานค้างอยู่จะลบไม่ได้
                ระบบจะให้ซ่อนแทน เพื่อไม่ให้งานกลายเป็นงานไร้หัวข้อ ส่วนแถบชิปด้านบนกระดานคือ
                <strong> ตัวกรองตามหัวข้อ</strong> กด “ทั้งหมด” เพื่อกลับมาเห็นทุกงาน
              </>
            }
          />

          {/* ── 9. กระดิ่ง (18.10) ──────────────────────────────────────── */}
          <GuideSection
            icon="🔔"
            title="ตัวเลขบนกระดิ่ง นับอะไรบ้าง"
            tone="border-l-red-500"
            appears={
              <>
                ตัวเลขแดงบนกระดิ่งมุมบนของทุกหน้า = แจ้งเตือนอัตโนมัติที่ค้างอยู่ทุกหมวด{" "}
                <strong>บวกกับงานบนกระดานที่ถึงกำหนดแล้ว</strong>
              </>
            }
            rule={
              <>
                สำหรับกระดานงาน กระดิ่งนับ <strong>เฉพาะงานที่ยังไม่เสร็จ และวันครบกำหนดถึงแล้ว</strong>{" "}
                (วันครบกำหนดเป็นวันนี้หรือเลยมาแล้ว) เท่านั้น
              </>
            }
            clears={[
              <>
                งานที่ <strong>ไม่ได้ใส่วันครบกำหนด</strong> จะ <strong>ไม่ถูกนับ</strong> ตลอดไป
              </>,
              <>
                งานที่ <strong>ครบกำหนดวันข้างหน้า</strong> ยัง <strong>ไม่ถูกนับ</strong>{" "}
                จะเริ่มนับเองในวันที่ถึงกำหนด
              </>,
              <>กดว่างานเสร็จแล้ว ตัวเลขจะลดลงในรอบรีเฟรชถัดไป</>,
            ]}
            note={
              <>
                ถ้าเพิ่งสร้างงานใหม่แล้ว <strong>ตัวเลขบนกระดิ่งไม่ขยับ</strong> — ไม่ใช่ระบบพัง
                แต่แปลว่างานนั้นยังไม่ถึงกำหนด หรือไม่ได้ใส่วันครบกำหนดไว้
              </>
            }
          />

          {/* ── 10. ลิงก์ในงาน (18.11) ──────────────────────────────────── */}
          <GuideSection
            icon="🔗"
            title="ลิงก์ที่ผูกไว้ในงาน"
            tone="border-l-teal-500"
            appears={
              <>
                เมื่อคุณผูกลิงก์ไว้ตอนสร้างหรือแก้ไขงาน ลิงก์จะโผล่เป็นป้ายเล็กๆ ใต้ชื่องาน
                ผูกได้หลายอันในงานเดียว
              </>
            }
            rule={
              <ul className="space-y-1.5 mt-1">
                <li className="wrap-break-word">
                  🏢 <strong>ลูกค้า</strong> — กดแล้วเปิดหน้ารายชื่อลูกค้าที่ลูกค้ารายนั้น
                </li>
                <li className="wrap-break-word">
                  🔧 <strong>เครื่องจักร</strong> — กดแล้วเปิดหน้าลูกค้าที่แท็บเครื่อง ตรงเครื่องนั้น
                </li>
                <li className="wrap-break-word">
                  🧾 <strong>ใบเสนอราคา</strong> — กดแล้วเปิดใบเสนอราคาใบนั้นในโหมดดู
                </li>
                <li className="wrap-break-word">
                  📄 <strong>เอกสาร</strong> — กดแล้วเปิดหน้าเอกสารนั้น
                </li>
              </ul>
            }
            clears={[
              <>
                ปลดลิงก์ออกจากงานได้ตลอดในหน้าแก้ไขงาน — ปลดลิงก์ไม่ได้ลบลูกค้า เครื่อง
                หรือใบเสนอราคาปลายทาง
              </>,
            ]}
            note={
              <>
                <strong>ป้ายที่ขึ้นว่า “ถูกลบแล้ว”</strong> (สีจาง กดไม่ได้) แปลว่าปลายทางไม่มีอยู่แล้ว
                ที่พบบ่อยที่สุดคือ <strong>ใบเสนอราคาเก่าเกิน 2 ปี ที่ระบบล้างออกตามรอบเก็บข้อมูล</strong>{" "}
                ชื่อเดิมที่บันทึกไว้ตอนผูกลิงก์จะยังแสดงอยู่ให้รู้ว่าเคยชี้ไปที่อะไร และ{" "}
                <strong>ตัวงานของคุณไม่ได้หายไปด้วย</strong> ส่วนป้ายที่ขึ้นว่า “ตรวจสอบไม่สำเร็จ”
                คนละเรื่องกัน — แปลว่าโหลดข้อมูลปลายทางไม่ได้ในรอบนั้น ลองรีเฟรชอีกครั้ง
              </>
            }
          />

          <p className="text-xs text-gray-400 text-center pt-2 pb-1 wrap-break-word">
            ตัวเลขเกณฑ์ในคู่มือนี้อ่านจากค่าที่ระบบใช้จริง ถ้ามีการปรับเกณฑ์ในอนาคต คู่มือจะเปลี่ยนตามเอง
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
