# Spec Delta: sales-line-items

## ADDED Requirements

### Requirement: ใบขาย 1 ใบ SHALL เก็บรายการสินค้าเป็นตารางลูก 1 แถวต่อ 1 รายการ
ระบบ SHALL มีตารางใหม่ `sales_record_items` ที่เก็บ **1 แถวต่อ 1 รายการสินค้า**
ภายใต้ `sales_records` 1 ใบ โดยมีคอลัมน์อย่างน้อย: `id` (VARCHAR(36) PK,
`crypto.randomUUID()`), `salesRecordId` (VARCHAR(36) NOT NULL — ใบขายแม่),
`productId` (VARCHAR(255) NOT NULL DEFAULT '' — ว่างได้เมื่อไม่ผูกสินค้าในระบบ),
`productName` (VARCHAR(255) NOT NULL DEFAULT ''), `categoryId` (INT DEFAULT NULL),
`qty` (INT NOT NULL DEFAULT 1), `unitPrice` / `totalAmount` / `costAmount`
(DECIMAL(12,2) NOT NULL DEFAULT 0), `quotationItemId` (VARCHAR(64) DEFAULT NULL
— `QuoteItem.id` ต้นทาง, **nullable** เพราะรายการที่กรอกเองไม่มีต้นทาง),
`createdAt` (ISO string) และ `sortOrder` (INT NOT NULL DEFAULT 0)
คอลัมน์ทั้งหมด SHALL เป็น camelCase ตาม convention เดิม และ `productName`
SHALL ผ่าน `sanitizePlainText` ก่อนบันทึกเสมอ

ตาราง SHALL มี FK `salesRecordId` → `sales_records(id)` **ON DELETE CASCADE**
(รูปแบบเดียวกับ `sale_cost_items`) และ SHALL มี index อย่างน้อย:
`idx_sri_salesRecord (salesRecordId)`, `idx_sri_product (productId)`,
`idx_sri_category (categoryId)`, `idx_sri_quotationItem (quotationItemId)`
เพื่อให้คิวรี่รายงานและการเช็ค "รายการนี้ขายไปแล้วหรือยัง" ไม่ต้อง full scan
การสร้างตารางและ ALTER ทั้งหมด SHALL เขียนแบบ idempotent
(`CREATE TABLE IF NOT EXISTS` + try/catch `isBenignSchemaError`)

การเขียนใบขาย 1 ใบพร้อม line items ทั้งหมด SHALL อยู่ใน `withTransaction`
เดียวกัน — ห้ามมีสภาพ "มีใบขายแต่ไม่มีรายการสินค้า" ค้างในฐานข้อมูล และเนื่องจาก
`withTransaction` retry callback ได้ถึง 3 ครั้ง UUID ทุกตัว SHALL ถูกสร้าง
**ภายใน** callback

#### Scenario: บันทึกใบขายที่มีสินค้า 3 รายการ
- **WHEN** แอดมินบันทึกใบขาย 1 ใบที่มีสินค้า 3 รายการ
- **THEN** เกิด `sales_records` 1 แถว และ `sales_record_items` 3 แถวที่มี
  `salesRecordId` ชี้ไปใบขายเดียวกัน — ทั้งหมดคอมมิตพร้อมกันในทรานแซกชันเดียว

#### Scenario: บันทึกล้มเหลวกลางทาง
- **WHEN** การ insert line item แถวที่ 2 ล้มเหลว (เช่น DB error)
- **THEN** ไม่มีทั้ง `sales_records` และ `sales_record_items` แถวใดถูกเขียนเลย
  (all-or-nothing) — ผู้ใช้บันทึกใหม่ได้โดยไม่เกิดใบขายซ้ำที่ทำให้ยอดขายเบิ้ล

#### Scenario: รายการที่มาจากใบเสนอราคาที่พิมพ์เอง
- **WHEN** รายการนั้นมาจาก `QuoteItem` ที่ไม่มี `productId` หรือผู้ใช้กรอกสินค้าเอง
- **THEN** แถวถูกบันทึกได้ปกติ โดย `productId` เป็น `''`, `categoryId` เป็น
  `NULL` และ `quotationItemId` เป็น `NULL` ได้ — ไม่มี FK ใดบังคับให้ล้มเหลว

