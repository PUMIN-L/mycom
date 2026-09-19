# Proposal: แคชการอ่านแคตตาล็อก (สินค้า + หมวดหมู่) ข้าม request

## Why

`getAllProducts()` และ `getAllCategories()` อ่าน **ทั้งตาราง** ทุกครั้งที่ถูกเรียก

```
getAllProducts    → SELECT * FROM products ORDER BY categoryId, sortOrder, createdAt
                    (app/lib/productStore.ts:313-320)
getAllCategories  → SELECT * FROM product_categories ORDER BY sortOrder ASC
                    (app/lib/productStore.ts:32-37)
```

`getAllProducts` ห่อด้วย `cache()` ของ React ซึ่ง **dedupe ได้แค่ภายใน request
เดียวกัน** ข้าม request คือคิวรีใหม่เสมอ ส่วน `getAllCategories` ไม่มีอะไรห่อเลย

### ใครเรียกบ้าง

| ผู้เรียก | ความถี่ |
|---|---|
| `app/showcase/[id]/page.tsx:94-101` | **ทุกครั้งที่มีคนเปิดหน้าบทความ** (หน้าเป็น `force-dynamic`) |
| `app/sitemap.ts` | ทุกครั้งที่ Google หรือเครื่องมือใดๆ ดึง sitemap (`force-dynamic`) |
| `app/lib/getProductsData.ts` | หน้าแรก — **แคชอยู่แล้ว** ไม่ใช่ปัญหา |
| `app/api/products/route.ts`, `app/api/products/categories/route.ts` | แอดมินเปิดหน้ารายการ |
| `app/api/contents/[id]/route.ts`, `app/api/revisions/[id]/restore/route.ts` | งานแอดมิน |

### ผลที่เกิดขึ้นจริง

คนเปิดอ่านบทความสินค้า **1 ชิ้น** แต่ระบบดึงสินค้า **ทั้งร้าน** มาด้วยทุกครั้ง
ถ้ามีคนเปิดหน้า showcase 300 ครั้งระหว่างที่แอดมินไม่ได้แตะสินค้าเลย = ยิง
`SELECT * FROM products` 300 ครั้ง + `SELECT * FROM product_categories` 300 ครั้ง
ได้ผลลัพธ์เหมือนกันเป๊ะทั้ง 300 ครั้ง

กระทบ TTFB ของหน้าสาธารณะที่ต้องไปขึ้นอันดับ Google (Core Web Vitals) และเปลือง
โควตา DB (TiDB Cloud คิดตามการใช้งาน)

### ทำไมถึงทำได้โดยไม่ต้องรื้อหน้า

หน้า showcase จำเป็นต้องเป็น `force-dynamic` จริง เพราะต้องรู้ว่าคนเปิดเป็นแอดมิน
หรือไม่ (`getSession()`) เพื่อซ่อนสินค้าที่ยังไม่ published — **แต่ตัวข้อมูลดิบที่
ดึงมาเหมือนกันทุกคน** ความต่างอยู่ที่ขั้นตอน *กรอง* หลังดึงเสร็จ
(`session ? products : products.filter(isProductPublic)` —
`app/showcase/[id]/page.tsx:114`) ดังนั้นหน้ายังคง dynamic ได้ตามเดิม ส่วน
การอ่าน DB ย้ายไปนั่งบนแคชได้เลย

## What Changes

ห่อ `getAllProducts` และ `getAllCategories` ด้วย `unstable_cache` ของ Next.js
ตามแพทเทิร์นเดียวกับที่ `app/lib/getProductsData.ts:35-37` ใช้อยู่แล้ว โดย
**ใช้ tag `"products"` ตัวเดิม**

```ts
export const getAllProducts = cache(
  unstable_cache(fetchAllProducts, ["products_all"], {
    tags: ["products"],
    revalidate: 300,
  })
);
```

- **cache key แยกกันคนละตัว** (`["products_all"]`, `["categories_all"]`) ห้ามชนกับ
  `["products_data"]` ที่ `getProductsData` ใช้อยู่ เพราะ shape ข้อมูลคนละแบบ
- **คง `cache()` ของ React ไว้ชั้นนอก** — ยัง dedupe ภายใน request เดิมได้ฟรี
- **ซ้อนกับแคชของ `getProductsData` โดยตั้งใจ** ไม่ใช่ความผิดพลาด: แคชชั้นในจะ
  รับหน้าที่ตอนแคชชั้นนอกพลาด ทั้งคู่ใช้ tag เดียวกันจึงล้างพร้อมกันเสมอ

