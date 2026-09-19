# Tasks: cache-content-meta

> **เลือกทางเลือก A แล้ว** — ใช้ tag `"products"` ตัวเดิม เส้นทางที่ 5 (cascade
> ตอน hard delete สินค้า) จึงถูกครอบคลุมอัตโนมัติ ไม่ต้องแก้
> **ไม่แก้ schema** — `SCHEMA_VERSION` ยังเป็น **41** และ `app/lib/db.ts` ไม่ถูกแตะ

## 1. เตรียม test ก่อนแตะโค้ดจริง

- [x] 1.1 `__tests__/lib/contentStore.test.ts` — เพิ่ม
      `vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }))`
- [x] 1.2 รันเทสต์เดิมผ่านก่อน (38 เทสต์) ยืนยันว่า mock ไม่ทำพฤติกรรมเดิมเพี้ยน

## 2. เพิ่ม invalidation ให้ครบ **ก่อน** ห่อแคช

- [x] 2.1 `POST /api/contents` — `addContent`
- [x] 2.2 `PUT /api/contents/[id]` — `updateContent` (วางหลัง guard 404 จึงล้าง
      เฉพาะตอนสำเร็จจริง)
- [x] 2.3 `DELETE /api/contents/[id]` — `deleteContent`
- [x] 2.4 `PUT /api/revisions/[id]/restore` → `case "content"` — จุดที่มองข้ามง่ายสุด
- [x] 2.5 `DELETE /api/products/[id]` hard-delete — **ไม่ต้องแก้** (ทางเลือก A:
      ล้าง `"products"` อยู่แล้ว ครอบคลุม cascade ให้เอง)
- [x] 2.6 คอมเมนต์ที่จุดห่อแคชอธิบายว่าทำไม tag ถึงใช้ร่วมกัน

## 3. ห่อแคช

- [x] 3.1 `getAllContentsMeta` → `unstable_cache(fn, ["contents_meta"],
    { tags: ["products"], revalidate: 300 })` คง `cache()` ของ React ชั้นนอก
- [x] 3.2 key ไม่ชนกับ `products_all` / `categories_all` / `products_data` /
      `company_info` (มีเทสต์บังคับ)
- [x] 3.3 ลบคอมเมนต์เก่าที่ตกยุคออก (ยังเขียนว่า "reads blocks to count them"
      ทั้งที่ commit 5b0f220 เอาออกไปแล้ว)

## 4. เทสต์ — พิสูจน์แล้วว่าจับของจริง

- [x] 4.1 `getAllContentsMeta` ลงทะเบียนด้วย tag ถูก + key ไม่ซ้ำ + มี TTL
- [x] 4.2 เทสต์สแกน **ทั้ง `app/api`** (ไม่ใช่แค่โฟลเดอร์เดียว) และ **หารายชื่อ
      ฟังก์ชันเขียนเองจากไฟล์ store** → ฟังก์ชันเขียนที่เพิ่มใหม่ในอนาคตถูก
      คุ้มครองโดยไม่ต้องแก้เทสต์
- [x] 4.3 พิสูจน์ว่า fail จริง: ลบ `revalidateTag` ออกจาก `POST /api/contents`
      → file-level scan จับได้พร้อมชื่อไฟล์
- [x] 4.4 **พบจุดบอดระหว่างทาง แล้วอุดแล้ว**: ลบ `revalidateTag` ของ
      `case "content"` ใน restore route → file-level scan **ผ่าน** (เพราะไฟล์ยังมี
      ของ `case "product"` อยู่) จึงเพิ่มเทสต์ระดับ branch แยกต่างหาก แล้วพิสูจน์
      ซ้ำว่าจับได้พร้อมระบุชื่อ branch
- [x] 4.5 Regression: `contentStore.test.ts` เดิมผ่านครบ

## 5. ตรวจว่าไม่ทำของเดิมพัง

- [x] 5.1 `__tests__/sitemap.test.ts` ยังผ่าน (เทสต์ที่กัน bug 404 จาก 5b0f220)
- [x] 5.2 `npx tsc --noEmit` สะอาด
- [x] 5.3 `npx vitest run` ผ่านทั้งชุด — **148 ไฟล์ / 3067 เทสต์**
- [x] 5.4 `npx next build` คอมไพล์ผ่าน ไม่มี error เรื่อง `unstable_cache`
      (พังที่ `/catalog` เพราะเครื่อง dev ไม่มี DB — จุดเดียวกับ baseline)
- [x] 5.5 `SCHEMA_VERSION` ยังเป็น 41 และ `app/lib/db.ts` ไม่ถูกแตะ
- [x] 5.6 **แก้เทสต์ที่สมมติฐานเปลี่ยน**: `revisions.test.ts` เคยยืนยันว่า
      restore content ต้อง **ไม่** ล้าง tag (ถูกต้องตอนที่ยังไม่มีแคช content)
      ตอนนี้ต้องล้าง — อัปเดตพร้อมคอมเมนต์อธิบายว่าทำไมถึงกลับด้าน

## 6. ยืนยันด้วยมือ (ต้องมี DB จริง — เทสต์แทนไม่ได้)

- [x] 6.1 แก้บทความในหน้าแอดมิน → เปิด `/showcase/[id]` → เห็นเนื้อหาใหม่ทันที ✓
- [x] 6.2 สร้างบทความใหม่ → เปิด `/sitemap.xml` → ต้องมี URL ใหม่โผล่ทันที ✓
- [x] 6.3 **สถานการณ์ความเสี่ยงหลัก**: hard delete สินค้าที่มี content ผูกอยู่ →
      เปิด `/sitemap.xml` → **ต้องไม่มี** `/showcase/{id}` ของ content ที่ถูกลบ ✓
- [x] 6.4 ~~กู้คืนบทความจากหน้า revisions~~ (ข้ามไป)
