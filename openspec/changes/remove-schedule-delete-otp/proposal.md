# Proposal: ลบนัดหมายที่เสร็จแล้วโดยไม่ต้องใช้อีเมล/OTP

## Why

ตอนนี้ลบนัดหมาย (schedule) ที่สถานะ `completed` ต้องผ่าน 3 ขั้นตอน
(`app/components/modals/CustomerCallScheduleSection.tsx:476-560`,
`app/api/admin/schedules/[id]/delete-otp/route.ts`,
`app/api/admin/schedules/[id]/route.ts:115-157`):

1. กดปุ่ม "ส่งรหัส OTP" → ระบบส่งรหัส 6 หลักไปอีเมลผู้ดูแลระบบ (contact email)
2. เปิดอีเมล คัดลอกรหัส 6 หลัก
3. กลับมาวางรหัสในกล่อง confirm แล้วกดยืนยันลบ

ระบบนี้เป็น **single-admin** (มี login เดียว, session cookie ตัวเดียว ตาม
`openspec/project.md`) — คนที่กดลบกับคนที่เปิดอีเมลอ่านรหัสคือคนเดียวกันเสมอ
OTP จึงไม่ได้เพิ่มขอบเขตความปลอดภัยใดๆ เหนือกว่า session login ที่มีอยู่แล้ว
(ทั้ง endpoint ยังอยู่หลัง `requireAuth()` เหมือนเดิม) มีแต่เพิ่มขั้นตอนที่ต้อง
สลับไปเปิดอีเมลทุกครั้งที่จะลบนัดหมายเก่าที่จบงานไปแล้ว

ที่แย่กว่านั้นคือมันสร้างจุดพังจุดใหม่: `delete-otp/route.ts:37-42` เช็ก
`isMailConfigured()` — **ถ้า SMTP ยังไม่ได้ตั้งค่าไว้ (หรือใบรับรอง/รหัสผ่าน
หมดอายุ) แอดมินจะลบนัดหมายที่เสร็จแล้วไม่ได้เลยแม้แต่รายการเดียว** ทั้งที่
ไม่เกี่ยวอะไรกับการทำงานของอีเมลเลย

โจทย์จากภาพหน้าจอ: ต้องการให้ลบนัดหมายที่เสร็จแล้วได้แบบเดียวกับนัดหมาย
สถานะอื่น — กดลบ ขึ้นกล่องยืนยัน กดยืนยัน จบ ไม่ต้องส่งอีเมล ไม่ต้องกรอกรหัส

## What Changes

### Frontend — `app/components/modals/CustomerCallScheduleSection.tsx`
- กล่อง "ยืนยันการลบนัดหมายที่เสร็จแล้ว" (บรรทัด 476-560) เปลี่ยนจากฟอร์ม
  OTP ให้เหลือแค่ข้อความยืนยัน + ปุ่ม "ยกเลิก"/"ยืนยันลบ" — รูปแบบเดียวกับ
  กล่องยืนยันลบนัดหมายสถานะอื่นที่มีอยู่แล้ว (`deleteScheduleConfirm` /
  `executeDeleteSchedule`)
- ลบ state และฟังก์ชันที่มีไว้เพื่อ OTP อย่างเดียว: `deleteOtpCode`,
  `deleteOtpEmail`, `otpCountdown`, `isSendingOtp`, `handleSendDeleteOtp`
- `executeDeleteCompletedSchedule` เรียก `DELETE
  /api/admin/schedules/[id]` โดยไม่ส่ง `otp` ในตัว body อีกต่อไป (หรือรวม
  path นี้เข้ากับ `executeDeleteSchedule` เดิมไปเลย เพราะ logic เหมือนกัน
  100% หลังตัด OTP ออก)

### Backend — `app/api/admin/schedules/[id]/route.ts`
- ตัดทั้งบล็อก `if (schedule.status === "completed") { ... }` ในเมธอด
  `DELETE` (บรรทัด 115-157) ที่เช็ก otp/savedOtp/expiresAt/
  `recordOtpFailure`/`clearOtpAttempts` ออกทั้งหมด
- นัดหมายสถานะ `completed` ลบได้ทันทีเหมือนสถานะอื่น เงื่อนไขเดียวที่เหลือ
  คือ `requireAuth()` เดิม (ต้อง login ก่อนเสมอ — ไม่เปลี่ยน)

### ลบไฟล์ที่ไม่ใช้แล้วทั้งไฟล์
- `app/api/admin/schedules/[id]/delete-otp/route.ts` — ทั้งไฟล์ ไม่มีใครเรียก
  อีกต่อไป
- `sendScheduleDeleteOtpEmail` ใน `app/lib/mailer.ts:217` — ใช้เฉพาะจาก
  route ข้างบนที่ถูกลบ ไม่มีผู้เรียกอื่น
