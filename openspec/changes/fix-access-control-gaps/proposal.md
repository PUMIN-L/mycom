# Proposal: ปิดช่องโหว่การเข้าถึง/มองเห็นข้อมูลที่ไม่ควรเปิด

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31), มิติ auth-surface + security + public-seo

## Why
พบช่องทางที่ข้อมูล/ทรัพยากรที่ควรถูกจำกัดสามารถเข้าถึงได้กว้างเกินตั้งใจ — ตั้งแต่
เนื้อหาที่ควรซ่อน (unpublished product) ไปจนถึงการยืมโดเมนของเราไปเสิร์ฟไฟล์ของ
คนอื่น และระบบ OTP ที่ป้องกันการลบข้อมูลสำคัญแต่เดายังไงก็ได้ไม่จำกัดครั้ง

## What Changes

1. **PDF proxy รับ URL จาก Cloudinary cloud ไหนก็ได้** —
   `app/api/documents/proxy/route.ts:9-19` เช็คแค่ hostname เป็น
   `res.cloudinary.com` แต่ Cloudinary เป็น multi-tenant (ทุกบัญชีใช้ hostname
   เดียวกัน แยกด้วย path `/<cloud_name>/...`) — ไม่ได้ pin path ให้ตรงกับ cloud
   ของแอปเราเอง ผลคือ endpoint ที่ไม่ต้อง login สามารถถูกใช้เป็น proxy ให้ไฟล์
   PDF ของ Cloudinary account ใดๆ ก็ได้ ภายใต้โดเมน profinlab.co.th (พร้อมบังคับ
   `Content-Disposition: attachment` — เสี่ยงถูกใช้หลอกดาวน์โหลดไฟล์อันตราย
   โดยอ้างชื่อโดเมนที่น่าเชื่อถือ)

2. **เนื้อหาที่ผูกกับสินค้า unpublished ยังอ่านได้แบบ public** —
   `GET /api/products` ตั้งใจซ่อนสินค้า `isPublished=false`/`pendingDeleteAt`
   จาก anonymous caller อยู่แล้ว (`app/api/products/route.ts:13-19`) แต่
   `GET /api/contents/all`, `GET /api/contents/by-product/[productId]`
   (`app/api/contents/[id]/route.ts:15-31`) และหน้า `/showcase/[id]`
   (RSC page — `app/showcase/[id]/page.tsx:74-79`) ไม่มี filter เดียวกัน —
   เนื้อหาเต็ม (title/desc/image) ของสินค้าที่ตั้งใจซ่อนไว้ยังหลุดออกไปทาง
   สองช่องทางนี้
   **พบเพิ่มระหว่างแก้ไข** (ไม่ได้ระบุใน adversarial review รอบแรก): (a)
   `app/showcase/product/[productId]/page.tsx` — gateway page ที่ resolve
   product → content แล้ว `redirect()` ทันทีโดยไม่เช็คสถานะสินค้าเลย ทำให้
   ยืนยันการมีอยู่ของ content ของสินค้าที่ซ่อนไว้ต่อ anonymous ได้, และ (b)
   `ShowcaseClient`'s `initialAllContents` prop (ใช้เช็คว่าสินค้าไหนมี content
   ผูกแล้วตอนแก้ไข) ก็ไม่ได้กรองเช่นกัน ทั้งสองจุดใช้ pattern การกรองเดียวกัน
   กับข้อ 2 จึงแก้พร้อมกัน

3. **OTP ที่ป้องกันการลบข้อมูลสำคัญไม่มี rate limit** — ทั้ง 3 จุดที่ใช้ OTP
   ยืนยันก่อนทำ action ทำลายข้อมูล (ลบ schedule ที่ completed แล้ว, เปลี่ยน
   อีเมลติดต่อ, ลบรูป orphan เป็นชุด) เทียบ code ด้วย `otp !== savedOtp` ตรงๆ
   ไม่มีตัวนับจำนวนครั้งที่ผิด ต่างจาก `/api/auth/login` ที่มี
   `FAILURE_LIMIT`/`BLOCK_MS` ชัดเจน — OTP 5-6 หลักเดาได้ภายในเวลาที่ code
   ยังไม่หมดอายุ

## Impact
- Affected code: `app/api/documents/proxy/route.ts`,
  `app/api/contents/[id]/route.ts`, `app/api/contents/by-product/[productId]/route.ts`,
  `app/showcase/[id]/page.tsx`, `app/lib/contentStore.ts`,
  `app/api/admin/schedules/[id]/route.ts`, `app/api/settings/contact-email/route.ts`,
  `app/api/cloudinary/orphans/route.ts`
- Affected specs: `access-control` (ใหม่)
- ข้อ 3 ต้องเก็บตัวนับใน DB (ตาราง `settings` หรือใหม่) ไม่ใช่ in-memory เพราะรันบน
  serverless หลาย instance
