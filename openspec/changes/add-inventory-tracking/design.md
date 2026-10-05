# Design: add-inventory-tracking

## ข้อมูล — ตารางเดียวกันสำหรับทั้งสองหน้า แยกด้วย `kind`

ผู้ใช้เห็นสองหน้าแยกกัน แต่โครงข้อมูลเหมือนกันทุกช่อง จึงเก็บในตารางชุด
เดียวที่มีคอลัมน์ `kind` (`'asset'` | `'stock'`) แทนที่จะสร้างตารางซ้ำสองชุด
— store/route/UI ชุดเดียว บั๊กที่แก้ที่หนึ่งก็หายทั้งสองหน้า

**การแยกเป็นหน้าที่ของ store** (ไม่มี FK — ตามแนวของ task board): ทุก query
กรองด้วย `kind`; ชิ้นเพิ่ม/ย้ายเข้าได้เฉพาะรายการ `kind` เดียวกัน; route
ตรวจว่า `kind` ใน URL ตรงกับแถวที่แตะ

```
inventory_groups   id PK · kind · name · brand · model · category · note
                   · createdAt · updatedAt                 INDEX (kind)
inventory_items    id PK · kind · groupId · code · seq · serialNumber
                   · purchaseDate (YYYY-MM-DD) · price DECIMAL(12,2)
                   · supplierId NULL · supplierName · location · custodian
                   · warrantyUntil NULL · status · statusParty · statusDate NULL
                   · note · createdAt · updatedAt
                   UNIQUE (kind, code) · INDEX (groupId) · INDEX (kind, status)
inventory_events   id PK · itemId · kind · eventType · fromValue · toValue
                   · detail · createdAt                    INDEX (itemId)
inventory_counters kind PK · lastNo INT
```

ช่องข้อความที่คนพิมพ์ทั้งหมดเป็น `utf8mb4` (เหมือนที่ task board ตั้งไว้ —
กันอีโมจิ/อักขระพิเศษทำให้ INSERT ล้ม)

### รหัสชิ้น
`inventory_counters` เก็บเลขล่าสุดต่อ `kind` จ่ายเลขในทรานแซกชันเดียวกับ
INSERT: `INSERT IGNORE` แถวตั้งต้น → `SELECT lastNo … FOR UPDATE` →
`UPDATE lastNo = lastNo + n` → รหัส `AS-` / `ST-` + เลขเติม 0 ให้ครบ 4 หลัก
(เกิน 9999 ก็ยาวขึ้นเอง) ตัวนับเดินหน้าอย่างเดียว ลบชิ้นแล้วรหัสนั้นไม่กลับมา
`seq` (ตัวเลขล้วน) ไว้เรียงลำดับ

### ผู้ขาย
`supplierId` (อ้างถึง `suppliers.id` แบบ soft) + `supplierName` (ข้อความ)
- เลือกจาก Suppliers → เก็บทั้งสองอย่าง; ตอนอ่านแสดงชื่อ **ปัจจุบัน** ของ
  Supplier (`COALESCE(s.companyName, i.supplierName)`) แก้ชื่อในหน้า Suppliers
  แล้วเปลี่ยนตาม; Supplier ถูกลบ → แสดงชื่อที่จดไว้ ข้อมูลไม่หาย
- พิมพ์เอง → `supplierId = NULL`, เก็บข้อความ
- `supplierId` ที่ไม่มีอยู่จริงตอนบันทึก → ตัดทิ้ง เก็บแค่ชื่อ

### สถานะ (`lib/inventoryStatus.ts` — pure ใช้ทั้ง client/server)

| kind | key | ป้าย | ช่องเพิ่ม | ออกไปแล้ว |
|---|---|---|---|---|
| asset | `in_use` | ใช้งานอยู่ | — | |
| asset | `in_storage` | เก็บในคลัง | — | |
| asset | `repair` | ส่งซ่อม | ส่งซ่อมที่ (ไม่บังคับ) | |
| asset | `loaned` | ยืมออก | ผู้ยืม (บังคับ), กำหนดคืน (ไม่บังคับ) | |
| asset | `disposed` | ขาย/จำหน่ายแล้ว | วันที่จำหน่าย (บังคับ, ≥ วันที่ซื้อ) | ✔ |
| asset | `broken` | ชำรุด/ทิ้ง | — | ✔ |
| stock | `available` | พร้อมขาย | — | |
| stock | `reserved` | จองแล้ว | จองให้ (บังคับ) | |
| stock | `repair` | ส่งซ่อม | ส่งซ่อมที่ (ไม่บังคับ) | |
| stock | `sold` | ขายแล้ว | วันที่ขาย (บังคับ, ≥ วันที่ซื้อ), ขายให้ (ไม่บังคับ) | ✔ |
| stock | `returned` | คืนผู้ขาย | — | ✔ |
| stock | `broken` | ชำรุด | — | ✔ |

