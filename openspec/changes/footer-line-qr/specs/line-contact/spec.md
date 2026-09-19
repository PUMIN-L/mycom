# Spec Delta: line-contact

## ADDED Requirements

### Requirement: ปุ่ม LINE ทุกจุดต้องทำงานเหมือนกัน
ทุกจุดบนเว็บที่มีปุ่มติดต่อผ่าน LINE (`Hero`, `Contact`, `Footer`) SHALL ตัดสินใจ
ด้วย logic ชุดเดียวกัน ไม่ใช่สำเนาที่คัดลอกกันมา — บนมือถือเปิดแอป LINE บน
คอมพิวเตอร์เปิด QR modal

#### Scenario: ผู้ใช้คอมพิวเตอร์กดปุ่ม LINE ใน Footer
- **WHEN** ผู้ใช้ที่ไม่ได้อยู่บนมือถือกดปุ่ม LINE ในคอลัมน์ Connect ของ Footer
- **THEN** SHALL แสดง QR modal ตัวเดียวกับที่หน้าแรกและหน้าติดต่อใช้

#### Scenario: ผู้ใช้มือถือกดปุ่ม LINE ใน Footer
- **WHEN** ผู้ใช้บนมือถือกดปุ่มเดียวกัน
- **THEN** SHALL พาไปยังแอป LINE ด้วย `LINE_APP_URL` และ SHALL ไม่เปิด modal

#### Scenario: มีการแก้เงื่อนไขการตรวจจับมือถือ
- **WHEN** มีการแก้เงื่อนไขว่าอุปกรณ์ใดถือเป็นมือถือ
- **THEN** การแก้ที่เดียว SHALL มีผลกับปุ่ม LINE ทุกจุดพร้อมกัน

### Requirement: ปุ่ม LINE ต้องอ้างอิงค่าคงที่ ไม่ใช่ URL ที่พิมพ์ซ้ำ
ปลายทางของปุ่ม LINE SHALL มาจาก `app/lib/contact.ts` เพื่อให้การเปลี่ยน LINE ID
มีผลกับทุกจุดพร้อมกัน

#### Scenario: LINE ID ถูกเปลี่ยน
- **WHEN** ค่าใน `app/lib/contact.ts` ถูกแก้
- **THEN** SHALL ไม่มีจุดใดบนเว็บที่ยังชี้ไปยัง ID เดิม

### Requirement: โหมดปรับปรุงต้องยังปิดช่องทาง LINE ได้
ตอนเปิดโหมดปรับปรุง ปุ่ม LINE ใน Footer SHALL ถูกซ่อนจากผู้ที่ไม่ได้ login ตามเดิม
และ QR modal SHALL ไม่มีทางถูกเปิดขึ้นมาได้

#### Scenario: ผู้เยี่ยมชมทั่วไปดู Footer ขณะเปิดโหมดปรับปรุง
- **WHEN** โหมดปรับปรุงเปิดอยู่ และผู้เรียกไม่ได้ login
- **THEN** SHALL ไม่พบปุ่ม LINE ใน Footer และ SHALL ไม่พบ QR modal บนหน้า
