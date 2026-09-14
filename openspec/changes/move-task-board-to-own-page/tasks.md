# Tasks: move-task-board-to-own-page

## 1. หน้าใหม่ `/crm/tasks`
- [x] 1.1 สร้าง `app/crm/tasks/page.tsx` — auth guard, toast, topics
      (`fetchTopics`, `topicsLoading`, `topicsError`), `taskModal`,
      `revealTask`, `showTopicManager`, `boardRefreshKey` — ย้ายมาจาก
      `/crm/alerts/page.tsx` ทุกประการ
- [x] 1.2 render `<TaskBoardSection>` พร้อม prop ครบ (`onCreateTask`,
      `onEditTask`, `onManageTopics`, `onRetryTopics`, `refreshKey`,
      `revealTask`, `onToast`, `onUnauthorized`)
- [x] 1.3 `onOpenCustomer`/`onOpenEquipment` ผูกกับ hook ใหม่ (ดู §2) —
      ชิปลูกค้า/เครื่องบนการ์ดงานเปิด modal ในหน้าเดิม เหมือนที่
      `open-task-chip-targets-in-place` กำหนดไว้
- [x] 1.4 `{taskModal && <TaskFormModal .../>}`,
      `{showTopicManager && <TaskTopicManagerModal .../>}`,
      `{viewingCustomerDetails && <CustomerDetailsModal onTaskCreated=
      {setRevealTask} .../>}`, `{viewingEquipmentDetails &&
      <EquipmentDetailsModal onTaskCreated={setRevealTask} .../>}` — สร้าง
      งานจากปุ่มในสอง modal นี้ต้องขึ้นบนกระดานทันทีเหมือนปุ่ม "สร้างงาน
      ใหม่" ของกระดานเอง
- [x] 1.5 `EquipmentDetailsModal` ต้องการ `onEditEquipment` เสมอ — เพิ่ม
      `editingEquipment` + `<EquipmentEditModal>` ในหน้านี้ด้วย (คนละก้อน
      กับของ `/crm/alerts`)
- [x] 1.6 header: ลิงก์กลับ "กลับไปหน้าแจ้งเตือน" ไป `/crm/alerts`,
      หัวข้อ "สิ่งที่ต้องทำ"

## 2. Hook กลาง `useCustomerEquipmentDetails`
- [x] 2.1 สร้าง `app/components/useCustomerEquipmentDetails.ts` — ดึง
      `viewingCustomerDetails`/`viewingEquipmentDetails` state +
      `openCustomerProfile`/`openEquipmentDetails` (fetch แล้ว
      `setViewing...`, คืน `boolean` ว่าสำเร็จหรือไม่, toast ข้อความ
      ภาษาไทยเดิมทุกตัวอักษรเมื่อพลาด) ออกจาก `/crm/alerts/page.tsx`
- [x] 2.2 `/crm/alerts/page.tsx` ใช้ hook นี้แทนโค้ดเดิม — พฤติกรรมปุ่ม
      "แก้ไข" บนการ์ดนัดโทรลูกค้า/กำหนดการ **ต้องเหมือนเดิมทุกประการ**
      (ห้าม regress)
- [x] 2.3 `/crm/tasks/page.tsx` ใช้ hook เดียวกัน

## 3. `/crm/alerts` — เอาบล็อกกระดานงานออก ใส่ปุ่มไปหน้าใหม่แทน
- [x] 3.1 ลบ state/effect ที่กระดานงานใช้คนเดียว: `topics`,
      `topicsLoading`, `topicsError`, `boardRefreshKey`, `taskModal`,
      `revealTask`, `showTopicManager`, `taskBoardRef`, `fetchTopics`
      + effect ของมัน, `activeTopics`
- [x] 3.2 ลบ render บล็อก `<div id="task-board"><TaskBoardSection .../>
      </div>` และ `<TaskBoardJumpButton .../>`
- [x] 3.3 ลบ `onTaskCreated={setRevealTask}` ออกจาก
      `<EquipmentDetailsModal>`/`<CustomerDetailsModal>` ของหน้านี้ (ไม่มี
      กระดานให้ reveal บนหน้านี้อีกแล้ว — prop เป็น optional จึงไม่ใส่ก็ได้)
