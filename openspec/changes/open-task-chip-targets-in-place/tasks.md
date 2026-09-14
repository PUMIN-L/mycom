# Tasks: open-task-chip-targets-in-place

## 1. `/crm/alerts` — ฟังก์ชันกลาง
- [x] 1.1 แยก logic ในสาขา `customer_profile` ของ `handleEditClick` ออกมาเป็น
      `openCustomerProfile(customerId: string)` — fetch
      `/api/customers/[id]`, สำเร็จ `setViewingCustomerDetails(customer)`,
      ไม่สำเร็จ `showToast("โหลดข้อมูลลูกค้าไม่สำเร็จ", "error")`
- [x] 1.2 แยก logic ในสาขา equipment fetch ของ `handleEditClick` ออกมาเป็น
      `openEquipmentDetails(equipmentId: string)` เดียวกัน (fetch
      `/api/admin/equipments/[id]`)
- [x] 1.3 `handleEditClick` เรียกฟังก์ชันทั้งสองแทนโค้ดเดิมที่ฝังอยู่ใน branch
      — พฤติกรรมของปุ่ม "แก้ไข" ต้องเหมือนเดิมทุกประการ (ห้าม regress)
- [x] 1.4 ส่ง `onOpenCustomer={openCustomerProfile}` และ
      `onOpenEquipment={openEquipmentDetails}` ให้ `<TaskBoardSection>`

## 2. `TaskBoardSection` — ปุ่มแทนลิงก์ สำหรับ 2 ประเภท
- [x] 2.1 เพิ่ม props `onOpenCustomer?: (id: string) => void`,
      `onOpenEquipment?: (id: string) => void` ใน `TaskBoardSectionProps`
- [x] 2.2 ในลูป render ชิป: เมื่อ `link.targetType === "customer"` และมี
      `onOpenCustomer` และชิปยังไม่ตาย (`link.href` ใช้ได้) — render
      `<button type="button" onClick={() => onOpenCustomer(link.targetId)}>`
      แทน `<Link href={link.href}>` โดย className/ไอคอน/ข้อความเหมือนเดิม
      ทุกประการ (ให้หน้าตาเป๊ะเหมือนเดิม เปลี่ยนแค่ element กับ behavior)
- [x] 2.3 ทำแบบเดียวกันกับ `equipment` + `onOpenEquipment`
- [x] 2.4 ไม่มี `onOpenCustomer`/`onOpenEquipment` ส่งมา (prop เป็น
      `undefined`) → ตกกลับไปใช้ `<Link href>` เดิม ไม่ใช่ปุ่มที่กดไม่มีผล
- [x] 2.5 `quotation`/`document` **ไม่แตะ** ยัง `<Link href>` เดิมเสมอ ไม่ว่า
      prop ใหม่จะส่งมาหรือไม่
- [x] 2.6 ชิปที่ตายแล้ว ("ถูกลบแล้ว") **ไม่แตะ** ยังเป็น `<span>` กดไม่ได้
      เหมือนเดิมทุกประการ

## 3. เทสต์
- [x] 3.1 เทสต์หน้า `/crm/alerts` — สร้างงานที่มีลิงก์ลูกค้า + เครื่อง กดชิป
      ลูกค้า → `CustomerDetailsModal` เปิดในหน้าเดิม (URL ไม่เปลี่ยน), กดชิป
      เครื่อง → `EquipmentDetailsModal` เปิดในหน้าเดิมเช่นกัน
- [x] 3.2 ชิปใบเสนอราคา/เอกสารในงานเดียวกัน ยังนำทางไปหน้าเดิมเหมือนเดิม
      (regression — ไม่ถูกงานนี้แตะ)
- [x] 3.3 ชิปที่ตายแล้วในงานเดียวกัน ยังกดไม่ได้เหมือนเดิม (regression)
- [x] 3.4 พิสูจน์ด้วยการย้อนโค้ดกลับว่าเทสต์ใหม่จับได้จริง (mutation check)

## 4. เอกสาร
- [x] 4.1 `specs/crm-task-board/spec.md` ในการเปลี่ยนนี้ — MODIFIED
      requirement (ปรับคำอธิบายปลายทางของชิปลูกค้า/เครื่อง)
- [x] 4.2 `openspec validate open-task-chip-targets-in-place --strict` ผ่าน

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` สะอาด
- [x] 5.2 `npx vitest run` ผ่านทั้งชุด
