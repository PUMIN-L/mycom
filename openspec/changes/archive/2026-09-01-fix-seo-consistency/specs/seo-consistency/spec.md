# Spec Delta: seo-consistency

## ADDED Requirements

### Requirement: Product JSON-LD ต้องผ่านการตรวจสอบของ Google โดยไม่มี error
รายการสินค้าใน ItemList JSON-LD ของหน้าแรก SHALL ไม่ใช้ schema.org type
`Product` เว้นแต่จะมีข้อมูล `offers`/`review`/`aggregateRating` จริง — เว็บนี้
เป็น B2B catalog ที่ไม่แสดงราคาสาธารณะ (ติดต่อขอใบเสนอราคาแทน) จึง SHALL ใช้
type `Thing` แทน (คง name/alternateName/description/image/url ไว้ครบเพื่อ
crawlability) เพื่อไม่ต้องใส่ข้อมูล offers ปลอมซึ่งเสี่ยงต่อ Google manual
action เรื่อง misleading structured data

#### Scenario: ตรวจสอบหน้าแรกด้วย Google Rich Results Test
- **WHEN** ตรวจสอบ JSON-LD ของหน้าแรกที่มีสินค้าแสดงอยู่
- **THEN** ไม่มี error "Either 'offers', 'review', or 'aggregateRating' should
  be specified" (เพราะ item ไม่ใช้ type `Product` ที่ต้องการฟิลด์เหล่านี้)

### Requirement: ลิงก์และ embed แผนที่ต้องชี้ตำแหน่งบริษัทจริง
ลิงก์ "เปิดใน Google Maps" และ iframe embed ในหน้า Contact SHALL ชี้ไปยัง
ที่อยู่จริงของบริษัท (93 ซอยงามวงศ์วาน 6 แยก 19 ตำบลบางเขน อำเภอเมืองนนทบุรี)
ตรงกับที่อยู่ที่แสดงเป็นข้อความในหน้าเดียวกันและใน Organization JSON-LD

#### Scenario: กดปุ่ม "เปิดใน Google Maps" จากหน้า Contact
- **WHEN** ผู้ใช้กดลิงก์แผนที่ในหน้า Contact
- **THEN** Google Maps เปิดขึ้นที่ตำแหน่งจริงของบริษัท ไม่ใช่สถานที่อื่น

### Requirement: robots.txt ต้องครอบคลุมทุก path ที่เป็นแอดมิน
`app/robots.ts` SHALL disallow ทุก path ที่ถูก gate ด้วย middleware (ต้อง login)
รวมถึง path ที่เพิ่มใหม่ภายหลัง — ไม่ตกหล่น

#### Scenario: ตรวจ robots.txt เทียบกับ middleware matcher
- **WHEN** เปรียบเทียบ path ทั้งหมดใน middleware matcher กับ disallow list ใน
  robots.ts
- **THEN** ทุก path ที่ต้อง login ปรากฏอยู่ใน disallow list ครบถ้วน