#### Scenario: ลบใบขาย
- **WHEN** ใบขายถูกลบผ่านเส้นทางลบปกติ
- **THEN** `sales_record_items` ของใบนั้นถูกลบตาม FK cascade ส่วน
  `customer_equipments` ที่ผูกอยู่ SHALL **ยังคงอยู่ในฐานข้อมูลครบ**
  (ปลดออกจากใบขายเท่านั้น) ตาม spec `crm-data-integrity` เดิม

### Requirement: การเปลี่ยน schema ของฟีเจอร์นี้ SHALL มาพร้อมการ bump SCHEMA_VERSION
`SCHEMA_VERSION` ใน `app/lib/db.ts` SHALL ถูก bump จาก `32` เป็น `33` ใน commit
เดียวกับที่เพิ่มตาราง `sales_record_items` และคอลัมน์ `sales_records.quotationId`
— ถ้าไม่ bump ฐานข้อมูลที่มีอยู่แล้ว (production TiDB) จะ **ข้าม migration
ทั้งหมด** ทำให้ตารางไม่ถูกสร้าง แล้วทุกคิวรี่รายงานที่อ่าน line items พังเงียบ
การ bump SHALL ทำครั้งเดียวครอบคลุมทั้งตารางใหม่, คอลัมน์ใหม่ และ backfill
และขั้นตอน bootstrap ทั้งหมด SHALL รันซ้ำได้โดยไม่เกิด error หรือข้อมูลซ้ำ

#### Scenario: deploy ขึ้นฐานข้อมูลเดิมที่ schema_version = 32
- **WHEN** โค้ดใหม่ที่ `SCHEMA_VERSION = 33` ถูก deploy ทับ DB ที่บันทึกไว้ 32
- **THEN** migration รัน สร้าง `sales_record_items`, เพิ่ม `quotationId`,
  รัน backfill แล้วบันทึก schema_version = 33

#### Scenario: deploy ซ้ำรอบสอง
- **WHEN** deploy โค้ดเดิมซ้ำบน DB ที่ schema_version = 33 แล้ว
- **THEN** ไม่มี error, ไม่มีตาราง/คอลัมน์/แถวใดถูกสร้างซ้ำ และข้อมูลเดิมไม่ถูกแก้

### Requirement: ยอดเงินบนใบขาย SHALL สอดคล้องกับผลรวมของ line items เสมอ
สำหรับใบขายทุกใบ ระบบ SHALL รักษา invariant:
`sales_records.totalAmount` = `SUM(sales_record_items.totalAmount)` ของใบนั้น
และ `sales_records.qty` = `SUM(sales_record_items.qty)` โดยแต่ละแถว
`sales_record_items.totalAmount` = `qty × unitPrice` (ปัดทศนิยม 2 ตำแหน่ง)
invariant นี้ SHALL ถูกคำนวณใหม่ทุกครั้งที่ line items เปลี่ยน ภายใน
ทรานแซกชันเดียวกับการแก้ line items (รูปแบบเดียวกับ `recalcCostAmount`
ที่ล็อกแถวใบขายด้วย `SELECT ... FOR UPDATE` ก่อนสรุปยอด)

ผลคือ **รายได้/ต้นทุน/กำไร/margin รายช่วงเวลา SHALL ไม่ขึ้นกับว่าใบขายใบหนึ่ง
มีกี่รายการ** — คิวรี่ที่สรุปยอดระดับใบขาย (`RevenueByPeriod`,
`getRevenueByPeriod`, KPI การ์ด) SHALL ยังอ่านจาก `sales_records` เท่านั้น
และ SHALL **ไม่** join `sales_record_items` เพื่อกัน row multiplication
คอลัมน์สินค้าแบบ scalar เดิมบน `sales_records` (`productId`, `productName`,
`categoryId`, `unitPrice`) SHALL ถูกคงไว้เพื่อ backward compatibility ของ
หน้าจอ/สคริปต์เดิม โดยตั้งค่าจากรายการแรกของใบขาย แต่ SHALL **ห้ามใช้เป็น
แหล่งความจริงในการปันส่วนรายได้** อีกต่อไป

#### Scenario: ใบขาย 3 รายการ ยอดรวมตรงกัน
- **WHEN** ใบขายมีรายการ 1×120,000 + 2×45,000 + 1×90,000
- **THEN** `sales_record_items.totalAmount` = 120,000 / 90,000 / 90,000 และ
  `sales_records.totalAmount` = 300,000, `sales_records.qty` = 4

