# Proposal: แปลงใบเสนอราคาเป็นยอดขาย (Quotation → Sale)

## Why
ทุกวันนี้เวลาปิดดีลได้ ต้องเปิดหน้า "บันทึกยอดขาย" แล้วพิมพ์ทุกอย่างใหม่หมด
ทั้งที่ข้อมูลชุดเดียวกันอยู่ใน "ใบเสนอราคา" ที่เพิ่งทำให้ลูกค้าไปแล้ว — ชื่อ
ลูกค้า บริษัท รายการสินค้า จำนวน ราคาต่อหน่วย ต้องคีย์ซ้ำทีละช่อง เสียเวลาและ
พิมพ์ผิดได้ง่าย

ปัญหาที่ตามมาคือ:
- **ไม่มีเส้นเชื่อมระหว่างใบเสนอราคากับยอดขาย** — `quotationRef` เป็น text
  ที่พิมพ์เอง ไม่ได้ผูกกับใบจริง เปิดกลับไปดูใบต้นทางไม่ได้
- **ลูกค้าซื้อไม่ครบใบ ต้องจัดการด้วยมือ** — เสนอไป 3 เครื่อง ซื้อจริง 2 เครื่อง
  แล้วอีกเดือนค่อยมาซื้อเครื่องที่เหลือ ระบบไม่รู้ว่าบรรทัดไหนขายไปแล้ว
- **ไม่มีอะไรกันบันทึกดีลเดิมซ้ำ** — บันทึกใบเดียวกันสองรอบได้โดยไม่มีการเตือน
  และ serial number เครื่องเดียวกันซ้ำได้เช่นกัน (ไม่มี unique constraint และ
  ไม่มีการเช็คในทุก write path)
- **ดีลหลายเครื่องระบุสินค้าให้ถูกไม่ได้เลย** — `sales_records` เก็บสินค้าได้
  แถวละ 1 ตัว (`productId`, `productName`, `categoryId`, `qty`, `unitPrice`
  เป็น scalar ทั้งหมด) ดังนั้นบิลที่ขาย 3 รุ่นในใบเดียวจะถูกยัดไปอยู่ใต้สินค้า
  ตัวเดียว/หมวดเดียว ทำให้กราฟ "สินค้าขายดี" และ "รายได้ตามหมวดหมู่" ผิดแบบ
  เงียบๆ

และเพราะรอบการขายของธุรกิจนี้ยาวเป็น **เดือนถึงเป็นปี** (โน้ตติดตามลูกค้าจริง
มีตั้งแต่ 3/7/24 → 19/9/24 → 21/11/24 → 18/9/25 → 16/6/26) การที่ใบเสนอราคา
ถูกลบทิ้งอัตโนมัติทุก 30 วัน (`RETENTION_DAYS` ใน
`app/api/quotations/cleanup/route.ts`) แปลว่าใบต้นทางจะหายไปพอดีก่อนวันที่
ลูกค้าตัดสินใจซื้อจริง ตัวเลือกใบเสนอราคาในฟอร์มขายจึงจะว่างเปล่าเสมอถ้าไม่
แก้ retention

## What Changes

### Database
- ตารางลูกใหม่ `sales_record_items` (line items ของใบขาย 1 แถวต่อ 1 รายการ
  สินค้า): `id`, `salesRecordId`, `productId`, `productName`, `categoryId`,
  `qty`, `unitPrice`, `totalAmount`, `costAmount` (ต้นทุนสินค้ารายรายการ),
  `quotationItemId` (id ของ `QuoteItem` ต้นทาง, nullable), `sortOrder`,
  `createdAt`
- เพิ่มคอลัมน์ `quotationId` ใน `sales_records` — soft link กลับไปยังใบเสนอราคา
  ต้นทาง (คนละตัวกับ `quotationRef` ที่เป็น text อิสระ ซึ่งยังคงอยู่)
- Bump `SCHEMA_VERSION` ใน `app/lib/db.ts` (32 → 33)
- **Backfill** ตอน bootstrap: สร้าง `sales_record_items` 1 แถวต่อใบขายเดิม
  ที่ยังไม่มี line item โดยอ่านจาก scalar columns ของใบนั้นเอง — additive
  อย่างเดียว, idempotent, ไม่แก้ ไม่ทับ ไม่ลบข้อมูลเดิมใดๆ

