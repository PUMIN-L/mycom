# Tasks: open-customer-profile-in-place

## 1. `GET /api/customers/[id]` (route ใหม่)
- [x] 1.1 `app/api/customers/[id]/route.ts` เพิ่ม `export const GET` —
      `SELECT customers.*, companies.name as companyName FROM customers LEFT
      JOIN companies ON customers.companyId = companies.id WHERE
      customers.id = ?` (เหมือน `GET /api/customers` เดิม แค่เติม WHERE) —
      `requireAuth()`, ไม่พบแถว → 404 พร้อมข้อความไทย
- [x] 1.2 เทสต์ route: คืนแถวถูกต้อง (รวม companyName ที่ join มา), 404 เมื่อ
      ไม่พบ, 401 เมื่อไม่ได้ login

## 2. สร้าง `CustomerDetailsModal` (ย้ายโค้ดจาก /customers)
- [x] 2.1 `app/components/modals/CustomerDetailsModal.tsx` ใหม่ — ย้าย JSX +
      state จาก Viewing Customer Modal เดิมทั้งหมด: แผนก/อีเมล/เบอร์โทร,
      บันทึกลูกค้า (inline edit, `noteViewRef`/`noteMinHeight` สำหรับความสูง
      กล่องแก้ไข, reset draft เมื่อเปลี่ยนลูกค้า), `CustomerCallScheduleSection`,
      ปุ่ม "สร้างสิ่งที่ต้องทำ" (topics/`showTaskForm`/`taskFormInitialLinks`
      ที่เพิ่งเพิ่มใน `add-customer-quick-task-button`)
- [x] 2.2 Props: `customer: Customer`, `onClose: () => void`,
      `onSaved: (updated: Customer) => void` (เรียกหลังบันทึกบันทึกลูกค้า
      สำเร็จ — parent ตัดสินใจเองว่าจะอัปเดต state ของตัวเองยังไง)
- [x] 2.3 `app/customers/page.tsx` — ลบ JSX/state เดิมของ modal ทั้งหมด
      (`isEditingCustomerNote`, `customerNoteDraft`, `isSavingCustomerNote`,
      `noteViewRef`, `noteMinHeight`, `handleSaveCustomerNote`, `taskTopics`,
      `isLoadingTaskTopics`, `taskFormCustomer`, `handleOpenTaskForm`,
      `taskFormInitialLinks`, block `<TaskFormModal>` เดิม) เรียก
      `<CustomerDetailsModal customer={viewingCustomer} onClose={() =>
      setViewingCustomer(null)} onSaved={(updated) => { setViewingCustomer
      (updated); setCustomers(prev => prev.map(c => c.id === updated.id ?
      updated : c)); }} />` แทน
- [x] 2.4 ยืนยันว่าหน้า `/customers` หน้าตา/พฤติกรรมเหมือนเดิมทุกประการหลัง
      ย้าย (เทสต์เดิมของหน้านี้ต้องผ่านหมดโดยแก้แค่ selector ที่จำเป็น)

## 3. `/crm/alerts` — เปิด modal ในหน้าเดิม แทนการนำทางออก
- [x] 3.1 เพิ่ม state `viewingCustomerDetails: Customer | null`
- [x] 3.2 `handleEditClick` — branch `route.kind === "customer_profile"`:
      ลบ `router.push("/customers?customerId=...")` เดิมออก แทนด้วย
      `fetch(\`/api/customers/${encodeURIComponent(route.customerId)}\`)` →
      สำเร็จ: `setViewingCustomerDetails(customer)` + `setSelectedAlert(null)`;
      ไม่สำเร็จ (404 หรืออื่นๆ): `showToast("โหลดข้อมูลลูกค้าไม่สำเร็จ",
      "error")` ไม่เปิด modal ไม่นำทางไปไหน
- [x] 3.3 เรนเดอร์ `{viewingCustomerDetails && <CustomerDetailsModal
      customer={viewingCustomerDetails} onClose={() =>
      setViewingCustomerDetails(null)} onSaved={setViewingCustomerDetails} />}`
      ท้ายไฟล์ (คู่กับ `{viewingEquipmentDetails && <EquipmentDetailsModal
      .../>}` ที่มีอยู่แล้ว)
- [x] 3.4 ยืนยันว่า URL ยังเป็น `/crm/alerts` ไม่เปลี่ยนตลอด — ไม่มี query
      param ใหม่ใดๆ ถูกเติม

## 4. เทสต์
- [x] 4.1 ย้ายเทสต์ modal เดิม (ถ้ามีเทสต์แยกของหน้า /customers ที่ทดสอบส่วนนี้
      โดยตรง) ให้ทดสอบผ่าน `CustomerDetailsModal` component ใหม่แทน
- [x] 4.2 `__tests__/pages/alertsCustomerCallEditRoute.test.tsx` (มีอยู่แล้ว
      จาก `route-customer-call-edit-to-profile`) — แก้เคสที่เคยยืนยัน
      `router.push` ให้ยืนยันว่า **modal เปิดในหน้าเดิมแทน** และ
      `window.location.pathname` ยังเป็น `/crm/alerts` ตลอด ไม่เปลี่ยนเลย
- [x] 4.3 เพิ่มเคส: โหลดข้อมูลลูกค้าไม่สำเร็จ (404/500) → toast ภาษาไทย ไม่เปิด
      modal ไม่นำทาง
- [x] 4.4 พิสูจน์ด้วยการย้อนโค้ดกลับว่าเทสต์ใหม่จับได้จริง (mutation check)

## 5. เอกสาร
- [x] 5.1 `specs/crm-alert-surface/spec.md` ในการเปลี่ยนนี้ — MODIFIED
      requirement (ต่อจากที่ `route-customer-call-edit-to-profile` แก้ไว้)
- [x] 5.2 `openspec validate open-customer-profile-in-place --strict` ผ่าน

## 6. Verify
- [x] 6.1 `npx tsc --noEmit` สะอาด
- [x] 6.2 `npx vitest run` ผ่านทั้งชุด (รวมเทสต์เดิมของ /customers ที่ต้องผ่าน
      หลังย้ายโค้ด)