- คีย์ตั้งค่า `schedule_delete_otp_${id}` และ
  `schedule_delete_otp_expires_${id}` ใน settings store จะกลายเป็น dead
  key — ไม่ต้อง migration เพราะเป็น key-value ทั่วไป (ไม่ลบ record เก่าที่
  เหลือค้างก็ไม่มีผล เพราะไม่มีโค้ดอ่านคีย์นี้อีกแล้ว)

### ไม่แตะ
- **ไม่แตะ** OTP ของการลบอุปกรณ์ (`app/api/admin/equipments/[id]/delete-otp`,
  `app/components/modals/EquipmentDetailsModal.tsx`) — เป็นฟีเจอร์คนละตัว
  คนละหน้าจอ ภาพหน้าจอที่ให้มาคือกล่องลบ "นัดหมาย" เท่านั้น
- **ไม่แตะ** `app/lib/otpAttempts.ts` (`recordOtpFailure`/
  `clearOtpAttempts`/`resetOtpAttempts`) — โมดูลนี้ยังใช้ร่วมกับ OTP อื่นอีก
  หลายจุด (equipment delete, company-profile, contact-email, maintenance,
  cloudinary orphans)
- **ไม่แตะ** requirement OTP rate-limit ใน
  `openspec/specs/access-control/spec.md` ("การยืนยันด้วย OTP ต้องมีการ
  จำกัดจำนวนครั้งที่ผิด") — ยังจริงอยู่สำหรับทุก endpoint ที่ **ยังใช้** OTP
  เพียงแต่ endpoint นี้จะไม่อยู่ในกลุ่มที่ต้องทำตามอีกต่อไปเพราะไม่มี OTP
  ให้จำกัดแล้ว
- **ไม่แตะ** สิทธิ์การแก้ไข (`PUT`) นัดหมายที่เสร็จแล้ว — ยังคงแก้ไม่ได้
  เหมือนเดิม (`route.ts:45-47`) เปลี่ยนเฉพาะการ "ลบ" เท่านั้น

## จุดที่อันตราย และตั้งใจกันไว้อย่างไร

**1. ลบแล้วกู้คืนไม่ได้ — ของเดิมก็เป็นแบบนี้อยู่แล้ว ไม่ใช่ของใหม่ที่เพิ่งเพิ่ม**
`deleteSchedule` เป็น hard delete ไม่มี soft-delete/revision มาก่อน การตัด
OTP ออกไม่ได้ทำให้ความเสี่ยงข้อนี้แย่ลงกว่าที่นัดหมายสถานะอื่นเป็นอยู่แล้ว
วันนี้ (ลบนัดหมาย `pending`/`cancelled` ก็กู้คืนไม่ได้เหมือนกัน แค่ไม่มี OTP)
ถ้าต้องการกันเผลอลบนัดหมายที่จบงานแล้ว (ซึ่งมี service log ผูกอยู่) ให้ปลอดภัย
กว่าเดิมจริงๆ ควรเป็น task แยกเรื่อง soft-delete/undo ไม่ใช่เอา OTP กลับมา
(OTP ไม่ได้ป้องกันการเผลอกดผิด มันป้องกันคนอื่นที่ไม่มีอีเมลเท่านั้น ซึ่งใน
ระบบ single-admin คือคนคนเดียวกับที่ login อยู่แล้ว)

**2. service log ที่ผูกกับนัดหมายนี้จะเป็นอย่างไรหลังลบ**
`service_logs` ผูกกับ schedule ด้วย `scheduleId` — พฤติกรรมตอนลบ (CASCADE/
เก็บ log ไว้ลอยๆ) เป็นพฤติกรรมเดิมของ `deleteSchedule` ที่มีอยู่ก่อนหน้านี้
แล้ว ไม่ได้เปลี่ยนโดย proposal นี้ (ต้องตรวจโค้ด `deleteSchedule` ตอน implement
ว่าเป็นแบบไหน แต่ไม่ใช่สิ่งที่ proposal นี้แก้)

## ที่ไม่ทำ และเหตุผล

- **ไม่เพิ่มการยืนยันแบบอื่นทดแทน** (เช่น พิมพ์คำว่า "DELETE", ยืนยันซ้อน 2
  ครั้ง) — โจทย์บอกชัดว่าต้องการกล่องยืนยันธรรมดาเหมือนนัดหมายทั่วไป ไม่ใช่
  เกราะป้องกันชั้นใหม่
- **ไม่ลบ OTP ของฟีเจอร์อื่น** (อุปกรณ์, contact-email, company-profile,
  maintenance, cloudinary orphans) — คนละ scope คนละความเสี่ยง ผู้ใช้ไม่ได้
  ขอ
- **ไม่แก้ schema/SCHEMA_VERSION** — ไม่มีการเปลี่ยนโครงตาราง มีแต่ตัด logic
  และลบไฟล์ route/ฟังก์ชันที่ไม่ใช้
