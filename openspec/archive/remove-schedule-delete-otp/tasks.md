# Tasks: remove-schedule-delete-otp

> ไม่มีการแก้ schema — `SCHEMA_VERSION` ใน `app/lib/db.ts` **ห้ามขยับ**

## 1. Backend — ตัด OTP ออกจากเส้นทางลบ
- [ ] 1.1 `app/api/admin/schedules/[id]/route.ts` — ตัดบล็อก
      `if (schedule.status === "completed") { ... }` ทั้งก้อนในเมธอด `DELETE`
      (การเช็ก/เปรียบเทียบ otp, `getSetting`/`setSetting` ของ
      `schedule_delete_otp_*`, `recordOtpFailure`, `clearOtpAttempts`) —
      เหลือแค่ `getSchedule` → `deleteSchedule` ตรงๆ ทุกสถานะ
- [ ] 1.2 ลบ import ที่ไม่ใช้แล้วในไฟล์เดียวกัน (`getSetting`, `setSetting`,
      `recordOtpFailure`, `clearOtpAttempts`) ถ้าไม่มีจุดอื่นในไฟล์เรียกใช้
- [ ] 1.3 ลบไฟล์ `app/api/admin/schedules/[id]/delete-otp/route.ts` ทั้งไฟล์
- [ ] 1.4 ลบฟังก์ชัน `sendScheduleDeleteOtpEmail` ออกจาก `app/lib/mailer.ts`
      (ตรวจก่อนว่าไม่มีที่อื่นเรียกใช้จริงๆ)
- [ ] 1.5 เทสต์ (`__tests__/api/admin/schedules/**` หรือ path ที่ตรงกับ
      convention ของโปรเจกต์):
      - ลบนัดหมายสถานะ `completed` โดยไม่ส่ง `otp` ใน body → สำเร็จ (200/ok)
      - ยิง DELETE โดยไม่ login (ไม่มี session cookie) กับนัดหมายที่เสร็จแล้ว
        → 401 เหมือนนัดหมายสถานะอื่นทุกประการ
      - ลบนัดหมายสถานะ `pending`/`cancelled` ยังทำงานเหมือนเดิม (regression)

## 2. Frontend — กล่องยืนยันแบบธรรมดา
- [ ] 2.1 `app/components/modals/CustomerCallScheduleSection.tsx` —
      เปลี่ยนเนื้อหากล่อง "ยืนยันการลบนัดหมายที่เสร็จแล้ว" (บรรทัด
      ~476-560) ให้เหลือแค่ข้อความยืนยัน + ปุ่ม "ยกเลิก" / "ยืนยันลบ" ตัด
      ส่วนกรอกรหัส OTP และปุ่ม "ส่งรหัส OTP" ออกทั้งหมด
- [ ] 2.2 ลบ state ที่ใช้เฉพาะ OTP: `deleteOtpCode`, `deleteOtpEmail`,
      `otpCountdown`, `isSendingOtp` และฟังก์ชัน `handleSendDeleteOtp`
- [ ] 2.3 `executeDeleteCompletedSchedule` เรียก `DELETE` โดยไม่ส่ง `otp`
      ในตัว body — พิจารณารวมเข้ากับ `executeDeleteSchedule` เดิมถ้า logic
      เหมือนกันหมดหลังตัด OTP (ลดโค้ดซ้ำ)
- [ ] 2.4 ตรวจว่าปุ่มลบของนัดหมายสถานะ `completed` ยังพาไปกล่องยืนยันที่ถูก
      เปลี่ยนใหม่ (ไม่ใช่กล่องเดิมของสถานะอื่นโดยไม่ตั้งใจ ถ้าเลือกไม่รวม
      ฟังก์ชัน)
- [ ] 2.5 เทสต์คอมโพเนนต์ (mock network): กดลบนัดหมายที่เสร็จแล้ว → กดยืนยัน
      → เรียก DELETE ครั้งเดียวโดยไม่มีการเรียก `delete-otp` endpoint เลย

## 3. เอกสารประกอบ
- [ ] 3.1 ตรวจ `ARCHITECTURE.md` ว่ามีพูดถึงขั้นตอน OTP สำหรับลบนัดหมายไหม
      ถ้ามีให้แก้ให้ตรงกับพฤติกรรมใหม่
- [ ] 3.2 `openspec validate remove-schedule-delete-otp --strict` ผ่าน

## 4. ตรวจสอบขั้นสุดท้าย
- [ ] 4.1 `npx tsc --noEmit` สะอาด (ไม่มี import ที่เหลือค้างจากไฟล์ที่ลบ)
- [ ] 4.2 `npx vitest run` ผ่านทั้งชุด
- [ ] 4.3 ยืนยันด้วยมือ: ลบนัดหมายที่เสร็จแล้วในหน้าโปรไฟล์ลูกค้า → เห็นกล่อง
      ยืนยันธรรมดา ไม่มีให้กรอกรหัส ไม่มีการยิง request ไปอีเมลใดๆ
- [ ] 4.4 ยืนยันว่าการลบอุปกรณ์ (equipment) ยังต้องใช้ OTP เหมือนเดิม
      ไม่ได้ถูกกระทบ
