# Spec Delta: site-navigation-auth

## ADDED Requirements

### Requirement: Admin Panel อยู่ที่ /adminpanel และต้อง login เท่านั้น
หน้า hub ระบบจัดการ (ปุ่มไปยังเครื่องมือแอดมินทั้งหมด) SHALL อยู่ที่ `/adminpanel`
เข้าถึงได้เฉพาะ admin ที่ login แล้ว (middleware redirect ไป `/login`) และ SHALL
ไม่ถูก index (robots disallow + meta noindex)

#### Scenario: guest เปิด /adminpanel
- **WHEN** ผู้ที่ยังไม่ login เปิด `/adminpanel`
- **THEN** ถูก redirect ไป `/login`

#### Scenario: bookmark เก่า /showcase
- **WHEN** เปิด `/showcase` (path ตรงตัว ไม่มี id ต่อท้าย)
- **THEN** ถูก redirect ไป `/adminpanel` (แล้ว middleware จัดการ auth ต่อ)

### Requirement: หน้าเนื้อหา /showcase/{id} เป็น public เสมอ
หน้าเนื้อหาสินค้า `/showcase/{id}` และ gateway `/showcase/product/{productId}`
SHALL เปิดดูได้โดย **ไม่ต้อง login** — เป็นหน้าที่ลูกค้าทุกคนดูได้, อยู่ใน
sitemap, ถูก crawl/index ได้ (robots ไม่บล็อก) ปุ่มแก้ไข/ลบบนหน้ายังแสดง
เฉพาะเมื่อ login แล้ว (client-side) และ API ที่แก้ข้อมูลยังถูก gate ด้วย
requireAuth ฝั่ง server เหมือนเดิม

#### Scenario: ลูกค้าดูเนื้อหาเครื่อง
- **WHEN** ผู้ที่ไม่ได้ login เปิด `/showcase/1783184955559`
- **THEN** เห็นเนื้อหาเต็ม (HTTP 200) ไม่ถูก redirect ไป login

#### Scenario: Google crawl ตาม sitemap
- **WHEN** bot เปิด URL `/showcase/{id}` ที่ประกาศใน sitemap
- **THEN** ได้ HTTP 200 พร้อมเนื้อหา (ไม่ใช่ 307 → /login) — sitemap กับ
  พฤติกรรมจริงต้องตรงกันเสมอ

### Requirement: ไม่มีลิงก์สาธารณะพาไปหน้าแอดมิน
ลิงก์บนหน้า public (เช่น หน้า 404) SHALL ไม่ชี้ไป `/adminpanel` — ลิงก์ไป
Admin Panel ปรากฏเฉพาะบริบทที่ login แล้ว (เช่น Footer เมื่อ isLoggedIn)

#### Scenario: หน้า 404
- **WHEN** ผู้ใช้ทั่วไปเจอหน้า not-found
- **THEN** ปุ่มนำทางพาไปหน้า public (`/`, `/catalog`) เท่านั้น
