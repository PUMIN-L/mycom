# Tasks: add-purchase-order

## 1. ฐานข้อมูล (schema v41)
- [x] 1.1 bump `SCHEMA_VERSION` เป็น 41 ใน `app/lib/db.ts`
- [x] 1.2 เพิ่มตาราง `purchase_orders` (`id VARCHAR(255) PK`, `docNo
      VARCHAR(255)`, `data JSON NOT NULL`, `supersededById VARCHAR(36)
      DEFAULT NULL`, `cancelledAt VARCHAR(255) DEFAULT NULL`, `createdAt
      VARCHAR(255) NOT NULL`) ตามแบบ `quotations`/`billing_documents` — วาง
      ต่อจากบล็อก `used_docnos` เดิม
- [x] 1.3 index `idx_po_createdAt (createdAt)` และ `idx_po_supersededById
      (supersededById)` — แต่ละอันในทรานแซกชัน try/catch แยกกัน
      (`isBenignSchemaError`) ตามกติกาเดิมของไฟล์
- [x] 1.4 เพิ่มคอลัมน์ `address TEXT DEFAULT NULL`, `taxId VARCHAR(255)
      DEFAULT NULL` บนตาราง `suppliers` ที่มีอยู่แล้ว — `ALTER TABLE ... ADD
      COLUMN IF NOT EXISTS` ทีละคอลัมน์ คนละ try/catch (ห้ามรวมเป็น ALTER
      เดียวหลายคอลัมน์ — ดูคอมเมนต์เดิมเรื่อง `ER_DUP_FIELDNAME` ทำให้
      statement ทั้งก้อนหยุดกลางทาง)

## 2. เลขที่เอกสาร
- [x] 2.1 `app/lib/poNumber.ts` — thin wrapper รอบ `nextDocNo`/
      `docNoPrefixes`/`pad2` จาก `quotationNumber.ts` (import ไม่ reimplement)
      `PO_DOCNO_PREFIX = "PO"`, ไม่มีรูปแบบ legacy
- [x] 2.2 `GET /api/purchase-orders/docnos?base=...` — คืนเลขที่ที่ใช้แล้วของ
      base ที่ขอ (สูงสุด 4 base ต่อ request ตามแบบ endpoint ของใบเสนอราคา) ใช้
      หา "เลขว่างถัดไป" และหาใบที่เคยออกด้วย base เดียวกัน (สำหรับ
      supersede) — reuse `listDocNosByBase`/`listRecentDocNos` จาก
      `quotationStore.ts` ตรงๆ ไม่เขียน ledger function ซ้ำ
- [x] 2.3 เทสต์ `app/lib/poNumber.ts` ตรงรอยต่อวัน/เดือน/ปี (ชุดวันที่แบบ
      เดียวกับ `quotationNumber.test.ts`)

## 3. Store — `app/lib/poStore.ts`
- [x] 3.1 `createPurchaseOrder(data)` — มินต์ docNo ผ่าน
      `used_docnos`เดียวกับใบเสนอราคา/ใบแจ้งหนี้ (INSERT ผูก id ของ PO ใน
      คอลัมน์ที่ชื่อ `quotationId` — คอลัมน์เดิม ตั้งใจใช้ร่วมกันทุกประเภท
      เอกสาร) ในทรานแซกชันเดียว, แปลง `ER_DUP_ENTRY` เป็น `PoDocNoConflictError`
      แบบเดียวกับ `saveQuotationAtomic`
- [x] 3.2 `getPurchaseOrder(id)`, `listPurchaseOrders()` (ล่าสุดก่อน)
- [x] 3.3 `cancelPurchaseOrder(id, cancelledAt)` — ตั้ง `cancelledAt`
      เท่านั้น **ห้าม DELETE แถว** ปฏิเสธถ้าถูก cancel/supersede ไปแล้ว
- [x] 3.4 `supersedePurchaseOrder(oldId, newData)` — สร้างแถวใหม่ (เลขที่ใหม่
      ทั้งใบ ไม่ใช่แค่ suffix เวอร์ชัน) + ตั้ง `supersededById` ของแถวเก่า ใน
      ทรานแซกชันเดียว — ปฏิเสธถ้าแถวเก่าถูก supersede ไปแล้วหรือ cancel
      ไปแล้ว
- [x] 3.5 **ไม่มีฟังก์ชันแก้ไขแถวเดิมในที่เลย** — ยืนยันด้วยเทสต์
- [x] 3.6 เทสต์ store ทั้งหมด (`poStore.test.ts`, 15 เทสต์ mock
      `app/lib/db`) — มี mutation test ยืนยันว่า guard ทั้งสองจุด (cancel ซ้ำ,
      supersede ซ้ำ) จับได้จริง

