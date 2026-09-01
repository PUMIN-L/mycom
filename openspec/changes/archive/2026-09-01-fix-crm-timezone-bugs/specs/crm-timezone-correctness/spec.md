# Spec Delta: crm-timezone-correctness

## ADDED Requirements

### Requirement: การแปลงวันที่จาก DatePicker ต้องใช้วัน-เดือน-ปีตามเวลาท้องถิ่น ไม่ใช่ toISOString()
ทุกจุดที่แปลง `Date` object จาก DatePicker เป็น string `YYYY-MM-DD` SHALL อ่าน
ค่าปี/เดือน/วันจาก local getters (`getFullYear()`/`getMonth()`/`getDate()`)
ไม่ใช่ `toISOString()` ซึ่งแปลงเป็น UTC ก่อนตัดเวลาทิ้ง

#### Scenario: เลือกวันที่ครั้งแรกในฟิลด์ที่ว่างเปล่า
- **WHEN** ผู้ใช้ที่อยู่ใน timezone Asia/Bangkok (UTC+7) เลือกวันที่ 5 สิงหาคม
  ในฟิลด์ที่ยังไม่มีค่า
- **THEN** ค่าที่บันทึกคือ "2026-08-05" ไม่ใช่ "2026-08-04"

### Requirement: การคำนวณ "วันนี้" สำหรับ CRM alerts ต้องอิงเวลาไทย (UTC+7)
`getAlerts` และ query ที่เกี่ยวข้องกับการเทียบวันที่ (overdue check, warranty
cutoff) SHALL คำนวณ "วันนี้" โดยอิงเวลาไทย ไม่ใช่ UTC ของเซิร์ฟเวอร์ตรงๆ

#### Scenario: ตรวจ overdue schedule ตอนเช้าตรู่ตามเวลาไทย
- **WHEN** เวลาไทยคือ 02:00 น. ของวันที่ 5 (ตรงกับ UTC 19:00 ของวันที่ 4) และมี
  schedule ที่ scheduledDate = วันที่ 4
- **THEN** schedule นั้นถูกจัดเป็น overdue (เทียบกับวันที่ 5 ตามเวลาไทย ไม่ใช่
  วันที่ 4 ตาม UTC)

### Requirement: ค่า "วันนี้" เริ่มต้นของเอกสารใหม่ (docDate/เลขที่เอกสาร) ต้องอิงวันที่ท้องถิ่น
หน้าสร้างใบเสนอราคา (`app/quotation/page.tsx`) และใบวางบิล (`app/billing/page.tsx`)
SHALL คำนวณ `docDate` เริ่มต้นและ prefix เลขที่เอกสาร (`QT`/`INV`/`BN`/`RC`
`<YYYYMMDD>-NN`) ของเอกสารใหม่จากวันที่ปฏิทินท้องถิ่นของผู้ใช้ (`toLocalDateString`)
ไม่ใช่ `toISOString()` — บั๊กเดียวกันกับ DatePicker แต่กระทบเลขที่เอกสารที่เป็น
ข้อมูลถาวรในระบบบัญชี ไม่ใช่แค่ค่าฟอร์มที่แก้ทีหลังได้

#### Scenario: สร้างใบเสนอราคาใหม่ตอนเช้าตรู่ตามเวลาไทย
- **WHEN** ผู้ใช้ในไทยเปิดหน้าสร้างใบเสนอราคาใหม่เวลา 02:00 น. ของวันที่ 5
  (ตรงกับ UTC 19:00 ของวันที่ 4)
- **THEN** `docDate` และ prefix เลขที่เอกสาร (เช่น `QT260805-`) ที่ระบบสร้างให้
  เป็นวันที่ 5 ไม่ใช่วันที่ 4
