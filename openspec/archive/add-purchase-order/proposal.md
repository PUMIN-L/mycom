# Proposal: ใบสั่งซื้อ (Purchase Order) — ฟีเจอร์ใหม่สำหรับ admin

## Why

ระบบหลังบ้าน (เฉพาะ admin ที่ login) ยังไม่มีฟังก์ชันออก **ใบสั่งซื้อ (PO)** ให้
ซัพพลายเออร์ — เอกสารที่บริษัทออกไปหาผู้ขายเพื่อสั่งซื้อสินค้า/บริการ คนละทิศ
ทางกับใบเสนอราคา (ที่บริษัทออกให้ *ลูกค้า*) ต้องการให้หน้าตาเป็นไปตามแบบฟอร์ม
PO มาตรฐานที่ใช้กันทั่วไปในประเทศไทย

โครงสร้างที่ใกล้เคียงที่สุดในระบบวันนี้คือใบเสนอราคา (`app/quotation/page.tsx`,
`quotationStore.ts`, `quotationNumber.ts`, `quotationTotals.ts`) — เอกสารธุรกิจ
ไทยที่มีหัวกระดาษ/ตารางรายการ/ยอดรวม+VAT/ช่องลงนามเหมือนกัน งานนี้จึงสร้าง
ฟีเจอร์ใหม่โดย **เดินตามโครงเดิมของใบเสนอราคาให้มากที่สุด** (เก็บเอกสารเป็น
JSON blob ต่อใบ, ใช้ระบบเลขที่เอกสารกลางเดียวกัน, พิมพ์ PDF ฝั่ง client ด้วย
html2canvas+jsPDF) แทนที่จะคิดกลไกใหม่

## จุดตัดสินใจสำคัญ (ตกลงกับเจ้าของระบบแล้วก่อนเขียนงานนี้)

1. **สถานะเอกสาร — ใช้กติกาแบบใบแจ้งหนี้ (เข้มงวด) ไม่ใช่แบบใบเสนอราคา
   (หลวม)** ใบเสนอราคาแก้ไขซ้ำในแถวเดิมได้เรื่อยๆ ไม่มีสถานะ แต่ PO คือคำสั่ง
   ซื้อที่ผูกพันกับซัพพลายเออร์แล้ว จึง **ห้ามแก้ไขในแถวเดิมหลังบันทึก** — จะ
   แก้ต้อง "ยกเลิก" ใบเดิม (`cancelledAt`) แล้วออกใบใหม่เลขใหม่ทั้งใบที่ผูกกลับ
   ไปยังใบเดิม (`supersededById`) เหมือนกลไกที่ `billing_documents` ใช้อยู่แล้ว
2. **ข้อมูลซัพพลายเออร์ไม่พอสำหรับพิมพ์บน PO** — ตาราง `suppliers` วันนี้มีแค่
   `companyName/contactName/phone/note` ไม่มีที่อยู่/เลขผู้เสียภาษี ซึ่ง PO
   มาตรฐานไทยต้องมี → เพิ่มคอลัมน์ `address`/`taxId` ในตาราง `suppliers` (ให้
   กรอกครั้งเดียวในหน้าจัดการซัพพลายเออร์ เลือกซัพพลายเออร์ตอนออก PO แล้วเติม
   อัตโนมัติ) **แต่ตัว PO เก็บสำเนาข้อมูลนี้ไว้ในเอกสารของตัวเองด้วย** แก้ไขได้
   อิสระตอนออกใบ (วิธีเดียวกับที่ใบเสนอราคาเก็บชื่อ/ที่อยู่/เบอร์ลูกค้าเป็น
   free text ในเอกสาร ไม่ join สดจากตารางลูกค้าทุกครั้ง) — เพื่อไม่ให้ PO เก่า
   เปลี่ยนหน้าตาไปตามซัพพลายเออร์ที่ถูกแก้ทีหลัง