#### Scenario: ยอดรวมรายเดือนไม่ขึ้นกับจำนวนรายการในบิล
- **WHEN** เดือนหนึ่งมีใบขาย 300,000 บาทใบเดียวที่มี 3 รายการ เทียบกับกรณีที่
  ใบเดียวกันมีรายการเดียว 300,000 บาท
- **THEN** `revenue`, `cost`, `profit`, `margin` และ `deals` ของเดือนนั้น
  เท่ากันทุกค่า (deals = 1 ทั้งสองกรณี)

#### Scenario: แก้ราคาต่อหน่วยของรายการเดียวในใบขาย
- **WHEN** แอดมินแก้ `unitPrice` ของรายการที่ 2 จาก 45,000 เป็น 40,000
- **THEN** `totalAmount` ของรายการนั้นเป็น 80,000 และ
  `sales_records.totalAmount` ถูกคำนวณใหม่เป็น 290,000 ในทรานแซกชันเดียวกัน

### Requirement: ต้นทุนสินค้า SHALL เก็บรายรายการ ส่วนค่าใช้จ่ายระดับใบขาย SHALL ยังผูกกับใบขาย และห้ามนับซ้ำ
`sales_record_items.costAmount` SHALL เก็บ **ต้นทุนสินค้าของรายการนั้น
(ทั้งรายการ ไม่ใช่ต่อหน่วย)** เพราะเครื่องหลายตัวในบิลเดียวกันมีต้นทุนต่างกันได้
และผู้ใช้ SHALL แก้ค่านี้ได้รายรายการก่อนบันทึก

ค่าใช้จ่ายที่เป็นของ **ทั้งบิล** — ค่ารถ / ค่าเดินทาง (`transport`),
ค่าขนส่ง (`shipping`), ค่าคอมมิชชั่น (`commission`), `service_visit`,
`repair`, `other` — SHALL ยังเก็บใน `sale_cost_items` ผูกกับใบขายเหมือนเดิม
**ห้ามกระจายลงรายการสินค้า** และ SHALL ไม่ถูกทำซ้ำใน `sales_record_items`

`sales_records.costAmount` (ค่าที่ทุกคิวรี่กำไร/margin อ่าน) SHALL เท่ากับ
**พอดี**:

```
sales_records.costAmount
  = SUM(sales_record_items.costAmount)
  + SUM(sale_cost_items.amount WHERE costType <> 'product_cost')
```

ดังนั้นตั้งแต่ฟีเจอร์นี้เป็นต้นไป เส้นทางบันทึกใหม่ SHALL **ไม่สร้าง**
`sale_cost_items` ที่ `costType = 'product_cost'` อีก (ต้นทุนสินค้าอยู่ที่
line items ที่เดียว) และการคำนวณ `costAmount` ใหม่ (เช่น `recalcCostAmount`,
`syncCostItems`) SHALL ตัดแถว `product_cost` ออกจากผลรวมเสมอ เพื่อไม่ให้
ต้นทุนสินค้าถูกนับสองรอบ แถว `product_cost` เก่าที่มีอยู่ SHALL **ไม่ถูกลบ**
(คงไว้เป็นประวัติ ตามกฎห้ามลบข้อมูลอัตโนมัติ) แต่ SHALL ไม่ถูกนำมารวมอีก

เนื่องจาก UI ที่กรอกต้นทุนรายรายการ (Phase 2) ยังไม่มี ฟอร์มบันทึกการขายที่ใช้
งานอยู่จริงจึงยังส่ง `product_cost` ระดับใบขายมาที่ `PUT .../costs/sync` ดังนั้น:

- `syncCostItems` SHALL รวมยอด `product_cost` ที่ส่งมาแล้ว **เขียนทับ (SET)**
  ลงบน `sales_record_items.costAmount` ของใบขายที่มีรายการเดียว (ใบขายที่ยัง
  ไม่มีรายการ SHALL สร้างให้ 1 รายการจากคอลัมน์สเกลาร์) — เขียนเป็น**ค่าสัมบูรณ์
  เสมอ ห้ามบวก/ลบส่วนต่าง (delta)** เพื่อให้บันทึกซ้ำหรือ retry ของ
  `withTransaction` ได้ผลเท่าเดิม และการแก้พร้อมกันสองแท็บไม่สะสมยอด
- ตะกร้าต้นทุนที่ส่งมา SHALL ถือเป็นค่าจริงทั้งชุด รวมถึงกรณี**ไม่มี**แถว
  `product_cost` เลย ซึ่ง SHALL ตั้งต้นทุนสินค้าเป็น 0 (ต้นทุนต้องแก้ลงและล้างได้
  ไม่ใช่ค่าที่ขึ้นได้อย่างเดียว)
