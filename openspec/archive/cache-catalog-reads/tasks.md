# Tasks: cache-catalog-reads

> **ไม่แก้ schema** — `SCHEMA_VERSION` ใน `app/lib/db.ts` ต้องอยู่ที่ **41** เท่าเดิม
> **ไม่แตะ `getAllContentsMeta`** — เป็นขอบเขตของ change ถัดไป (ต้องเพิ่ม
> `revalidateTag` ให้ `/api/contents/*` ก่อน)

## 1. เตรียม test ก่อนแก้โค้ด (ไม่งั้นจะพังแบบงงๆ)
- [x] 1.1 `__tests__/lib/productStore.test.ts` — เพิ่ม
      `vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }))`
      ตามแพทเทิร์นใน `__tests__/lib/getProductsData.test.ts:15`
- [x] 1.2 รันเทสต์เดิมให้ผ่านก่อน เพื่อยืนยันว่า mock ไม่ได้ทำให้พฤติกรรมเดิมเพี้ยน
      (69 เทสต์ผ่านครบก่อนแตะโค้ดจริง)

## 2. ห่อแคช
- [x] 2.1 `app/lib/productStore.ts` — แยกตัว fetch จริงออกมา แล้วห่อ
      `getAllProducts` ด้วย `unstable_cache(fn, ["products_all"],
      { tags: ["products"], revalidate: 300 })` โดย **คง `cache()` ของ React ไว้ชั้นนอก**
- [x] 2.2 ห่อ `getAllCategories` แบบเดียวกันด้วย key `["categories_all"]`
      (ของเดิมไม่มี `cache()` ของ React เลย — เพิ่มให้ด้วยเพื่อ dedupe ใน request)
- [x] 2.3 ตรวจว่า cache key ไม่ชนกับ `["products_data"]` ที่
      `app/lib/getProductsData.ts:36` ใช้อยู่ (มีเทสต์บังคับไว้ที่ 3.2)
- [x] 2.4 คอมเมนต์สั้นๆ ตรงจุดที่ห่อว่า **ทำไม** ใช้ tag `"products"` ตัวเดิม
      (mutation 10 จุดล้าง tag นี้อยู่แล้ว) — ไม่ใช่อธิบายว่าโค้ดทำอะไร

## 3. เทสต์พฤติกรรมแคช
> อยู่ใน `__tests__/catalogCacheInvalidation.test.ts` — ดักที่ค่าที่ส่งให้
> `unstable_cache` จริงตอนโหลดโมดูล ไม่ใช่เขียนค่าที่คาดหวังซ้ำไว้เอง
- [x] 3.1 เทสต์ว่า `getAllProducts` / `getAllCategories` ถูกลงทะเบียนด้วย tag
      `"products"` — ถ้า tag เพี้ยน แอดมินจะแก้ของแล้วหน้าเว็บไม่อัปเดต ซึ่งเป็น
      ความเสียหายที่มองไม่เห็นจนกว่าลูกค้าจะทัก
- [x] 3.2 เทสต์ว่า cache key ของสองฟังก์ชันไม่ซ้ำกัน และไม่ซ้ำกับ `products_data`
- [x] 3.3 Regression: เทสต์เดิมทั้งหมดใน `productStore.test.ts` ยังผ่าน
      (รูปแบบข้อมูลที่คืนต้องไม่เปลี่ยน)
- [x] 3.4 เพิ่มเทสต์ว่ามี `revalidate` (TTL) จริง ตามที่ proposal ตัดสินใจไว้

## 4. ยืนยันว่า invalidation ยังครบ
- [x] 4.1 เขียนเทสต์ที่เทียบ **รายการ route ที่แก้สินค้า/หมวดหมู่** กับ
      **การเรียก `revalidateTag("products")`** — แบบเดียวกับที่
      `__tests__/robots.test.ts` เทียบ robots กับ middleware matcher
      เพื่อให้ route ใหม่ในอนาคตที่ลืมล้าง tag ถูกจับได้ตรงนี้
      (อ่าน route จากดิสก์จริง → route ใหม่ถูกคุ้มครองอัตโนมัติ)
- [x] 4.1b พิสูจน์ว่าเทสต์ทั้งสองจับของจริง: ลองแก้ tag ให้ผิด + ลบ
      `revalidateTag` ออกจาก 1 route → เทสต์ fail ทั้งคู่ตามคาด แล้วคืนค่ากลับ
- [x] 4.2 ยืนยันด้วยมือ: แก้ชื่อสินค้าในหน้าแอดมิน → เปิดหน้า `/showcase/[id]`
      ที่ผูกกับสินค้านั้น → เห็นชื่อใหม่ **ทันที** ไม่ต้องรอ 5 นาที ✓
- [x] 4.3 ยืนยันด้วยมือ: ซ่อนสินค้า (unpublish) → หน้า showcase ของ content
      ที่ผูกอยู่ต้อง 404 สำหรับคนที่ไม่ได้ login ทันที ✓

## 5. ตรวจขั้นสุดท้าย
- [x] 5.1 `npx tsc --noEmit` สะอาด
- [x] 5.2 `npx vitest run` ผ่านทั้งชุด (148 ไฟล์ / 3066 เทสต์)
- [x] 5.3 ยืนยันว่า `SCHEMA_VERSION` ยังเป็น 41 และ `app/lib/db.ts` ไม่ถูกแตะ
- [x] 5.4 `openspec validate` — ไม่มี CLI ติดตั้งในเครื่องนี้ ข้ามไป
      (โครงสร้างไฟล์ทำตามแพทเทิร์นเดียวกับ change เดิมในโปรเจกต์)
