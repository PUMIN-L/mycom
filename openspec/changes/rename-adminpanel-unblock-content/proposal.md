# Proposal: ย้าย Admin Panel ไป /adminpanel และปลดล็อกหน้าเนื้อหา /showcase/{id} ให้ public

## Why
ตอนนี้ URL `/showcase` เป็นหน้า "ระบบจัดการ (Admin Panel)" — ชื่อ URL ไม่สื่อว่าเป็น
หน้าแอดมิน และที่แย่กว่านั้น middleware ปัจจุบัน gate ทั้ง `/showcase` **และ**
`/showcase/:path*` ทำให้หน้าเนื้อหาสินค้า `/showcase/{id}` ที่ต้องเป็น **public**
(ลูกค้ากด "ดูรายละเอียด" จากหน้าแรก, อยู่ใน sitemap, มี Article JSON-LD)
**โดนบังคับ login ไปด้วย** — ยืนยันบน production แล้ว:
`/showcase/1783184955559` → 307 → `/login` ผลคือลูกค้าดูเนื้อหาเครื่องไม่ได้เลย
และ Google crawl ตาม sitemap แล้วเจอ redirect → หน้าไม่ถูก index

## What Changes
- **ย้ายหน้า Admin Panel**: `/showcase` (หน้า hub ปุ่มระบบจัดการ) → `/adminpanel`
  — ยังต้อง login เหมือนเดิม (middleware gate + robots disallow + meta noindex)
- **ปลดล็อกหน้าเนื้อหา**: เอา `/showcase`, `/showcase/:path*` ออกจาก middleware
  matcher → `/showcase/{id}` และ `/showcase/product/{productId}` กลับมาเปิดดูได้
  โดยไม่ต้อง login (ตามที่ตั้งใจไว้แต่แรก)
- **Redirect** `/showcase` (เฉพาะ path ตรงตัว) → `/adminpanel` ใน next.config
  กัน bookmark เก่าของแอดมิน
- **อัปเดตลิงก์ทุกจุด** ที่ชี้ "/showcase" (~20 จุด: login redirect, Footer,
  ปุ่มกลับใน billing/quotation/settings/customers/suppliers/product-specs/
  documents/dashboard/create-content, ปุ่ม admin ใน ShowcaseClient) →
  "/adminpanel" — ยกเว้น `not-found.tsx` ซึ่งเป็นหน้า public ให้เปลี่ยนไปชี้
  `/catalog` แทน (หน้า 404 สาธารณะไม่ควรพาไปหน้าแอดมิน)
- **robots.ts**: เปลี่ยน `"/showcase$"` → `"/adminpanel"` (เลิกบล็อก /showcase
  ทุกแบบ — หน้าเนื้อหาถูก crawl ได้เต็มที่)
- **Breadcrumb JSON-LD** ใน `/showcase/[id]`: ตัด item กลางที่ชี้ `/showcase`
  (ซึ่งกลายเป็น admin URL) เหลือ Home › ชื่อเนื้อหา
- sitemap ไม่ต้องแก้ (list เฉพาะ `/showcase/{id}` อยู่แล้ว ถูกต้อง)

## Impact
- Affected code: `app/adminpanel/**` (ใหม่ — ย้ายจาก `app/showcase/page.tsx` +
  `DashboardActions.tsx`), `middleware.ts`, `next.config.ts` (redirect),
  `app/robots.ts`, `app/showcase/[id]/page.tsx` (breadcrumb),
  ลิงก์ในหน้า admin ~12 ไฟล์, `app/not-found.tsx`
- ผล SEO เชิงบวก: หน้าเนื้อหาที่ sitemap ประกาศไว้กลับมา index ได้จริง
- ผลลูกค้า: ปุ่ม "ดูรายละเอียด" จากหน้าแรกกลับมาใช้งานได้โดยไม่เจอหน้า login