- ใบขาย **หลายรายการ** SHALL ไม่ถูกเกลี่ยยอด: ถ้ายอดที่ส่งมาไม่เท่ากับ
  `SUM(sales_record_items.costAmount)` เดิม ระบบ SHALL ตอบ error (400) และไม่
  เขียนอะไรเลย — ห้ามทั้งเดาสัดส่วนและทิ้งเงินเงียบ ๆ
- `POST .../costs` SHALL ปฏิเสธ `costType = 'product_cost'` (400)

#### Scenario: บิล 3 เครื่องต้นทุนต่างกัน + ค่ารถ + ค่าคอมมิชชั่น
- **WHEN** ใบขายมีรายการ A ต้นทุน 80,000, B ต้นทุน 60,000, C ต้นทุน 55,000
  และมี `sale_cost_items` = ค่ารถ 3,000 + ค่าคอมมิชชั่น 9,000
- **THEN** `sales_records.costAmount` = (80,000+60,000+55,000) + (3,000+9,000)
  = 207,000 — ต้นทุนสินค้าถูกนับครั้งเดียวจาก line items และค่าใช้จ่ายระดับบิล
  ถูกนับครั้งเดียวจาก `sale_cost_items`
- **THEN** เมื่อ `totalAmount` = 300,000 กำไรของใบนี้ (ก่อนหักค่าใช้จ่ายบริษัท)
  = 93,000 และ `RevenueByPeriod.cost` ของเดือนนั้นรวม 207,000 ไม่ใช่ 402,000

#### Scenario: ใบขายเก่าที่ยังมีแถว product_cost อยู่
- **WHEN** ใบขายเก่ามี `sale_cost_items` `product_cost` = 80,000 และค่ารถ 3,000
  แล้ว backfill สร้าง line item ที่ `costAmount` = 80,000
- **THEN** `sales_records.costAmount` ยังเท่ากับ 83,000 เท่าเดิม — แถว
  `product_cost` ยังอยู่ในฐานข้อมูลแต่ไม่ถูกบวกซ้ำ

#### Scenario: แก้ต้นทุนรายเครื่องเครื่องเดียว
- **WHEN** แอดมินแก้ `costAmount` ของรายการ B จาก 60,000 เป็น 66,000
- **THEN** `sales_records.costAmount` เป็น 213,000 และต้นทุนของรายการ A, C
  รวมถึงค่ารถ/ค่าคอมมิชชั่น ไม่ถูกแตะต้อง

### Requirement: สิ่งที่ฟอร์มอ่านกลับ SHALL เป็นยอดเดียวกับที่ถูกนับ
`getCostItems` (`GET .../costs`) SHALL คืนค่าใช้จ่ายระดับใบขาย **บวกกับ**
ต้นทุนสินค้าที่นับจริงคือ `SUM(sales_record_items.costAmount)` ในรูปแถวสังเคราะห์
`costType = 'product_cost'` หนึ่งแถว (id ผูกกับ id ใบขาย) และ SHALL **ไม่คืน**
แถว `product_cost` เก่าใน `sale_cost_items`

เหตุผล: ฟอร์มแก้ไขทุกตัวโหลดตะกร้าต้นทุนจาก endpoint นี้แล้วส่งกลับมาทั้งชุดตอน
บันทึก ถ้าอ่านกลับได้ยอดที่ระบบไม่ได้นับ (แถวเก่า) การบันทึกครั้งถัดไปจะย้อนค่าที่
ผู้ใช้เพิ่งแก้กลับเป็นค่าเดิมโดยไม่มีอะไรเตือน ดังนั้น GET → save → GET SHALL ได้
ตัวเลขชุดเดิมเสมอ

#### Scenario: แก้ต้นทุนแล้วเปิดใบขายซ้ำ
- **WHEN** ใบขายเก่ามีแถว `product_cost` = 12,000 (ประวัติ) และผู้ใช้แก้
  ต้นทุนสินค้าเป็น 20,000 แล้วบันทึก
- **THEN** `GET .../costs` คืนต้นทุนสินค้า 20,000 (ไม่ใช่ 12,000) และการกดบันทึก
  อีกครั้งโดยไม่แก้อะไร SHALL ให้ `costAmount` เท่าเดิม

