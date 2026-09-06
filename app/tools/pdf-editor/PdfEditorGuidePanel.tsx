"use client";

import { useEffect, useRef } from "react";
import {
  MAX_IMAGE_MB,
  MAX_PAGES,
  MAX_PDF_MB,
  WARN_PDF_MB,
} from "../../lib/pdfValidate";
import { MAX_FONT_SIZE_PT, MIN_FONT_SIZE_PT } from "./PdfEditorToolbar";

/**
 * The in-page Thai user guide for the PDF editor.
 *
 * This is the thing the owner asked for in so many words — "บอกวิธีใช้ไว้ด้วยว่า
 * ทำไรได้บ้าง ทำยังไง" — so it is a first-class part of the feature, not a
 * tooltip. It is a structural copy of `app/components/AlertsGuidePanel.tsx` and
 * keeps all four of that file's contracts:
 *
 *   1. IT OWNS NO STATE BUT ITS OWN SCROLL. Opening and closing is a plain
 *      boolean in the page — no router push, no query string. The URL stays
 *      `/tools/pdf-editor` and the document the admin is editing is untouched
 *      behind it (opening the guide mid-edit must never cost him his work).
 *   2. NO THRESHOLD IS EVER TYPED AS PROSE. Every number below is imported —
 *      the upload limits from `pdfValidate.ts`, the same module the upload path
 *      checks against, and the point-size range from `PdfEditorToolbar`, which
 *      is the list the admin actually picks from. Raising either rewrites the
 *      guide instead of leaving it quietly lying about the tool it documents.
 *   3. The dialog is a flex COLUMN with a NON-SCROLLING header, so the close
 *      button never scrolls out of reach, plus a second way out at the bottom
 *      for anyone who read to the end. Escape closes; focus moves into the body.
 *   4. One column at every width, `overscroll-contain` on the scroller, so a
 *      360px phone scrolls this box and never the page sideways.
 *
 * THE ข้อจำกัด SECTION IS THE POINT OF THE WHOLE FILE. A PDF editor invites two
 * assumptions that are both wrong here, and an admin who acts on either will
 * send a customer something he did not intend:
 *   • that typing into a document reflows it like a word processor, and
 *   • that covering text with a white box DELETES it.
 * The second is a confidentiality question, not a cosmetic one — the covered
 * text is still in the file and comes straight back out with copy-paste or any
 * text extractor. Redaction was explicitly cut from this build, so the guide has
 * to say plainly that white-out is not redaction. Never soften these lines.
 */

interface PdfEditorGuidePanelProps {
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

/** One "you can do this" row: what it is, and the one sentence of how. */
function Can({ icon, name, children }: { icon: string; name: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 wrap-break-word">
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong className="font-bold text-gray-900">{name}</strong> — {children}
      </span>
    </li>
  );
}

/** One numbered step in ทำยังไง. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 wrap-break-word">
      <span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-700 font-bold text-xs flex items-center justify-center">
        {n}
      </span>
      <span>
        <strong className="font-bold text-gray-900">{title}</strong>
        <br />
        <span className="text-gray-700">{children}</span>
      </span>
    </li>
  );
}

/** One limitation. `severe` marks the two an admin can actually get hurt by. */
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

export default function PdfEditorGuidePanel({ onClose }: PdfEditorGuidePanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Escape closes — the same gesture every other modal in this app answers to.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Move focus into the scrolling body so the keyboard can page through the
  // guide immediately, and so a screen reader lands inside the dialog rather
  // than back on the editor behind it.
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
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="คู่มือการใช้งานเครื่องมือแก้ไข PDF"
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
              เครื่องมือนี้ทำอะไรได้ ทำยังไง และมีอะไรที่ทำไม่ได้
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
            the end of the list from scrolling the editor underneath. */}
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 space-y-4 focus:outline-none"
        >
          <p className="text-sm leading-relaxed text-gray-600 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 wrap-break-word">
            เครื่องมือนี้ทำงาน <strong className="font-bold text-gray-900">ในเครื่องคุณทั้งหมด</strong> —
            ไฟล์ที่อัปโหลดไม่ได้ถูกส่งขึ้นเซิร์ฟเวอร์ ไม่ได้เก็บลงฐานข้อมูล และไม่ได้ค้างไว้ที่ไหนเลย
            พอปิดหน้านี้หรือรีเฟรช ทุกอย่างจะหายไป{" "}
            <strong className="font-bold text-gray-900">ต้องกดดาวน์โหลดก่อนเสมอ</strong>
          </p>

