# Tasks: fix-billing-quotation-integrity

## 1. แก้ดาวน์โหลด PDF ใบวางบิล (ทำก่อน — กระทบการใช้งานจริง)
- [x] 1.1 ใน `app/billing/page.tsx` เก็บ `id` ไว้ใน `existingDocs`
      (เปลี่ยน type เป็น `{ id: string; docNo: string }[]`)
- [x] 1.2 แก้เงื่อนไข docNoDup เป็น
      `existingDocs.some((d) => d.docNo === trimmedDocNo && d.id !== b.id)`
      แบบเดียวกับ quotation builder
- [x] 1.3 เทส: `__tests__/api/billing-docnos.test.ts` ครอบคลุม endpoint ใหม่ที่
      ใช้ป้อน `existingDocs`; พฤติกรรม UI (ปุ่มดาวน์โหลดไม่ถูก disable) ยืนยัน
      ผ่าน tsc + logic เดียวกับ quotation builder ที่มีเทสอยู่แล้ว

## 2. ขยายระบบกันลบรูปให้ครอบ quotations + billing_documents
- [x] 2.1 เพิ่มเช็คใน `isCloudinaryImageInUse` (`imageUsageHelper.ts`):
      `SELECT id FROM quotations WHERE JSON_SEARCH(uploadedImages, 'one', ?) IS
      NOT NULL` (exclude quotation ปัจจุบันเมื่อลบจากภายใน ผ่าน `ExcludeSource`)
- [x] 2.2 เพิ่มเช็คเดียวกันสำหรับ `billing_documents.data` ด้วย JSON_SEARCH
- [x] 2.3 ลบ `getReferencedImageUrls` (ยืนยันแล้วว่าเป็น dead code 100% —
      ไม่มีจุดเรียกใช้ที่ไหนเลย) ตัดสินใจใช้ `imageUsageHelper` เป็นกลไกป้องกัน
      เดียวแทน — `deleteQuoteImagesSafely` ยังคงเป็น no-op ตามเดิม (ให้ orphan
      scanner จัดการแบบ manual แทนการลบอัตโนมัติ ซึ่งสอดคล้องกับนโยบายห้ามลบ
      ข้อมูลอัตโนมัติ)
- [x] 2.4 ทำเช่นเดียวกันใน `getAllUsedImageUrls` (orphan scanner) — เพิ่ม
      section 5 (billing document line-item images) พร้อม helper
      `collectCloudinaryUrls` ที่ walk ทุก string/array/object ใน `data` blob

## 3. เพิ่มเทสจริงสำหรับ imageUsageHelper (ไม่ mock ตัวมันเอง)
- [x] 3.1 เขียน `__tests__/lib/imageUsageHelper.test.ts` (16 เทส) — mock แค่
      `@/app/lib/db`, ทดสอบ `isCloudinaryImageInUse`/`safeDeleteCloudinaryImage(s)`/
      `getAllUsedImageUrls` ทุกแหล่ง (products, documents, contents,
      quotations, billing_documents) ทั้งเคสพบ/ไม่พบ/exclude-by-id/malformed JSON
- [ ] 3.2 แก้ `__tests__/api/upload.test.ts` ให้ไม่ mock ทั้งโมดูล
      `imageUsageHelper` อีกต่อไป — **เลื่อนไป Group 6 (fix-test-coverage-honesty)**
      เพราะเป็นเรื่อง test-honesty โดยตรง ไม่ใช่ตัว bug fix ของกลุ่มนี้ และ
      `imageUsageHelper.test.ts` ใหม่ (3.1) ได้ปิดช่องว่าง coverage 0% ที่เป็น
      ปัญหาจริงไปแล้ว

## 4. แก้ auto-numbering ค้างหลังลบใบวางบิล
**เปลี่ยนแนวทางจากที่เสนอไว้เดิม** ("ปล่อย reservation ใน `used_docnos` ตอนลบ")
เพราะขัดกับ (a) นโยบาย "ห้ามลบข้อมูลใน database" ที่ประกาศระหว่างพัฒนา และ
(b) การตัดสินใจ (ของอีกฝ่ายหนึ่ง) ที่เพิ่งเปลี่ยน cron cleanup ให้เลิก purge
`used_docnos` โดยตั้งใจเพื่อเก็บไว้วิเคราะห์ conversion rate แนวทางจริงที่ใช้คือ
ทำให้ frontend อ่านจาก ledger เดียวกับที่ backend ล็อกไว้ตอนบันทึก (เหมือน
quotation builder ทำอยู่แล้ว) แทนที่จะพยายามทำให้เลข "ว่างคืน":
- [x] 4.1 สร้าง `app/api/billing/docnos/route.ts` — GET endpoint (ต้อง login)
      คืนค่า `listRecentDocNos()` จาก `quotationStore.ts` (ledger กลางเดียวกับ
      quotation ใช้ — ไม่มีการสร้าง ledger ใหม่)
- [x] 4.2 แก้ `app/billing/page.tsx` ให้โหลด `existingDocs` จาก
      `/api/billing/docnos` แทน `/api/billing` (ลิสต์เอกสารจริง) แล้ว map
      `{quotationId, docNo}` → `{id: x.quotationId, docNo: x.docNo}` เหมือนกับ
      quotation builder ทุกประการ
- [x] 4.3 เทส: `__tests__/api/billing-docnos.test.ts` — ยืนยันว่า endpoint คืน
      เลขที่แม้เอกสารเจ้าของเลขนั้นถูกลบไปแล้ว (401 สำหรับ anonymous, 200 พร้อม
      ledger รวมเลขที่ของเอกสารที่ถูกลบสำหรับ admin)

## 5. Verify
- [x] 5.1 tsc + vitest เขียว (full suite: 536 passed | 2 skipped, 53 files)
- [x] 5.2 coverage ของ `imageUsageHelper.ts` ต้องไม่ใช่ 0% อีกต่อไป (16 เทสใหม่
      ใช้ logic จริง ไม่ mock ตัวมันเอง)
- [ ] 5.3 manual: ลบใบเสนอราคาที่มีสำเนา/ลิงก์ใบวางบิล ตรวจว่ารูปไม่หาย —
      **ต้องทำ manual บน production/staging จริง ไม่รันผ่าน automation ตาม
      นโยบายห้ามรัน query ทำลายข้อมูลจริง**
