# Tasks: add-quotation-to-sale

## 1. Phase 1 — Database (schema v33)
- [ ] 1.1 เพิ่มตาราง `sales_record_items` ใน `app/lib/db.ts` — `id`,
      `salesRecordId`, `productId`, `productName`, `categoryId`, `qty`,
      `unitPrice`, `totalAmount`, `costAmount`, `quotationItemId`,
      `sortOrder`, `createdAt` (camelCase ตาม convention เดิม)
- [ ] 1.2 เพิ่ม index: `idx_sri_salesRecord`, `idx_sri_product`,
      `idx_sri_category`, `idx_sri_quotationItem`
- [ ] 1.3 เพิ่ม FK `fk_sri_sales` → `sales_records(id) ON DELETE CASCADE`
      ห่อ try/catch `isBenignSchemaError` แบบเดียวกับ `sale_cost_items`
- [ ] 1.4 เพิ่มคอลัมน์ `quotationId VARCHAR(36) DEFAULT NULL` บน
      `sales_records` ทั้งใน CREATE TABLE และ ALTER แบบ additive สำหรับ DB
      เดิม + index `idx_sr_quotation`
- [ ] 1.5 ไม่ผูก FK จาก `sales_records.quotationId` ไปตาราง `quotations`
      (soft link) เพราะใบเสนอราคายังถูกลบได้ — ใบขายต้องไม่หายตาม
- [ ] 1.6 Bump `SCHEMA_VERSION` 32 → 33 ใน `app/lib/db.ts`
- [ ] 1.7 เขียนนิยามไว้ในคอมเมนต์ของ schema ว่า `sales_records.costAmount`
      (ค่าที่ Chart 1 พล็อต) = `SUM(sales_record_items.costAmount)` +
      `SUM(sale_cost_items.amount WHERE costType <> 'product_cost')`
      เพื่อไม่ให้ต้นทุนสินค้าถูกนับสองรอบ

## 2. Phase 1 — Backfill ข้อมูลเดิม
- [ ] 2.1 เขียน backfill: ใบขายเดิม 1 แถว → line item 1 แถว โดย copy
      `productId`, `productName`, `categoryId`, `qty`, `unitPrice`,
      `totalAmount`, `costAmount` จากคอลัมน์ scalar ของใบขายนั้นเอง และ
      `quotationItemId` = NULL
- [ ] 2.2 ใช้ `INSERT ... SELECT ... WHERE NOT EXISTS` (ใบขายที่ยังไม่มี
      line item) — additive อย่างเดียว ห้าม UPDATE/DELETE ของเดิม รันซ้ำ
      กี่รอบผลต้องเท่าเดิม (idempotent)
- [ ] 2.3 ครอบคลุมใบขายทุกประเภท รวม `saleType='service'` และใบที่
      `productId` ว่าง เพื่อให้ยอดรวมหลังย้ายคิวรี่ (ข้อ 6) เท่าเดิมทุกเคส
- [ ] 2.4 เรียก backfill ตอน bootstrap หลัง DDL v33 ผ่านแล้ว และต้องปลอดภัย
      เมื่อหลาย instance บูตพร้อมกัน (ชนกันแล้วไม่ throw จน bootstrap ล้ม)

## 3. Phase 1 — Store: line items + การเขียนแบบ atomic
- [ ] 3.1 สร้าง `app/lib/saleLineItemStore.ts` —
      `listLineItemsForSale(salesRecordId)` และ
      `replaceLineItemsForSale(...)` ที่รับ connection ของ transaction เข้ามา
- [ ] 3.2 `createSaleWithLineItems(...)` — เขียน `sales_records` +
      line items ทุกแถว + `customer_equipments` ทุกเครื่อง ใน
      `withTransaction` เดียว (all-or-nothing) แทน flow เดิมที่ commit ใบขาย
      ก่อนแล้วค่อยวน `addEquipment`
- [ ] 3.3 generate UUID ทั้งหมด **ภายใน** callback ของ `withTransaction`
      (retry ได้ถึง 3 ครั้ง → callback ต้อง idempotent)
