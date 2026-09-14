# Tasks: rename-adminpanel-unblock-content

## 1. ย้ายหน้า Admin Panel
- [x] 1.1 สร้าง `app/adminpanel/page.tsx` (ย้ายเนื้อหา hub จาก
      `app/showcase/page.tsx`) + ย้าย `DashboardActions.tsx` ไป
      `app/adminpanel/` — ใส่ `robots: { index: false, follow: false }`
- [x] 1.2 ลบ `app/showcase/page.tsx` และ `app/showcase/loading.tsx`
      (skeleton ของ list เก่า; `[id]` มี loading ของตัวเองอยู่แล้ว)
- [x] 1.3 เพิ่ม redirect `/showcase` → `/adminpanel` ใน `next.config.ts`
      (เฉพาะ path ตรงตัว — ห้ามครอบ `/showcase/:id`)

## 2. Auth gating
- [x] 2.1 middleware matcher: เอา `'/showcase'`, `'/showcase/:path*'` ออก
      แล้วเพิ่ม `'/adminpanel'`, `'/adminpanel/:path*'`
- [x] 2.2 ยืนยันว่า API mutation ของ contents ยังมี requireAuth ครบ
      (หน้า public เปิดได้แต่แก้ไม่ได้)

## 3. อัปเดตลิงก์ "/showcase" → "/adminpanel"
- [x] 3.1 `app/login/page.tsx` (2 จุด: redirect หลัง login)
- [x] 3.2 `app/components/Footer.tsx` (ลิงก์ Content เมื่อ isLoggedIn)
- [x] 3.3 ปุ่มกลับ/ลิงก์ในหน้า admin: quotation, billing, billing/saved,
      settings, customers, suppliers, product-specs, documents
      (DocumentListClient), dashboard, create-content, document/[id]
- [x] 3.4 `app/showcase/[id]/ShowcaseClient.tsx` (3 จุด — ล้วนอยู่หลัง
      isLoggedIn อยู่แล้ว)
- [x] 3.5 `app/not-found.tsx`: เปลี่ยนปุ่ม "ดูเนื้อหาทั้งหมด" → `/catalog`
      "ดูแคตตาล็อกสินค้า" (หน้า public ห้ามชี้หน้าแอดมิน)

## 4. SEO consistency
- [x] 4.1 `app/robots.ts`: `"/showcase$"` → `"/adminpanel"`
- [x] 4.2 Breadcrumb JSON-LD ใน `app/showcase/[id]/page.tsx`: ตัด item
      `/showcase` เหลือ Home › ชื่อเนื้อหา
- [x] 4.3 sitemap: ไม่แก้ (ถูกต้องอยู่แล้ว)

## 5. Verify
- [x] 5.1 tsc + vitest เขียว; อัปเดตเทสที่อ้าง path เก่า (ถ้ามี)
- [x] 5.2 หลัง deploy: `/adminpanel` → 307 login · `/showcase` → redirect →
      login · `/showcase/{id}` → **200 public** · `/showcase/product/{pid}`
      → 307 ไป `/showcase/{id}` (ไม่ใช่ login)