### Store
- `app/lib/salesDashboardStore.ts` — เขียน `sales_records` + line items +
  อุปกรณ์ทั้งหมดใน `withTransaction` เดียว (atomic), ย้าย `getTopProducts`
  และ `getRevenueByCategory` ไปอ่านจาก `sales_record_items` แทน scalar
  columns, และเพิ่มคิวรี่ "บรรทัดใบเสนอราคาไหนถูกขายไปแล้ว" (join ผ่าน
  `quotationId` + `quotationItemId`)
- `app/lib/crmStore.ts` — ขยาย `syncEquipmentsForSalesRecord` ให้รับข้อมูล
  **รายเครื่อง (per machine)** ที่ต่างกันได้ในใบขายเดียว (productId, serial,
  วันเริ่ม-หมดประกัน) และทำงานอยู่ใน transaction เดียวกับใบขาย โดย
  **คง invariant เดิมไว้ทุกประการ** — จับคู่ด้วย serial identity ก่อน
  แล้วค่อย fallback ตามตำแหน่ง และไม่ลบแถวอุปกรณ์อัตโนมัติเด็ดขาด (unlink
  เท่านั้น) + คิวรี่เช็ค serial ซ้ำ
- `app/lib/quotationStore.ts` — `purgeExpiredQuotations(days)` รับค่า
  retention จาก route อยู่แล้ว จึงแก้แค่คอมเมนต์ที่ยังอ้าง "30 days" และ
  เหตุผลของ `LIST_SAFETY_LIMIT` ที่อิงกับหน้าต่าง 30 วันเดิม

### API
- `POST /api/admin/sales` — รับ payload ที่มี `quotationId` + array ของ line
  items + array ของเครื่อง (serial/ประกันรายเครื่อง) และเขียนทั้งหมด atomic
  แทนพฤติกรรมปัจจุบันที่ commit ใบขายก่อนแล้วค่อยวนสร้างอุปกรณ์ (ซึ่งพังกลาง
  ทางแล้วตอบ 207 ได้)
- `GET /api/quotations/[id]/sold` — คืนว่าบรรทัดใดของใบเสนอราคานี้ถูก
  บันทึกเป็นยอดขายไปแล้ว (สำหรับกันบันทึกซ้ำ)
- `GET /api/admin/equipments/serial-check?serials=` — คืนว่า serial เหล่านี้มี
  อยู่ใน `customer_equipments` แล้วหรือยัง (พร้อมลูกค้า/ใบขายที่ผูกอยู่)
- `GET /api/admin/sales/[id]/items` — line items + เครื่องในบิลนั้น สำหรับ
  แถวขยายได้ในตารางยอดขาย
- `app/api/quotations/cleanup/route.ts` — `RETENTION_DAYS` 30 → 730 (2 ปี)
- ทุกเส้นใหม่ใช้ `withRoute(...)` + `await requireAuth()` และ
  `sanitizePlainText` ก่อนบันทึกตามเดิม

### UI
- ฟอร์มบันทึกยอดขายใน `app/dashboard/page.tsx` เพิ่ม **ตัวเลือกใบเสนอราคา**
  (ค้นหาได้, fetch สองจังหวะ: summary จาก `GET /api/quotations` แล้วดึงราย
  ละเอียดจาก `GET /api/quotations/[id]`) — ใช้ dropdown ใน
  `app/billing/page.tsx` เป็นต้นแบบ แต่ต้องส่ง `productId` ต่อไปด้วย
- เมื่อเลือกใบแล้ว: auto-fill ลูกค้า/บริษัทด้วย id ถ้ามี ไม่มีก็ match ด้วยชื่อ
  พร้อมป้าย "เติมจากใบเสนอราคา — กรุณาตรวจสอบ"; ถ้า match ได้ 0 หรือหลายราย
  ให้เว้นว่างและบอกเหตุผล พร้อมทางลัด "สร้างลูกค้า/บริษัทใหม่"
- รายการสินค้าในใบแสดงเป็น **multi-select** เลือกได้บางบรรทัด แต่ละบรรทัดแก้
  จำนวนได้เอง และแก้ได้ทุกช่องก่อนบันทึก: ราคาต่อหน่วย, จำนวน, สินค้าที่ผูกกับ
  แคตตาล็อก, ต้นทุนสินค้า, serial number และวันเริ่ม/หมดประกัน **รายเครื่อง**
