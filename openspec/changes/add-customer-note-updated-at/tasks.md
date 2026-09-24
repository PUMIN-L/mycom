# Tasks: add-customer-note-updated-at

> **แก้โครงสร้างฐานข้อมูล** — bump `SCHEMA_VERSION` 41 → 42

## 1. ฐานข้อมูล
- [x] 1.1 `ALTER TABLE customers ADD COLUMN noteUpdatedAt VARCHAR(255) NULL`
- [x] 1.2 backfill จาก `revisions` (snapshot ที่บันทึกต่างจากปัจจุบัน) → fallback `createdAt`
      เฉพาะแถวที่มีบันทึกและยังเป็น NULL (idempotent)
- [x] 1.3 bump `SCHEMA_VERSION` เป็น 42

## 2. ประทับเวลาทุกเส้นทางที่เขียนบันทึก
- [x] 2.1 `POST /api/customers` — มีบันทึก = เวลาที่สร้าง, ไม่มี = NULL
- [x] 2.2 `PUT /api/customers/[id]` — เฉพาะเมื่อบันทึกเปลี่ยนจริง; ส่ง `noteUpdatedAt` กลับ
- [x] 2.3 `replaceInNotes` — UPDATE เดียวกันกับ note
- [x] 2.4 `POST /api/revisions/[id]/restore` — UPDATE เดียวกันกับ note

## 3. หน้าเว็บ
- [x] 3.1 `formatDisplayDateTime()` ใน `dateFormat.ts` — `24 Sep 2026 14:30` เวลากรุงเทพฯ
- [x] 3.2 `compareCustomersByNoteActivity()` — มีบันทึกก่อน → ล่าสุดก่อน → วันที่สร้าง
- [x] 3.3 `/customers` — คอลัมน์ "อัปเดตล่าสุด" + เรียงฝั่ง client (ไม่แตะ API order)
- [x] 3.4 `CustomerDetailsModal` ใช้ `noteUpdatedAt` จาก response ของ PUT

## 4. เทสต์
- [x] 4.1 unit: formatDisplayDateTime, compareCustomersByNoteActivity
- [x] 4.2 route: POST/PUT ประทับเวลาถูกต้อง, PUT ไม่ประทับเมื่อบันทึกไม่เปลี่ยน
- [x] 4.3 อัปเดต SQL ที่ถูก pin ไว้ในเทสต์ replace/restore
