# db-bootstrap-integrity Specification

## Purpose
TBD - created by archiving change fix-db-bootstrap-integrity. Update Purpose after archive.

## Requirements

### Requirement: ลำดับการสร้างตารางต้องไม่ละเมิด foreign key dependency
Bootstrap script ใน `app/lib/db.ts` SHALL สร้างตารางที่ถูกอ้างอิง (referenced
table) ก่อนตารางหรือ ALTER ที่อ้างอิงถึงมันเสมอ — โดยเฉพาะ `products` ต้องถูก
สร้างก่อนสิ่งใดๆ ที่มี FK ชี้ไปหามัน (`contents.fk_content_product`,
`product_specs`)

#### Scenario: Bootstrap บน TiDB/MySQL ที่ยังไม่มีตารางใดๆ เลย
- **WHEN** ระบบเชื่อมต่อ DB ว่างเปล่าเป็นครั้งแรก
- **THEN** bootstrap สร้างตารางทั้งหมดสำเร็จโดยไม่มี FK error
  (`ER_FK_CANNOT_OPEN_PARENT`) และ `schema_version` ถูกบันทึกถูกต้อง

### Requirement: Migration error ที่ไม่ใช่ "already exists" ต้องไม่ถูกกลืน
ทุก migration step (ALTER/CREATE INDEX) SHALL ใช้ `isBenignSchemaError()` เพื่อ
แยกแยะ error ที่ปลอดภัย ("คอลัมน์/index มีอยู่แล้ว") ออกจาก error จริง — ห้ามมี
`catch` block ใดที่กลืน error ทุกชนิดด้วย `console.warn` เพียงอย่างเดียว
และ `schema_version` SHALL ไม่ถูกบันทึกถ้ามี migration step ใดล้มเหลวจริง

#### Scenario: ALTER TABLE ล้มเหลวจากสาเหตุที่ไม่ใช่ "มีอยู่แล้ว"
- **WHEN** การเพิ่มคอลัมน์ `salesRecordId`/`productName` ล้มเหลวด้วย error อื่น
  ที่ไม่ใช่ `ER_DUP_FIELDNAME`
- **THEN** exception ถูก throw ออกไปจาก `bootstrapSchemaOnce` (ให้ retry logic
  ของ `initializeDb` จัดการ) และ `schema_version` ไม่ถูกบันทึกว่าสำเร็จ

#### Scenario: ALTER TABLE ล้มเหลวเพราะคอลัมน์มีอยู่แล้ว
- **WHEN** เพิ่มคอลัมน์ที่มีอยู่แล้วในตาราง (`ER_DUP_FIELDNAME`)
- **THEN** ระบบข้าม error นี้และดำเนินการต่อได้ตามปกติ (พฤติกรรมเดิมไม่เปลี่ยน)
