# Tasks: fix-seo-consistency

## 1. แก้ Google Maps ผิดที่ (ทำก่อน — กระทบลูกค้าจริง)
- [x] 1.1 ยืนยันที่อยู่จริงจากแหล่งที่มีอยู่แล้วในโค้ด (ตรงกับ
      `translations.ts` และ `ProductsJsonLd.tsx`'s Organization JSON-LD ที่มี
      อยู่ก่อนแล้ว ไม่ใช่ค่าใหม่ที่เดา): "93 Soi Ngamwongwan 6 Yaek 19,
      Ngamwongwan Rd., Bang Khen, Mueang Nonthaburi, Nonthaburi 11000, TH"
- [x] 1.2 เพิ่ม `COMPANY_ADDRESS`/`COMPANY_ADDRESS_QUERY` เป็น single source
      ใหม่ใน `app/lib/contact.ts` (ที่อยู่เดิมกระจายอยู่ 2 ที่แบบ hardcode
      ไม่ตรงกัน — นี่คือสาเหตุที่ลิงก์ผิดที่ตั้งแต่แรก) แล้วแก้ href ของลิงก์
      "เปิดใน Google Maps" ใน `app/components/Contact.tsx` เป็น
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(COMPANY_ADDRESS_QUERY)}`
- [x] 1.3 แก้ iframe `src` เป็น
      `https://www.google.com/maps?q=${encodeURIComponent(COMPANY_ADDRESS_QUERY)}&output=embed`
      — **เปลี่ยนแนวทางจากที่เสนอไว้เดิม** ("Share → Embed a map" ผ่าน Google
      Maps UI ด้วยมือ) เป็น query-based embed URL ที่ไม่ต้องใช้ API key และไม่
      ต้องมีขั้นตอน manual ในเบราว์เซอร์ — สร้างจากที่อยู่เดียวกับ href ด้านบน
      จึง sync กันเสมอ ไม่มีทางเพี้ยนแยกจากกันอีกแบบที่บั๊กเดิมเป็น
- [x] 1.4 refactor `ProductsJsonLd.tsx`'s Organization address ให้ import
      `COMPANY_ADDRESS` จาก `app/lib/contact.ts` แทนการ hardcode ซ้ำ (ปิด
      ช่องทางที่ที่อยู่จะเพี้ยนแยกจากกันอีกในอนาคต — root cause ของบั๊กนี้คือ
      hardcode ซ้ำสองที่ ไม่ใช่แค่ค่าที่ผิด)
- [ ] 1.5 manual verify: กดลิงก์ + เช็ค embed แสดงตำแหน่งถูกต้อง — **ต้องทำบน
      production/staging จริงในเบราว์เซอร์**

## 2. แก้ Product JSON-LD ให้ผ่านมาตรฐาน Google
- [x] 2.1 ตัดสินใจแนวทางร่วมกับผู้ใช้ (ถามผ่าน AskUserQuestion เพราะเป็นการ
      ตัดสินใจทางธุรกิจ/ความเสี่ยงด้าน SEO ที่ proposal เดิมระบุไว้ว่าต้อง
      ปรึกษา): **เลือกตัด type `Product` ออก** ไม่ใช่ใส่ offers ราคาปลอม
      (option ที่ใส่ `price: 0`/ราคาหลอกเสี่ยง Google manual action เรื่อง
      misleading structured data มากกว่าจะคุ้มกับ rich snippet ที่ได้)
- [x] 2.2 implement ใน `app/components/ProductsJsonLd.tsx`: เปลี่ยน
      `item["@type"]` จาก `"Product"` เป็น `"Thing"` (ยังคง name/alternateName/
      description/image/url ครบเหมือนเดิม เพียงไม่ผูกกับข้อกำหนด offers/
      review/aggregateRating ของ Product rich result) พร้อมคอมเมนต์อธิบาย
      เหตุผลไว้ในโค้ด
- [ ] 2.3 ทดสอบด้วย Google Rich Results Test / Schema Markup Validator จริง —
      **ต้องทำหลัง deploy จริง** (เครื่องมือนี้ต้องดึงหน้าเว็บที่ deploy แล้ว
      ไม่สามารถทดสอบจาก local ได้)

## 3. เพิ่ม /crm, /expenses ใน robots.ts
- [x] 3.1 ไล่เทียบ `middleware.ts` matcher ทั้งหมดกับ `app/robots.ts` disallow
      list — ยืนยันแล้วว่ามีแค่ 2 path ที่ตกหล่นจริง (`/crm`, `/expenses`)
      ที่เหลือครบทุกจุด
- [x] 3.2 เพิ่ม `/crm`, `/expenses` เข้า disallow list พร้อมเทสกันการ regress
      (`__tests__/robots.test.ts` — เทียบ `middleware.ts`'s `config.matcher`
      กับ `robots.ts`'s disallow list โดยตรง แทนที่จะ hardcode รายการ path
      ที่คาดหวังไว้ในเทส เพื่อให้จับ path ใหม่ที่ตกหล่นในอนาคตได้ด้วย ไม่ใช่
      แค่ 2 path นี้)

## 4. Verify
- [x] 4.1 tsc + vitest เขียว (full suite: 575 passed | 2 skipped, 57 files;
      `vitest run --coverage` ผ่าน threshold เช่นกัน)
- [ ] 4.2 ตรวจ `robots.txt` บน production หลัง deploy ว่าครบตาม middleware —
      **ต้องทำหลัง deploy จริง**
