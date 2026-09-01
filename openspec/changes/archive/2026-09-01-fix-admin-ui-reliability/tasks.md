# Tasks: fix-admin-ui-reliability

## 1. แก้ error handling ของ fetch ที่ไม่สำเร็จ
- [x] 1.1 ใน `app/crm/alerts/page.tsx` `fetchAlerts`: เพิ่ม else branch สำหรับ
      `!res.ok` — `status === 401` → `router.replace("/login")`, อื่นๆ → toast
      error (`"โหลดข้อมูลแจ้งเตือนไม่สำเร็จ"`)
- [x] 1.2 ทำ pattern เดียวกันใน `app/customers/page.tsx` (`fetchData`) และ
      `app/customers/EquipmentTab.tsx` (`fetchEquipments`) — ทั้งสองไฟล์ fetch
      หลาย endpoint พร้อมกันด้วย `Promise.all` และเช็ค `.ok` แยกต่อตัวอยู่แล้ว
      (ถูกต้อง — endpoint ที่โหลดสำเร็จควรใช้ได้แม้ตัวอื่นล้มเหลว) จึงเพิ่มแค่
      toast รวมท้ายฟังก์ชันเมื่อมีตัวใดตัวหนึ่งไม่ ok แทนที่จะเงียบไปเฉยๆ
      (ไม่ได้เพิ่ม 401-redirect ที่นี่ เพราะทั้งสองหน้ามี redirect เมื่อ session
      หมดอายุอยู่แล้วผ่าน `useAuth()`/`isLoggedIn` ที่ชั้นบนสุดของหน้า)
- [ ] 1.3 เทส/manual: mock fetch ให้ตอบ 401/500 แล้วตรวจว่า error แสดงจริง —
      **ไม่มี pattern เทสสำหรับหน้า React ขนาดใหญ่ในโปรเจกต์นี้** (ตาม
      ARCHITECTURE.md: "large React UI pages/components are not
      unit-tested") จึงตรวจด้วย tsc + ต้อง manual verify บน staging จริง

## 2. แก้ regex เบอร์โทรพนักงานขาย
- [x] 2.1 แก้ `app/customers/page.tsx` จาก `/\\D/g` (backslash คู่ — match
      "D ที่มี backslash นำหน้า" ไม่ใช่ non-digit) เป็น `/\D/g`
- [x] 2.2 grep ทั้ง `app/` หา `\\D`/`\\d`/`\\w`/`\\s` (backslash คู่ผิดแบบเดียวกัน)
      ซ้ำที่อื่น — ยืนยันแล้วว่ามีจุดเดียวที่พบ ไม่มีจุดอื่นซ้ำ
- [ ] 2.3 manual: วางเบอร์โทรที่มีขีด/ช่องว่างในฟอร์มพนักงานขาย ยืนยันบันทึกได้
      — **ต้องทำบน staging จริงในเบราว์เซอร์**

## 3. Verify
- [x] 3.1 tsc + vitest เขียว (full suite: 575 passed | 2 skipped, 57 files)