## 4. Totals — เงินในเอกสาร
- [x] 4.1 `computeQuoteTotals`/`round2`/`hasNegativeLineItem` จาก
      `quotationTotals.ts` **reuse ตรงๆ** (generic พอ ไม่ต้องสร้าง
      `poTotals.ts` แยก)
- [x] 4.2 เทสต์ตัวเลข (กรณีมี/ไม่มีส่วนลด) — ครอบคลุมผ่านเทสต์ของ
      `poStore.test.ts`/`purchase-orders.test.ts` ที่เรียก
      `computeQuoteTotals` จริงบนข้อมูล PO ไม่ mock การคำนวณ (การคำนวณเองมี
      เทสต์ของตัวเองอยู่แล้วใน `quotationTotals.test.ts`)

## 5. Supplier — เพิ่มฟิลด์
- [x] 5.1 `Supplier` type (`app/lib/types.ts`) เพิ่ม `address?: string`,
      `taxId?: string`
- [x] 5.2 `app/lib/supplierStore.ts` — `createSupplier`/`updateSupplier`
      ส่งผ่านสองฟิลด์ใหม่ (ตัด/sanitize ตามเดิม)
- [x] 5.3 `app/suppliers/page.tsx` — เพิ่มช่องกรอกที่อยู่ (textarea) และเลขผู้
      เสียภาษี ในฟอร์มเพิ่ม/แก้ไข + แสดงในมุมมองดูรายละเอียด
- [x] 5.4 เทสต์ `supplierStore.test.ts` ที่แก้ (บันทึก/ตัดความยาวฟิลด์ใหม่,
      update เฉพาะฟิลด์ที่ส่งมา)

## 6. API routes — `/api/purchase-orders`
- [x] 6.1 `GET/POST /api/purchase-orders` — `requireAuth()` + `withRoute()`
      POST → `createPurchaseOrder`, แปลง `PoDocNoConflictError` เป็น HTTP 409
- [x] 6.2 `GET /api/purchase-orders/[id]`
- [x] 6.3 `POST /api/purchase-orders/[id]/cancel`
- [x] 6.4 `POST /api/purchase-orders/[id]/supersede`
- [x] 6.5 เทสต์ทุก route (`__tests__/api/purchase-orders.test.ts`, 25 เทสต์ —
      mock store ทั้งก้อน, ควบคุมผ่าน `getSession()`)

## 7. หน้าจอ `/purchase-order`
- [x] 7.1 โครงหน้า 2 คอลัมน์เหมือน `/quotation`: ฟอร์มซ้าย + preview กระดาษ
      A4 ขวา (`id="po-sheet"` เป็นต้น) — โหมดดู (`?id=` ที่บันทึกแล้ว) ขยาย
      preview เต็มความกว้างแทนเพราะไม่มีฟอร์มให้แก้
- [x] 7.2 เลือกซัพพลายเออร์ด้วย `SearchableDropdown` ต่อ `/api/suppliers` —
      เลือกแล้วเติมชื่อ/ที่อยู่/เลขผู้เสียภาษี/ผู้ติดต่อ/เบอร์โทร ลงในฟอร์ม
- [x] 7.3 ตารางรายการ: **ปรับ scope จากแผนเดิม** — พิมพ์ชื่อรายการเองเท่านั้น
      (ไม่มี `SearchableDropdown` เลือกจาก `/api/products`) เพราะของที่ซื้อ
      จากซัพพลายเออร์ส่วนใหญ่ไม่ใช่สินค้าในแคตตาล็อกของบริษัทเองอยู่แล้ว
      (วัสดุสิ้นเปลือง ชิ้นส่วนอะไหล่ ฯลฯ) — จำนวน/หน่วย/ราคาต่อหน่วยใช้
      `NumberInput` แบบเดียวกับใบเสนอราคา, ลบ/เพิ่มแถวได้ครบ
- [x] 7.4 หัวเอกสาร: โลโก้ + ข้อมูลบริษัทเรา (hardcode ชื่อ/ที่อยู่ + ช่องกรอก
      เลขผู้เสียภาษีอิสระต่อใบ) คู่กับข้อมูลซัพพลายเออร์, เลขที่ PO (มินต์
      อัตโนมัติ, แก้ปะทะเลขซ้ำด้วย `handleDocNoConflict` แบบเดียวกับใบเสนอ
      ราคา), วันที่ออก, วันที่ต้องการรับสินค้า