- [ ] 3.4 กำหนดกติกาเติมคอลัมน์ scalar เดิมของ `sales_records` ให้ชัด
      (`qty`/`totalAmount`/`costAmount` = ผลรวมของ line items; product/
      category = ของบรรทัดหลัก) เพื่อไม่ให้ overview cards ที่ยังอ่าน
      คอลัมน์เดิมเพี้ยน
- [ ] 3.5 `sanitizePlainText` ทุก field ที่มาจากผู้ใช้ก่อน persist
- [ ] 3.6 เอา flow HTTP 207 "บันทึกใบขายแล้วแต่สร้างอุปกรณ์ไม่ครบ" ออก —
      หลังเปลี่ยนเป็น atomic ไม่มี partial success อีก (สำเร็จทั้งใบ หรือ
      ไม่เขียนอะไรเลย)
- [ ] 3.7 คำนวณ `sales_records.totalAmount` / `qty` ใหม่จากผลรวม line items
      ทุกครั้งที่ line items เปลี่ยน ภายในทรานแซกชันเดียวกัน โดยล็อกแถวใบขาย
      ด้วย `SELECT ... FOR UPDATE` แบบเดียวกับ `recalcCostAmount`
- [ ] 3.8 แก้ `recalcCostAmount` / `syncCostItems` ให้ `costAmount` =
      `SUM(sales_record_items.costAmount)` + ผลรวม `sale_cost_items` ที่
      `costType <> 'product_cost'` — เส้นทางบันทึกใหม่ห้ามสร้างแถว
      `product_cost` อีก และแถว `product_cost` เก่าห้ามลบ (แค่ไม่นำมารวม)

## 4. Phase 1 — Equipment writer รองรับเครื่องต่างรุ่นในบิลเดียว
- [ ] 4.1 ขยาย `syncEquipmentsForSalesRecord`
      (`app/lib/crmStore.ts:161-282`) ให้รับ array ของเครื่องที่ข้อมูล
      **ต่างกันได้รายเครื่อง** (`productId`, `productName`, `serialNumber`,
      `warrantyStartDate`, `warrantyEndDate`, `quotationNumber`) แทนการ
      derive ทุกเครื่องจากคอลัมน์เดียวของใบขาย
- [ ] 4.2 คง invariant: จับคู่ด้วย normalized serial identity ก่อนเสมอ
      แล้วค่อย fallback ตามตำแหน่ง (spec `crm-data-integrity`)
- [ ] 4.3 คง invariant: **ห้ามลบแถวอุปกรณ์อัตโนมัติ** — ส่วนเกินให้ unlink
      (`salesRecordId` = "") เท่านั้น
- [ ] 4.4 fallback ตามตำแหน่งต้องจับคู่ภายในกลุ่ม `productId` เดียวกัน
      เพื่อไม่ให้เครื่องคนละรุ่นสลับกันเมื่อ serial ยังว่าง
- [ ] 4.5 stamp `quotationNumber` รายเครื่องจาก docNo ของใบเสนอราคา —
      ใช้คอลัมน์เดิมของ `customer_equipments` ไม่เพิ่มคอลัมน์ใหม่

## 5. Phase 1 — Lookup queries
- [ ] 5.1 `getSoldQuotationItems(quotationId)` — คืน `quotationItemId` ที่
      ถูกบันทึกขายแล้วพร้อมจำนวนรวม (JOIN `sales_record_items` กับ
      `sales_records.quotationId`)
- [ ] 5.2 รองรับใบเสนอราคาที่ถูกบันทึกขายหลายครั้งคนละวัน — รวมยอดข้าม
      ใบขายหลายใบ
- [ ] 5.3 `findEquipmentsBySerial(serials[])` — ตรวจ serial ซ้ำใน
      `customer_equipments` หลายค่าในคิวรี่เดียว โดย normalize (trim +
      case-insensitive) แบบเดียวกับที่ sync ใช้
