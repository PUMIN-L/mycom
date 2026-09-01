# Proposal: แก้บั๊ก timezone UTC vs ไทย (+7) ใน CRM

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31), มิติ crm-correctness + reliability-ux

## Why
Server รันที่ UTC (Vercel) แต่ทีมงานอยู่ที่ไทย (UTC+7) — จุดที่คำนวณ "วันนี้" หรือ
แปลงวันที่จาก DatePicker ด้วย `toISOString()` ตรงๆ จะเพี้ยนไป 1 วันในช่วง
เที่ยงคืน–7 โมงเช้าตามเวลาไทย ซึ่งเป็นช่วงเวลาทำงานปกติของทีม บั๊กนี้กระทบทั้ง
การคำนวณแจ้งเตือน (ผิดโดยไม่มีใครสังเกต) และการบันทึกวันที่ครั้งแรกในฟอร์ม
(ผิดวันไปเงียบๆ)

## What Changes

1. **DatePicker บันทึกวันที่แรกผิดไป 1 วัน** — ทุกจุดที่ใช้
   `date.toISOString().split('T')[0]` แปลง Date object จาก react-datepicker
   (`EquipmentDetailsModal.tsx:408`, `EquipmentEditModal.tsx:204,213`,
   `SalesRecordEditModal.tsx:434,444`, `app/dashboard/page.tsx:1149,1159`) —
   เมื่อฟิลด์เริ่มต้นว่างเปล่า react-datepicker จะคืนวันที่ที่เลือกเป็น
   "เที่ยงคืนตามเวลาท้องถิ่น" `toISOString()` แปลงเป็น UTC แล้วตัดเวลาทิ้ง
   จึงกลายเป็น**วันก่อนหน้า** สำหรับ UTC+7 (เช่น เลือก 5 ส.ค. ได้ค่า "2026-08-04")
   เกิดกับทุกฟิลด์วันที่ที่เริ่มจากค่าว่าง: วันนัด schedule ใหม่, วันเริ่ม/สิ้นสุด
   ประกัน, วันขาย

2. **`getAlerts` และ query ที่เกี่ยวข้องคำนวณ "วันนี้" เป็น UTC** —
   `app/lib/crmStore.ts:379-385` ใช้ `new Date().toISOString().slice(0,10)`
   เป็น "today" แล้วใช้เทียบ `scheduledDate < today` (overdue check) และ
   `warrantyEndDate` cutoff — ในช่วง 00:00-06:59 น. ตามเวลาไทย ระบบยังใช้วันที่
   ของเมื่อวาน (ตาม UTC) ผลคือ: นัดที่ครบกำหนดเมื่อวานยังไม่ถูกตีว่า overdue,
   ประกันที่หมดอายุเมื่อวานยังไม่ถูกแจ้งเตือน — เฉพาะช่วงเช้าตรู่ทุกวัน

## Impact
- Affected code: `app/lib/dateFormat.ts` (ใหม่ — จุดรวมศูนย์, `DatePicker.tsx`
  เองเป็นแค่ wrapper บาง ๆ ไม่ได้ทำ Date→string เอง จึงย้ายจุดรวมศูนย์มาไว้ที่
  helper แทน), `EquipmentDetailsModal.tsx`, `EquipmentEditModal.tsx`,
  `SalesRecordEditModal.tsx`, `app/dashboard/page.tsx`, `app/lib/crmStore.ts`
  (`getAlerts`)
- Affected specs: `crm-timezone-correctness` (ใหม่)
- แนวทาง: รวม logic แปลงวันที่ไว้ที่จุดเดียว (`app/lib/dateFormat.ts`) แทนที่จะ
  แก้ทีละจุดซ้ำๆ กัน เพื่อกันบั๊กแบบนี้เกิดซ้ำในอนาคต
- **พบเพิ่มระหว่างแก้ไข** (bug class เดียวกันทุกประการ, proposal เดิมไม่ได้
  ระบุไว้ครบ): จุดคำนวณ "วันนี้" ด้วย `toISOString()` แบบเดียวกันยังมีอยู่ใน
  `app/customers/EquipmentTab.tsx`, `app/crm/alerts/page.tsx` (ค่า default
  ของฟอร์มบันทึกผลงาน), และที่สำคัญ — นอกขอบเขต CRM — `app/quotation/page.tsx`
  กับ `app/billing/page.tsx` ที่ใช้ "วันนี้" คำนวณทั้ง `docDate` เริ่มต้นและ
  **เลขที่เอกสาร** (`QT<YYYYMMDD>-NN`) ของเอกสารใหม่ ทำให้เอกสารที่สร้างช่วง
  เที่ยงคืน-7โมงเช้าตามเวลาไทยได้วันที่/เลขที่ของ "เมื่อวาน" เงียบๆ — แก้ไปพร้อม
  กันด้วย helper เดียวกัน เพราะเป็นบั๊กและวิธีแก้แบบเดียวกันทุกประการ
