# Tasks: add-crm-service-tracking

## 1. Database
- [x] 1.1 เพิ่มตาราง `customer_equipments`, `service_schedules`, `service_logs`
      ใน `app/lib/db.ts` (camelCase columns, FK + index ตาม convention)
- [x] 1.2 Bump `SCHEMA_VERSION` 18 → 19

## 2. Store (`app/lib/crmStore.ts`)
- [x] 2.1 Equipment CRUD (+ join ชื่อลูกค้า/บริษัท/สินค้า)
- [x] 2.2 Schedule CRUD (validate scheduleType/status enum)
- [x] 2.3 `completeScheduleWithLog` — insert log + mark completed ใน
      `withTransaction` (กันจบงานซ้ำ: เฉพาะ `pending`)
- [x] 2.4 `getAlerts(warrantyDays=30, scheduleDays=7)` — ประกันใกล้หมด +
      นัดใกล้ถึง/overdue

## 3. API (`/api/admin/**` — requireAuth ทุกเส้น)
- [x] 3.1 `GET/POST /api/admin/equipments` (+ `?customerId=` filter)
- [x] 3.2 `PUT/DELETE /api/admin/equipments/[id]`
- [x] 3.3 `GET/POST /api/admin/schedules` (+ `?equipmentId=` filter)
- [x] 3.4 `PUT/DELETE /api/admin/schedules/[id]`
- [x] 3.5 `GET/POST /api/admin/schedules/[id]/logs` (POST = จบงาน)
- [x] 3.6 `GET /api/admin/alerts`

## 4. Page gating
- [x] 4.1 เพิ่ม `/admin`, `/admin/:path*` ใน `middleware.ts` matcher

## 5. UI
- [x] 5.1 `/customers/[id]/equipment` — รายการอุปกรณ์, ฟอร์มเพิ่ม/แก้ไข,
      ปุ่มเพิ่มกำหนดการ, modal จบงาน (เลขที่ใบรายงาน + ผลงาน + feedback),
      ประวัติ log ต่ออุปกรณ์
- [x] 5.2 ลิงก์ "อุปกรณ์และประกัน" ใน modal รายละเอียดลูกค้า
      (`app/customers/page.tsx`)
- [x] 5.3 `/admin/alerts` — 2 หมวด (ประกันใกล้หมด / นัดใกล้ถึง+overdue)
      พร้อมลิงก์กระโดดไปหน้าอุปกรณ์ของลูกค้า

## 6. Tests + docs
- [x] 6.1 Unit tests: crmStore (CRUD, atomic complete, alerts windows)
- [x] 6.2 Route tests: 401 anon, validation 400, enum 400, complete 409, alerts
- [x] 6.3 อัปเดต `ARCHITECTURE.md` (ตารางใหม่ + routes ใหม่)