- [ ] 5.4 lookup ทั้งสองเป็นข้อมูลสำหรับ "เตือน" เท่านั้น — ห้าม throw หรือ
      บล็อกการบันทึกในชั้น store/API (D12/D13)

## 6. Phase 1 — ย้ายคิวรี่รวมยอดมาอ่าน line items
- [ ] 6.1 เขียน `getTopProducts` ใหม่ให้ group จาก
      `sales_record_items.productId, productName` (JOIN `sales_records`
      เพื่อคงฟิลเตอร์ช่วงวันที่/เงื่อนไขเดิม)
- [ ] 6.2 เขียน `getRevenueByCategory` ใหม่ให้ group จาก
      `sales_record_items.categoryId`
- [ ] 6.3 ตรวจคิวรี่รวมยอดอื่น (overview, revenueByDay/Month/Quarter/Year,
      topCustomers, leaderboard, smartInsights) ว่ายังอ่านระดับใบขายและ
      ไม่ถูกนับซ้ำจาก JOIN ที่เพิ่มเข้ามา
- [ ] 6.4 คง shape ผลลัพธ์ `TopItem` เดิมไว้ เพื่อให้หน้า dashboard เดิม
      ไม่ต้องแก้
- [ ] 6.5 คิวรี่ใหม่ทั้งสองใช้ `LEFT JOIN` + `COALESCE` เท่านั้น ห้าม
      `INNER JOIN` หรือ `WHERE productId <> ''` — รายการที่ไม่ผูกสินค้า/หมวด
      ต้องตกบัคเก็ตเดิม (`"ไม่ระบุสินค้า"` / `"ไม่ระบุหมวด"`) ไม่ใช่หายไป
- [ ] 6.6 `deals` = `COUNT(DISTINCT salesRecordId)` (บิลเดียวนับ 1 ดีล
      ไม่ใช่ 1 ดีลต่อ line item) และตรวจว่าผลรวม `revenue` ของทุกแถว
      เท่ากับ `SUM(sales_records.totalAmount)` ของช่วงเดียวกัน

## 7. Phase 1 — API
- [ ] 7.1 ปรับ `POST /api/admin/sales` ให้รับ payload หลายรายการ
      (`items[]` + `equipments[]`) ควบคู่กับ payload สินค้าเดียวแบบเดิม
      (backward compatible)
- [ ] 7.2 validate: ต้องมีอย่างน้อย 1 รายการ, `qty` ≥ 1,
      `unitPrice`/`costAmount` ≥ 0, serial ต้องไม่ว่างทุกเครื่อง → 400
      พร้อมข้อความภาษาไทย
- [ ] 7.3 ทุกเส้นใช้ `withRoute("<ข้อความ fallback>", handler)` +
      `await requireAuth()`
- [ ] 7.4 `GET /api/admin/sales/[id]/items` — line items + เครื่องในบิล
      สำหรับแถวขยายใน Phase 3
- [ ] 7.5 `GET /api/quotations/[id]/sold` — สรุป "บรรทัดไหนขายไปแล้ว"
      ตามข้อ 5.1
- [ ] 7.6 `GET /api/admin/equipments/serial-check?serials=` — ตรวจ serial ซ้ำ
      ตามข้อ 5.3
- [ ] 7.7 บันทึก `quotationId` + `quotationRef` ลงใบขายเมื่อ payload ส่งมา
      และยอมรับกรณีพิมพ์ `quotationRef` เองโดยไม่มี `quotationId`

## 8. Phase 1 — Retention ใบเสนอราคา 30 วัน → 2 ปี
- [ ] 8.1 เปลี่ยน `RETENTION_DAYS` 30 → 730 ใน
      `app/api/quotations/cleanup/route.ts`
- [ ] 8.2 ตรวจว่า retention ของ ledger (`purgeOldDocNos`, ~2 วัน) ยังแยก
      จากค่าใหม่นี้ และไม่ถูกเปลี่ยนตามไปด้วย
