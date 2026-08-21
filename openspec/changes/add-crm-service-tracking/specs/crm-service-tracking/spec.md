# Spec Delta: crm-service-tracking

## ADDED Requirements

### Requirement: Admin-only access (Authorization Constraint)
ทุกหน้าจอและทุก API ของฟีเจอร์นี้ SHALL เข้าถึงได้เฉพาะ admin ที่ login แล้ว
เท่านั้น ผู้ใช้ทั่วไป/guest ต้องเข้าถึงหรือมองเห็นข้อมูลไม่ได้

#### Scenario: Guest เรียก API
- **WHEN** ผู้ที่ไม่ได้ login เรียก endpoint ใดๆ ใต้ `/api/admin/**`
- **THEN** ได้ 401 Unauthorized และไม่มีข้อมูลใดรั่ว

#### Scenario: Guest เปิดหน้า
- **WHEN** ผู้ที่ไม่ได้ login เปิด `/admin/alerts` หรือ `/customers/[id]/equipment`
- **THEN** ถูก redirect ไป `/login`

### Requirement: บันทึกอุปกรณ์ที่ขายพร้อมข้อมูลประกัน
ระบบ SHALL บันทึกอุปกรณ์ที่ขายให้ลูกค้า (ตาราง `customer_equipments`) ด้วย:
customerId, productId, serialNumber, quotationNumber (เลขที่ใบเสนอราคา),
warrantyCertNumber (เลขที่ใบรับประกัน), warrantyType, warrantyStartDate,
warrantyEndDate, status (Active/Expired) — เอกสารทุกชนิดเก็บเป็น
"เลขที่เอกสารอ้างอิง" แบบ text เท่านั้น (**ไม่มีการอัปโหลดไฟล์**)

#### Scenario: เพิ่มอุปกรณ์ใหม่
- **WHEN** admin กรอกฟอร์มเพิ่มอุปกรณ์ (เลือกลูกค้า+สินค้า, กรอก serial,
  เลขที่ใบเสนอราคา, เลขที่ใบรับประกัน, ชนิด/วันเริ่ม-หมดประกัน) แล้วบันทึก
- **THEN** ระบบเก็บเรกคอร์ดใหม่และแสดงในรายการอุปกรณ์ของลูกค้ารายนั้น

#### Scenario: ข้อมูลบังคับไม่ครบ
- **WHEN** ไม่ระบุ customerId หรือ productId
- **THEN** API ตอบ 400 พร้อมข้อความบอกช่องที่ขาด และไม่บันทึก

### Requirement: กำหนดการ Service และโทรติดตาม
ระบบ SHALL สร้างกำหนดการ (ตาราง `service_schedules`) ผูกกับอุปกรณ์ โดยมี
scheduleType เป็น `service` หรือ `phone_call` เท่านั้น, scheduledDate,
assignedToAdminId (ผู้รับผิดชอบ), status เป็น `pending` / `completed` /
`cancelled` เท่านั้น และ notes

#### Scenario: เพิ่มกำหนดการจากอุปกรณ์
- **WHEN** admin กด "เพิ่มกำหนดการ" บนอุปกรณ์ แล้วเลือกชนิด (service/โทร)
  กับวันที่
- **THEN** ระบบสร้าง schedule สถานะ `pending` ผูกกับอุปกรณ์นั้น

#### Scenario: ชนิด/สถานะนอกเหนือที่กำหนด
- **WHEN** ส่ง scheduleType หรือ status ที่ไม่อยู่ในค่าที่อนุญาต
- **THEN** API ตอบ 400 และไม่บันทึก

### Requirement: จบงานพร้อมบันทึกผล (Service Log)
เมื่อจบงาน ระบบ SHALL รับ serviceReportNumber (เลขที่ใบรายงานซ่อม — text),
รายละเอียดผลงาน (resultDetails), และ customerFeedback แล้วบันทึกเป็น log
(ตาราง `service_logs`) **พร้อมกับ** อัปเดต schedule เป็น `completed`
แบบ atomic (ทั้งคู่สำเร็จหรือไม่เกิดอะไรเลย) เพื่อใช้เป็นข้อมูลตัดสินใจขาย
ครั้งถัดไป

#### Scenario: จบงาน Service
- **WHEN** admin กดจบงานบน schedule ที่ `pending` แล้วกรอกเลขที่ใบรายงาน,
  รายละเอียด, feedback
- **THEN** เกิด log ใหม่ และ schedule เปลี่ยนเป็น `completed` ในทรานแซกชัน
  เดียวกัน

#### Scenario: จบงานซ้ำ
- **WHEN** จบงาน schedule ที่ไม่ใช่สถานะ `pending`
- **THEN** API ตอบ 409 และไม่เกิด log ซ้ำ

### Requirement: หน้าแจ้งเตือน (Admin Alerts Page)
ระบบ SHALL มีหน้าแยกที่ `/admin/alerts` และ API `GET /api/admin/alerts` ที่คืน:
(1) อุปกรณ์ที่ประกันจะหมดภายใน 30 วัน (2) กำหนดการสถานะ `pending` ที่ถึง
กำหนดภายใน 7 วัน หรือเลยกำหนดแล้ว (overdue) พร้อมลิงก์กระโดดไปจัดการ
อุปกรณ์/ลูกค้ารายนั้นได้ทันที

#### Scenario: ประกันใกล้หมด
- **WHEN** อุปกรณ์มี warrantyEndDate อยู่ในช่วง [วันนี้, วันนี้+30 วัน]
- **THEN** ปรากฏในหมวด "ประกันใกล้หมดอายุ" พร้อมชื่อลูกค้า/สินค้า/วันหมด

#### Scenario: นัดเลยกำหนด
- **WHEN** schedule สถานะ `pending` มี scheduledDate ก่อนวันนี้
- **THEN** ปรากฏในหมวดกำหนดการ ติดป้าย overdue

## Non-goals
- ไม่มีการอัปโหลด/เก็บไฟล์เอกสารใดๆ (ใช้เลขที่อ้างอิงเท่านั้น)
- ไม่มี role หลายระดับ — ระบบมี admin ชุดเดียว (session ที่ login แล้ว = admin)
- ไม่มีการแจ้งเตือนอัตโนมัติภายนอก (อีเมล/LINE) ในเฟสนี้ — ดูจากหน้า alerts
