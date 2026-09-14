# Tasks: add-customer-quick-task-button

## 1. TaskFormModal — รับลิงก์ตั้งต้นได้
- [x] 1.1 `TaskFormModalProps` เพิ่ม `initialLinks?: TaskLinkPayload[]` (optional)
- [x] 1.2 `links` state เริ่มต้นจาก `initialLinks` **เมื่อ `task` เป็น
      `null`/`undefined` เท่านั้น** — โหมดแก้ไขยังคงอ่านจาก `task.links` เหมือน
      เดิมทุกประการ ห้ามให้ `initialLinks` แทรกแซงโหมดแก้ไขแม้แต่กรณีเดียว
- [x] 1.3 ลิงก์ที่ seed มาต้องผ่าน dedupe เดียวกับที่ผู้ใช้เพิ่มเอง (คีย์
      `targetType:targetId`) — ส่งซ้ำสองอันมาไม่ให้เกิดสองแถว
- [x] 1.4 ลิงก์ที่ seed มาต้อง**ลบออกได้**ผ่านปุ่มลบชิปเดิม ก่อนกดบันทึก —
      ไม่มีการ lock พิเศษใดๆ กับลิงก์ที่มาจาก `initialLinks`

## 2. หน้า /customers — ปุ่มใหม่
- [x] 2.1 เพิ่ม state เปิด/ปิดฟอร์มสร้างงาน (แยกจาก `editingCustomer` เดิม)
      และ state เก็บ topics ที่โหลดมา (เริ่มต้น `null` = ยังไม่เคยโหลด)
- [x] 2.2 ปุ่ม "📝 สร้างสิ่งที่ต้องทำ" ใน Viewing Customer Modal — ตำแหน่ง:
      แถวเดียวกับปุ่มปิด (X) มุมบนขวาของ modal
- [x] 2.3 กดปุ่มครั้งแรก: ถ้ายังไม่เคยโหลด topics ให้ยิง
      `GET /api/admin/task-topics` (ไม่ต้อง `includeHidden` เพราะเป็นการสร้าง
      ใหม่ ไม่ใช่แก้งานเดิมที่อาจอ้างหัวข้อที่ถูกซ่อนไปแล้ว) แล้ว cache ไว้ใน
      state ของหน้า — ครั้งถัดไปกดปุ่มไม่โหลดซ้ำ
      - โหลดไม่สำเร็จ: toast แจ้งเป็นภาษาไทย ไม่เปิดฟอร์ม (ฟอร์มต้องมี
        `topics` ที่ใช้ได้จริงเสมอ)
- [x] 2.4 เปิด `TaskFormModal` พร้อม
      `initialLinks={[{ targetType: "customer", targetId: viewingCustomer.id, label: buildTaskLinkLabel("customer", { name: viewingCustomer.name, companyName: viewingCustomer.companyName }) }]}`
      (import `buildTaskLinkLabel` จาก `TaskLinkChips.tsx` — ห้ามเขียนสูตร
      label ซ้ำเป็นครั้งที่สาม)
- [x] 2.5 `onSaved`: ปิดฟอร์ม + toast "สร้างงานสำเร็จ — ผูกกับลูกค้ารายนี้แล้ว"
      + อยู่หน้าเดิม (ไม่ `router.push` ออกจาก `/customers`)

## 3. เทสต์
- [x] 3.1 `__tests__/components/TaskFormModal.test.tsx` —
      `initialLinks` seed ลิงก์จริงตอนสร้าง (`task` omitted), ไม่ถูกใช้เมื่อ
      แก้ไขงานเดิม (ลิงก์ยังมาจาก `task.links` เท่านั้น แม้ `initialLinks` จะ
      ถูกส่งมาด้วยก็ตาม), ลบลิงก์ที่ seed มาได้ก่อนบันทึก, ส่ง `initialLinks`
      ซ้ำกับที่ผู้ใช้เพิ่มเองไม่ให้เกิดสองแถว
- [x] 3.2 เทสต์หน้า `/customers` ใหม่ — เปิดลูกค้า A กดปุ่ม แล้วยืนยันว่าฟอร์ม
      มีชิปลิงก์ของ A (ไม่ใช่ลูกค้าอื่น); ปิดแล้วเปิดลูกค้า B กดปุ่มอีกที ต้อง
      ได้ชิปของ B ไม่ใช่ของ A ค้างอยู่; บันทึกสำเร็จแล้วยืนยันว่า
      `POST /api/admin/tasks` มี `links` ที่มี `targetId` ตรงกับลูกค้าที่เปิด
      อยู่จริง; ยืนยันว่า topics ถูกโหลดครั้งเดียว (ไม่ใช่ทุกครั้งที่กดปุ่ม)

## 4. เอกสาร
- [x] 4.1 `specs/crm-task-board/spec.md` ในการเปลี่ยนนี้ — ADDED requirement
      ใหม่ 1 ข้อ
- [x] 4.2 `openspec validate add-customer-quick-task-button --strict` ผ่าน

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` สะอาด
- [x] 5.2 `npx vitest run` ผ่านทั้งชุด
