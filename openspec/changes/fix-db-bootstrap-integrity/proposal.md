# Proposal: แก้บั๊ก DB bootstrap ที่ทำให้ตั้งค่า DB ใหม่ล้มเหลว / migration ผิดพลาดเงียบๆ

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31), มิติ db-schema

## Why
`app/lib/db.ts` เป็นจุดเดียวที่สร้าง/migrate schema ทั้งหมด บั๊ก 2 จุดนี้ทำให้
(1) **DB ใหม่ตั้งค่าไม่ผ่านเลย** และ (2) **migration ที่พังจะถูกซ่อนไว้ถาวร**
เพราะ `schema_version` ถูก stamp ทับไปแล้ว ทั้งสองข้อขัดกับหลักการที่ไฟล์นี้
ประกาศไว้เองว่า "schema_version ต้องไม่ถูก stamp ทับ migration ที่ล้มเหลว"

## What Changes

1. **ลำดับ FK ผิด — DB ใหม่ bootstrap ไม่ผ่าน** — `db.ts:111` (ALTER TABLE
   contents เพิ่ม `fk_content_product`) และ `db.ts:118-127` (CREATE TABLE
   `product_specs` ที่มี inline `FOREIGN KEY ... REFERENCES products(id)`)
   รันอยู่**ก่อน** `CREATE TABLE products` ที่บรรทัด 258 บน TiDB/MySQL 8
   (FK-enforcing) จะได้ error `ER_FK_CANNOT_OPEN_PARENT` (errno 1824) ซึ่งไม่อยู่
   ใน whitelist ของ error ที่ยอมรับได้ — `initializeDb()` throw, bootstrap
   ล้มเหลวทั้งกระบวนการ ทุก request จะ fail ซ้ำๆ บน DB ที่ยังไม่เคยตั้งค่า

2. **Migration ของ `customer_equipments.salesRecordId`/`productName` กลืน error
   แล้วปล่อยผ่าน** — `db.ts:498-507` ใช้ `catch { console.warn(...) }` แทนที่จะ
   เช็คด้วย `isBenignSchemaError()` เหมือนทุก migration อื่นในไฟล์เดียวกัน
   ผล: ถ้า ALTER ล้มเหลวจากสาเหตุจริง (lock-wait timeout ตอน DDL พร้อมกันบน
   TiDB ที่ใช้ร่วมกัน, permission, DDL queue error) — error จะถูกกลืนไป แล้ว
   `schema_version` ยังถูกบันทึกว่าสำเร็จ (`db.ts:752`) → fast-path ในรอบถัดไป
   จะข้าม bootstrap ไปตลอดกาล คอลัมน์ที่ควรมีจะไม่มีอยู่จริง แต่ระบบคิดว่า schema
   อัปเดตแล้ว

## Impact
- Affected code: `app/lib/db.ts` เท่านั้น
- Affected specs: `db-bootstrap-integrity` (ใหม่)
- ความเสี่ยง: การย้ายบล็อกโค้ด (ข้อ 1) ต้องทดสอบกับ DB ว่างจริงๆ (ไม่ใช่แค่ DB ที่
  bootstrap ไปแล้ว) เพื่อยืนยันว่า fresh install ผ่านจริง — แนะนำทดสอบด้วย TiDB/
  MySQL ใหม่เอี่ยมก่อน merge
