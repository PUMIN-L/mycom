# Tasks: fix-db-bootstrap-integrity

## 1. แก้ลำดับ FK
- [x] 1.1 ย้าย ALTER TABLE `fk_content_product` ไปไว้หลังบล็อกสร้างตาราง
      `products` (+ FK `fk_product_category` ของมันเอง) — วางคู่กับที่
      `product_suppliers` เพิ่ม FK ไปหา products อยู่แล้ว
- [x] 1.2 ย้ายบล็อกสร้างตาราง `product_specs` ไปไว้หลัง `products` ด้วยเหตุผล
      เดียวกัน
- [x] 1.3 bump `SCHEMA_VERSION` 26 → 27
- [x] 1.4 ทดสอบด้วย mocked "fresh DB" (`EMPTY` ทุก query) ใน
      `__tests__/lib/db.test.ts` — เทสใหม่ยืนยันลำดับ SQL จริงว่า
      `CREATE TABLE products` รันก่อน `fk_content_product` และก่อน
      `CREATE TABLE product_specs` เสมอ (กัน regression ในอนาคต)

## 2. แก้ migration ที่กลืน error
- [x] 2.1 แก้ catch block ทั้งสองจุด (salesRecordId, productName) ที่
      `db.ts` ให้ใช้ `isBenignSchemaError()` แบบเดียวกับ migration อื่นทั้งไฟล์
      แทน `console.warn`
- [x] 2.2 ไล่ตรวจทั้งไฟล์ `db.ts` แล้ว — ไม่มี catch block อื่นที่หลุด pattern
      (จุดเดียวที่เจอคือสองจุดนี้ ตามที่ review ระบุ)

## 3. Verify
- [x] 3.1 tsc + vitest เขียว (518 ผ่าน, 2 skip, 51 ไฟล์ — เพิ่มจากเดิม 3 เทส
      ใหม่: FK-ordering regression, real-error propagation,
      benign-error-still-swallowed)
- [ ] 3.2 ทดสอบ manual กับ DB ว่างจริง — ยังไม่ทำ (ตามข้อตกลง: ไม่แตะ/ทดสอบกับ
      TiDB จริงในเซสชันนี้ ต้องรอ deploy จริงหรือทดสอบแยกกับ DB ทดลองที่ไม่ใช่
      ของจริง)