### Requirement: สินค้าขายดี และ รายได้ตามหมวดหมู่ SHALL คำนวณจาก line items เท่านั้น
`getTopProducts` (สินค้าขายดี) และ `getRevenueByCategory` (รายได้ตามหมวดหมู่)
ใน `app/lib/salesDashboardStore.ts` SHALL อ่านจาก `sales_record_items`
(join `sales_records` เพื่อกรองด้วย `saleDate` เท่านั้น) และ SHALL **ห้าม**
group by `sales_records.productId` / `sales_records.productName` /
`sales_records.categoryId` อีกต่อไป

นิยามของค่าที่คืน SHALL เป็น: `revenue` = `SUM(sri.totalAmount)`,
`qty` = `SUM(sri.qty)`, `deals` = `COUNT(DISTINCT sri.salesRecordId)`
(บิลเดียวนับเป็น 1 ดีลของสินค้า/หมวดนั้น ไม่ใช่ 1 ดีลต่อแถว) และ
`percentage` = สัดส่วนของ `revenue` เทียบผลรวมทั้งชุด
ผลรวม `revenue` ของทุกสินค้า/ทุกหมวดในช่วงเวลาหนึ่ง SHALL เท่ากับยอดขายรวม
ของช่วงเวลาเดียวกัน (`SUM(sales_records.totalAmount)`) เสมอ

#### Scenario: บิลเดียวขาย 3 เครื่อง 2 หมวด — แต่ละสินค้าได้ส่วนของตัวเอง
- **WHEN** ใบขายใบเดียว `saleDate` = 2026-03-10 มีรายการ
  (A) "เครื่องชั่ง XA-220" หมวด "เครื่องชั่ง" qty 1 × 120,000 = 120,000,
  (B) "เครื่องชั่ง PS-1000" หมวด "เครื่องชั่ง" qty 2 × 45,000 = 90,000,
  (C) "ตู้อบ OV-50" หมวด "เครื่องมือวิทยาศาสตร์" qty 1 × 90,000 = 90,000
- **THEN** สินค้าขายดีของเดือนนั้นแสดง XA-220 = 120,000 (qty 1),
  PS-1000 = 90,000 (qty 2), OV-50 = 90,000 (qty 1) — **ไม่ใช่** สินค้าตัวเดียว
  ได้ 300,000 ทั้งบิล
- **THEN** รายได้ตามหมวดหมู่แสดง "เครื่องชั่ง" = 210,000 และ
  "เครื่องมือวิทยาศาสตร์" = 90,000 — **ไม่ใช่** หมวดเดียวได้ 300,000
- **THEN** `deals` ของทั้ง 3 สินค้า = 1 และของหมวด "เครื่องชั่ง" = 1
  (บิลเดียวกัน ไม่นับซ้ำ 2 ครั้ง)

#### Scenario: ผลรวมของรายงานต้องเท่ากับยอดขายรวม
- **WHEN** ช่วงเวลาหนึ่งมียอดขายรวม 300,000 จากใบขายข้างต้น
- **THEN** ผลรวม `revenue` ของทุกแถวใน สินค้าขายดี = 300,000 และผลรวมของทุกแถว
  ใน รายได้ตามหมวดหมู่ = 300,000 และ `percentage` รวมกันได้ 100%

#### Scenario: กรองด้วยช่วงวันที่
- **WHEN** ผู้ใช้กรองรายงานด้วย `dateFrom`/`dateTo`
- **THEN** การกรองใช้ `sales_records.saleDate` ของใบขายแม่ (ไม่ใช่ `createdAt`
  ของ line item) — รายการทุกแถวในบิลเดียวกันอยู่ในช่วงเดียวกันเสมอ

### Requirement: รายการที่ไม่ผูกสินค้าในระบบ SHALL ตกลงบัคเก็ต "ไม่ระบุสินค้า" / "ไม่ระบุหมวด" ไม่ใช่หายไปจากรายงาน
เมื่อ line item มี `productId` เป็นค่าว่าง หรือ `categoryId` เป็น `NULL`
หรือชี้ไปสินค้า/หมวดที่ถูกลบไปแล้ว รายงาน SHALL ยังนับรายการนั้นเข้ายอด
โดยใช้บัคเก็ตเดิมที่มีอยู่แล้วในโค้ดปัจจุบัน: สินค้าขายดีใช้
`id` = `"unspecified"` ชื่อ = `"ไม่ระบุสินค้า"` และรายได้ตามหมวดหมู่ใช้
`id` = `"unknown"` ชื่อ = `"ไม่ระบุหมวด"` (คง fallback เดิมของแต่ละคิวรี่ไว้
ตามที่เป็นอยู่ ห้ามเปลี่ยนค่าเหล่านี้เพราะหน้าจอเดิมอ้างอิงอยู่)
คิวรี่ SHALL ใช้ `LEFT JOIN` + `COALESCE` เท่านั้น
SHALL **ห้ามใช้ `INNER JOIN`** หรือเงื่อนไข `WHERE productId <> ''`
ที่จะทำให้ยอดขายบางส่วนหายไปเงียบๆ จนผลรวมรายงานไม่ตรงกับยอดขายรวม

