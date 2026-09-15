# Tasks: add-excel-export-to-documents

## 0. กลไกกลาง — `app/lib/documentFormExcel.ts`
- [x] 0.1 ติดตั้ง `xlsx-js-style` (dependency ใหม่, client-side only) — ตัว
      `xlsx` เดิมตัดความสามารถใส่ style ออก จึงใส่เส้นขอบ/สีพื้น/merge cell
      ไม่ได้ ต้องใช้ fork ที่คง API เดิมแต่คืนความสามารถนี้กลับมา
- [x] 0.2 `buildDocumentFormSheet(opts)` — pure function (ไม่แตะ DOM/ไฟล์)
      คืน rows/merges/columnWidths จาก options กลาง (หัวเรื่อง, คู่กรณี 2
      ฝ่าย, meta rows, คอลัมน์+รายการ, totals เป็น optional, notes, ลายเซ็น)
- [x] 0.3 `downloadDocumentFormExcel(filename, sheetName, opts)` — dynamic
      import `xlsx-js-style`, เรียก `buildDocumentFormSheet` แล้วสั่งดาวน์โหลด
- [x] 0.4 เทสต์ `buildDocumentFormSheet` ตรงๆ (pure function) — หัวเรื่อง
      merge เต็มความกว้าง, คู่กรณีสองฝ่ายพิมพ์ครบ (ข้ามบรรทัด null), แถว
      รายการตรงจำนวน+มีสไตล์หัวตาราง, แถว placeholder เมื่อไม่มีรายการ, แถว
      totals ที่ `emphasize` เท่านั้นที่หนา+มีเส้นคั่น, `totals: undefined`
      ไม่พิมพ์บล็อกนี้เลย (กรณีเอกสารไม่มีเงิน), แถวลายเซ็นมีเส้น+label

## 1. ใบเสนอราคา — `app/quotation/page.tsx`
- [x] 1.1 ปุ่ม "📊 ดาวน์โหลด Excel" ข้างปุ่ม "⬇️ ดาวน์โหลด PDF" เดิม
- [x] 1.2 `handleDownloadExcel()` — dynamic import `downloadDocumentFormExcel`
      จาก `documentFormExcel.ts`, ชีทเดียว: หัวเรื่อง → ผู้เสนอราคา (เรา)/
      ลูกค้า → เลขที่/วันที่/ยืนราคา → ตารางรายการ (ผ่าน `computeQuoteTotals`
      เดิม) → สรุปยอด → เงื่อนไข/หมายเหตุ → ลายเซ็น 3 ช่อง
- [x] 1.3 เทสต์: เรียก handler แล้วตรวจ `DocumentFormOptions` ที่ส่งให้
      `downloadDocumentFormExcel` (mock module) — ยืนยันว่าไม่แตะ
      `generatePdf`/`handleSave`/endpoint บันทึกเดิมเลย

## 2. เอกสารบัญชี — `app/billing/page.tsx`
- [x] 2.1 ปุ่ม "📊 ดาวน์โหลด Excel" ข้างปุ่ม PDF เดิม
- [x] 2.2 `handleDownloadExcel()` — หัวเรื่อง/ชื่อชีทปรับตาม `b.docType` (ใช้
      `BILLING_LABELS` เดิมจาก `billingNumber.ts`) เพิ่มหมายเหตุช่องทางชำระ
      เงิน/วันที่ชำระ/เลขที่อ้างอิง **เฉพาะตอน `docType === "receipt"`**
      เท่านั้น (ตรงกับที่แผ่นพิมพ์แสดงแบบมีเงื่อนไขอยู่แล้ว) ลายเซ็นสลับตาม
      ประเภท (ใบเสร็จ: ผู้รับเงิน/ผู้จ่ายเงิน, อื่นๆ: ผู้ออกเอกสาร/ผู้อนุมัติ)
- [x] 2.3 เทสต์: ครอบคลุมทั้ง invoice และ receipt — ยืนยันว่า notes ของ
      invoice ไม่มีรายการช่องทางชำระเงิน แต่ของ receipt มี

## 3. ใบ Job บริการ — `app/service-job/page.tsx`
- [x] 3.1 ปุ่ม "📊 ดาวน์โหลด Excel" ข้างปุ่ม PDF เดิม
- [x] 3.2 `handleDownloadExcel()`/`generateExcel(docNo)` — ใช้กติกาเดียวกับ
      `handleDownload` ทุกจุด (บันทึกก่อนถ้ายังไม่ได้บันทึก/dirty, ปฏิเสธถ้า
      ยังไม่มีเลขที่จากเซิร์ฟเวอร์) ชีทเดียว: หัวเรื่อง → ผู้ให้บริการ (เรา)/
      ลูกค้า → เลขที่/วันที่/ช่างผู้ปฏิบัติงาน → ตารางเครื่อง (จาก
      `picked: PickedEquipment[]`, คอลัมน์ "งานที่ทำ" เว้นว่างตรงกับ PDF) →
      หมายเหตุอธิบายว่ารายละเอียดงานเขียนด้วยลายมือในต้นฉบับ → ลายเซ็น 1 ช่อง
      ("ลูกค้าผู้รับบริการ") **ไม่มีบล็อกสรุปยอด** (`totals: undefined`) —
      เอกสารนี้ไม่ใช่เอกสารการเงิน
- [x] 3.3 เทสต์: ยืนยันจำนวนแถวในตารางเครื่องตรงกับจำนวนเครื่องที่เลือกไว้จริง
      และยืนยัน guard "ยังไม่มีเลขที่ใบงาน" ทำงานเหมือนปุ่ม PDF (mutation-
      tested โดยลบ guard แล้วดูเทสต์ล้ม)

## 4. เอกสาร
- [x] 4.1 `specs/document-export/spec.md` ในการเปลี่ยนนี้ — ADDED
      Requirements ครบตาม proposal (ดีไซน์ชีทเดียวจำลอง PDF ไม่ใช่ 2 ชีท flat)
- [x] 4.2 `openspec validate add-excel-export-to-documents --strict` ผ่าน
- [x] 4.3 อัปเดต `openspec/changes/add-purchase-order/specs/purchase-order/spec.md`
      ให้ตรงกับดีไซน์ใหม่ด้วย (Excel ของ PO เปลี่ยนจาก 2 ชีท flat เป็นชีท
      เดียวแบบฟอร์มเช่นกัน)

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` สะอาด
- [x] 5.2 `npx vitest run` ผ่านทั้งชุด — โดยเฉพาะเทสต์เดิมของทั้ง 3 หน้า
      ต้องผ่านเหมือนเดิมทุกตัว ยืนยันว่างานนี้ไม่แตะพฤติกรรมเดิมเลย
