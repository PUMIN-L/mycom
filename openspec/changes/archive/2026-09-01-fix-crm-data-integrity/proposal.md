# Proposal: แก้บั๊กทำลาย/สูญเสียข้อมูล CRM (equipment/schedule/customer)

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31) — กลุ่ม HIGH severity ที่อันตรายสุด
> เพราะเกิดจาก**การใช้งานปกติ** ไม่ใช่ edge case แปลกๆ

## Why
พบ 3 จุดที่ทำให้ **ประวัติซ่อม/ประกัน (service history) หายหรือย้ายไปอยู่กับเครื่องผิดตัวแบบเงียบๆ**
โดยไม่มีการแจ้งเตือนใดๆ ทั้งที่ระบบตั้งใจป้องกันเรื่องนี้ไว้แล้วในบางจุด (เช่น ต้องใช้ OTP
ก่อนลบ schedule ที่เสร็จแล้ว) แต่มีทางลัดที่ข้ามการป้องกันนั้นไปได้

## What Changes

1. **`syncEquipmentsForSalesRecord` จับคู่อุปกรณ์ผิดตัว และเคยลบข้อมูลอัตโนมัติ** —
   `app/lib/crmStore.ts:122-160` (เดิม) จับคู่ `serialNumbers[i]` กับแถวอุปกรณ์เดิม
   ลำดับที่ i (เรียงตาม `createdAt ASC`) แทนที่จะจับคู่ด้วย serial number จริง
   เมื่อแอดมินแก้ไขจำนวน/ลำดับ serial ในใบขาย ระบบจะ:
   - เขียนทับ serial ของแถวเดิมด้วยค่าใหม่ผิดตัว (เครื่อง A ได้ประวัติของเครื่อง B)
   - ลบแถวส่วนเกินทิ้งแบบถาวร (`deleteEquipment`) ซึ่ง cascade ลบ `service_schedules`
     และ `service_logs` ที่ผูกอยู่ไปด้วย (FK `ON DELETE CASCADE`, `db.ts:539,560`)
   - ทำนอก transaction — ถ้าล้มกลางทางจะเหลือข้อมูลไม่สมบูรณ์
   - **ข้าม OTP gate** ที่ปกป้องการลบ schedule ที่ completed แล้วโดยสิ้นเชิง
   >
   > **แก้แล้ว (เข้มกว่าที่เสนอไว้เดิม ตามคำสั่งผู้ใช้ "ห้ามลบข้อมูลใน database"):**
   > จับคู่ด้วย serial identity ก่อน (แก้บั๊กหลัก) ตกไปใช้ตำแหน่งเป็น fallback
   > เฉพาะ serial ว่าง และ**เลิกลบแถวอุปกรณ์โดยอัตโนมัติเด็ดขาด** — จำนวนลดลง
   > จะ "ปลดออกจากใบขาย" (`salesRecordId = ''`) แทน ข้อมูล+ประวัติทั้งหมดอยู่ครบ
   > ใน DB ตลอด ทำใน `withTransaction` เดียว `cleanupEquipmentsForSalesRecord`
   > (เรียกตอนเปลี่ยนประเภทใบขาย/ลบใบขาย) เปลี่ยนจาก `DELETE` เป็น unlink
   > เช่นกัน

2. **แก้ schedule เป็น "completed" ตรงๆ ผ่าน PUT ได้ โดยไม่ต้องมี service log** —
   `app/api/admin/schedules/[id]/route.ts:56-66` รับค่า `status` ทุกค่าใน enum รวมถึง
   `completed` แต่ระบบมี `completeScheduleWithLog` (transaction ที่บังคับให้ log กับ
   completed ต้องมาคู่กันเสมอ) อยู่แล้ว — ฟอร์มแก้ไข (`EquipmentDetailsModal.tsx:426-446`)
   มีปุ่มเลือกสถานะที่เปิดช่องนี้ไว้ และที่แย่กว่านั้นคือ **กู้คืนไม่ได้**: schedule ที่
   completed แล้วแก้ไขไม่ได้อีก (route ปฏิเสธ) และจะจบงานผ่านทางที่ถูกต้องซ้ำก็ไม่ได้
   (409 เพราะ status ไม่ใช่ pending แล้ว) ทางออกเดียวคือลบทิ้งทั้ง schedule

