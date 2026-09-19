# Proposal: Sales Dashboard — วิเคราะห์ยอดขาย

## Why
ทีมขายไม่มีข้อมูลสรุปว่า ยอดขายรายเดือน/ไตรมาส/ปีเท่าไร ลูกค้ารายไหนซื้อเยอะ
เซลล์คนไหนปิดยอดได้ดี สินค้าหมวดไหนขายดี — ข้อมูลทั้งหมดอยู่ในความจำ/Excel
แยก ไม่มี single source of truth ทำให้ไม่สามารถวิเคราะห์แนวโน้มหรือตัดสินใจ
เชิงกลยุทธ์ได้

ข้อมูลที่มีอยู่ (quotations, billing_documents) **ถูกลบอัตโนมัติทุก 30 วัน**
จึงไม่สามารถใช้ดูยอดขายย้อนหลังได้ ต้องมี table ถาวรสำหรับบันทึกยอดขาย

## What Changes

### Database
- ตารางใหม่ `sales_records` — เก็บยอดขายที่ปิดแล้ว (normalized, ถาวร, indexed)
  ```
  id, salespersonId, customerId, companyId, productId, productName,
  categoryId, qty, unitPrice, totalAmount, saleDate, quotationId?,
  billingId?, equipmentId?, note, createdAt
  ```
- Bump `SCHEMA_VERSION` ใน `app/lib/db.ts`

### Store
- `app/lib/salesDashboardStore.ts` — CRUD sales_records + aggregate queries:
  - revenue by month/quarter/year
  - top products, top customers, salesperson leaderboard
  - smart insights (rule-based)

### API (ทุกเส้น requireAuth)
- `GET /api/admin/dashboard` — aggregated stats (cards, charts data)
- `GET /api/admin/sales` — list sales records (paginated, filterable)
- `POST /api/admin/sales` — บันทึกยอดขาย
- `PUT /api/admin/sales/[id]` — แก้ไข
- `DELETE /api/admin/sales/[id]` — ลบ

### UI (admin-only, middleware-gated)
- `/dashboard` — หน้า Dashboard หลัก (1 หน้า scrollable):
  1. **Overview Cards** — ยอดขายเดือน, จำนวนดีล, ลูกค้าใหม่, conversion rate,
     เครื่องใกล้หมดประกัน + เทียบเดือนก่อน (↑↓%)
  2. **Revenue Charts** — กราฟแท่งรายเดือน/ไตรมาส/ปี, กราฟวงกลมสัดส่วนหมวด,
     กราฟเส้น cumulative YTD
  3. **Smart Insights** — rule-based cards เช่น "ยอดตกต่อเนื่อง 3 เดือน",
     "ลูกค้า X ไม่ซื้อมา 6 เดือน", "cross-sell opportunity"
  4. **Product Analysis** — Top 10 สินค้า, สินค้าไม่เคยขาย, pricing trend
  5. **Customer Analysis** — Top ลูกค้า, repeat rate, ตามจังหวัด
  6. **Salesperson Leaderboard** — สัดส่วน %, convert rate, trend
  7. **Filters & Export** — date range, filter by เซลล์/หมวด/ลูกค้า,
     export Excel, print view
- `/dashboard` section ใน EquipmentTab — ปุ่มเพิ่ม sales record ตอนเพิ่มอุปกรณ์

### Dependencies
- `recharts` — กราฟ (Bar, Line, Pie) — lightweight, React-native

## Constraints
- **Admin-only ทุกจุด** — middleware + requireAuth
- **ข้อมูลจาก `sales_records` เท่านั้น** — ไม่พึ่ง quotations/billing (ถูกลบ 30 วัน)
- **ไม่เก็บต้นทุน/margin** (ยังไม่ต้องการ) — ดูแค่ revenue
- **Rule-based insights** ไม่ใช้ AI API — คำนวณจาก SQL queries จริง

## Impact
- Affected specs: `sales-dashboard` (ใหม่)
- Affected code: `app/lib/db.ts` (schema bump), `app/lib/salesDashboardStore.ts`
  (ใหม่), `app/api/admin/dashboard/**` (ใหม่), `app/api/admin/sales/**` (ใหม่),
  `middleware.ts` (เพิ่ม `/dashboard`), `app/dashboard/page.tsx` (ใหม่),
  `app/robots.ts` (เพิ่ม disallow), `__tests__/**`
- ไม่กระทบหน้า public ใดๆ