3. **ข้อมูลบริษัทเรา (ผู้ซื้อ)** — วันนี้ใบเสนอราคาใช้ชื่อ/ที่อยู่บริษัท
   hardcode ไว้ในโค้ด (`COMPANY` const, `app/quotation/page.tsx`) ไม่มีเลขผู้
   เสียภาษีเก็บในฐานข้อมูลที่ไหนเลย (เป็นช่องกรอกอิสระต่อใบ) → PO **ใช้วิธี
   เดียวกันไปก่อน** (hardcode ชื่อ/ที่อยู่ + ให้ admin พิมพ์เลขผู้เสียภาษีเอง
   ต่อใบ) เพื่อไม่แตะระบบใบเสนอราคาที่ใช้งานจริงอยู่ในงานนี้ — การรวมเป็นค่า
   กลางถาวรถือเป็นงานแยกในอนาคต ไม่ใช่ scope ของงานนี้
4. **เลขที่เอกสาร** ใช้ระบบเลขกลางเดียวกับใบเสนอราคา/ใบแจ้งหนี้ (ตาราง
   `used_docnos` เดิม ที่ตั้งใจให้ทุกประเภทเอกสารใช้ร่วมกันอยู่แล้ว — คอลัมน์
   ชื่อ `quotationId` แต่จริงๆ เก็บ id ของเอกสารประเภทไหนก็ได้) รูปแบบ
   `PO<DDMMYY>-<ลำดับ>` ไม่มีรูปแบบ legacy (เอกสารประเภทใหม่ ไม่มีเลขเก่าต้อง
   รองรับ)
5. **`sales_records.poRef` ที่มีอยู่แล้ว คนละเรื่องกัน** — ฟิลด์นั้นคือเลข PO
   ของ *ลูกค้า* ที่อ้างอิงมาตอนซื้อของเรา (ลูกค้าพิมพ์เอง เป็น free text ไม่มี
   FK) งานนี้ไม่แตะฟิลด์นั้นเลย และ **ต้องไม่ปนกัน** — PO ที่สร้างในงานนี้คือ
   เอกสารที่ *เราออกไปหาซัพพลายเออร์*
6. **ดาวน์โหลดเป็น Excel ด้วย** (นอกเหนือจาก PDF) — ใบเสนอราคา (ต้นแบบที่ยึด
   อยู่) ไม่เคยมี Excel export เลย แต่เจ้าของระบบขอเพิ่มสำหรับ PO โดยเฉพาะ
   ระบบมี helper export Excel ฝั่ง client อยู่แล้ว (`app/lib/xlsxExport.ts`,
   `downloadExcel()`) ที่ใช้กับรายการข้อมูลแบบตาราง (รายชื่อลูกค้า/อุปกรณ์/
   รายงาน dashboard) — **ใช้ตัวเดิมนี้ ไม่สร้างกลไก export ใหม่** โดยส่ง 2
   ชีท: "ข้อมูลทั่วไป" (เลขที่ PO/วันที่/ซัพพลายเออร์/ผู้ซื้อ/เงื่อนไข/สรุปยอด
   เป็นคู่ label–value) และ "รายการสินค้า" (ตารางรายการเหมือนในเอกสาร) — ไม่
   แก้ไฟล์ `xlsxExport.ts` เลย เพราะ API เดิม (`ExcelSheet[]`) รองรับความ
   ต้องการนี้ได้อยู่แล้วโดยไม่ต้องเพิ่มความสามารถใหม่ (ไม่ทำ merged-cell
   layout เหมือนหน้า PDF เป๊ะๆ — Excel ที่ได้เน้นเอาไปใช้ต่อ เช่น import เข้า
   ระบบบัญชี/สต็อก มากกว่าเอาไว้พิมพ์)

## What Changes

### ฐานข้อมูล (bump `SCHEMA_VERSION` 40 → 41)
- ตารางใหม่ `purchase_orders`: `id VARCHAR(255) PK`, `docNo VARCHAR(255)`,
  `data JSON NOT NULL` (ทั้งเอกสาร รวม `items[]`), `supersededById VARCHAR(36)
  DEFAULT NULL`, `cancelledAt VARCHAR(255) DEFAULT NULL`, `createdAt
  VARCHAR(255) NOT NULL` + index บน `createdAt` และ `supersededById`
