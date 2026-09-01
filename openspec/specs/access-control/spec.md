# access-control Specification

## Purpose
TBD - created by archiving change fix-access-control-gaps. Update Purpose after archive.

## Requirements

### Requirement: PDF proxy ต้องเสิร์ฟเฉพาะไฟล์จาก Cloudinary cloud ของแอปเราเท่านั้น
`GET /api/documents/proxy` SHALL ตรวจสอบว่า URL ที่ขอ proxy อยู่ภายใต้
`CLOUDINARY_CLOUD_NAME` ของแอปนี้เท่านั้น (ไม่ใช่แค่ hostname
`res.cloudinary.com`) — ปฏิเสธ URL จาก Cloudinary cloud อื่นทั้งหมด

#### Scenario: ขอ proxy ไฟล์จาก Cloudinary cloud อื่น
- **WHEN** `?url=` ชี้ไปที่ `res.cloudinary.com/<cloud อื่น>/...`
- **THEN** API ตอบ 400 และไม่ทำการ fetch/proxy ไฟล์นั้น

#### Scenario: ขอ proxy ไฟล์จาก cloud ของแอปเราเอง
- **WHEN** `?url=` ชี้ไปที่ `res.cloudinary.com/<cloud ของเรา>/...`
- **THEN** proxy ทำงานตามปกติ

### Requirement: เนื้อหาที่ผูกกับสินค้า unpublished ต้องไม่แสดงต่อผู้ใช้ที่ไม่ login
Content ที่ผูก (`productId`) กับสินค้าที่ `isPublished=false` หรือมี
`pendingDeleteAt` SHALL ไม่ถูกส่งกลับให้ anonymous caller ทั้งผ่าน API
(`/api/contents/all`, `/api/contents/by-product/[productId]`) และผ่านหน้า
`/showcase/[id]` (RSC payload)

#### Scenario: เปิดเนื้อหาที่ผูกกับสินค้าที่ถูกซ่อน โดยไม่ login
- **WHEN** ผู้ที่ไม่ได้ login เปิด `/showcase/{id}` ของเนื้อหาที่ผูกกับสินค้า
  unpublished
- **THEN** ไม่เห็นข้อมูลสินค้านั้นในหน้า (ทั้ง render และ RSC payload)

#### Scenario: แอดมิน login แล้วเปิดเนื้อหาเดียวกัน
- **WHEN** แอดมิน login แล้วเปิดหน้าเดียวกัน
- **THEN** เห็นข้อมูลสินค้าครบตามปกติ (สำหรับแก้ไข)

#### Scenario: เปิด gateway page ของสินค้าที่ถูกซ่อนโดยไม่ login
- **WHEN** ผู้ที่ไม่ได้ login เปิด `/showcase/product/{productId}` ของสินค้าที่
  `isPublished=false`/มี `pendingDeleteAt` และสินค้านั้นมี content ผูกอยู่แล้ว
- **THEN** ไม่ถูก redirect ไปหน้า content นั้น (เห็นหน้า fallback เดียวกับกรณี
  "ยังไม่มีเนื้อหา" และไม่เห็นชื่อสินค้าที่ถูกซ่อนอยู่ด้วย)

### Requirement: การยืนยันด้วย OTP ต้องมีการจำกัดจำนวนครั้งที่ผิด
ทุก endpoint ที่ใช้ OTP ยืนยันก่อนทำ action ทำลายข้อมูล SHALL จำกัดจำนวนครั้งที่
กรอกผิดได้ (เช่น 5 ครั้ง) แล้วทำให้ OTP นั้นใช้ไม่ได้อีก ตัวนับ SHALL เก็บแบบ
persistent (ไม่ใช่ in-memory) เพื่อให้ทำงานถูกต้องบน serverless หลาย instance

#### Scenario: กรอก OTP ผิดเกินจำนวนที่กำหนด
- **WHEN** กรอกรหัส OTP ผิดครบ 5 ครั้งติดต่อกันสำหรับ OTP ตัวเดียวกัน
- **THEN** OTP นั้นถูกยกเลิกทันที แม้จะกรอกรหัสที่ถูกต้องในครั้งถัดไปก็ใช้ไม่ได้
  ต้องขอ OTP ใหม่
