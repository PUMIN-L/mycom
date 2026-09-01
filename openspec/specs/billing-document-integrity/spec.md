# billing-document-integrity Specification

## Purpose
TBD - created by archiving change fix-billing-quotation-integrity. Update Purpose after archive.

## Requirements

### Requirement: การเช็คเลขที่เอกสารซ้ำต้อง exclude เอกสารตัวเอง
การตรวจสอบ `docNo` ซ้ำในหน้าสร้าง/แก้ไขใบวางบิล SHALL exclude เอกสารที่กำลัง
แก้ไขอยู่ออกจากการเปรียบเทียบ (เทียบด้วย id ไม่ใช่แค่ docNo)

#### Scenario: เปิดดูใบวางบิลที่บันทึกแล้วในโหมด view
- **WHEN** เปิดเอกสารที่มีอยู่แล้ว (`?id=X&view=1`)
- **THEN** ปุ่มดาวน์โหลด PDF ใช้งานได้ ไม่ถูก disable จากการชน docNo ของตัวเอง

### Requirement: การลบรูปภาพต้องเช็คการใช้งานในทุกแหล่งที่อาจอ้างอิงรูปนั้น
`isCloudinaryImageInUse` (และ orphan scanner ที่เกี่ยวข้อง) SHALL ตรวจสอบ
การอ้างอิงรูปภาพใน `quotations.uploadedImages` และ `billing_documents.data`
เพิ่มเติมจาก products/documents/contents ที่มีอยู่แล้ว ก่อนอนุญาตให้ลบรูปถาวร

#### Scenario: ลบใบเสนอราคาที่มีรูปซึ่งถูกใช้ในใบวางบิลที่ลิงก์กัน
- **WHEN** ใบเสนอราคา A ถูกลบ และรูปภาพในนั้นยังถูกอ้างอิงจาก billing document
  ที่ลิงก์กับ A
- **THEN** รูปนั้นไม่ถูกลบออกจาก Cloudinary

#### Scenario: ลบใบเสนอราคาที่ถูก clone เป็นเวอร์ชันใหม่
- **WHEN** ใบเสนอราคาต้นทางถูกลบ แต่สำเนา (แก้ไข New Ver.) ยังอ้างอิงรูปเดิมอยู่
- **THEN** รูปที่สำเนายังใช้อยู่ไม่ถูกลบ

### Requirement: การเช็คเลขที่เอกสารซ้ำและ auto-suggest ต้องอ่านจาก ledger ถาวร ไม่ใช่ลิสต์เอกสารที่มีอยู่
หน้าสร้าง/แก้ไขใบวางบิล SHALL โหลดรายการเลขที่ที่ถูกใช้แล้วจาก ledger ถาวร
(`used_docnos`) ผ่าน endpoint กลาง ไม่ใช่จากลิสต์เอกสารที่ยังไม่ถูกลบ เพื่อให้
เลขที่ยังคง "ถูกจอง" แม้เอกสารที่ใช้เลขนั้นจะถูกลบไปแล้ว (ledger ไม่ถูกลบ/ปล่อย
คืนตามนโยบายห้ามลบข้อมูลใน database และการ retain ledger ไว้เพื่อ analytics)

#### Scenario: ลบใบวางบิลแล้ว auto-suggest ต้องไม่เสนอเลขเดิมซ้ำ
- **WHEN** ใบวางบิลเลขที่ X ถูกลบ แล้วเปิดหน้าสร้างใบวางบิลใหม่ในวันเดียวกัน
- **THEN** ระบบ auto-suggest เลขที่ถัดไปที่ยังไม่ถูกจองใน ledger ไม่เสนอเลขที่ X
  ซ้ำ (เพราะ ledger ยังมีการจองเลขที่ X อยู่ แม้เอกสารจะถูกลบไปแล้ว) จึงไม่เกิด
  409 ซ้ำๆ
