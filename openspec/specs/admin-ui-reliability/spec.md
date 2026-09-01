# admin-ui-reliability Specification

## Purpose
TBD - created by archiving change fix-admin-ui-reliability. Update Purpose after archive.

## Requirements

### Requirement: fetch ที่ไม่สำเร็จต้องแสดงสถานะ error ไม่ใช่ empty state
เมื่อ fetch ข้อมูลสำหรับหน้าแอดมิน (alerts, customers, equipment) ได้ response
ที่ไม่ ok SHALL แสดง error ให้ผู้ใช้เห็นชัดเจน (toast หรือ error state) แทนที่จะ
ปล่อยให้ตกไปเป็น empty state ที่บอกว่าไม่มีข้อมูล/ทุกอย่างเรียบร้อย

#### Scenario: session หมดอายุระหว่างเปิดหน้า CRM alerts
- **WHEN** เรียก `GET /api/admin/alerts` แล้วได้ 401 (session หมดอายุ)
- **THEN** ผู้ใช้เห็น error message หรือถูก redirect ไป login ไม่ใช่เห็นข้อความ
  "ไม่มีแจ้งเตือน"

#### Scenario: server error ตอนโหลด alerts
- **WHEN** เรียก `GET /api/admin/alerts` แล้วได้ 500
- **THEN** ผู้ใช้เห็น toast แจ้งว่าโหลดข้อมูลไม่สำเร็จ

### Requirement: การกรองตัวเลขในฟิลด์เบอร์โทรต้องทำงานถูกต้องทุกฟอร์ม
ทุกฟิลด์กรอกเบอร์โทรในหน้าจัดการลูกค้า/บริษัท/พนักงานขาย SHALL ใช้ regex
`/\D/g` (ไม่ใช่ตัวอักษร) เพื่อกรองอักขระที่ไม่ใช่ตัวเลขออกอย่างสม่ำเสมอ

#### Scenario: วางเบอร์โทรที่มีขีดคั่นในฟอร์มพนักงานขาย
- **WHEN** วางเบอร์โทรรูปแบบ "081-234-5678" ในฟิลด์เบอร์โทรพนักงานขาย
- **THEN** ฟิลด์แสดงผล "0812345678" (ตัวเลขล้วน) และปุ่มบันทึกกดได้ปกติ
