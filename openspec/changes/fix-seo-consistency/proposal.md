# Proposal: แก้ปัญหา SEO/structured-data ที่ตกค้าง

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31), มิติ public-seo

## Why
พบ 3 จุดที่กระทบความน่าเชื่อถือของเว็บต่อ Google และผู้ใช้จริง — JSON-LD ที่ผิด
มาตรฐานจน Search Console ฟ้อง error ทุกหน้า, ลิงก์แผนที่ที่ชี้ผิดสถานที่โดยสิ้นเชิง
(ส่งลูกค้าไปผิดที่จริงๆ), และ robots.txt ที่ตกหล่นไม่ครอบคลุม path แอดมินใหม่

## What Changes

1. **Product JSON-LD ไม่มี offers/review/aggregateRating** —
   `app/components/ProductsJsonLd.tsx:151-168` ส่ง Product entity แบบเต็ม
   (name/description/image/url) แต่ขาด 1 ใน 3 ฟิลด์ที่ Google บังคับให้มี
   อย่างน้อยหนึ่งอย่าง — Search Console's "Product snippets" จะฟ้อง error
   "Either 'offers', 'review', or 'aggregateRating' should be specified"
   ทุกสินค้าที่แสดงบนหน้าแรก

2. **ลิงก์ Google Maps ในหน้า Contact ชี้ผิดสถานที่โดยสิ้นเชิง** —
   `app/components/Contact.tsx:160-166` ทั้งลิงก์ "เปิดใน Google Maps" และ
   iframe embed ชี้ไปที่ "The Mall Lifestore Ngamwongwan" ซึ่งเป็นคนละที่กับ
   ที่อยู่จริงที่แสดงข้างๆ กัน (93 ซอยงามวงศ์วาน 6 แยก 19) — ดูเหมือนเป็น
   placeholder ที่ลืมเปลี่ยน ลูกค้าที่กด "นำทาง" จะไปผิดที่จริงๆ

3. **`robots.ts` ไม่ครอบ path แอดมินใหม่** — `/crm` และ `/expenses` ถูก gate
   ด้วย middleware แล้ว แต่ไม่ได้อยู่ใน disallow list ของ `robots.ts` (ตรวจสอบ
   บน production แล้ว: `robots.txt` ไม่มี rule สำหรับ path เหล่านี้จริง)

## Impact
- Affected code: `app/components/ProductsJsonLd.tsx`, `app/components/Contact.tsx`,
  `app/robots.ts`
- Affected specs: `seo-consistency` (ใหม่)
- ข้อ 2 (Google Maps ผิดที่) ควรแก้เร่งด่วนที่สุดในกลุ่มนี้ — กระทบลูกค้าจริงที่
  พยายามหาที่ตั้งบริษัท ไม่ใช่แค่ปัญหาทางเทคนิค