### Invalidation — มีอยู่แล้วครบ ไม่ต้องเขียนใหม่

ทุก route ที่แก้ไขสินค้า/หมวดหมู่เรียก `revalidateTag("products", { expire: 0 })`
อยู่แล้ว **10 จุด**:

```
app/api/products/route.ts:73                     app/api/products/[id]/route.ts:74,99,111
app/api/products/reorder/route.ts:23             app/api/products/categories/route.ts:33
app/api/products/categories/[id]/route.ts:36,70  app/api/products/categories/reorder/route.ts:28
app/api/revisions/[id]/restore/route.ts:200
```

แอดมินกดบันทึก → tag ถูกล้าง → คนถัดไปที่เข้ามาได้ข้อมูลใหม่ทันที **ไม่มีช่วง
ที่แอดมินเห็นของเก่าค้าง** ซึ่งเป็นเงื่อนไขที่ทำให้ change นี้ความเสี่ยงต่ำ

### `revalidate: 300` — ตาข่ายกันพลาด (จุดที่ต้องตัดสินใจ)

`unstable_cache` ที่ไม่ใส่ `revalidate` จะแคช **ตลอดไป** จนกว่าจะมีคนล้าง tag
ให้ ถ้าวันหน้ามีใครเพิ่ม route ใหม่ที่แก้สินค้าแล้วลืมใส่ `revalidateTag`
ข้อมูลจะค้างถาวรโดยไม่มีใครรู้ — ใส่เพดานเวลาไว้ทำให้กรณีที่พลาดกลายเป็น
"ค้างไม่เกิน 5 นาที" แทน "ค้างตลอดกาล"

หมายเหตุ: `getProductsData` ปัจจุบัน **ไม่มี** `revalidate` (พึ่ง tag อย่างเดียว)
การใส่เพดานเวลาใน change นี้จึงต่างจากของเดิมเล็กน้อย — เป็นการตัดสินใจที่ยกมา
ให้พิจารณาตรงนี้ ถ้าอยากให้เหมือนเดิมเป๊ะก็ตัด `revalidate` ออกได้ แต่ควรเป็น
การเลือกอย่างตั้งใจ ไม่ใช่ลืม

## จุดที่อันตราย และตั้งใจกันไว้อย่างไร

**1. unit test จะพังถ้าไม่จัดการ mock ก่อน**
`__tests__/lib/productStore.test.ts` เรียก `getAllProducts()` / `getAllCategories()`
ตรงๆ โดย mock แค่ `@/app/lib/db` — ยังไม่ได้ mock `next/cache` พอห่อ
`unstable_cache` เข้าไป การเรียกครั้งที่สองในเทสต์จะได้ผลลัพธ์ที่แคชไว้จากครั้งแรก
(เช่นเทสต์ที่ตั้งใจให้คืน `[]` จะได้ rows ของเทสต์ก่อนหน้า) แพทเทิร์นแก้มีอยู่แล้ว
ใน `__tests__/lib/getProductsData.test.ts:15` —
`vi.mock('next/cache', () => ({ unstable_cache: (fn) => fn }))`

**2. หน้าแอดมินต้องไม่เห็นข้อมูลค้าง**
`GET /api/products` และ `GET /api/products/categories` จะเสิร์ฟจากแคชด้วย ซึ่ง
ถูกต้องตราบใดที่ mutation ทุกตัวล้าง tag — ซึ่งครบอยู่แล้วทั้ง 10 จุด เทสต์ต้อง
ยืนยันข้อนี้ ไม่ใช่เชื่อเอาเอง

**3. ข้อมูลที่ถูกแก้นอกเส้นทาง API**
แก้ DB ตรงๆ (phpMyAdmin / SQL console) จะไม่ล้าง tag — `revalidate: 300` คือ
คำตอบของกรณีนี้

## ที่ไม่ทำใน change นี้

- **ไม่แตะ `getAllContentsMeta()`** (ส่วนที่ 2) — ตาราง `contents` ยัง **ไม่มี**
  `revalidateTag` สักจุดใน `/api/contents/*` ต้องเพิ่มโครงสร้างนั้นก่อนถึงจะแคชได้
  อย่างปลอดภัย แยกเป็น change ของตัวเอง
- **ไม่แตะ `getProductsData`** — แคชถูกต้องอยู่แล้ว
- **ไม่เปลี่ยนหน้า showcase ให้เลิก `force-dynamic`** — ยังจำเป็นเพราะ session
- **ไม่แก้ schema** — `SCHEMA_VERSION` ต้องอยู่ที่ 41 เท่าเดิม