- [ ] 8.3 ตรวจ `LIMIT 2000` ของ `listQuotations()` ว่ารองรับข้อมูล 2 ปี —
      ถ้าไม่พอ เพิ่มการค้นหา/กรองฝั่ง server ให้ dropdown ยังใช้งานได้
- [ ] 8.4 แก้คอมเมนต์ที่ยังอ้าง "30 days" ใน `app/lib/quotationStore.ts`

## 9. Phase 1 — Tests (Vitest, DB mock)
- [ ] 9.1 db: DDL v33 รันซ้ำได้, index/FK ครบ, `SCHEMA_VERSION` = 33
- [ ] 9.2 backfill: ใบขายเดิม N ใบ → line item N แถว และรัน 2 รอบยังได้ N
- [ ] 9.3 backfill: ใบขายที่มี line item อยู่แล้วไม่ถูกแตะ (ไม่มี
      UPDATE/DELETE ยิงออกไป)
- [ ] 9.4 **Regression**: `getTopProducts` / `getRevenueByCategory` หลัง
      backfill ให้ตัวเลขเท่ากับคิวรี่เดิมบนข้อมูลชุดเดียวกัน — กราฟย้อนหลัง
      ต้องไม่ขยับแม้แต่บาทเดียว
- [ ] 9.5 aggregate: บิลเดียว 3 รายการ 3 หมวด → รายได้กระจายครบทั้ง 3
      ไม่กองที่สินค้า/หมวดแรก
- [ ] 9.6 atomic: บังคับให้ insert equipment เครื่องที่ 2 พัง → ไม่มี
      `sales_records` / line item / equipment เหลือใน DB เลย
- [ ] 9.7 atomic: `withTransaction` retry แล้วไม่เกิด id ซ้ำหรือแถวซ้ำ
- [ ] 9.8 equipment writer: บิลผสม 2 รุ่น สลับลำดับ serial → ประวัติซ่อม
      ยังผูกกับ serial เดิม (ต่อยอด `__tests__/lib/crmStore.test.ts`)
- [ ] 9.9 equipment writer: ลดจำนวนเครื่อง → unlink ไม่ลบ
- [ ] 9.10 lookup: `getSoldQuotationItems` นับข้ามใบขายหลายใบถูกต้อง และ
      ใบที่ยังไม่เคยขายคืนลิสต์ว่าง
- [ ] 9.11 lookup: serial ซ้ำถูกตรวจเจอแบบ trim/case-insensitive
- [ ] 9.12 route: 401 anon, 400 validation, บันทึกหลายรายการสำเร็จ,
      payload สินค้าเดียวแบบเดิมยังผ่าน
- [ ] 9.13 retention: purge ไม่ลบใบเสนอราคาอายุ 1 ปี แต่ลบใบอายุเกิน 2 ปี
- [ ] 9.14 aggregate: รายการที่ `productId` = `''` / `categoryId` = `NULL`
      ยังถูกนับในบัคเก็ต "ไม่ระบุสินค้า"/"ไม่ระบุหมวด" และผลรวมรายงาน
      เท่ากับยอดขายรวมของช่วงนั้น
- [ ] 9.15 cost: ใบขายที่มีทั้ง line items และ `sale_cost_items` (ค่ารถ/
      ค่าคอม) ได้ `costAmount` ที่ไม่นับต้นทุนสินค้าซ้ำ (ข้อ 3.8) และ
      `RevenueByPeriod.cost` ของเดือนนั้นตรงกับผลรวมที่คาดไว้

## 10. Phase 2 — Dropdown เลือกใบเสนอราคาในฟอร์มขาย
- [ ] 10.1 เพิ่ม dropdown ค้นหาได้ (พิมพ์กรอง docNo / ชื่อลูกค้า) ใน
      `app/dashboard/page.tsx` ยึดรูปแบบจาก `app/billing/page.tsx`
      (`linkQuotation`, บรรทัด ~303-352 และ ~548-568)
- [ ] 10.2 two-stage fetch: `GET /api/quotations` (summary) ตอนเปิดฟอร์ม
      แล้วค่อย `GET /api/quotations/[id]` เมื่อเลือกใบ