          {/* ── 1. ทำอะไรได้ ─────────────────────────────────────────────── */}
          <GuideSection
            icon="✅"
            title="ทำอะไรได้"
            tone="border-l-emerald-500"
            intro="รายการข้างล่างนี้คือทั้งหมดที่เครื่องมือนี้ทำได้ ถ้าไม่มีในรายการนี้แปลว่าทำไม่ได้"
          >
            <ul className="space-y-2.5 text-sm leading-relaxed text-gray-700">
              <Can icon="⬜" name="ทับขาวแล้วพิมพ์ทับ">
                ลากกรอบสี่เหลี่ยมสีขาวทึบปิดข้อความเดิม แล้วพิมพ์ข้อความใหม่ลงไปตรงนั้น
                ใช้แก้ตัวเลข แก้ชื่อ แก้วันที่ในเอกสารที่ไม่มีไฟล์ต้นฉบับแล้ว
              </Can>
              <Can icon="🔤" name="เพิ่มข้อความ">
                พิมพ์ข้อความไทย/อังกฤษเพิ่มตรงไหนของหน้าก็ได้ ตั้งขนาดได้ตั้งแต่{" "}
                <Val>{MIN_FONT_SIZE_PT} pt</Val> ถึง <Val>{MAX_FONT_SIZE_PT} pt</Val>{" "}
                ปรับสี ตัวหนา การจัดวาง และความเอียงได้ ข้อความที่ได้เป็นตัวหนังสือจริง
                ค้นหาและคัดลอกได้ ไม่ใช่รูปภาพ
              </Can>
              <Can icon="🖼️" name="วางรูปภาพ">
                วางรูป PNG หรือ JPG ลงบนหน้าเอกสาร เช่น ตราบริษัท หัวจดหมาย หรือตราประทับ
                ขนาดไฟล์รูปไม่เกิน <Val>{MAX_IMAGE_MB} MB</Val> ต่อรูป
              </Can>
              <Can icon="✍️" name="เซ็นชื่อ">
                เซ็นด้วยเมาส์หรือนิ้วบนหน้าจอ แล้ววางลายเซ็นลงบนเอกสาร ย้ายและปรับขนาดได้
              </Can>
              <Can icon="🧾" name="กรอกฟอร์มที่มีอยู่แล้ว">
                ถ้าไฟล์นั้นเป็น PDF ฟอร์มที่มีช่องกรอกจริง ๆ (AcroForm) จะมีแผงให้กรอกขึ้นมาเอง
                และเลือกได้ว่าจะตรึงค่าให้แก้ไม่ได้อีกหรือไม่ ถ้าไฟล์ไม่มีช่องกรอก
                แผงนี้จะบอกตรง ๆ ว่าไม่มี
              </Can>
              <Can icon="📄" name="จัดการหน้า">
                ลบหน้า สลับลำดับหน้า หมุนหน้า (90° / 180° / 270°) เอาไฟล์ PDF อีกไฟล์มาต่อท้าย
                และแยกเฉพาะหน้าที่เลือกออกมาเป็นไฟล์ใหม่
              </Can>
              <Can icon="↩️" name="ย้อนกลับ / ทำซ้ำ">
                วางผิดกดย้อนกลับได้ ทุกอย่างเป็นแค่ “แผนการแก้ไข” จนกว่าจะกดดาวน์โหลด
                ไฟล์ต้นฉบับไม่ได้ถูกแตะเลยระหว่างที่แก้
              </Can>
            </ul>
          </GuideSection>