- แสดง `warrantyTerms` จากใบเสนอราคาไว้ข้างช่องกรอกวันประกัน เป็นข้อมูลอ้างอิง
- **Dialog เตือนแบบขอยืนยัน 2 กรณี** (เตือน ไม่บล็อก):
  1. ใบเสนอราคานี้เคยบันทึกขายบางบรรทัดไปแล้ว ("ใบนี้บันทึกขายไปแล้ว 2/3
     รายการ") — ติ๊กให้อัตโนมัติเฉพาะบรรทัดที่ยังไม่ขาย
  2. serial ที่กรอกซ้ำกับเครื่องที่มีอยู่แล้วในระบบ
- `app/quotation/page.tsx` — dropdown "เลือกลูกค้าจากระบบ"/"เลือกบริษัทจาก
  ระบบ" เก็บ `customerId`/`companyId` ลง `QuoteState` ด้วย (ปัจจุบันคัดลอกแค่
  ชื่อแล้วทิ้ง id)

### Dashboard
- ตารางยอดขายกดขยายแถวเพื่อดูรายการสินค้า + เครื่อง (serial/ประกัน) ในบิลนั้น
  พร้อมปุ่มเปิดใบเสนอราคาต้นทางผ่าน `quotationId`
- กราฟที่ 1 "ยอดขาย ปี <year>" เลิกพล็อต **กำไร** เปลี่ยนเป็นพล็อต
  **ต้นทุนสินค้า** (`RevenueByPeriod.cost`) คู่กับ **ยอดขาย** โดยใช้โทน
  ส้ม/อำพัน แยกจากสีแดงของ "รายจ่ายบริษัท" ในกราฟที่ 2
- เพิ่ม **หมายเหตุอธิบายสั้นๆ** ที่มองเห็นได้บนหน้า บอกว่า "ต้นทุนสินค้า"
  (กราฟ 1) กับ "รายจ่ายบริษัท" (กราฟ 2) ไม่ใช่ตัวเลขเดียวกัน

## Constraints (จาก requirement)
- **1 บิล = 1 `sales_records`** — ขายหลายเครื่องในใบเดียวเขียนใบขาย 1 แถว +
  line items หลายแถว + `customer_equipments` 1 แถวต่อ 1 เครื่องจริง
  (ไม่แตกเป็นหลายใบขาย เพื่อให้ยอดดีลและรายงานสินค้า/หมวดถูกต้องพร้อมกัน)
- **เตือนแต่ไม่บล็อก** ทั้งสองกรณี — บรรทัดใบเสนอราคาที่เคยขายแล้ว และ serial
  ซ้ำ — ผู้ใช้ยืนยันแล้วบันทึกต่อได้เสมอ (เคสจริง: ลูกค้ามาซื้อเครื่องที่เหลือ
  ทีหลัง)
- **serial number ยังเป็นข้อมูลบังคับ** ต้องกรอกครบทุกเครื่องก่อนบันทึก
  (คงกฎเดิม) — การเตือนเรื่องซ้ำไม่ได้ยกเลิกข้อบังคับนี้
- **ราคา copy มาตรงๆ** จาก `QuoteItem.unitPrice` (ราคาก่อนส่วนลดและก่อน VAT)
  แล้วให้ผู้ใช้แก้เองถ้าดีลจริงมีส่วนลด — **ไม่เฉลี่ยส่วนลดระดับใบอัตโนมัติ**
- **ประกันตั้งได้รายเครื่อง** ไม่ใช่ค่าเดียวต่อบิล
- **จำนวนแก้ได้รายบรรทัด** เพราะใบเสนอ 3 เครื่อง ลูกค้าอาจซื้อ 2
- **Backfill ต้อง additive อย่างเดียว** — สร้างแถวที่ขาดเท่านั้น ห้ามแก้ ห้าม
  ทับ ห้ามลบ เพื่อให้กราฟย้อนหลังได้ตัวเลขเดิมเป๊ะ
- **นิยาม "ต้นทุนสินค้า" บนกราฟ 1 = `RevenueByPeriod.cost` =
  `SUM(sales_records.costAmount)`** คือต้นทุนที่บันทึกไว้ในใบขายเท่านั้น
  (ต้นทุนรายรายการของ line items + ค่าใช้จ่ายระดับใบขายใน `sale_cost_items`
  เช่น ค่ารถ/ค่าขนส่ง/ค่าคอมมิชชั่น) **ไม่รวมค่าใช้จ่ายบริษัท** เช่น ค่าเช่า
  เงินเดือน ค่าน้ำค่าไฟ — และเพราะซีรีส์ "รายจ่าย" ของกราฟ 2 หมายถึงค่านี้
  **บวก** ค่าใช้จ่ายบริษัท จึงต้องมีหมายเหตุกำกับและใช้สีต่างกันชัดเจน
