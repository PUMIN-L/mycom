# Proposal: ย้ายกระดานงาน "สิ่งที่ต้องทำ" ไปเป็นหน้าแยกต่างหาก

## Why

กระดานงาน "สิ่งที่ต้องทำ" เคยเป็นบล็อกอยู่ท้าย `/crm/alerts` ใต้ฟีดแจ้งเตือน
อัตโนมัติทั้งหมด สัปดาห์ที่ฟีดยาว (แจ้งเตือนเยอะ) บล็อกที่ owner จดเองกลาย
เป็นส่วนที่หาเจอยากที่สุดในหน้า ต้องเลื่อนผ่านการ์ดแจ้งเตือนหลายสิบใบก่อนจะถึง
(เดิมแก้ปัญหานี้ด้วยปุ่มลอย `TaskBoardJumpButton` แต่ก็ยังต้องเลื่อน แค่เร็ว
ขึ้น) เจ้าของระบบขอให้ย้ายกระดานไปเป็นหน้าของตัวเอง แล้วมีปุ่มกดจากหน้า
แจ้งเตือนไปหาแทน

## What Changes

- **หน้าใหม่ `/crm/tasks`** (`app/crm/tasks/page.tsx`) — กระดานงานทั้งชุด
  ย้ายมาที่นี่ทั้งหมด: `TaskBoardSection`, สร้าง/แก้ไขงาน (`TaskFormModal`),
  จัดการหัวข้อ (`TaskTopicManagerModal`) และการเปิดรายละเอียดลูกค้า/เครื่อง
  ในที่เดิมเมื่อกดชิปบนการ์ดงาน (`CustomerDetailsModal`/
  `EquipmentDetailsModal`, ตาม `open-task-chip-targets-in-place`) — พฤติกรรม
  ทุกอย่างเหมือนเดิมทุกประการ เปลี่ยนแค่ที่อยู่
- **`/crm/alerts`** — บล็อกกระดานงานเดิม (และปุ่มลอย `TaskBoardJumpButton`)
  ถูกแทนที่ด้วยการ์ดปุ่มเดียว "ไปที่หน้าสิ่งที่ต้องทำ" ในตำแหน่งเดิมที่บล็อก
  เคยอยู่ (ท้ายฟีด ก่อน footer) มีตัวเลขค้าง (`dueTaskCount`) เป็น badge บน
  ปุ่มเมื่อมากกว่า 0 — ไม่ยิง request ไปหา `/api/admin/tasks` หรือ
  `/api/admin/task-topics` จากหน้านี้อีกต่อไป
- **`app/components/useCustomerEquipmentDetails.ts`** (ใหม่) — ดึง state +
  ฟังก์ชัน "โหลดลูกค้า/เครื่องแล้วเปิด modal ในที่เดิม" (เดิมอยู่ใน
  `/crm/alerts/page.tsx` โดยตรง) ออกมาเป็น hook กลาง ให้ทั้ง `/crm/alerts`
  (ปุ่ม "แก้ไข" บนการ์ดนัดโทรลูกค้า/กำหนดการ) และ `/crm/tasks` (ชิปบนการ์ด
  งาน) เรียกใช้ตัวเดียวกัน — ไม่มีโค้ด fetch+เปิด modal ชุดที่สองที่จะ
  ค่อยๆ เพี้ยนไปจากกันทีหลัง
- **`TaskBoardJumpButton`** (component + test) — ลบทิ้ง เพราะปัญหาที่มันแก้
  ("กระดานอยู่ไกลเกินจะเลื่อนถึง") ไม่มีอยู่แล้วเมื่อกระดานมีหน้าเป็นของ
  ตัวเอง
- **`app/components/AlertsGuidePanel.tsx`** — แก้ข้อความ 2 จุดที่อ้างว่า
  กระดานงาน "อยู่บล็อกด้านล่าง" ของหน้าเดียวกัน ให้บอกว่าตอนนี้มีหน้าแยก
  พร้อมวิธีไปหน้านั้น

## Impact

- Affected specs:
  - `crm-task-board` — MODIFIED requirement "กระดานงานต้องแยกให้เห็นชัดจาก
    การแจ้งเตือนอัตโนมัติบนหน้าเดียวกัน" → เปลี่ยนจาก "คนละบล็อกบนหน้า
    เดียวกัน" เป็น "คนละหน้ากันไปเลย" (`/crm/tasks` แยกจาก `/crm/alerts`)
  - `crm-alert-surface` — ADDED requirement: ปุ่ม/การ์ด "ไปที่หน้าสิ่งที่
    ต้องทำ" บน `/crm/alerts` แทนที่บล็อกกระดานงานเดิม
- Affected code:
  - ใหม่: `app/crm/tasks/page.tsx`, `app/components/useCustomerEquipmentDetails.ts`
  - แก้: `app/crm/alerts/page.tsx` (ลบ state/effect/render ของกระดานงาน
    ทั้งหมด, ใช้ hook ใหม่แทนโค้ดเดิม, เพิ่มปุ่มไปหน้าใหม่),
    `app/components/AlertsGuidePanel.tsx` (แก้ข้อความอ้างอิงตำแหน่ง)
  - ลบ: `app/components/TaskBoardJumpButton.tsx` +
    `__tests__/components/TaskBoardJumpButton.test.tsx`
  - เทสต์: ย้าย `alertsTaskChipTargets.test.tsx` →
    `tasksChipTargets.test.tsx`, `alertsQuickCreateRevealsBoard.test.tsx` →
    `tasksQuickCreateRevealsBoard.test.tsx` (render `/crm/tasks` แทน
    `/crm/alerts`, ปรับทางเปิด modal ให้เหมาะกับหน้าใหม่ที่ไม่มีการ์ด
    นัดโทรลูกค้า) + เทสต์ใหม่ `tasksMovedOffAlerts.test.tsx` ยืนยัน seam
    ระหว่างสองหน้า
- ไม่กระทบ:
  - `TaskBoardSection.tsx`, `TaskFormModal.tsx`, `TaskTopicManagerModal.tsx`,
    `CustomerDetailsModal.tsx`, `EquipmentDetailsModal.tsx` — ไม่แตะโค้ด
    ภายใน ใช้ props/behavior เดิมทุกประการ ย้ายแค่ตัว caller
  - `GlobalAdminBell` — ยังลิงก์ไป `/crm/alerts` เหมือนเดิม (นับรวมทุกหมวด
    แจ้งเตือน ไม่ใช่แค่งาน)
  - schema ฐานข้อมูล — ไม่มีการเปลี่ยนแปลง