          {/* ── 2. ทำยังไง ───────────────────────────────────────────────── */}
          <GuideSection
            icon="🛠️"
            title="ทำยังไง"
            tone="border-l-violet-500"
            intro="ลำดับการใช้งานปกติ ตั้งแต่เปิดไฟล์จนได้ไฟล์ใหม่"
          >
            <ol className="space-y-3 text-sm leading-relaxed">
              <Step n={1} title="อัปโหลดไฟล์ PDF">
                ลากไฟล์มาวางในกรอบ หรือกดที่กรอบเพื่อเลือกไฟล์ รับไฟล์ .pdf ขนาดไม่เกิน{" "}
                <Val>{MAX_PDF_MB} MB</Val> และไม่เกิน <Val>{MAX_PAGES} หน้า</Val>{" "}
                <strong>ถ้าไฟล์ตั้งรหัสผ่านไว้จะเปิดไม่ได้</strong> ต้องเอารหัสผ่านออกก่อน
                (เปิดด้วยโปรแกรมอ่าน PDF แล้วสั่งพิมพ์เป็น PDF ใหม่ หรือลบรหัสผ่านใน Acrobat)
              </Step>
              <Step n={2} title="เลือกเครื่องมือบนแถบด้านบน">
                กด <strong>“ทับขาว”</strong> แล้วลากคลุมบริเวณที่จะปิด · กด{" "}
                <strong>“ข้อความ”</strong> แล้วคลิกตรงที่จะพิมพ์ · กด <strong>“รูปภาพ”</strong>{" "}
                หรือ <strong>“ลายเซ็น”</strong> เพื่อวางรูปหรือลายเซ็น · กด{" "}
                <strong>“เลือก/ย้าย”</strong> เพื่อกลับมาลากย้ายหรือย่อขยายของที่วางไว้แล้ว
              </Step>
              <Step n={3} title="ตั้งค่าข้อความก่อนพิมพ์">
                เมื่อเลือกเครื่องมือ “ข้อความ” จะมีแถวตั้งค่าโผล่ขึ้นมา — ขนาด ตัวหนา สี การจัดวาง
                และความเอียง ตั้งไว้ก่อนแล้วค่อยคลิกวาง จะได้ไม่ต้องมาแก้ทีหลัง
              </Step>
              <Step n={4} title="จัดการหน้าในแผง “จัดการหน้า”">
                แต่ละหน้ามีปุ่มเลื่อนขึ้น/ลงเพื่อสลับลำดับ และปุ่มลบ ส่วนการหมุนอยู่บนแถบเครื่องมือ
                (หมุนหน้าที่กำลังเลือกอยู่) ติ๊กช่องหน้าที่ต้องการแล้วกด{" "}
                <strong>“แยกหน้าที่เลือก”</strong> เพื่อดาวน์โหลดเฉพาะหน้านั้นเป็นไฟล์ใหม่
                โดยไฟล์ที่กำลังแก้อยู่ไม่เปลี่ยน
              </Step>
              <Step n={5} title="กรอกฟอร์ม (ถ้ามี)">
                ถ้าไฟล์มีช่องกรอก แผง “ฟอร์มในเอกสาร” จะขึ้นมาเอง กรอกให้ครบแล้วเลือกว่าจะ
                <strong> ตรึงค่า</strong> ไหม — ตรึงแล้วผู้รับจะแก้ค่าไม่ได้อีก
              </Step>
              <Step n={6} title="กดดาวน์โหลด">
                ระบบจะสร้างไฟล์ PDF ใหม่จากไฟล์ต้นฉบับบวกกับทุกอย่างที่วางไว้{" "}
                <strong>ไฟล์เดิมของคุณไม่ถูกแก้</strong> ถ้ายังไม่กดดาวน์โหลดแล้วปิดหน้านี้
                งานที่ทำไว้จะหายทั้งหมด (ระบบจะเตือนก่อน)
              </Step>
            </ol>
          </GuideSection>