- [x] 3.4 เพิ่มการ์ดปุ่ม "ไปที่หน้าสิ่งที่ต้องทำ" ในตำแหน่งเดิมที่บล็อก
      กระดานเคยอยู่ (ท้ายฟีด, นอก `relative` wrapper ของ sticky header) —
      ลิงก์ไป `/crm/tasks`, badge ตัวเลข `dueTaskCount` เมื่อ > 0 เท่านั้น
- [x] 3.5 dueTaskCount ยังคำนวณจาก `alerts?.dueTaskCount` เหมือนเดิม
      (ไม่ยิง request ใหม่)
- [x] 3.6 ลบ import ที่ไม่ใช้แล้ว: `TaskBoardSection`,
      `TaskBoardJumpButton`, `TaskFormModal`, `TaskTopicManagerModal`,
      type `CrmTask`, `TaskTopic`, `Customer`, `useRef`

## 4. ลบโค้ดที่ไม่ใช้แล้ว
- [x] 4.1 ลบ `app/components/TaskBoardJumpButton.tsx` +
      `__tests__/components/TaskBoardJumpButton.test.tsx` (ปัญหาที่มันแก้
      ไม่มีอยู่แล้วเมื่อกระดานมีหน้าของตัวเอง)

## 5. คู่มือในแอป
- [x] 5.1 `app/components/AlertsGuidePanel.tsx` — แก้ 2 จุดที่อ้างว่า
      กระดานงาน "อยู่บล็อกด้านล่าง" ให้บอกว่าตอนนี้อยู่คนละหน้าแล้ว พร้อม
      วิธีไปหน้านั้น

## 6. เทสต์
- [x] 6.1 ย้าย `alertsTaskChipTargets.test.tsx` →
      `tasksChipTargets.test.tsx` — render `/crm/tasks` แทน `/crm/alerts`,
      เนื้อหาเทสต์เดิมทุกเคส (ชิปลูกค้า/เครื่องเปิดในที่เดิม,
      ใบเสนอราคา/เอกสารยังนำทาง, ชิปที่ยังไม่ตรวจสอบยังกดได้)
- [x] 6.2 ย้าย `alertsQuickCreateRevealsBoard.test.tsx` →
      `tasksQuickCreateRevealsBoard.test.tsx` — ปรับทางเปิด
      `CustomerDetailsModal` จากปุ่ม "แก้ไข" บนการ์ดนัดโทรลูกค้า (ไม่มีใน
      หน้าใหม่) เป็นชิปบนการ์ดงานเดิมแทน ยืนยันงานที่สร้างใหม่ขึ้นบน
      กระดานเองโดยไม่รีเฟรช
- [x] 6.3 เทสต์ใหม่ `tasksMovedOffAlerts.test.tsx`:
  - `/crm/alerts` ไม่ยิง request ไปยัง `/api/admin/tasks`/
    `/api/admin/task-topics` และไม่มีปุ่ม "สร้างงานใหม่" หลงเหลืออยู่เลย
  - `/crm/alerts` แสดงปุ่มลิงก์ไป `/crm/tasks` พร้อม badge ตัวเลขเมื่อ
    `dueTaskCount > 0` และไม่มี badge เมื่อ 0
  - `/crm/tasks` render กระดานงาน (ปุ่ม "สร้างงานใหม่") และลิงก์กลับ
    `/crm/alerts`
- [x] 6.4 พิสูจน์ด้วยการย้อนโค้ด href ของปุ่มใหม่กลับเป็นค่าอื่น แล้วยืนยัน
      เทสต์ §6.3 จับได้จริง (mutation check)

## 7. เอกสาร
- [x] 7.1 `specs/crm-task-board/spec.md` ในการเปลี่ยนนี้ — MODIFIED
      requirement "กระดานงานต้องแยกให้เห็นชัด..." ปรับจาก "คนละบล็อกบนหน้า
      เดียวกัน" เป็น "คนละหน้ากันไปเลย"
- [x] 7.2 `specs/crm-alert-surface/spec.md` ในการเปลี่ยนนี้ — ADDED
      requirement ปุ่ม/การ์ดไปหน้าสิ่งที่ต้องทำ
- [x] 7.3 `openspec validate move-task-board-to-own-page --strict` ผ่าน

## 8. Verify
- [x] 8.1 `npx tsc --noEmit` สะอาด
- [x] 8.2 `npx vitest run` ผ่านทั้งชุด (142 ไฟล์)