- [ ] 10.3 ทางออกแบบพิมพ์เอง — ไม่เลือกใบไหนก็ยังกรอก `quotationRef` เอง
      และบันทึกใบขายได้ครบเหมือนเดิม
- [ ] 10.4 เลือกใบแล้วเก็บทั้ง `quotationId` และ `quotationRef` (docNo)
      ลง payload
- [ ] 10.5 loading / error state ตอน fetch — ใบเสนอราคาโหลดไม่ได้ต้องไม่
      ทำให้ฟอร์มค้างหรือกดบันทึกไม่ได้
- [ ] 10.6 เปลี่ยนใบเสนอราคาที่เลือกแล้ว → ล้างรายการเดิมพร้อมถามยืนยัน
      ถ้าผู้ใช้แก้ข้อมูลไปแล้ว

## 11. Phase 2 — Auto-fill ลูกค้า/บริษัท
- [ ] 11.1 ใบเสนอราคาที่มี `customerId`/`companyId` (D7) → เลือก dropdown
      ตาม id ตรงๆ
- [ ] 11.2 ใบเก่าที่ไม่มี id → match ด้วยชื่อ (`customerContact` /
      `customerCompany`) แบบ normalize (trim + case-insensitive)
- [ ] 11.3 match ได้ 1 รายการ → เติมค่าให้ พร้อม marker
      "เติมจากใบเสนอราคา — กรุณาตรวจสอบ" ข้างฟิลด์
- [ ] 11.4 match ได้ 0 รายการ → เว้นฟิลด์ว่าง + แสดงชื่อจากใบเสนอราคาและ
      ข้อความว่าไม่พบในระบบ
- [ ] 11.5 match ได้หลายรายการ → เว้นฟิลด์ว่าง + บอกจำนวนที่ชื่อซ้ำ ให้
      ผู้ใช้เลือกเอง (ห้ามเดาอันแรก)
- [ ] 11.6 ปุ่ม "สร้างลูกค้าใหม่" / "สร้างบริษัทใหม่" inline — สร้างเสร็จ
      เลือกให้อัตโนมัติ โดยข้อมูลที่กรอกค้างไว้ในฟอร์มต้องไม่หาย
- [ ] 11.7 marker "กรุณาตรวจสอบ" หายไปทันทีที่ผู้ใช้แก้ค่าฟิลด์นั้นเอง

## 12. Phase 2 — รายการสินค้าแบบเลือกหลายบรรทัด
- [ ] 12.1 แสดง QuoteItem ทุกบรรทัดเป็น checkbox list (ชื่อ, จำนวนในใบ,
      ราคา/หน่วย)
- [ ] 12.2 ช่อง "จำนวนที่ขายจริง" ต่อบรรทัด — default = qty ในใบ, แก้ได้,
      ขั้นต่ำ 1; ถ้ากรอกเกินจำนวนในใบให้เตือนแต่ไม่บล็อก
- [ ] 12.3 คัดลอก `unitPrice` จากใบเสนอราคาตรงๆ (ราคาก่อนส่วนลด/ก่อน VAT)
      และแก้ไขได้ พร้อมข้อความบอกว่าระบบไม่เฉลี่ยส่วนลดระดับใบให้อัตโนมัติ
- [ ] 12.4 บรรทัดที่มี `productId` → ผูกสินค้าในระบบอัตโนมัติ; บรรทัดที่
      พิมพ์เอง → dropdown "สินค้าในระบบ" ให้เลือกเอง และค่า sentinel
      `_custom` ต้องถูกแปลงเป็น `""` ก่อนส่ง API
- [ ] 12.5 `categoryId` มาจากสินค้าที่ผูกเท่านั้น — ไม่ผูกสินค้าก็เว้นว่าง
      ห้ามเดาหมวด
- [ ] 12.6 ช่อง "ต้นทุนสินค้า" ต่อบรรทัด (ค่าเริ่มต้น 0, แก้ได้)
- [ ] 12.7 กางบรรทัดเป็นรายเครื่องตามจำนวน — serial, วันเริ่มประกัน,
      วันหมดประกัน แก้ได้แยกทุกเครื่อง (D11)
