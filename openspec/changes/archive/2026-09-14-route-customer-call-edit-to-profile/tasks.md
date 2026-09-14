# Tasks: route-customer-call-edit-to-profile

## 1. Routing decision
- [x] 1.1 `app/lib/alertEditRoute.ts` — เพิ่มชนิด `AlertEditRoute` ใหม่
      `{ kind: "customer_profile"; customerId: string }`
- [x] 1.2 แยกกติกา `customer_call` ออกจาก `schedule` ใน
      `resolveAlertEditRoute`: `customer_call` ที่มี `customerId` ใช้ได้
      (ผ่าน `usableId` ตัวเดิม — ห้ามสร้างตัวตรวจซ้ำ) → `customer_profile`;
      ไม่มี/ใช้ไม่ได้ → ตกกลับ `schedule_form` เดิม (ต้องมี `scheduleId` ใช้ได้
      ด้วย ไม่งั้น `none` เหมือนเดิม)
- [x] 1.3 `target.type === "schedule"` (equipment-scoped) **ไม่แตะ** — ยัง
      `equipment_fetch` / `schedule_form` ตามเงื่อนไข `equipmentId` เดิม
      ทุกประการ

## 2. หน้า /crm/alerts
- [x] 2.1 `handleEditClick` เพิ่ม branch `route.kind === "customer_profile"` →
      `router.push(\`/customers?customerId=${encodeURIComponent(route.customerId)}\`)`
      ตามด้วย `setSelectedAlert(null)` (รูปแบบเดียวกับ branch
      `billing_document` ที่มีอยู่แล้วในฟังก์ชันเดียวกัน)
- [x] 2.2 ยืนยันว่าทั้งปุ่ม "แก้ไข" บนการ์ดนัดโทรลูกค้า และปุ่ม "ไปแก้ไขข้อมูล"
      ในแผงรายละเอียด (`selectedAlert`) เรียก `handleEditClick` ฟังก์ชัน
      เดียวกัน — ไม่มี path คู่ขนานที่ต้องแก้ซ้ำสองที่

## 3. เทสต์
- [x] 3.1 `__tests__/lib/alertEditRoute.test.ts` — แก้เคส "routes the new
      นัดโทรลูกค้า category the same way (10.5)" ให้คาดผล
      `{ kind: "customer_profile", customerId: "cus-2" }` แทน `schedule_form`
- [x] 3.2 เพิ่มเคส: `customer_call` ที่ `customerId` เป็นทุกสเปลลิ่งของ "ไม่มี"
      (`undefined` / `null` / `""` / `"   "` / `"undefined"` / `"null"`) แต่มี
      `id` ใช้ได้ → ตกกลับ `schedule_form`; ถ้า `id` ก็ใช้ไม่ได้ด้วย → `none`
- [x] 3.3 เพิ่ม/ขยายเทสต์หน้า `/crm/alerts` — ยืนยันว่ากด "แก้ไข" บนการ์ดนัดโทร
      ลูกค้าเรียก `router.push` ไปที่ `/customers?customerId=...` จริง (ไม่ใช่
      เปิด `editingSchedule` เหมือนเดิม) และการ์ด "กำหนดการ" ที่ผูกเครื่อง
      ยังพฤติกรรมเดิม (ไม่ regress)
- [x] 3.4 พิสูจน์ด้วยการย้อนโค้ดกลับ (mutation) ว่าเทสต์ใหม่จับบั๊กจริง — ย้อน
      1.2 กลับเป็นเงื่อนไขเดิมแล้วเทสต์ที่แก้ใน 3.1/3.3 ต้องแดง

## 4. เอกสาร
- [x] 4.1 `specs/crm-alert-surface/spec.md` ในการเปลี่ยนนี้ — MODIFIED
      requirement + scenario "กดแก้ไขบนนัดโทรลูกค้า" แทนของเดิม ระบุปลายทาง
      ใหม่ให้ชัด
- [x] 4.2 `openspec validate route-customer-call-edit-to-profile --strict`
      ผ่าน

## 5. Verify
- [x] 5.1 `npx tsc --noEmit` สะอาด
- [x] 5.2 `npx vitest run` ผ่านทั้งชุด
