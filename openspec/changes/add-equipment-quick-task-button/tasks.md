# Tasks: add-equipment-quick-task-button

## 1. `useTaskTopics` — hook ใช้ร่วมกัน (module-level cache)
- [x] 1.1 `app/components/useTaskTopics.ts` ใหม่ — เลียนแบบ
      `useTaskLinkTargets` (`TaskLinkChips.tsx`): ตัวแปร module-level เก็บ
      สถานะ `{ topics: TaskTopic[] | null; isLoading: boolean }`, ฟังก์ชัน
      `ensureTaskTopicsLoaded(): Promise<TaskTopic[] | null>` ที่โหลดครั้งแรก
      แล้ว cache ตลอด session (คืน `null` เมื่อโหลดล้มเหลว โดยไม่ทำลาย cache
      เดิมถ้ามีอยู่แล้ว — ครั้งถัดไปที่ล้มเหลวลองใหม่ได้เสมอ)
- [x] 1.2 hook `useTaskTopics()` ที่ subscribe กับสถานะนั้น คืน
      `{ topics, isLoading, ensureLoaded }` ให้ component เรียกใช้
- [x] 1.3 `__resetTaskTopics()` เป็น test seam (export แยก เหมือน
      `__resetTaskLinkTargets`)
- [x] 1.4 เทสต์ hook เอง: โหลดครั้งเดียวแม้เรียก `ensureLoaded` พร้อมกันหลาย
      component instance, โหลดล้มเหลวแล้วลองใหม่ได้ในครั้งถัดไป, cache อยู่ข้าม
      การ mount/unmount ของ component (ไม่ใช่แค่ข้าม re-render)

## 2. ย้ายปุ่มฝั่งลูกค้ามาใช้ hook ตัวนี้ (retrofit)
- [x] 2.1 `app/customers/page.tsx` — ลบ state `taskTopics`/
      `isLoadingTaskTopics` ที่เขียนเอง เปลี่ยน `handleOpenTaskForm` ให้เรียก
      `useTaskTopics()`/`ensureLoaded()` แทน พฤติกรรมที่แอดมินเห็นต้องเหมือนเดิม
      ทุกประการ (ข้อความ toast เดิม, ปุ่มเดิม, เงื่อนไขเดิม)
- [x] 2.2 `__tests__/pages/customersQuickTaskButton.test.tsx` — เพิ่ม
      `__resetTaskTopics()` ใน `beforeEach` (ของเดิมไม่มี เพราะ cache เคยอยู่ที่
      state ของหน้าเอง) ยืนยันว่าทั้ง 5 เคสเดิมยังผ่านหลัง refactor

## 3. ปุ่มใหม่ใน `EquipmentDetailsModal`
- [x] 3.1 เพิ่มปุ่ม "📝 สร้างสิ่งที่ต้องทำ" ในหัวข้อ modal แถวเดียวกับปุ่ม
      "✏️ แก้ไข" ที่มีอยู่แล้ว
- [x] 3.2 กดปุ่ม: เรียก `useTaskTopics().ensureLoaded()` — โหลดไม่สำเร็จหรือ
      ไม่มีหัวข้อเลย → `alert(...)` ข้อความไทย ไม่เปิดฟอร์ม (ตามแบบที่ modal
      นี้ใช้ `alert()` แจ้งผลอยู่แล้วทุกจุด ไม่ใช้ toast)
- [x] 3.3 เปิด `TaskFormModal` พร้อม `initialLinks` ผูกกับ `equipment.id` ประเภท
      `"equipment"`, label = `buildTaskLinkLabel("equipment", { productName:
      equipment.productName, serialNumber: equipment.serialNumber })`
- [x] 3.4 `onSaved`: ปิดฟอร์ม + `alert("สร้างงานสำเร็จ — ผูกกับเครื่องนี้แล้ว")`
      + อยู่ที่ modal เดิม (ไม่ปิด `EquipmentDetailsModal`, ไม่นำทางออกจากหน้า)
- [x] 3.5 ยืนยันด้วยมือ (หรือด้วยเทสต์) ว่าปุ่มขึ้นทั้งสองทางเข้า: แท็บ
      "อุปกรณ์ที่ขาย" ที่ `/customers` และการ์ดที่ผูกเครื่องบน `/crm/alerts`
      (ปุ่ม "แก้ไข" → equipment_fetch → modal เดียวกันนี้)

## 4. เทสต์
- [x] 4.1 `__tests__/components/EquipmentDetailsModal.test.tsx` (ใหม่) —
      ปุ่มเปิดฟอร์มพร้อมลิงก์เครื่องนี้จริง (`targetType: "equipment"`,
      `targetId` ตรงกับ `equipment.id`, label ตรงกับ productName+serialNumber),
      ลบลิงก์ที่ seed มาได้ก่อนบันทึก, ไม่มีหัวข้องาน → alert ไม่เปิดฟอร์ม,
      โหลดหัวข้อไม่สำเร็จ → alert ไม่เปิดฟอร์ม แล้วลองใหม่ได้
- [x] 4.2 พิสูจน์ด้วยการย้อนโค้ดกลับว่าทุกเทสต์ใหม่จับบั๊กจริง (mutation check)
      — เอา guard หัวข้อว่างออก, ให้ cache ไม่ทำงาน, ให้ initialLinks รั่วเข้า
      โหมดแก้ไข

## 5. เอกสาร
- [x] 5.1 `specs/crm-task-board/spec.md` ในการเปลี่ยนนี้ — ADDED requirement
      ใหม่ (ฝั่งอุปกรณ์) + MODIFIED requirement เดิม (ฝั่งลูกค้า, ปรับคำอธิบาย
      ขอบเขต cache)
- [x] 5.2 `openspec validate add-equipment-quick-task-button --strict` ผ่าน

## 6. Verify
- [x] 6.1 `npx tsc --noEmit` สะอาด
- [x] 6.2 `npx vitest run` ผ่านทั้งชุด (รวมเทสต์ฝั่งลูกค้าเดิมที่ยังต้องผ่านหลัง
      refactor)