- [ ] 12.8 ปุ่มคัดลอกวันประกันจากเครื่องแรกไปทุกเครื่องในบรรทัด (ลดการพิมพ์
      ซ้ำเมื่อซื้อหลายเครื่องพร้อมกัน)
- [ ] 12.9 แสดง `warrantyTerms` จากใบเสนอราคาเป็น reference ข้างช่องวัน
      ประกัน (D15) — read-only ไม่ถูกบันทึกลงใบขาย
- [ ] 12.10 สรุปยอดรวมของบิล (รวมทุกบรรทัดที่ติ๊ก) ให้เห็นก่อนกดบันทึก
- [ ] 12.11 บังคับกรอก serial ครบทุกเครื่องก่อนบันทึก (กติกาเดิม) พร้อม
      ชี้ตำแหน่งบรรทัด/เครื่องที่ยังว่าง

## 13. Phase 2 — คำเตือนและ dialog ยืนยัน
- [ ] 13.1 แบนเนอร์ "ใบนี้บันทึกขายไปแล้ว X/Y รายการ" จาก
      `GET /api/quotations/[id]/sold`
- [ ] 13.2 pre-tick เฉพาะบรรทัดที่ยังไม่เคยขาย; บรรทัดที่ขายแล้วติด badge
      "ขายแล้ว" และไม่ถูกติ๊กให้อัตโนมัติ
- [ ] 13.3 ผู้ใช้ติ๊กบรรทัดที่ขายแล้ว → dialog ยืนยัน (ยืนยันแล้วบันทึกได้
      ห้ามบล็อก) รองรับเคสลูกค้าซื้อเครื่องที่เหลือทีหลัง
- [ ] 13.4 serial ซ้ำกับ `customer_equipments` → dialog ยืนยันพร้อมบอกว่า
      ซ้ำกับเครื่องของลูกค้ารายใด — ยืนยันแล้วบันทึกได้
- [ ] 13.5 ตรวจ serial ซ้ำ "ภายในฟอร์มเดียวกัน" ด้วย (ก่อนยิง API)
- [ ] 13.6 dialog ทั้งสองต้องมีปุ่มยกเลิก และห้ามยิง API จนกว่าจะกดยืนยัน
      (รูปแบบเดียวกับ dialog ยืนยันลบอุปกรณ์)

## 14. Phase 2 — Quotation builder เก็บ id ลูกค้า/บริษัท
- [ ] 14.1 เพิ่ม `customerId` / `companyId` (optional) ใน `QuoteState`
      (`app/quotation/page.tsx`) — ใบเก่าที่ไม่มีคีย์นี้ต้องอ่านได้ปกติ
- [ ] 14.2 onChange ของ dropdown "เลือกลูกค้าจากระบบ" /
      "เลือกบริษัทจากระบบ" (~บรรทัด 1025-1085) เก็บ id ไว้ด้วย ไม่ทิ้งเหมือน
      ปัจจุบัน
- [ ] 14.3 ผู้ใช้พิมพ์ชื่อทับเองภายหลัง → เคลียร์ id ทิ้ง กันชื่อกับ id
      ไม่ตรงกัน
- [ ] 14.4 ใบเสนอราคาเก่าที่ไม่มี id ยังทำงานได้ด้วย name matching (11.2)

## 15. Phase 2 — Tests
- [ ] 15.1 แยก logic ที่ทดสอบได้ออกเป็น pure helper ใน
      `app/lib/quotationToSale.ts` (ไม่ผูกกับ React) แล้วเขียนเทสต์กับไฟล์นี้
- [ ] 15.2 unit: การ match ลูกค้า/บริษัท ครบทั้ง 3 เคส (0 / 1 / หลายรายการ)
- [ ] 15.3 unit: แปลง QuoteItem ที่เลือก + จำนวนที่แก้ → payload `items[]`
      และ `equipments[]` (จำนวนเครื่องต้องเท่ากับผลรวม qty)
