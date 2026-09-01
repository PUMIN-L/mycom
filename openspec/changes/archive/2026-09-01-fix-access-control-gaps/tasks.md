# Tasks: fix-access-control-gaps

## 1. PDF proxy — pin เฉพาะ cloud ของแอปเรา
- [x] 1.1 ใน `app/api/documents/proxy/route.ts` (`parseAllowedUrl`): หลังเช็ค
      hostname แล้ว เพิ่มเช็ค
      `url.pathname.startsWith(\`/${process.env.CLOUDINARY_CLOUD_NAME}/\`)`
      — ถ้าไม่ตรง (หรือไม่ได้ตั้งค่า `CLOUDINARY_CLOUD_NAME` เลย — fail closed)
      ให้ return null (400)
- [x] 1.2 เทส (`__tests__/api/documents.test.ts`): URL จาก cloud อื่น → 400;
      URL จาก cloud เราเอง → ผ่านปกติ; ไม่ตั้งค่า `CLOUDINARY_CLOUD_NAME` → 400

## 2. ซ่อนเนื้อหาที่ผูกกับสินค้า unpublished จาก anonymous
**เปลี่ยนแนวทางจากที่เสนอไว้เดิม**: แทนที่จะแก้ที่ `contentStore.ts` (ซึ่งเป็น
pure DB layer ไม่รู้จัก session) ทำ session-aware filtering ที่ชั้น API/page
เท่านั้น (ตรงกับ pattern เดิมของ `/api/products`) โดยเพิ่ม `isProductPublic()`
helper กลางใน `app/lib/productStore.ts` แล้วใช้ซ้ำทุกจุดที่เคยกระจัดกระจาย
(`getProductsData.ts`, `/api/products`, และจุดใหม่ทั้งหมดด้านล่าง) — ระหว่างทาง
พบช่องโหว่เดียวกันเพิ่มอีก 2 จุดที่ proposal เดิมไม่ได้ระบุไว้:
`app/showcase/product/[productId]/page.tsx` (gateway page ที่ redirect ไปหา
content โดยไม่เช็คสถานะสินค้าเลย) และ `allContents` metadata ที่ส่งเข้า
`ShowcaseClient` (ใช้เช็คว่าสินค้าไหนมี content แล้วในโหมดแก้ไข — ก็หลุดชื่อ
content ของสินค้าที่ซ่อนไปด้วยเช่นกัน)
- [x] 2.1 เพิ่ม `isProductPublic(product)` ใน `app/lib/productStore.ts` (แทนที่
      เงื่อนไข `isPublished !== false && !pendingDeleteAt` ที่เคยเขียนซ้ำ)
- [x] 2.2 `app/api/contents/[id]/route.ts` (branch `all` และ single-id) และ
      `app/api/contents/by-product/[productId]/route.ts`: เรียก `getSession()`
      — ถ้าไม่มี session ให้กรอง/บล็อกเนื้อหาที่ผูกกับสินค้าที่ถูกซ่อนออก (404
      สำหรับ single-id/by-product เสมือนไม่มีอยู่จริง)
- [x] 2.3 `app/showcase/[id]/page.tsx`: กรอง `products`/`allContents` ก่อนส่งเข้า
      `ShowcaseClient` (มี session = เห็นครบ, ไม่มี session = เห็นแค่ published)
      และ `notFound()` ทั้งหน้า + `generateMetadata` เมื่อ content
      ผูกกับสินค้าที่ซ่อนอยู่และไม่มี session
- [x] 2.4 `app/showcase/product/[productId]/page.tsx` (พบเพิ่มระหว่างทำ):
      ไม่ redirect ไปหา content ถ้าสินค้าที่ผูกอยู่ถูกซ่อนและ caller ไม่มี
      session (แสดง fallback UI เดียวกับ "ยังไม่มีเนื้อหา" แทน) และไม่โชว์
      ชื่อสินค้าที่ซ่อนอยู่ในหน้า fallback ด้วย
- [x] 2.5 เทส: `__tests__/api/contents.test.ts` (filtering ทั้ง 2 endpoint,
      admin เห็นครบ), `__tests__/lib/productStore.test.ts`
      (`isProductPublic` ทุก branch) — หน้า page.tsx เองไม่มี pattern เทส RSC
      page ในโปรเจกต์นี้ (coverage ครอบเฉพาะ `app/lib` และ `app/api`) จึงตรวจ
      ด้วย tsc + manual แทน (ดู 4.2)

## 3. Rate limit สำหรับ OTP ทั้ง 3 จุด
- [x] 3.1 สร้าง `app/lib/otpAttempts.ts` — ตัวนับ persistent ผ่าน
      `settingsStore` (คีย์ `${otpKey}_attempts`) ไม่ใช่ in-memory: 
      `resetOtpAttempts`/`recordOtpFailure`/`clearOtpAttempts`, limit = 5 ครั้ง
      (ตรงกับ `FAILURE_LIMIT` ของ `/api/auth/login`)
- [x] 3.2 ใช้ใน `app/api/admin/schedules/[id]/route.ts` (verify) +
      `.../delete-otp/route.ts` (reset เมื่อออก OTP ใหม่)
- [x] 3.3 ใช้ใน `app/api/settings/contact-email/route.ts` (verify) +
      `.../otp/route.ts` (reset)
- [x] 3.4 ใช้ใน `app/api/cloudinary/orphans/route.ts` (verify) +
      `.../otp/route.ts` (reset)
- [x] 3.5 เทส: `__tests__/lib/otpAttempts.test.ts` (unit, ทุก branch) +
      เทส lockout แบบ end-to-end ในทั้ง 3 endpoint
      (`admin-schedules.test.ts`, `settings-contact-email.test.ts`,
      `cloudinary-orphans.test.ts` — ไฟล์ใหม่ เพราะ route นี้ไม่เคยมีเทสมาก่อน)
      ยืนยันว่ากรอกผิดครบ 5 ครั้ง → OTP ถูกยกเลิก แม้กรอกถูกในครั้งถัดไปก็ใช้
      ไม่ได้

## 4. Verify
- [x] 4.1 tsc + vitest เขียว (full suite: 563 passed | 2 skipped, 55 files)
- [ ] 4.2 manual: ทดสอบ proxy กับ URL cloud อื่น, เปิด showcase ของสินค้าที่ซ่อน
      แบบ login/ไม่ login — **ต้องทำบน production/staging จริง (ตามนโยบาย
      ห้ามรัน query/action ทดสอบกับข้อมูลจริงผ่าน automation)**
