# Tasks: fix-test-coverage-honesty

## 1. ทำให้ coverage gate บังคับใช้จริง
- [x] 1.1 ตัดสินใจจุดบังคับใช้: เพิ่ม `--coverage` เข้า `.githooks/pre-push`
      (เลือกแทน GitHub Actions CI เพราะ repo นี้ใช้ git hook เป็นกลไก gate
      หลักอยู่แล้ว ไม่มี CI pipeline แยกต่างหาก — เพิ่มจุดบังคับใช้ที่มีอยู่แล้ว
      ให้ครบ แทนที่จะสร้างระบบใหม่)
- [x] 1.2 รัน `npx vitest run --coverage` วัด baseline จริง ณ วันที่แก้
      (2026-09-01, หลังเทสใหม่จาก Group 1/5/6): 63.64% stmts / 54.9% branch /
      68.01% funcs / 64.86% lines (เทียบกับตัวเลขเดิมที่ตั้งไว้ 95/90/97/96%
      ซึ่งไม่เคยสะท้อนความจริงเลย)
- [x] 1.3 ปรับ threshold ใน `vitest.config.ts` เป็น 60/50/63/61 (ต่ำกว่า
      baseline จริงเล็กน้อยเป็น buffer สำหรับ refactor เล็กๆ) พร้อมคอมเมนต์
      อธิบายว่าเลขนี้มาจากไหนและวันที่วัด — ห้ามลดตัวเลขนี้ลงอีกเพื่อให้ push
      ผ่านโดยไม่เพิ่มเทสจริง (ระบุไว้ในคอมเมนต์ชัดเจน)
- [x] 1.4 แก้ `ARCHITECTURE.md` (`## Testing` section) ให้ตรงกับพฤติกรรมจริง:
      อ้างอิงคอมเมนต์ใน `vitest.config.ts` แทนการ hardcode ตัวเลขซ้ำ (กัน
      เอกสารเพี้ยนจากโค้ดอีกในอนาคต), ระบุตรงๆ ว่าไฟล์ไหนยังอยู่ที่ 0%
      coverage และ pre-push gate รัน `--coverage` จริงแล้ว

## 2. เขียนเทสจริงให้ crmStore (ทำหลัง fix-crm-data-integrity เสร็จ)
- [x] 2.1 `__tests__/lib/crmStore.test.ts` มีอยู่แล้วจาก Group 1
      (fix-crm-data-integrity) — mock แค่ `@/app/lib/db` (`query`,
      `withTransaction`) ตาม pattern มาตรฐาน
- [x] 2.2 ทดสอบ `syncEquipmentsForSalesRecord`/`cleanupEquipmentsForSalesRecord`
      เวอร์ชันที่แก้แล้ว — ทำไปแล้วใน Group 1 (10 เทส: grow/shrink/reorder/
      no-op/blank-serial fallback)
- [x] 2.3 ทดสอบ `completeScheduleWithLog`: happy path (insert log ก่อน update
      status เสมอ + คืนแถวที่ persist จริง), 409 เมื่อไม่ใช่ pending, 409 เมื่อ
      schedule ไม่มีอยู่จริง, error จาก insert log ต้อง propagate โดยไม่ update
      status (4 เทสใหม่ในกลุ่มนี้ — mock `withTransaction` เรียก callback ตรงๆ
      จึงทดสอบ "ไม่ update status เมื่อ insert ล้มเหลว" ได้ทั้งที่ rollback จริง
      อยู่ที่ชั้น `db.ts` ซึ่งมีเทสของตัวเองแยกต่างหากอยู่แล้ว)
- [x] 2.4 ทดสอบ `getAlerts` — ทำไปแล้วใน Group 5 (fix-crm-timezone-bugs, 2 เทส
      ครอบ Bangkok-time "today" คำนวณถูกวัน + overdue flag ถูกต้อง)
- [ ] 2.5 แก้ `__tests__/api/admin-equipments.test.ts`,
      `admin-schedules.test.ts`, `admin-alerts.test.ts` ให้ยังคง mock
      `crmStore` — **ไม่ต้องแก้อะไร**: ทั้ง 3 ไฟล์นี้ mock `crmStore` มาตั้งแต่
      แรกอยู่แล้วและยังใช้งานได้ปกติ (เทสระดับ route มีประโยชน์ของมันเอง) สิ่ง
      ที่ขาดคือเทสระดับ store คู่กัน ซึ่งตอนนี้มีครบแล้วจาก 2.1-2.4

## 3. Verify
- [x] 3.1 `npx vitest run --coverage` ผ่าน threshold ใหม่ (ทั้ง 4 ตัวเลขผ่าน
      ไม่มี ERROR)
- [x] 3.2 tsc เขียว