- [ ] 15.4 unit: pre-tick เฉพาะบรรทัดที่ยังไม่ขาย เมื่อได้ผลจาก
      `/sold` มาแล้ว
- [ ] 15.5 unit: normalize + ตรวจ serial ซ้ำภายในฟอร์ม
- [ ] 15.6 unit: quotation builder เก็บและเคลียร์ `customerId`/`companyId`
      ตามข้อ 14.2-14.3

## 16. Phase 3 — ตารางยอดขายและลิงก์ใบเสนอราคา
- [ ] 16.1 แถวในตารางยอดขายกดขยายได้ แสดง line items และเครื่องในบิลนั้น
      (สินค้า, จำนวน, ราคา, serial, วันประกัน)
- [ ] 16.2 โหลดรายละเอียดแบบ lazy ตอนกางแถว — ไม่ยิงทุกแถวตอนโหลดหน้า
- [ ] 16.3 ใบขายเก่า (จาก backfill) กางแล้วเห็น 1 รายการตามปกติ ไม่ error
- [ ] 16.4 ปุ่ม "เปิดใบเสนอราคาต้นทาง" เมื่อใบขายมี `quotationId`
- [ ] 16.5 ใบเสนอราคาถูกลบไปแล้ว → ปุ่ม disabled + ข้อความ
      "ใบเสนอราคาถูกลบแล้ว" แทนการพาไปหน้า error

## 17. Phase 3 — กราฟ Dashboard และหมายเหตุนิยามต้นทุน
- [ ] 17.1 Chart 1 "ยอดขาย ปี <year>": เปลี่ยน series กำไร → "ต้นทุนสินค้า"
      (`RevenueByPeriod.cost`) พล็อตคู่กับ "ยอดขาย"
- [ ] 17.2 series "ต้นทุนสินค้า" ใช้โทน amber/orange; Chart 2
      "รายจ่ายบริษัท" คงสีแดงเดิม — ต้องแยกออกจากกันชัดด้วยตาเปล่า
- [ ] 17.3 legend / tooltip ใช้ชื่อไทยตรงกับ series ใหม่
- [ ] 17.4 เพิ่มหมายเหตุที่มองเห็นได้บนหน้า dashboard อธิบายว่า Chart 1
      "ต้นทุนสินค้า" = ต้นทุนสินค้าที่ขายเท่านั้น (ไม่รวมค่าเช่า เงินเดือน
      ค่าน้ำค่าไฟ) ส่วน Chart 2 "รายจ่ายบริษัท" = ต้นทุนสินค้า +
      ค่าใช้จ่ายบริษัท
- [ ] 17.5 ตรวจว่า `profit` ยังคำนวณเหมือนเดิม
      (revenue − cost − rawExpense) และไม่มีการนับซ้ำ แม้ Chart 1 เลิกพล็อต
      กำไรแล้ว
- [ ] 17.6 ตรวจการแสดงผลบนจอเล็ก — แกน/legend/หมายเหตุยังอ่านออก

## 18. Docs
- [ ] 18.1 อัปเดต `ARCHITECTURE.md`: ตาราง `sales_record_items` + คอลัมน์
      `sales_records.quotationId` (schema v33)
- [ ] 18.2 อัปเดต `ARCHITECTURE.md`: routes ใหม่
      (`/api/admin/sales/[id]/items`, `/api/quotations/[id]/sold`,
      `/api/admin/equipments/serial-check`) และ `POST /api/admin/sales`
      ที่กลายเป็น atomic (ไม่มี 207 แล้ว)
- [ ] 18.3 อัปเดต `ARCHITECTURE.md`: retention ใบเสนอราคา 30 วัน → 2 ปี
- [ ] 18.4 อัปเดต `ARCHITECTURE.md`: นิยาม "ต้นทุน" 2 แบบของสองกราฟ
      (ต้นทุนสินค้า vs รายจ่ายบริษัท) เพื่อไม่ให้อ่านสลับกันในอนาคต