          {/* ── 3. ข้อจำกัด ─────────────────────────────────────────────── */}
          <GuideSection
            icon="🚫"
            title="ข้อจำกัด"
            tone="border-l-red-500"
            intro={
              <>
                อ่านหัวข้อนี้ให้จบก่อนส่งไฟล์ให้ลูกค้า — สองข้อล่างสุดที่เป็นกรอบสีแดง
                คือข้อที่คนเข้าใจผิดบ่อยที่สุด และเป็นข้อที่ทำให้ส่งข้อมูลหลุดไปได้จริง
              </>
            }
          >
            <ul className="space-y-2 text-sm leading-relaxed">
              <Limit>
                <strong>ข้อความไม่ไหลตาม</strong> — พิมพ์เพิ่มแล้วบรรทัดเดิมไม่ขยับหลบ
                เครื่องมือนี้ไม่ใช่ Word ข้อความที่พิมพ์ใหม่จะไปทับข้อความเดิมถ้าวางซ้อนกัน
                ต้องทับขาวตรงนั้นก่อนเสมอ
              </Limit>
              <Limit>
                <strong>ตารางไม่ขยาย</strong> — เพิ่มแถวในตารางเดิมไม่ได้
                เพราะในไฟล์ PDF มันไม่ใช่ตาราง แต่เป็นเส้นกับข้อความที่ถูกตรึงตำแหน่งไว้แล้ว
                ถ้าต้องเพิ่มแถวจริง ๆ ต้องกลับไปแก้ที่ไฟล์ต้นฉบับ (Word / Excel) แล้วทำ PDF ใหม่
              </Limit>
              <Limit>
                <strong>ข้อความที่พิมพ์ใหม่จะเป็นฟอนต์ Sarabun เสมอ</strong> ไม่ใช่ฟอนต์เดิมของเอกสาร
                ถ้าพิมพ์ทับกลางย่อหน้าเดิมจะเห็นว่าตัวอักษรหน้าตาไม่เหมือนกัน
                จึงเหมาะกับการแก้ตัวเลข ชื่อ หรือวันที่ มากกว่าแก้ทั้งย่อหน้า
              </Limit>
              <Limit>
                <strong>การทับขาวจะเห็นเป็นแถบขาว</strong> ถ้าพื้นหลังตรงนั้นไม่ใช่สีขาวเรียบ —
                เช่น ทับบนพื้นสีเทา บนลายน้ำ หรือบนเอกสารที่สแกนมาแล้วกระดาษออกสีครีม
                จะเห็นเป็นแผ่นขาวชัดเจน
              </Limit>
              <Limit severe>
                <strong>การทับขาว “ไม่ใช่การลบข้อมูล”</strong> — ข้อความเดิมยังอยู่ในไฟล์
                และดึงออกมาได้ ใครก็ตามที่เปิดไฟล์แล้วลากคลุมคัดลอก หรือใช้โปรแกรมดึงข้อความ
                จะเห็นข้อความที่ถูกทับไว้ทั้งหมด{" "}
                <strong>ห้ามใช้วิธีนี้ปิดข้อมูลลับ ราคา หรือข้อมูลส่วนบุคคล</strong>{" "}
                ถ้าต้องปิดข้อมูลจริง ๆ ให้แก้ที่ไฟล์ต้นฉบับแล้วสร้าง PDF ขึ้นมาใหม่
              </Limit>
              <Limit severe>
                <strong>เครื่องมือนี้ไม่ได้ใส่รหัสผ่าน และไม่ได้ห้ามพิมพ์/คัดลอก</strong> —
                ไฟล์ที่ดาวน์โหลดออกไปเป็น PDF ธรรมดาที่ใครก็เปิด พิมพ์ คัดลอก และแก้ต่อได้
                ถ้าต้องการล็อกไฟล์ ต้องไปทำด้วยโปรแกรมอื่น
              </Limit>
              <Limit>
                <strong>ไฟล์ที่ตั้งรหัสผ่านไว้ เปิดไม่ได้เลย</strong> — ระบบจะปฏิเสธตั้งแต่ตอนอัปโหลด
                และบอกให้เอารหัสผ่านออกก่อน ที่ทำแบบนี้เพราะถ้าฝืนเปิดจะได้ไฟล์ที่อ่านไม่ออก
                ดีกว่าปล่อยให้ได้ไฟล์เสียไปโดยไม่รู้ตัว
              </Limit>
              <Limit>
                <strong>ไฟล์ใหญ่จะช้า</strong> — ไฟล์ที่ใหญ่กว่า <Val>{WARN_PDF_MB} MB</Val>{" "}
                ยังเปิดได้ แต่การเลื่อนดู การวางของ และการสร้างไฟล์ตอนดาวน์โหลดจะใช้เวลานานขึ้นเรื่อย ๆ
                เพราะทุกอย่างทำงานอยู่ในหน่วยความจำของเบราว์เซอร์เครื่องคุณ ไม่ได้ไปทำบนเซิร์ฟเวอร์
              </Limit>
              <Limit>
                <strong>ไม่มีการบันทึกงานค้างไว้</strong> — ไม่ได้เก็บลงฐานข้อมูล ไม่ได้เก็บบนเซิร์ฟเวอร์
                ปิดแท็บหรือรีเฟรชแล้วเริ่มใหม่หมด ต้องกดดาวน์โหลดก่อนออกจากหน้านี้เสมอ
              </Limit>
            </ul>
          </GuideSection>

          <p className="text-xs text-gray-400 text-center pt-2 pb-1 wrap-break-word">
            ตัวเลขขีดจำกัดในคู่มือนี้อ่านจากค่าที่ระบบใช้จริง ถ้ามีการปรับในอนาคต คู่มือจะเปลี่ยนตามเอง
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
