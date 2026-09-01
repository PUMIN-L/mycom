# Tasks: fix-crm-timezone-bugs

## 1. รวม logic แปลงวันที่ไว้จุดเดียว
**เปลี่ยนแนวทางจากที่เสนอไว้เดิม**: `DatePicker.tsx` เป็นแค่ thin wrapper รอบ
`react-datepicker` ที่ forward `onChange` ตรงๆ ไปให้ caller (ไม่ได้ทำ Date→string
เอง) การแก้ที่ตัว component จึงไม่ครอบคลุม — สร้าง helper กลางที่
`app/lib/dateFormat.ts` (`toLocalDateString`) แล้วแทนที่ทุกจุดเรียกใช้แทน
- [x] 1.1 สร้าง `toLocalDateString(date: Date): string` ใน
      `app/lib/dateFormat.ts` ด้วย local getters
      (`getFullYear()`/`getMonth()`/`getDate()`) แทน `toISOString().split('T')[0]`
- [x] 1.2 แทนที่ทุกจุดเรียกใช้เดิมที่ระบุไว้: `EquipmentDetailsModal.tsx`,
      `EquipmentEditModal.tsx`, `SalesRecordEditModal.tsx`,
      `app/dashboard/page.tsx` — **พบเพิ่มระหว่างแก้ไข** (bug เดียวกันทุก
      ประการ แต่ proposal เดิมไม่ได้ระบุไว้ครบ): `app/dashboard/page.tsx`
      บรรทัด saleDate (นอกเหนือจาก warranty dates ที่ระบุไว้แล้ว),
      `SalesRecordEditModal.tsx` บรรทัด saleDate onChange +
      `emptyForm().saleDate` default, `app/customers/EquipmentTab.tsx`
      (export filename date + `isOverdue` client-side check),
      `app/crm/alerts/page.tsx` (`actionDate` default ×2),
      `EquipmentDetailsModal.tsx` (`actionDate` default ×2 +
      `isOverdue` client-side check) — แก้ทั้งหมดด้วย helper เดียวกัน
      นอกขอบเขต CRM ที่ proposal ระบุไว้ แต่เป็น bug class เดียวกันทุก
      ประการ และแก้ด้วย pattern เดียวกันพอดี: `app/quotation/page.tsx` และ
      `app/billing/page.tsx` — ค่า default ของ `docDate` และ prefix เลขที่
      เอกสาร (`QT<YYYYMMDD>-NN`) ของเอกสารใหม่ก็คำนวณ "วันนี้" ด้วย
      `toISOString()` เหมือนกัน (ผลคือเอกสารใหม่ที่สร้างช่วงเที่ยงคืน-7โมง
      เช้าตามเวลาไทยจะได้ docDate/เลขที่เอกสารของ "เมื่อวาน" เงียบๆ)
- [x] 1.3 เทส `__tests__/lib/dateFormat.test.ts`: เที่ยงคืนท้องถิ่นของวันที่
      ต่างๆ ต้องได้ string วันเดียวกันไม่ขยับ, padding เลขเดือน/วันหลักเดียว

## 2. แก้ getAlerts ให้อิงเวลาไทย
- [x] 2.1 ใน `app/lib/crmStore.ts` (`getAlerts`): เพิ่ม `bangkokDateString()`
      helper (ชดเชย offset +7 ชั่วโมงก่อนตัดเป็นวันที่ด้วย `toISOString().slice(0,10)`)
      ใช้แทน `new Date().toISOString().slice(0,10)` ตรงๆ สำหรับ
      `today`/`warrantyCutoff`/`scheduleCutoff`
- [x] 2.2 query DATEDIFF สำหรับ missing-documents ใช้ตัวแปร `today` เดียวกัน
      อยู่แล้ว (shared variable) จึงได้รับการแก้ไปพร้อมกันโดยอัตโนมัติ
- [x] 2.3 เทส `__tests__/lib/crmStore.test.ts` (`getAlerts` describe block):
      mock เวลาเป็น UTC 2026-08-04T19:00:00Z (= Bangkok 2026-08-05 02:00)
      ยืนยันว่า today/cutoff ทุกตัวคำนวณเป็นวันที่ 5 ไม่ใช่วันที่ 4 และ
      schedule ของวันที่ 4 ถูกตีเป็น overdue ถูกต้อง

## 3. Verify
- [x] 3.1 tsc + vitest เขียว (full suite: 568 passed | 2 skipped, 56 files)
- [ ] 3.2 manual: ตั้งเวลาเครื่องทดสอบเป็นช่วงเช้าตรู่ไทย ตรวจ alerts +
      DatePicker ในฟอร์ม CRM ทุกจุด — **ต้องทำบน staging จริง (ตามนโยบาย
      ห้ามรัน action ทดสอบกับข้อมูลจริงผ่าน automation)**
