# Tasks: add-inventory-tracking

## 1. ฐานข้อมูล (schema v47)
- [x] 1.1 bump `SCHEMA_VERSION` 46 → 47
- [x] 1.2 ตาราง `inventory_groups`, `inventory_items`, `inventory_events`,
      `inventory_counters` (ข้อความ utf8mb4) + index แยก try/catch
      `isBenignSchemaError` ตามแบบไฟล์
- [x] 1.3 เทสต์ bootstrap สร้างทั้ง 4 ตาราง

## 2. ตรรกะ pure (`app/lib`)
- [x] 2.1 `types.ts` — `InventoryKind`, `InventoryGroup`, `InventoryItem`,
      `InventoryEvent`
- [x] 2.2 `inventoryStatus.ts` — ชุดสถานะต่อ kind, ช่องเพิ่ม, "ออกไปแล้ว",
      prefix รหัส, `formatInventoryCode`
- [x] 2.3 `moneyAmount.ts` — `parseNonNegativeMoney` (ใช้กติกาเดียวกับ
      `parsePositiveMoney`)
- [x] 2.4 `inventorySearch.ts` — ค้นหา/กรอง/สรุป/คำแนะนำ
- [x] 2.5 `inventoryExport.ts` — แถว Excel สองชีต
- [x] 2.6 `inventoryLabels.ts` — ขนาดสติกเกอร์ + จัดหน้า (ดวงเริ่มต้น)
- [x] 2.7 เทสต์ทั้งหมดของ 2.2–2.6

## 3. Store — `app/lib/inventoryStore.ts`
- [x] 3.1 ตรวจ/ทำความสะอาดข้อมูล (`InventoryValidationError`)
- [x] 3.2 list (JOIN ชื่อ Supplier ปัจจุบัน), getItem + events
- [x] 3.3 สร้าง/แก้รายการ, ลบเมื่อว่าง (`GroupNotEmptyError`), รวมรายการ
- [x] 3.4 เพิ่มหลายชิ้น + จ่ายรหัส + ประวัติ "รับเข้า" ในทรานแซกชันเดียว
- [x] 3.5 แก้ชิ้น (merge + ตรวจทั้งแถว + ประวัติ), ลบชิ้น + ประวัติ
- [x] 3.6 แก้หลายชิ้น (สถานะ/ที่เก็บ) + ประวัติ
- [x] 3.7 เทสต์ store บนฐานข้อมูลจำลองในหน่วยความจำ (รหัสไม่ซ้ำ/ไม่นำกลับ,
      ทรานแซกชัน rollback, แยก kind, ประวัติ)

## 4. API — `/api/admin/inventory/[kind]/**`
- [x] 4.1 route ตามตารางใน design.md ทุกตัว `requireAuth()` + `withRoute`
- [x] 4.2 kind ผิด → 404, validation → 400, ไม่พบ → 404, รายการไม่ว่าง → 409
- [x] 4.3 เทสต์ route (401 ทุกตัว, การแปลง error, ส่งค่าให้ store ถูก)

## 5. UI
- [x] 5.1 `SuggestField` (พิมพ์เอง + คำแนะนำ บน SearchableDropdown) + เทสต์
- [x] 5.2 `SupplierField` (Suppliers หรือพิมพ์เอง)
- [x] 5.3 หน้ารายการ: การ์ดสรุป ค้นหา ตัวกรอง รายการ/ชิ้น เลือกหลายชิ้น
      เปลี่ยนสถานะ/ที่เก็บหลายชิ้น ส่งออก Excel ไปหน้าสติกเกอร์ — responsive
- [x] 5.4 หน้าต่างเพิ่มของ (เลือก/สร้างรายการ จำนวน ซีเรียล เตือนซีเรียลซ้ำ)
- [x] 5.5 หน้าต่างแก้รายการ / รวมรายการ / ลบรายการ
- [x] 5.6 หน้าชิ้น `/[assets|stock]/item/[id]`: ข้อมูล แก้ไข ลบ ประวัติ
- [x] 5.7 หน้าสติกเกอร์ `/[assets|stock]/labels`
- [x] 5.8 เทสต์ component หลัก

## 6. ต่อเข้าระบบเดิม
- [x] 6.1 `proxy.ts` matcher + `__tests__/proxy.test.ts`
- [x] 6.2 `robots.ts` disallow
- [x] 6.3 `GlobalAdminBell` ADMIN_PATH_PREFIXES
- [x] 6.4 การ์ด 2 ใบใน `/adminpanel`
- [x] 6.5 ARCHITECTURE.md

## 7. ตรวจ
- [x] 7.1 tsc, lint ไม่เพิ่มจาก HEAD, เทสต์ทั้งชุด, build
- [x] 7.2 mutation check ตรรกะสำคัญ
- [x] 7.3 review หา bug แล้วแก้จนไม่เหลือ