- ทำงานทั้งหมดที่ต้อง atomic ผ่าน `withTransaction` และเพราะมัน retry callback
  ได้ถึง 3 ครั้ง callback SHALL idempotent (generate UUID ข้างใน)

## Impact
- Affected specs:
  - `quotation-to-sale` (ใหม่)
  - `sales-line-items` (ใหม่)
  - `dashboard-cost-reporting` (ใหม่)
  - `crm-data-integrity` (แก้ไข)
- Affected code:
  - `app/lib/db.ts` — ตาราง `sales_record_items`, คอลัมน์ `quotationId`,
    bump `SCHEMA_VERSION`, backfill แบบ additive
  - `app/lib/salesDashboardStore.ts` — write path แบบ atomic, line items,
    `getTopProducts` / `getRevenueByCategory` อ่านจากตารางลูก, คิวรี่
    "บรรทัดไหนขายแล้ว"
  - `app/lib/saleLineItemStore.ts` (ใหม่) — อ่าน/เขียน line items ภายใน
    connection ของ transaction ที่ส่งเข้ามา
  - `app/lib/crmStore.ts` — `syncEquipmentsForSalesRecord` รับข้อมูลรายเครื่อง
    + เช็ค serial ซ้ำ (คง invariant serial identity / ห้ามลบแถวไว้ครบ)
  - `app/lib/quotationStore.ts` — คอมเมนต์ retention + `LIST_SAFETY_LIMIT`
  - `app/lib/quotationToSale.ts` (ใหม่) — pure helper สำหรับ name matching,
    การแปลง QuoteItem → payload และการตรวจ serial ซ้ำในฟอร์ม (เทสต์ได้)
  - `app/api/admin/sales/**` — payload ใหม่ + เขียน atomic +
    `GET /api/admin/sales/[id]/items`
  - `app/api/quotations/[id]/sold/route.ts` — "บรรทัดที่ขายแล้ว"
  - `app/api/admin/equipments/serial-check/route.ts` — เช็ค serial ซ้ำ
  - `app/api/quotations/cleanup/route.ts` — `RETENTION_DAYS` 30 → 730
  - `app/dashboard/page.tsx` — ตัวเลือกใบเสนอราคา, multi-select, dialog เตือน
    2 แบบ, แถวขยายได้, กราฟ 1 + หมายเหตุ
  - `app/quotation/page.tsx` — เก็บ `customerId`/`companyId` ลง `QuoteState`
  - `ARCHITECTURE.md` — ตาราง/routes ใหม่, retention ใหม่, นิยาม "ต้นทุน"
    ของสองกราฟ
  - `__tests__/**` — unit tests ของ store/route ใหม่ทั้งหมด
- **ไม่กระทบ**: หน้า public ทุกหน้า (แคตตาล็อกสินค้า/เนื้อหาการตลาด) และ
  `app/components/modals/SalesRecordEditModal.tsx` ยังทำงานเหมือนเดิมสำหรับ
  แก้ไขใบขายที่บันทึกไปแล้ว — ฟีเจอร์ใหม่ลงที่ฟอร์มหลักใน
  `app/dashboard/page.tsx` ก่อน
- **หมายเหตุความขัดแย้งกับ change ที่ยังไม่เสร็จ**: การยืด retention เป็น 2 ปี
  ขัดกับเหตุผลหนึ่งบรรทัดใน `openspec/changes/add-sales-dashboard` ที่อ้างว่า
  "ข้อมูลถูกลบทุก 30 วัน จึงต้องมีตารางถาวร" — การยืด retention **ไม่ได้**
  ทำให้ `sales_records` หมดความจำเป็น: ใบเสนอราคายังเป็นเอกสารชั่วคราวที่
  แก้/ลบได้และเก็บเป็น JSON blob ส่วน `sales_records` +
  `sales_record_items` ยังคงเป็นแหล่งข้อมูลถาวรเพียงแหล่งเดียวสำหรับการ
  วิเคราะห์ยอดขาย