- `used_docnos` — ไม่เปลี่ยนโครงสร้าง ใช้ตารางเดิม เพิ่มแค่ prefix `"PO"` ใหม่
- ตาราง `suppliers` — เพิ่มคอลัมน์ `address TEXT DEFAULT NULL`, `taxId
  VARCHAR(255) DEFAULT NULL` (ผ่าน `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  ทีละคอลัมน์ ตามกติกาเดิมของไฟล์)

### Backend
- `app/lib/poNumber.ts` (ใหม่) — thin wrapper รอบ `nextDocNo`/`docNoPrefixes`
  ใน `quotationNumber.ts` (แบบเดียวกับ `billingNumber.ts`/
  `serviceJobNumber.ts`) `PO_DOCNO_PREFIX = "PO"`
- `app/lib/poTotals.ts` (ใหม่ หรือใช้ร่วมกับ `quotationTotals.ts` ถ้าฟังก์ชัน
  นั้น generic พอ — ตัดสินใจตอน implement) — ส่วนลดต่อรายการ → ส่วนลดรวมทั้งใบ
  → VAT 7% → ยอดสุทธิ ปัดเศษสตางค์แบบเดียวกับใบเสนอราคา
- `app/lib/poStore.ts` (ใหม่) — `createPurchaseOrder` (ผูก docNo ผ่าน
  `used_docnos` ในทรานแซกชันเดียว แบบเดียวกับ `saveQuotationAtomic`),
  `getPurchaseOrder`, `listPurchaseOrders`, `cancelPurchaseOrder` (ตั้ง
  `cancelledAt`), `supersedePurchaseOrder` (สร้างใบใหม่ + ตั้ง
  `supersededById` ของใบเก่า ในทรานแซกชันเดียว) — **ห้ามมีฟังก์ชันแก้ไขในแถว
  เดิมหลังสร้างแล้ว** ตามข้อ 1
- `app/lib/supplierStore.ts` — เพิ่ม `address`/`taxId` ใน `Supplier` +
  create/update
- Routes ใหม่ทั้งหมดผ่าน `requireAuth()`/`withRoute()` (admin login เท่านั้น
  ตามที่ระบบเดิมบังคับทุก route อยู่แล้ว):
  - `GET/POST /api/purchase-orders`
  - `GET /api/purchase-orders/[id]`
  - `POST /api/purchase-orders/[id]/cancel`
  - `POST /api/purchase-orders/[id]/supersede`
  - `GET /api/purchase-orders/docnos?base=...` (คนละ endpoint กับของใบเสนอ
    ราคา แต่ใช้ allocator logic เดียวกัน)

### หน้าจอ
- `app/purchase-order/page.tsx` (ใหม่) — โครงเดียวกับ `app/quotation/page.tsx`:
  ฟอร์มฝั่งซ้าย + preview กระดาษ A4 ฝั่งขวา, ปุ่ม "ดาวน์โหลด PDF" (client-side
  html2canvas+jsPDF) **และปุ่ม "ดาวน์โหลด Excel"** (`downloadExcel()` จาก
  `xlsxExport.ts` เดิม, 2 ชีท: ข้อมูลทั่วไป + รายการสินค้า — ดูข้อ 6),
  `?id=` สำหรับเปิดดู/โหลดใบเดิม (เข้าโหมดอ่านอย่างเดียวเสมอ — ไม่มีโหมด
  "แก้ไขในที่" ให้ต้องแยก `?view=1` ออกจากกัน), list + ช่องค้นหา PO ล่าสุดใน
  หน้าเดียวกัน
  - เลือกซัพพลายเออร์ด้วย `SearchableDropdown` (ผู้ใช้รายแรกของ dropdown นี้
    ต่อ `/api/suppliers` — ยังไม่เคยมีที่ไหนใช้) เลือกแล้วเติมชื่อ/ที่อยู่/
    เลขผู้เสียภาษี/ผู้ติดต่อ/เบอร์โทรอัตโนมัติ (แก้ต่อได้ ตามข้อ 2)
  - รายการสินค้าพิมพ์ชื่อเองทั้งหมด (**ไม่มี** `SearchableDropdown` เลือกจาก
    `/api/products` เหมือนใบเสนอราคา) — ของที่ซื้อจากซัพพลายเออร์ส่วนใหญ่ไม่ใช่
    สินค้าในแคตตาล็อกของบริษัทเองอยู่แล้ว (วัสดุสิ้นเปลือง ชิ้นส่วนอะไหล่ ฯลฯ)
    จึง trim ความสามารถนี้ออกจากแผนตอน implement
- `app/suppliers/page.tsx` — เพิ่มช่องกรอกที่อยู่/เลขผู้เสียภาษีใน
  ฟอร์มเพิ่ม/แก้ไขซัพพลายเออร์เดิม

### หน้าตาเอกสาร PO (ตามมาตรฐานที่ใช้กันในไทย)
- หัวกระดาษ: โลโก้ + ชื่อ/ที่อยู่/เลขผู้เสียภาษี **ฝั่งผู้ซื้อ (เรา)** คู่กับ
  ฝั่ง **ผู้ขาย/ซัพพลายเออร์**
- เลขที่ใบสั่งซื้อ, วันที่ออก, วันที่ต้องการรับสินค้า (กำหนดส่ง)
- ตารางรายการ: ลำดับ / รายละเอียดสินค้า-บริการ / จำนวน / หน่วย / ราคาต่อหน่วย
  / จำนวนเงิน
- ส่วนลด (ถ้ามี) → ยอดรวมก่อนภาษี → VAT 7% → **ยอดรวมสุทธิ** (ตัวหนังสือไทย
  กำกับจำนวนเงินด้วย เหมือนใบเสนอราคา)
- เงื่อนไขการชำระเงิน, เงื่อนไขการส่งมอบ, หมายเหตุ
- ช่องลงนาม 3 ช่อง: ผู้สั่งซื้อ, ผู้อนุมัติ, ผู้ขาย (รับทราบ/ตอบรับคำสั่งซื้อ)

## Impact

- Affected specs: `purchase-order` (capability ใหม่ทั้งหมด — ไม่มี spec เดิม
  ให้ modify)
- Affected code (จะเกิดขึ้นตอน implement งานนี้ — ยังไม่เขียนโค้ดในรอบนี้):
  - ใหม่: `app/lib/poNumber.ts`, `app/lib/poStore.ts`, `app/lib/poTotals.ts`
    (หรือ reuse `quotationTotals.ts`), `app/api/purchase-orders/**`,
    `app/purchase-order/page.tsx`
  - แก้: `app/lib/db.ts` (SCHEMA_VERSION 41 + ตารางใหม่ + คอลัมน์ใหม่บน
    `suppliers`), `app/lib/supplierStore.ts`, `app/lib/types.ts` (type
    `Supplier` เพิ่ม `address`/`taxId`, type ใหม่สำหรับ `PurchaseOrder`),
    `app/suppliers/page.tsx` (เพิ่มช่องกรอก)
  - การเข้าถึงหน้า (ทุกหน้า admin อื่นในระบบนี้มีครบทั้ง 4 จุดนี้ — พบว่า
    `/purchase-order` ขาดหมดตอนทดสอบจริงบน dev server): `middleware.ts`
    (เพิ่ม matcher), `app/robots.ts` (เพิ่ม disallow —
    `__tests__/robots.test.ts` เทียบกับ middleware ตรงๆ),
    `app/components/GlobalAdminBell.tsx` (เพิ่ม `ADMIN_PATH_PREFIXES`),
    `app/adminpanel/DashboardActions.tsx` (เพิ่มการ์ดลิงก์เข้าหน้านี้)
  - ใช้ซ้ำโดยไม่แก้: `app/lib/xlsxExport.ts` (`downloadExcel()`/`ExcelSheet`)
    — import มาใช้ตรงๆ
- ไม่กระทบ: `app/quotation/**`, `app/lib/quotationStore.ts`,
  `app/lib/billingStore.ts`, `sales_records.poRef` — ไม่แตะของเดิมเลย เอา
  แค่ pattern ไปใช้ซ้ำ (`quotationNumber.ts`'s generic allocator ถูก import
  ไปใช้ ไม่ได้แก้ไข)
