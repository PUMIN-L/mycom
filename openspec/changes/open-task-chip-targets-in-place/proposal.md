# Proposal: ชิปลิงก์ลูกค้า/เครื่องบนการ์ดงาน เปิดในหน้าเดิม ไม่นำทางออก

## Why

กระดาน "สิ่งที่ต้องทำ" (`/crm/alerts`) แสดงชิปลิงก์บนการ์ดงานแต่ละใบ (ลูกค้า /
เครื่องจักร / ใบเสนอราคา / เอกสาร) วันนี้ชิป **ลูกค้า** กับ **เครื่อง** กดแล้ว
นำทางออกไปที่ `/customers?tab=customers&customerId=...` หรือ
`/customers?tab=equipments&equipmentId=...` — ออกจากกระดานไปเลย เหมือนปัญหา
เดียวกับปุ่ม "แก้ไข" บนการ์ดนัดโทรลูกค้าที่เพิ่งแก้ไปใน
`open-customer-profile-in-place`

ข่าวดี — **ของที่ต้องใช้มีครบแล้ว** จาก 2 งานที่เพิ่งทำ:
- `CustomerDetailsModal` — เปิดในที่เดิมได้แล้ว (จาก `open-customer-profile-
  in-place`)
- `EquipmentDetailsModal` — เปิดในที่เดิมได้อยู่แล้วเดิม (ใช้ในการ์ดที่ผูก
  เครื่องบน `/crm/alerts` มาตั้งแต่แรก)
- `/crm/alerts/page.tsx` มี state + ฟังก์ชันดึงข้อมูลแล้วเปิด modal ทั้งสอง
  ตัวอยู่แล้ว (`viewingCustomerDetails`/`viewingEquipmentDetails`)

งานนี้จึงเป็นแค่ **เปลี่ยนปลายทางของชิป** ให้เรียกของที่มีอยู่แล้ว ไม่ใช่สร้าง
อะไรใหม่

## ข้อค้นพบสำคัญก่อนเริ่ม — ชิปที่เห็นในภาพ ไม่ได้มาจากไฟล์ที่คาดไว้

ตรวจโค้ดแล้วพบว่ามีการ render ชิปอยู่ **2 จุดแยกกัน**:

1. **`app/components/TaskBoardSection.tsx`** — ชิปบนการ์ดงานที่ **บันทึกแล้ว**
   บนกระดาน (ภาพที่ส่งมาคือจุดนี้) ใช้ `<Link href={link.href}>` ธรรมดา โดย
   `href` มาจาก `taskLinkHref()` ใน `app/lib/taskBoard.ts`
2. **`app/components/TaskLinkChips.tsx`** — ใช้แค่ตอน**กำลังแก้ไข/สร้างงาน**
   ใน `TaskFormModal` (ชิปที่มีปุ่มลบ ✕) เรียกด้วย `navigable={false}` เสมอ
   — แปลว่าโหมดที่กดแล้วนำทางได้ของไฟล์นี้ **ไม่ถูกเรียกใช้งานจริงที่ไหนเลย
   ตอนนี้** (dead code ในทางปฏิบัติ)

งานนี้จึงแก้ที่ **จุดที่ 1 เท่านั้น** (`TaskBoardSection.tsx`) เพราะเป็นจุด
เดียวที่ผู้ใช้เจอจริง จุดที่ 2 ปล่อยไว้เหมือนเดิม (ไม่ได้ใช้ ไม่กระทบอะไร)

## What Changes

- **`app/crm/alerts/page.tsx`** — ดึง logic "โหลดลูกค้า/เครื่องแล้วเปิด modal"
  ที่ตอนนี้อยู่ใน `handleEditClick` ออกมาเป็นฟังก์ชันกลาง 2 ตัว
  (`openCustomerProfile(id)`, `openEquipmentDetails(id)`) แล้วให้ทั้ง
  `handleEditClick` **และ** `TaskBoardSection` เรียกใช้ตัวเดียวกัน — ไม่เขียน
  fetch + เปิด modal ซ้ำเป็นชุดที่สอง
- **`app/components/TaskBoardSection.tsx`** — รับ prop ใหม่
  `onOpenCustomer?: (id) => void` และ `onOpenEquipment?: (id) => void` ชิป
  ประเภท `customer`/`equipment` ที่ยังไม่ตาย: เปลี่ยนจาก `<Link href>` เป็น
  `<button onClick={...}>` เรียก prop ตัวที่ตรงกัน แทนที่จะนำทาง — หน้าตา
  ของชิป (ไอคอน สี ข้อความ) **เหมือนเดิมทุกประการ** เปลี่ยนแค่พฤติกรรมตอนกด
  ชิปประเภท `quotation`/`document` **ไม่แตะ** ยัง `<Link href>` นำทางไปหน้า
  เดิมเหมือนเดิม (ยังไม่มี modal แบบดูในที่สำหรับสองอย่างนี้ — เป็นงานที่
  ใหญ่กว่านี้มาก ถ้าต้องการทำแยกเป็นอีกงาน)
- ชิปที่ตายแล้ว ("ถูกลบแล้ว") **ไม่แตะ** — ยังกดไม่ได้เหมือนเดิม
- เมื่อไม่ได้ส่ง `onOpenCustomer`/`onOpenEquipment` มา (เผื่ออนาคตมีที่เรียก
  `TaskBoardSection` จากหน้าอื่น) ชิปทั้งสองประเภท **ตกกลับไปใช้ `<Link href>`
  เดิม** — ไม่ใช่ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น

## Impact

- Affected specs:
  - `crm-task-board` — MODIFIED requirement เดิม ("ชิปลิงก์ต้องพาไปยัง
    ปลายทางได้จริง...") เปลี่ยนคำอธิบายปลายทางของ `customer`/`equipment`
    จาก "นำทางไปหน้า" เป็น "เปิด modal ในที่เดิม"
- Affected code:
  - `app/crm/alerts/page.tsx` — ฟังก์ชันกลาง 2 ตัว + ส่ง prop ใหม่ให้
    `TaskBoardSection`
  - `app/components/TaskBoardSection.tsx` — เปลี่ยนการ render ชิป
    `customer`/`equipment` เป็นปุ่ม
  - เทสต์: อัปเดตเทสต์ของ `TaskBoardSection` (ถ้ามี) + เพิ่มเคสหน้า
    `/crm/alerts` ที่กดชิปแล้ว modal เปิดในที่เดิม ไม่นำทาง
- ไม่กระทบ:
  - `app/components/TaskLinkChips.tsx` และ `TaskFormModal.tsx` — ไม่แตะ
    (จุดที่ 2 ด้านบน ไม่ได้ใช้งานจริงอยู่แล้ว)
  - ชิปใบเสนอราคา/เอกสาร — ยังนำทางเหมือนเดิมทุกประการ
  - ชิปที่ตายแล้ว — ยังกดไม่ได้เหมือนเดิม
  - `task_links`, `TASK_LINK_TARGETS`, schema — ไม่มีของใหม่
