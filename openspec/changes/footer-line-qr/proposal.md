# Proposal: ปุ่ม LINE ใน Footer เปิด QR modal เหมือนที่อื่น

## Why

ปุ่ม LINE ในคอลัมน์ **Connect** ของ Footer เป็นลิงก์ `line://` ตรงๆ:

```tsx
<a href="line://ti/p/~puminkmutnb" aria-label="LINE">
```

**บนคอมพิวเตอร์ scheme `line://` ไม่ทำอะไรเลย** — เบราว์เซอร์ไม่รู้จัก ผู้ใช้กดแล้วเงียบ
ทั้งที่เว็บนี้มี `LineQrModal` ที่แสดง QR Code + ปุ่มคัดลอก LINE ID อยู่แล้ว และ
หน้าแรก (`Hero`) กับหน้าติดต่อ (`Contact`) ใช้มันอยู่

Footer อยู่ทุกหน้า จึงเป็นจุดที่คนกดบ่อยที่สุดและเป็นจุดเดียวที่ยังกดแล้วไม่เกิดอะไร

### ปัญหาที่ซ่อนอยู่: logic นี้ถูกคัดลอกไว้แล้ว 2 ชุด

`Hero.tsx:13-23` กับ `Contact.tsx:40-50` มี handler **เหมือนกันทุกบรรทัด**:

```tsx
const isMobile =
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isMobile) window.location.href = LINE_APP_URL;
else setIsLineModalOpen(true);
```

ถ้าเพิ่ม Footer โดยคัดลอกอีกรอบจะกลายเป็น **3 ชุด** — วันที่ต้องแก้ regex (เช่น
รองรับแท็บเล็ต Android รุ่นใหม่) จะต้องไล่แก้ 3 ที่ และพลาดที่ใดที่หนึ่งก็จะมีปุ่ม
LINE ที่ทำงานไม่เหมือนเพื่อน

สิ่งที่เจ้าของเว็บขอคือ **"ให้ขึ้นแบบเดียวกับที่หน้าแรก"** — ความเหมือนจึงเป็น
ข้อกำหนด ไม่ใช่ความบังเอิญ และควรถูกบังคับด้วยโครงสร้าง ไม่ใช่ด้วยการคัดลอก

## What Changes

**ดึง logic ที่ซ้ำออกมาเป็น hook เดียว** แล้วให้ทั้งสามที่เรียกใช้

```ts
const { isLineModalOpen, closeLineModal, handleLineClick } = useLineContact();
```

- มือถือ → เปิดแอป LINE ด้วย `LINE_APP_URL`
- คอมพิวเตอร์ → เปิด `LineQrModal`

แต่ละ component ยังถือ state ของ modal ตัวเอง (เปิดพร้อมกันไม่ได้อยู่แล้วเพราะ
กดได้ทีละปุ่ม) hook แค่รวม *การตัดสินใจ* ไว้ที่เดียว

### เก็บกวาดที่เจอระหว่างทาง

Footer ฮาร์ดโค้ด `"line://ti/p/~puminkmutnb"` แทนที่จะใช้ `LINE_APP_URL` จาก
`app/lib/contact.ts` — ค่าตรงกันในวันนี้ แต่ถ้า LINE ID เปลี่ยน จะมีจุดเดียวที่
ไม่ตามไปด้วย เปลี่ยนมาใช้ค่าคงที่

## สิ่งที่ต้องไม่พัง

**การซ่อนปุ่ม LINE ตอนเปิดโหมดปรับปรุง** — Footer ห่อปุ่มนี้ด้วย `{!hideContact && ...}`
ซึ่งเป็นความต้องการทางธุรกิจ (ดู change `maintenance-overlay-seo`) การเปลี่ยนจาก
`<a>` เป็น `<button>` ต้องคง `aria-label="LINE"` ไว้ เพราะเทสต์เดิมใน
`__tests__/components/Footer.test.tsx` ยืนยันการซ่อนผ่าน `queryByLabelText("LINE")`

**modal ต้องไม่โผล่ตอนโหมดปรับปรุง** — ถ้าปุ่มถูกซ่อน ก็ไม่มีทางกดเปิดได้อยู่แล้ว
แต่ต้องมีเทสต์ยืนยัน ไม่ใช่เชื่อเอาเอง

## ที่ไม่ทำใน change นี้

- **ไม่เปลี่ยนหน้าตา modal** — ใช้ `LineQrModal` ตัวเดิมทั้งดุ้น
- **ไม่แตะปุ่ม Email ข้างๆ** — `mailto:` ทำงานได้ปกติทุกเครื่อง ไม่มีปัญหาเดียวกัน
- **ไม่แก้ schema** — `SCHEMA_VERSION` ยังเป็น 41
