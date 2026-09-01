# Tasks: fix-crm-data-integrity

## 1. syncEquipmentsForSalesRecord — จับคู่ด้วย serial, ห้ามลบอัตโนมัติ
- [x] 1.1 เขียนใหม่ใน `app/lib/crmStore.ts`: จับคู่ด้วย serial identity ก่อน
      (normalize trim/lowercase), fallback เป็นจับคู่ตามตำแหน่งเฉพาะ serial ว่าง
- [x] 1.2 ห่อการ sync ทั้งหมดด้วย `withTransaction`
- [x] 1.3 **เปลี่ยนแผน** (ตามคำสั่งผู้ใช้ "ห้ามลบข้อมูลใน database"): แถวอุปกรณ์
      ส่วนเกิน (qty ลดลง) ไม่ลบและไม่ต้อง confirm-then-force อีกต่อไป — **ปลด
      ออกจากใบขาย** (`salesRecordId = ''`) เสมอ ข้อมูล+ประวัติอยู่ครบใน DB
- [x] 1.4 (ไม่จำเป็นแล้ว — ไม่มี error ให้ route/UI ต้องจัดการเพิ่ม เพราะไม่มีการ
      บล็อก/ลบอีกต่อไป)
- [x] 1.5 หน่วยทดสอบ (`__tests__/lib/crmStore.test.ts`): no-op, reorder (การ
      ยืนยันบั๊กหลัก), grow, shrink (unlink ไม่ลบ), reorder+shrink พร้อมกัน,
      blank-serial positional fallback, empty salesRecordId, cap 50 — ครบ 8 เคส
      ผ่านหมด

## 1b. cleanupEquipmentsForSalesRecord — unlink แทน delete
- [x] 1b.1 เปลี่ยนจาก `DELETE FROM customer_equipments WHERE salesRecordId = ?`
      เป็น `UPDATE ... SET salesRecordId = ''` (เรียกตอนเปลี่ยนใบขายเป็น
      "บริการ" หรือลบใบขาย)
- [x] 1b.2 เทส: ยืนยัน SQL ไม่มีคำว่า DELETE, เป็น UPDATE unlink แทน

## 2. Schedule ต้องผ่าน completeScheduleWithLog เท่านั้นถึงจะ completed
- [x] 2.1 ใน `app/api/admin/schedules/[id]/route.ts` PUT handler: ถ้า
      `data.status === "completed"` → ตอบ 400 "ต้องบันทึกผลงานผ่านหน้าจบงาน
      เท่านั้น (แนบ service log)"
- [x] 2.2 เอาตัวเลือก "เสร็จแล้ว" ออกจาก radio ในฟอร์มแก้ไขทั่วไป
      (`EquipmentDetailsModal.tsx`) เหลือแค่ pending/cancelled — completed ทำผ่าน
      modal "จบงาน" (handleComplete) ที่แยกต่างหากเท่านั้น
- [ ] 2.3 เทสระดับ route สำหรับ 400 นี้ (ยังไม่ได้เขียน — เก็บไว้ทำพร้อม
      fix-test-coverage-honesty เนื่องจากไฟล์นี้ยังไม่มีเทสเดิมอยู่เลย)

## 3. ลบลูกค้าต้องเช็ค equipment/sales ผูกอยู่ก่อน
- [x] 3.1 ใน `app/api/customers/[id]/route.ts` DELETE: เพิ่ม pre-check
      `customer_equipments` และ `sales_records` — เจอแถวใดแถวหนึ่ง → 400
- [ ] 3.2 เทส (ยังไม่ได้เขียน — ไฟล์นี้ไม่มีเทสเดิม เก็บไว้ทำพร้อม
      fix-test-coverage-honesty)

## 4. วันประกันในใบขายต้องไม่หายตอน partial update
- [x] 4.1 `LIST_SELECT` ใน `salesDashboardStore.ts`: เพิ่ม `DATE_FORMAT` ให้
      `warrantyStartDate`/`warrantyEndDate` เหมือน `saleDate`
- [x] 4.2 `cleanDate()` รองรับ `Date` object โดยตรง (defense-in-depth)
- [ ] 4.3 เทส (ยังไม่ได้เขียน — ไฟล์นี้ไม่มีเทสเดิม เก็บไว้ทำพร้อม
      fix-test-coverage-honesty)

## 5. Sentinel "_custom" ต้องไม่ถูกบันทึก
- [x] 5.1 `EquipmentEditModal.tsx` handleSave: แปลง `productId === "_custom"`
      เป็น `""` ก่อนส่ง
- [x] 5.2 defense-in-depth ใน `crmStore.cleanEquipment`: แปลง `"_custom"` เป็น
      `""` เช่นกัน
- [ ] 5.3 เทส (รวมอยู่ใน fix-test-coverage-honesty เมื่อเขียนเทส cleanEquipment)

## 6. คืน dialog ยืนยันลบอุปกรณ์ + เก็บกวาด dead code
- [x] 6.1 เพิ่ม dialog ยืนยันใน `app/customers/EquipmentTab.tsx` (แพทเทิร์น
      เดียวกับ company/customer/salesperson delete ใน `app/customers/page.tsx`)
- [x] 6.2 ยืนยันแล้วว่า `executeDeleteSchedule`, `handleSendDeleteOtp`,
      `executeDeleteCompletedSchedule`, `handleComplete`, `fetchSchedules`,
      `fetchLogs`, `handleSaveSchedule` และ state ที่เกี่ยวข้องทั้งหมด **ตายสนิท**
      (ตรวจด้วย grep ทุกตัวว่าไม่มี JSX เรียกใช้ — `EquipmentDetailsModal.tsx`
      ทำหน้าที่นี้แทนทั้งหมดแล้ว) → ลบออกทั้งหมด รวม import ที่ไม่ใช้แล้ว
      (`ServiceLog`)
- [x] 6.3 manual verify ผ่าน tsc (ไม่มี unused-var/reference error)

## 7. Verify
- [x] 7.1 tsc + vitest เขียว (515 ผ่าน, 2 skip, 51 ไฟล์)
- [ ] 7.2 manual smoke test บน staging/local: แก้ไขใบขายที่มี 2+ serial แล้ว
      สลับลำดับ/ลดจำนวน ตรวจว่าประวัติไม่ย้ายเครื่อง (รอทำตอน deploy จริง —
      ไม่ทดสอบกับ production DB โดยตรงตามที่ตกลงกันไว้)