#### Scenario: รายการที่พิมพ์ชื่อสินค้าเอง
- **WHEN** ใบขายมีรายการที่ `productId` = `''`, `categoryId` = `NULL`,
  มูลค่า 50,000
- **THEN** สินค้าขายดีมีแถว "ไม่ระบุสินค้า" 50,000 และรายได้ตามหมวดหมู่มีแถว
  "ไม่ระบุหมวด" 50,000 — และผลรวมของรายงานยังเท่ากับยอดขายรวมของช่วงนั้น

#### Scenario: สินค้าในแคตตาล็อกถูกลบภายหลัง
- **WHEN** สินค้าที่เคยผูกกับ line item ถูกลบออกจากแคตตาล็อก
- **THEN** รายงานยังแสดงยอดของรายการนั้น (ใช้ `productName` ที่บันทึกไว้ในแถว)
  ไม่ error และยอดไม่หาย

### Requirement: ใบขายเดิมทุกใบ SHALL ถูก backfill เป็น line item 1 แถว แบบ additive และ idempotent
ตอน bootstrap schema (พร้อมการ bump เป็น 33) ระบบ SHALL สร้าง
`sales_record_items` **1 แถวต่อ `sales_records` เดิม 1 ใบ** โดยดึงค่าจาก
คอลัมน์ scalar ของใบขายนั้นเอง: `productId`, `productName`, `categoryId`,
`qty`, `unitPrice`, `totalAmount` และ
`costAmount` = `MAX(0, sales_records.costAmount − SUM(sale_cost_items.amount
WHERE costType <> 'product_cost'))` (คือส่วนที่เป็นต้นทุนสินค้าจริง) โดย
`quotationItemId` = `NULL`

การ backfill SHALL:
- **เพิ่มอย่างเดียว** — ห้าม `UPDATE` หรือ `DELETE` แถวใดในทุกตาราง และห้าม
  แตะ `sales_records.totalAmount` / `costAmount` / `sale_cost_items`
- **idempotent** — insert เฉพาะใบขายที่ยังไม่มี line item เลย
  (`WHERE NOT EXISTS (SELECT 1 FROM sales_record_items ...)`) รันซ้ำกี่ครั้งก็
  ไม่เกิดแถวใหม่
- ครอบคลุม **ทุก** ใบขายรวมถึง `saleType = 'service'` และใบที่ไม่มี
  `productId` (ตกบัคเก็ต "ไม่ระบุสินค้า" ตาม requirement ก่อนหน้า) เพื่อให้
  ผลรวมจาก line items เท่ากับยอดขายรวมทุกช่วงเวลา
- ทำใน `withTransaction` และสร้าง UUID ภายใน callback (callback ถูก retry ได้)
- ปลอดภัยเมื่อหลาย instance บูตพร้อมกัน — การชนกันของ backfill SHALL ไม่ทำให้
  bootstrap ล้มทั้งกระบวนการ และ SHALL ไม่ทำให้เกิด line item ซ้ำต่อใบขาย

#### Scenario: deploy ครั้งแรกบนฐานข้อมูลที่มีใบขายเดิม 500 ใบ
- **WHEN** migration v33 รันบน DB ที่มี `sales_records` 500 ใบ
- **THEN** เกิด `sales_record_items` 500 แถว (ใบละ 1) และไม่มีแถวใดใน
  `sales_records`, `sale_cost_items`, `customer_equipments` ถูกแก้หรือลบ

#### Scenario: รันซ้ำ
- **WHEN** bootstrap หรือสคริปต์ backfill ถูกเรียกซ้ำอีกครั้ง
- **THEN** จำนวนแถวใน `sales_record_items` เท่าเดิม — ไม่มีแถวใหม่ ไม่มีข้อมูลซ้ำ

