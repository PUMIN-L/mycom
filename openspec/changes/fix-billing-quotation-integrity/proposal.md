# Proposal: แก้บั๊กใบวางบิล/ใบเสนอราคา — ดาวน์โหลด PDF ไม่ได้ + ระบบกันลบรูปไม่ครบ

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31), มิติ money-docs + tests-honesty

## Why
พบบั๊กที่กระทบการใช้งานจริงทันที (ดาวน์โหลด PDF ใบวางบิลไม่ได้เลย) และช่องโหว่ที่
อาจทำให้**รูปภาพที่ยังใช้งานอยู่ถูกลบทิ้งถาวร** จาก Cloudinary — ซึ่งเป็น invariant
ที่โปรเจกต์นี้เคยให้ความสำคัญมาก่อน (มีการแก้เรื่องนี้ไปแล้วรอบหนึ่งสำหรับ
quotation แต่ billing_documents ที่เพิ่มมาทีหลังไม่ได้ครอบคลุมไปด้วย)

## What Changes

1. **ดาวน์โหลด PDF ใบวางบิลที่บันทึกแล้วไม่ได้เลย** — `app/billing/page.tsx:347-349`
   เช็ค `docNo` ซ้ำด้วย `existingDocs.some((d) => d.docNo === trimmedDocNo)` โดย
   ไม่ exclude ตัวเอง (`existingDocs` ถูก map เหลือแค่ `{docNo}` ทิ้ง `id` ไปแล้ว
   ที่บรรทัด 180) เมื่อเปิดเอกสารที่บันทึกแล้วในโหมดดู (`?id=X&view=1`) — docNo
   ของตัวมันเองจะไปชนกับตัวเองในลิสต์เสมอ → ปุ่ม "ดาวน์โหลด PDF" ถูก disable
   ตลอด (เทียบกับ quotation ที่ทำถูกแล้ว: `d.docNo === trimmedDocNo && d.id !==
   q.id`)

2. **ระบบกันลบรูปไม่ครอบ quotations/billing_documents** —
   `app/lib/imageUsageHelper.ts:16-56` (`isCloudinaryImageInUse`, gate เดียวที่
   ป้องกัน `DELETE /api/upload/delete`) เช็คแค่ products/documents/contents
   ไม่เช็ค `quotations.uploadedImages` หรือ `billing_documents.data` เลย —
   `deleteQuotation` เองก็คืนรูปทั้งหมดเป็น "orphaned" โดยไม่ cross-check
   (`quotationStore.ts:245-254`) ฟังก์ชัน `getReferencedImageUrls` ที่เคยเขียน
   ไว้เป็น backstop กลายเป็น dead code การ "แก้ไข (New Ver.)" ที่ clone
   ใบเสนอราคาไปสร้างใบใหม่ก็ยังใช้รูปเดิม (`imageUploaded:true`) — ลบใบต้นทาง
   จึงอาจทำลายรูปที่ใบสำเนา/ใบวางบิลที่ลิงก์กันยังอ้างอิงอยู่

3. **เทสของ imageUsageHelper mock ทับ logic ที่ควรทดสอบ** —
   `__tests__/api/upload.test.ts:11` mock ทั้งโมดูล `imageUsageHelper` ทำให้
   route โชว์ coverage 100% ทั้งที่ตัว guard จริงไม่เคยถูกรันในเทสเลย
   (0% coverage) เช่นเดียวกับ orphan scanner (`getAllUsedImageUrls`) และ
   `/api/cloudinary/orphans/**`

4. **ลบใบวางบิลแล้วเลขที่เอกสารวันนั้น "จุก" ถาวร** — `app/billing/page.tsx`
   โหลดรายการ docNo สำหรับเช็คซ้ำ/auto-suggest จาก `/api/billing` (ลิสต์เอกสาร
   ที่มีอยู่จริง) ไม่ใช่จาก ledger (`used_docnos`) เมื่อลบเอกสาร เลขที่นั้นหาย
   จากลิสต์ทันที ทำให้ UI คิดว่าเลขว่างและ auto-suggest เลขเดิมซ้ำ แต่ฝั่ง
   backend (`saveBillingDocumentAtomic`) ยัง lock/เช็ค ledger อยู่จริง (ledger
   ไม่เคยถูกลบเพราะ cron cleanup เลิก purge `used_docnos` ไปแล้วโดยตั้งใจ —
   "Legacy: docNos are no longer purged to preserve conversion rate
   analytics" — และห้ามลบข้อมูลใน database ตามนโยบายปัจจุบัน) → เกิด 409 ซ้ำๆ
   ในวันนั้นไปเรื่อยๆ เพราะ frontend กับ backend เห็นเลขที่ "ว่าง" ไม่ตรงกัน
   ทางแก้ไม่ใช่การ "ปล่อย reservation" (จะขัดกับทั้ง data-retention ที่ตั้งใจ
   ไว้แล้ว และนโยบายห้ามลบข้อมูล) แต่คือทำให้ frontend อ่านจาก ledger
   เหมือนกับ backend — เหมือนที่ quotation builder ทำอยู่แล้วผ่าน
   `/api/quotations/docnos`

## Impact
- Affected code: `app/billing/page.tsx`, `app/lib/imageUsageHelper.ts`,
  `app/lib/quotationStore.ts`, `app/api/billing/docnos/route.ts` (ใหม่),
  `__tests__/api/upload.test.ts` (+ เทสใหม่)
- Affected specs: `billing-document-integrity` (ใหม่)
- ผลกระทบจริง: ทีมงานดาวน์โหลด PDF ใบวางบิลที่เคยบันทึกไว้ไม่ได้เลยตอนนี้ —
  ควรเป็นลำดับแรกในกลุ่มนี้ที่ควรแก้
- **หมายเหตุนโยบาย**: ทุกการแก้ไขในกลุ่มนี้เป็นการ "unlink/อ่านให้ถูกแหล่ง"
  ไม่มีการลบข้อมูลใน database เลย ledger `used_docnos` ไม่ถูกแตะต้อง
