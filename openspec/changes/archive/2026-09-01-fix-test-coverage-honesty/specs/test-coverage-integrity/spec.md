# Spec Delta: test-coverage-integrity

## ADDED Requirements

### Requirement: Coverage threshold ต้องถูกบังคับใช้จริงก่อน push/merge
Coverage threshold ที่ตั้งไว้ใน `vitest.config.ts` SHALL ถูกตรวจสอบจริงในจุดที่
บังคับใช้ได้ (pre-push hook หรือ CI) — ไม่ใช่แค่ตัวเลขที่ตั้งไว้เฉยๆ โดยไม่มีอะไร
รันมันเลย ตัวเลข threshold ที่ตั้งไว้ SHALL สะท้อนสถานะจริงของ coverage ปัจจุบัน
เอกสาร (`ARCHITECTURE.md`) SHALL ตรงกับพฤติกรรมจริง

#### Scenario: push โค้ดที่ทำให้ coverage ต่ำกว่า threshold
- **WHEN** แก้โค้ดแล้ว coverage ของไฟล์ที่แก้ไขต่ำกว่า threshold ที่ตั้งไว้
- **THEN** การ push (หรือ CI) ถูกบล็อกพร้อมข้อความบอกว่า threshold ไหนไม่ผ่าน

### Requirement: เทส route ต้อง exercise logic จริงของ store ที่มันเรียกใช้
เทสของ API route ที่ทำหน้าที่แค่ "ส่งต่อ" ไปยัง store function (thin route)
SHALL ไม่ mock ทั้งโมดูล store นั้นจนไม่มีการรัน logic จริงเลย — อย่างน้อยต้องมี
เทสระดับ store ที่รัน logic จริงคู่กันเสมอ (mock แค่ `@/app/lib/db`)

#### Scenario: เทส route ของ CRM schedules
- **WHEN** ทดสอบ `POST /api/admin/schedules/[id]/logs`
- **THEN** มีเทสแยกต่างหากที่เรียก `completeScheduleWithLog` จริง (mock แค่ db)
  เพื่อยืนยันว่า transaction/pending-check ทำงานถูกต้อง ไม่ใช่แค่เทสว่า route
  เรียก mock function