#### Scenario: ตัวเลขย้อนหลังต้องไม่เปลี่ยน (regression ที่ต้องกันให้ได้)
- **WHEN** เทียบผลของ สินค้าขายดี และ รายได้ตามหมวดหมู่ ของทุกช่วงเวลาย้อนหลัง
  ก่อน migration (คำนวณจาก `sales_records`) กับหลัง migration
  (คำนวณจาก `sales_record_items`)
- **THEN** ยอด `revenue`, `qty` และ `deals` ของทุกสินค้าและทุกหมวด **เท่ากันทุกค่า**
  และ `revenue`, `cost`, `profit`, `margin` รายเดือน/รายปีก็เท่าเดิมทุกค่า

#### Scenario: ใบขายเดิมที่มีเฉพาะค่าใช้จ่ายระดับบิล
- **WHEN** ใบขายเดิมมี `costAmount` = 3,000 ซึ่งมาจากค่ารถ 3,000 ทั้งก้อน
- **THEN** line item ที่ backfill ได้มี `costAmount` = 0 และ
  `sales_records.costAmount` ยังเป็น 3,000 เท่าเดิม (ไม่นับซ้ำ ไม่หาย)

### Requirement: sales_records.quotationId SHALL เป็น soft link ที่พังไม่ได้เมื่อใบเสนอราคาถูกลบ
`sales_records` SHALL มีคอลัมน์ใหม่ `quotationId VARCHAR(36) DEFAULT NULL`
พร้อม index `idx_sr_quotation (quotationId)` เพื่อชี้กลับไปยังใบเสนอราคาต้นทาง
คอลัมน์นี้ SHALL **ไม่มี FOREIGN KEY** ไปยัง `quotations` เด็ดขาด เพราะ
ใบเสนอราคาถูกลบจริง (hard delete) โดย cron ตามนโยบาย retention — การมี FK
จะทำให้ลบใบเสนอราคาไม่ได้ หรือ (ถ้า cascade) ลบใบขายทิ้งไปด้วย ซึ่งเป็นการ
ทำลายข้อมูลรายได้ถาวร

ระบบ SHALL ปฏิบัติกับ `quotationId` เป็น "ลิงก์แบบหลวม": ใบขายที่ใบเสนอราคา
ต้นทางหายไปแล้ว SHALL ยังอ่าน/แสดง/แก้ไขได้ตามปกติทุกประการ ปุ่มเปิด
ใบเสนอราคาต้นทาง SHALL เปลี่ยนเป็นสถานะใช้งานไม่ได้พร้อมข้อความอธิบาย
(เช่น "ใบเสนอราคาต้นทางถูกลบตามระยะเก็บข้อมูลแล้ว") SHALL **ห้าม** โยน error
หรือทำให้หน้า/API ล้มเหลว ส่วน `quotationRef` (เลขที่เอกสารแบบ text) SHALL
ยังคงถูกบันทึกคู่กันเสมอ เพื่อให้ยังอ้างอิงเลขที่เอกสารได้แม้ลิงก์จะใช้ไม่ได้

#### Scenario: ใบเสนอราคาต้นทางถูก purge ไปแล้ว
- **WHEN** เปิดใบขายที่ `quotationId` ชี้ไปใบเสนอราคาที่ถูกลบไปแล้ว
- **THEN** ใบขายและรายการสินค้าทั้งหมดแสดงครบถ้วนตามปกติ ปุ่มเปิดใบเสนอราคา
  ถูก disable พร้อมข้อความอธิบาย และไม่มี error ใดๆ เกิดขึ้น

#### Scenario: บันทึกใบขายโดยไม่ได้เลือกใบเสนอราคา
- **WHEN** แอดมินบันทึกใบขายด้วยการกรอกเองทั้งหมด
- **THEN** `quotationId` เป็น `NULL` และทุกอย่างทำงานปกติ — คอลัมน์นี้ไม่ใช่
  ฟิลด์บังคับ

#### Scenario: ลบใบเสนอราคาขณะที่มีใบขายอ้างอิงอยู่
- **WHEN** cron ลบใบเสนอราคาที่หมดอายุ ซึ่งมีใบขายอ้างอิงอยู่
- **THEN** การลบสำเร็จ ไม่ติด FK และไม่มีแถวใน `sales_records` หรือ
  `sales_record_items` ถูกลบหรือแก้ไขเลย