- [x] 7.5 ท้ายเอกสาร: ส่วนลด/ยอดก่อนภาษี/VAT 7%/ยอดสุทธิ, เงื่อนไขการชำระเงิน,
      เงื่อนไขการส่งมอบ, หมายเหตุ, ช่องลงนาม 3 ช่อง (ผู้สั่งซื้อ/ผู้อนุมัติ/
      ผู้ขาย)
- [x] 7.6 ปุ่ม "ดาวน์โหลด PDF" — client-side html2canvas-pro + jspdf, แบ่งหน้า
      A4 พอร์ตอัลกอริทึมเดียวกับ `generatePdf()` ของใบเสนอราคา (เปลี่ยนแค่
      element id เป็น `po-*`)
- [x] 7.7 ปุ่ม "ดาวน์โหลด Excel" — `downloadExcel()` จาก
      `app/lib/xlsxExport.ts` เดิม (ไม่แก้ไฟล์นั้น) ส่ง 2 ชีท ตามแผน
- [x] 7.8 `?id=` เปิดดู PO ที่เคยออก — เข้าโหมดอ่านอย่างเดียวเสมอ (ไม่มีฟอร์ม
      ให้แก้เลย ไม่ใช่แค่ตอน `cancelledAt`/`supersededById` ไม่ว่าง — ตรงกับ
      กติกา "ห้ามแก้ไขในที่" ของทั้งระบบ) — **ตัด `?view=1` ออกจากแผนเดิม**
      เพราะการเปิดผ่าน `?id=` เป็นโหมดดูเสมออยู่แล้ว ไม่มีโหมด "แก้ไขในที่"
      ให้ต้องแยกพารามิเตอร์
- [x] 7.9 ปุ่ม "ยกเลิกใบนี้" (cancel, มี `ConfirmDialog` ยืนยันก่อน) และ
      "ออกใบใหม่แทนใบนี้" (supersede, เปิดฟอร์มใหม่พร้อมข้อมูลเดิม เลขใหม่
      ทั้งใบ) — ทั้งสองปุ่มหายไปเองเมื่อ PO ถูกจัดการไปแล้ว (cancelled/
      superseded)
- [x] 7.10 list + ช่องค้นหา PO ล่าสุดในหน้าเดียวกัน (เลขที่/ผู้ขาย, กรองฝั่ง
      client) คลิกแถวเพื่อเปิดดู

## 7b. การเข้าถึงหน้า (พบระหว่างเทสต์จริงบน dev server — ไม่ได้ระบุไว้ในแผนเดิม)
- [x] 7b.1 เพิ่ม `/purchase-order`, `/purchase-order/:path*` ใน
      `middleware.ts`'s matcher — ไม่งั้นหน้านี้พึ่งแค่ client-side auth guard
      อย่างเดียว ต่างจากทุกหน้า admin อื่นที่มี middleware กันไว้ที่ edge ด้วย
- [x] 7b.2 เพิ่ม `/purchase-order` ใน `app/robots.ts`'s disallow list —
      `__tests__/robots.test.ts` เทียบสองลิสต์นี้ตรงๆ (กันบั๊กเดิมที่ `/crm`/
      `/expenses` เคยถูก middleware กันแต่ไม่ถูก robots disallow เลยยัง
      crawlable) จับได้ทันทีที่ลืมเพิ่ม
- [x] 7b.3 เพิ่ม `/purchase-order` ใน `GlobalAdminBell.tsx`'s
      `ADMIN_PATH_PREFIXES` — ไม่งั้นกระดิ่งแจ้งเตือนลอยไม่ขึ้นในหน้านี้ทั้งที่
      เป็นหน้า admin
- [x] 7b.4 เพิ่มการ์ดลิงก์ "ใบสั่งซื้อ (Purchase Order)" ใน
      `app/adminpanel/DashboardActions.tsx` — ไม่งั้นหน้านี้เข้าถึงได้แค่พิมพ์
      URL ตรงๆ เท่านั้น ไม่มีทางกดเข้าจากที่ไหนในระบบเลย

## 8. เอกสาร
- [x] 8.1 `specs/purchase-order/spec.md` ในการเปลี่ยนนี้ — ADDED Requirements
      ครบตาม proposal
- [x] 8.2 `openspec validate add-purchase-order --strict` ผ่าน

## 9. Verify
- [x] 9.1 `npx tsc --noEmit` สะอาด
- [x] 9.2 `npx vitest run` ผ่านทั้งชุด (146 ไฟล์ / 3062 เทสต์)
- [x] 9.3 ตรวจสอบบน dev server จริง: `/purchase-order` แบบไม่ login เด้งไป
      `/login` (307) เหมือนหน้า admin อื่นทุกหน้า, `/suppliers` ยังทำงาน
      ปกติหลังเพิ่มฟิลด์ใหม่
