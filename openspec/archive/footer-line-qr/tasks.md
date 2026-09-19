# Tasks: footer-line-qr

> **ไม่แตะหน้าตา `LineQrModal`** — ใช้ตัวเดิมทั้งดุ้น
> **ไม่แก้ schema** — `SCHEMA_VERSION` ยังเป็น 41

## 1. ดึง logic ที่ซ้ำออกมา
- [x] 1.1 สร้าง hook `useLineContact()` รวมการตัดสินใจมือถือ/คอมพิวเตอร์ไว้ที่เดียว
- [x] 1.2 `Hero.tsx` เรียกใช้ hook แทนสำเนาของตัวเอง
- [x] 1.3 `Contact.tsx` เรียกใช้ hook แทนสำเนาของตัวเอง
- [x] 1.4 ยืนยันว่าไม่เหลือ `/Android|iPhone|iPad|iPod/` ซ้ำในโค้ดอีก

## 2. Footer
- [x] 2.1 เปลี่ยน `<a href="line://...">` เป็น `<button>` ที่เรียก `handleLineClick`
- [x] 2.2 **คง `aria-label="LINE"`** — เทสต์เดิมยืนยันการซ่อนตอนโหมดปรับปรุงผ่าน label นี้
- [x] 2.3 เลิกฮาร์ดโค้ด URL ใช้ `LINE_APP_URL` จาก `app/lib/contact.ts`
- [x] 2.4 render `<LineQrModal>` ใน Footer
- [x] 2.5 ปุ่มยังอยู่ใต้ `{!hideContact && ...}` เหมือนเดิม

## 3. เทสต์
- [x] 3.1 กดปุ่มบนคอมพิวเตอร์ → modal เปิด
- [x] 3.2 กดปุ่มบนมือถือ → ไปที่ `LINE_APP_URL` และ modal ไม่เปิด
- [x] 3.3 โหมดปรับปรุงเปิด → ไม่มีทั้งปุ่มและ modal
- [x] 3.4 Regression: เทสต์ Footer/Hero/Contact เดิมยังผ่าน
- [x] 3.5 พิสูจน์ว่าเทสต์จับของจริง โดยย้อนโค้ดกลับแล้วดูว่าแดง

## 4. ตรวจ
- [x] 4.1 `npx tsc --noEmit` สะอาด
- [x] 4.2 `npx vitest run` ผ่านทั้งชุด
- [x] 4.3 `npx eslint` ไฟล์ที่แก้ ไม่มีปัญหาใหม่

## 5. เพิ่มระหว่างทาง (เจ้าของเว็บขอเพิ่ม)
- [x] 5.1 แสดง QR code ของ LINE ไว้ในส่วนข้อมูลติดต่อของหน้า `/contact` โดยตรง
      (ไม่ต้องกดเปิด modal ก่อน) ใช้ `lineQrUrl()` ตัวเดียวกับที่ modal ใช้