### Requirement: ตารางยอดขาย SHALL กางแถวเพื่อดูรายการสินค้าและเครื่องในบิลนั้น พร้อมปุ่มเปิดใบเสนอราคาต้นทาง
เมื่อใบขายหนึ่งใบเก็บสินค้าได้หลายรายการ ตัวเลขระดับใบขายอย่างเดียวจะอ่านไม่ออก
ว่าขายอะไรไปบ้าง ตารางยอดขายบนหน้า `/dashboard` SHALL ให้กดขยายแถวใบขายเพื่อดู
`sales_record_items` ทุกแถวของใบนั้น (ชื่อสินค้า, จำนวน, ราคาต่อหน่วย,
ยอดรวมรายรายการ) พร้อมแถว `customer_equipments` ที่ผูกกับใบขายนั้น
(serial number, วันเริ่ม/หมดประกันรายเครื่อง)

รายละเอียดนี้ SHALL โหลดแบบ lazy ตอนกางแถวผ่าน
`GET /api/admin/sales/[id]/items` (ใช้ `withRoute(...)` + `await requireAuth()`
ตามเดิม) SHALL **ไม่** ยิงคำขอของทุกแถวตอนโหลดหน้า และเมื่อใบขายนั้นมี
`quotationId` SHALL มีปุ่ม "เปิดใบเสนอราคาต้นทาง" ที่พาไปยังใบเสนอราคาใบนั้น

#### Scenario: กางแถวใบขายที่มี 3 รายการ
- **WHEN** admin กดขยายแถวใบขายที่มีสินค้า 3 รายการ รวม 4 เครื่อง
- **THEN** เห็นรายการสินค้า 3 บรรทัดพร้อมจำนวน/ราคา/ยอดรวม และเห็นเครื่อง
  4 เครื่องพร้อม serial และวันประกันของแต่ละเครื่อง

#### Scenario: ไม่กางแถวก็ไม่ยิงคำขอ
- **WHEN** โหลดหน้า dashboard ที่มีใบขาย 50 แถวโดยยังไม่กางแถวใด
- **THEN** ไม่มีการเรียก `GET /api/admin/sales/[id]/items` เลยแม้แต่ครั้งเดียว

#### Scenario: ใบขายเก่าที่มาจาก backfill
- **WHEN** กางแถวใบขายเดิมที่ backfill ให้มี line item เพียง 1 แถว
- **THEN** เห็นรายการสินค้า 1 บรรทัดตามปกติ ไม่มี error และไม่มีข้อความว่าง
  แบบไม่มีคำอธิบาย

#### Scenario: ใบขายที่ไม่ได้มาจากใบเสนอราคาในระบบ
- **WHEN** กางแถวใบขายที่ `quotationId` เป็น `NULL`
- **THEN** ไม่มีปุ่ม "เปิดใบเสนอราคาต้นทาง" (หรือปุ่มถูก disable พร้อมเหตุผล)
  และรายการสินค้า/เครื่องยังแสดงครบตามปกติ

#### Scenario: ใบเสนอราคาต้นทางถูกลบไปแล้ว
- **WHEN** ใบขายมี `quotationId` แต่ใบเสนอราคานั้นถูก purge ไปแล้ว
- **THEN** ปุ่มถูก disable พร้อมข้อความ "ใบเสนอราคาต้นทางถูกลบแล้ว" แทนการพา
  ผู้ใช้ไปหน้า error

## Non-goals
- ไม่กำหนด UI ของตัวเลือกใบเสนอราคา/multi-select/การเติมลูกค้าอัตโนมัติ —
  อยู่ใน spec `quotation-to-sale`
- ไม่กำหนดการเปลี่ยนกราฟหน้า dashboard และหมายเหตุอธิบายกราฟ — อยู่ใน spec
  `dashboard-cost-reporting`
- ไม่กำหนดพฤติกรรมของ `syncEquipmentsForSalesRecord` ในสเปกนี้ — การขยายให้
  รับข้อมูลรายเครื่อง (โดยคง invariant serial identity และกฎห้ามลบอุปกรณ์
  อัตโนมัติไว้ครบ) อยู่ใน spec `crm-data-integrity`
- ไม่มีส่วนลด/VAT รายรายการใน `sales_record_items` (ใบเสนอราคาให้ส่วนลดและ
  VAT ระดับใบเท่านั้น) — `unitPrice` คือราคาที่ผู้ใช้ยืนยันแล้ว