3. **ลบลูกค้าได้โดยไม่เช็คว่ามีอุปกรณ์/ใบขายผูกอยู่** —
   `app/api/customers/[id]/route.ts:48-57` ลบตรงๆ ไม่มี guard ทั้งที่ FK
   `fk_ce_customer` ถูกถอดออกไปแล้วโดยตั้งใจ (`db.ts:510-517`, เพื่อให้สร้างอุปกรณ์แบบ
   ไม่ผูกลูกค้าได้) ผลคือ `customer_equipments`/`sales_records` เหลือ `customerId`
   ที่ชี้ไปหาลูกค้าที่ไม่มีอยู่แล้ว (ต่างจาก `companies` route ที่เช็คก่อนลบ)

4. **`updateSalesRecord` ลบวันที่ประกันทิ้งทุกครั้งที่ PUT ไม่ส่งมาด้วย** —
   `app/lib/salesDashboardStore.ts:74-78,121-127,201-203` — คอลัมน์ `warrantyStartDate`/
   `warrantyEndDate` เป็น DATE type, DB คืนมาเป็น JS `Date` object (ไม่ใช่ string)
   เพราะ SELECT ไม่ได้ `DATE_FORMAT` ไว้ (ต่างจาก `saleDate` ที่ทำถูก) —
   `cleanDate()` เจอ Date object แปลงไม่ผ่าน regex เลยกลายเป็น `undefined` → NULL
   ทุกครั้งที่แก้ไขข้อมูลอื่นในใบขาย วันประกันจะหายไปโดยไม่มีใครตั้งใจ
   และการ sync equipment (ข้อ 1) ก็ลาก NULL นี้ไปด้วย

5. **Sentinel `"_custom"` ถูกส่งเข้า DB ตรงๆ** —
   `EquipmentEditModal.tsx:75-81,105` ใช้ `"_custom"` แทนค่าว่างในดรอปดาวน์เลือกสินค้า
   แต่ตอน submit ไม่มีการแปลงกลับเป็น `""` — ค่า `"_custom"` ถูกเขียนลง
   `customer_equipments.productId` จริง ทำให้ query ที่ join กับ `products` พังเงียบๆ

6. **ปุ่มลบอุปกรณ์กดแล้วไม่มีอะไรเกิดขึ้น (silent no-op)** —
   `app/customers/EquipmentTab.tsx:745` (handler ที่ `392-408`) เรียก
   `setDeleteConfirm(eq)` แต่ JSX ไม่มี modal ยืนยันการลบเหลืออยู่เลย — หายไปตอน
   refactor แยก modal ออกจากกัน (commit `fc93e2d`) แอดมินกดปุ่มลบแล้วคิดว่าไม่ทำงาน
   ทั้งที่จริงๆ ไม่มีทางกดยืนยันได้เลย

## Impact
- Affected code: `app/lib/crmStore.ts`, `app/lib/salesDashboardStore.ts`,
  `app/api/admin/schedules/[id]/route.ts`, `app/api/customers/[id]/route.ts`,
  `app/components/modals/EquipmentEditModal.tsx`, `app/customers/EquipmentTab.tsx`
- Affected specs: `crm-service-tracking` (แก้ requirement เดิมให้เข้มขึ้น),
  `crm-data-integrity` (ใหม่)
- ต้องระวัง: การแก้ #1 (sync ด้วย serial แทนตำแหน่ง) เปลี่ยน behavior ที่มีอยู่ —
  ต้องเทส grow/shrink/no-op ให้ครบก่อน deploy เพราะกระทบข้อมูลจริงในโปรดักชัน
