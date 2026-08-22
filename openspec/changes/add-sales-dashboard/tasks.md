# Tasks: Sales Dashboard

## Phase 1 — Database & Store
- [ ] เพิ่มตาราง `sales_records` ใน `app/lib/db.ts` + bump SCHEMA_VERSION
- [ ] สร้าง `app/lib/salesDashboardStore.ts`
  - [ ] CRUD: addSalesRecord, updateSalesRecord, deleteSalesRecord, getSalesRecord, listSalesRecords
  - [ ] Aggregate queries: revenueByMonth, revenueByQuarter, revenueByYear
  - [ ] Top products query (by revenue + qty)
  - [ ] Top customers query (by revenue)
  - [ ] Salesperson leaderboard query
  - [ ] Smart insights queries (trend detection, churn risk, cross-sell)
- [ ] Unit tests สำหรับ store functions

## Phase 2 — API Routes
- [ ] `GET /api/admin/dashboard` — aggregated stats สำหรับ overview cards + charts
- [ ] `GET /api/admin/sales` — list sales records (filterable by date, salesperson, category, customer)
- [ ] `POST /api/admin/sales` — create sales record (validate + sanitize)
- [ ] `PUT /api/admin/sales/[id]` — update
- [ ] `DELETE /api/admin/sales/[id]` — delete
- [ ] เพิ่ม `/dashboard` ใน middleware.ts matcher
- [ ] เพิ่ม `/dashboard` ใน robots.ts disallow
- [ ] Unit tests สำหรับ API routes

## Phase 3 — UI Dashboard Page
- [ ] ติดตั้ง `recharts` dependency
- [ ] สร้าง `/app/dashboard/page.tsx` (admin-only)
  - [ ] Overview Cards (6 ช่อง + เทียบเดือนก่อน)
  - [ ] Revenue Charts (Bar monthly, Pie by category, Line cumulative)
  - [ ] Smart Insights Cards
  - [ ] Top Products table
  - [ ] Top Customers table
  - [ ] Salesperson Leaderboard
  - [ ] Date range picker + filters
  - [ ] Export Excel
- [ ] เพิ่มลิงก์ Dashboard ใน Navbar (admin only)

## Phase 4 — Sales Record Entry
- [ ] สร้าง modal/form สำหรับเพิ่ม Sales Record
  - [ ] เลือกเซลล์ (SearchableDropdown)
  - [ ] เลือกลูกค้า/บริษัท (SearchableDropdown)
  - [ ] เลือกสินค้า (SearchableDropdown)
  - [ ] กรอก qty, unitPrice, saleDate, note
  - [ ] Link กับ equipment (ถ้ามี)
- [ ] ปุ่มเพิ่ม Sales Record จาก EquipmentTab (optional shortcut)

## Phase 5 — Polish & Testing
- [ ] Skeleton loading states สำหรับ charts + tables
- [ ] Responsive design (mobile)
- [ ] E2E verification
- [ ] Final adversarial review
