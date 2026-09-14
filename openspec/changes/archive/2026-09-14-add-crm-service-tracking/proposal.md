# Proposal: CRM ติดตามการขาย ประกัน และ Service

## Why
หลังขายเครื่องมือให้ลูกค้าแล้ว ทีมขาย/บริการไม่มีระบบติดตามว่า เครื่องไหนประกัน
ใกล้หมด ต้องเข้า Service เมื่อไหร่ หรือถึงเวลาโทรติดตามเพื่อเสนอขายเพิ่ม
(up-sell/cross-sell) — ทุกอย่างอยู่ในความจำ/ไฟล์แยก ทำให้พลาดกำหนดการและ
เสียโอกาสขาย

## What Changes
- ตารางใหม่ 3 ตาราง: `customer_equipments` (เครื่องที่ขาย + ประกัน),
  `service_schedules` (นัด Service / โทรติดตาม), `service_logs`
  (บันทึกผลหลังจบงาน) — bump `SCHEMA_VERSION`
- Store ใหม่ `app/lib/crmStore.ts` (CRUD + จบงานแบบ atomic + คิวรี่แจ้งเตือน)
- Admin API ใหม่ใต้ `/api/admin/**`: equipments, schedules,
  schedules/[id]/logs, alerts — **ทุกเส้นต้อง login (requireAuth)**
- หน้า UI ใหม่ (ทุกหน้าโดน middleware gate):
  - `/customers/[id]/equipment` — รายการอุปกรณ์ของลูกค้า + เพิ่ม/แก้ไข +
    เพิ่มกำหนดการ + จบงานพร้อมบันทึกผล (ลิงก์จาก modal รายละเอียดลูกค้า)
  - `/admin/alerts` — แจ้งเตือนประกันใกล้หมด (≤30 วัน) และกำหนดการใกล้ถึง
    (≤7 วัน) หรือเลยกำหนด (overdue)
- เพิ่ม `/admin/:path*` ใน middleware matcher

## Constraints (จาก requirement)
- **Admin-only ทุกจุด** — ทั้งหน้าและ API; guest/user ทั่วไปต้องมองไม่เห็น
- **ไม่มีการอัปโหลดไฟล์** — ใบเสนอราคา/ใบรับประกัน/ใบรายงานซ่อม เก็บเป็น
  "เลขที่เอกสารอ้างอิง" (text) เท่านั้น
- เก็บประวัติ (log) หลังจบงาน Service/โทร เพื่อใช้ตัดสินใจขายครั้งถัดไป

## Impact
- Affected specs: `crm-service-tracking` (ใหม่)
- Affected code: `app/lib/db.ts` (schema v19), `app/lib/crmStore.ts` (ใหม่),
  `app/api/admin/**` (ใหม่), `middleware.ts`, `app/admin/alerts/page.tsx` (ใหม่),
  `app/customers/[id]/equipment/page.tsx` (ใหม่), `app/customers/page.tsx`
  (ลิงก์เข้าอุปกรณ์), `__tests__/**`
- ไม่กระทบหน้า public ใดๆ