ช่องเพิ่มเก็บในคอลัมน์กลางสองช่อง `statusParty` (ข้อความ) / `statusDate`
(วันที่) ความหมายตามสถานะ สถานะที่ไม่มีช่องนั้น → store ล้างค่าเป็นว่าง/NULL
เสมอ ไม่ทิ้งค่าเก่าของสถานะก่อนหน้าค้างไว้

"ออกไปแล้ว" = ไม่นับในมูลค่ารวม และซ่อนโดยค่าเริ่มต้น

### ประวัติ (`inventory_events`)
store เขียนเองในทรานแซกชันเดียวกับการแก้ชิ้น:
- `created` — ตอนเพิ่ม (ที่เก็บ + สถานะแรก)
- `status` — สถานะเปลี่ยน หรือช่องเพิ่มของสถานะเปลี่ยน (`detail` = สรุปช่องเพิ่ม)
- `location` — ที่เก็บเปลี่ยน
- `group` — ย้ายไปรายการอื่น (เก็บชื่อรายการเป็นข้อความ ณ ตอนนั้น)

ไม่มี API แก้/ลบประวัติ ลบชิ้น → ลบประวัติของชิ้นนั้นในทรานแซกชันเดียวกัน

## API — `/api/admin/inventory/[kind]/…` (ทุก route `requireAuth()` + `withRoute`)

| method | path | ทำอะไร |
|---|---|---|
| GET | `/` | `{ groups, items }` ทั้งหมดของ kind (ไม่รวมประวัติ) |
| POST | `/groups` | สร้างรายการ |
| PATCH | `/groups/[id]` | แก้รายการ |
| DELETE | `/groups/[id]` | ลบรายการ — 409 ถ้ายังมีชิ้น |
| POST | `/groups/[id]/merge` | `{ intoId }` ย้ายทุกชิ้นไปอีกรายการแล้วลบรายการนี้ |
| POST | `/items` | เพิ่ม 1–100 ชิ้น (รายการเดิม `groupId` หรือสร้างใหม่ `group`) |
| GET | `/items/[id]` | `{ item, group, events }` |
| PATCH | `/items/[id]` | แก้ชิ้น (ช่องที่ส่งมา ทับบนค่าปัจจุบันแล้วตรวจทั้งแถว) |
| DELETE | `/items/[id]` | ลบชิ้น + ประวัติ |
| POST | `/items/bulk` | `{ ids, status?, statusParty?, statusDate?, location? }` สูงสุด 500 |

ข้อผิดพลาดจากการตรวจข้อมูลเป็นภาษาไทย ตอบ 400 (`InventoryValidationError`),
ไม่พบ → 404, รายการยังมีชิ้น → 409

## UI

- **โครงร่วม** `app/components/inventory/*` รับ `kind` เป็น prop — หน้า
  `/assets`, `/stock` เป็น wrapper บางๆ
- **ค้นหา/กรองฝั่ง client** (โหลดทั้ง kind ครั้งเดียว — ขนาดข้อมูลหลักร้อย
  ถึงหลักพันชิ้น) ตรรกะอยู่ใน `lib/inventorySearch.ts` (pure, มีเทสต์):
  ค้นทุกคำที่พิมพ์ (AND) ข้ามช่องของรายการ + ชิ้น ไม่สนตัวพิมพ์เล็ก/ใหญ่
- **ช่องพิมพ์เองพร้อมคำแนะนำ** `SuggestField` — ใช้ `SearchableDropdown`
  (กฎโปรเจกต์: ห้าม `<select>`/`<datalist>` ที่ OS วาด) ผ่าน
  `onSearchChange` + `filterOptions={false}`: ข้อความที่พิมพ์กลายเป็นตัวเลือก
  "ใช้ “…”" บนสุด ตามด้วยค่าที่เคยใช้ที่ตรงกับคำค้น
- **จอเล็ก** (< md) ตาราง → การ์ด, หน้าต่างแก้ไขเต็มจอ
- **สติกเกอร์** `/[assets|stock]/labels` — รับชิ้นที่เลือกผ่าน
  `sessionStorage` (หรือ `?ids=` สำหรับชิ้นเดียว) ขนาดสำเร็จรูป
  (`lib/inventoryLabels.ts`): A4 3×8 (70×37), A4 2×7 (99×38), A4 4×10
  (48.5×25.4), ม้วน 62×29 มม. + เลือกเริ่มพิมพ์จากดวงที่เท่าไหร่ QR สร้างใน
  เครื่องด้วย `qrcode` (มีใน dependencies แล้ว) ชี้ไปที่
  `<origin>/[assets|stock]/item/<id>`
