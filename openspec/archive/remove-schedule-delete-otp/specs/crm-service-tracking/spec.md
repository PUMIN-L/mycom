# Spec Delta: crm-service-tracking

## ADDED Requirements

### Requirement: ลบนัดหมายที่เสร็จแล้วใช้การยืนยันในหน้าจอเท่านั้น (ไม่ใช้ OTP อีเมล)
ระบบ SHALL ให้แอดมินที่ login แล้วลบ schedule ที่สถานะ `completed` ได้ด้วย
การยืนยันในหน้าจอแบบเดียวกับ schedule สถานะ `pending`/`cancelled` — SHALL
ไม่เรียก ไม่ส่ง และไม่ตรวจรหัสยืนยัน (OTP) ทางอีเมลใดๆ ก่อนลบ เงื่อนไขเดียว
คือต้อง login (`requireAuth()`) เหมือน schedule สถานะอื่นทุกประการ

#### Scenario: แอดมินลบนัดหมายที่เสร็จแล้ว
- **WHEN** แอดมิน login แล้วกดลบ schedule สถานะ `completed` แล้วกดยืนยันใน
  กล่อง confirm
- **THEN** schedule ถูกลบทันที โดยไม่มีการเรียก endpoint ส่ง OTP และไม่มีการ
  ถามรหัสยืนยันจากอีเมล

#### Scenario: ผู้ที่ไม่ได้ login เรียก DELETE ตรงๆ
- **WHEN** ผู้ที่ไม่ได้ login เรียก `DELETE /api/admin/schedules/[id]` ของ
  schedule สถานะ `completed`
- **THEN** ได้ 401 Unauthorized เหมือน schedule สถานะอื่นทุกประการ — การตัด
  OTP ออกต้องไม่ลดการป้องกันระดับ authentication ที่มีอยู่เดิม
