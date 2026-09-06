# Tasks: add-service-job-sheet

> **ต้องรอ `add-receivables` ลงก่อนเริ่ม** — ชุดนั้นกำลังแก้ตัวออกเลขเอกสาร
> (`app/lib/quotationNumber.ts`, `quotationStore.ts`, `billingNumber.ts`,
> `used_docnos`) ซึ่งใบ Job จะมาใช้ต่อ ถ้าทำคู่กันจะแย่งไฟล์เดียวกัน
> และ `add-receivables` จอง schema **v37** ไว้แล้ว ใบ Job จึงเป็น **v38**

## 1. Phase 1 — Database (schema v38)
- [x] 1.1 เพิ่มตาราง `service_jobs` ใน `app/lib/db.ts` — `id VARCHAR(36) PK`,
      `jobNo VARCHAR(255) NOT NULL UNIQUE`, `companyId VARCHAR(255) NOT NULL`,
      `customerId VARCHAR(255) NOT NULL`, `jobDate VARCHAR(20) NOT NULL`
      (`YYYY-MM-DD`), `technicianName VARCHAR(255) NOT NULL DEFAULT ''`
      (**ว่างได้ตั้งใจ** — ไม่พิมพ์ = เว้นให้ช่างเขียนเอง),
      `scheduleId VARCHAR(36) DEFAULT NULL`, `status VARCHAR(20) NOT NULL
      DEFAULT 'issued'`, `workSummary TEXT NULL`,
      `completedAt VARCHAR(255) DEFAULT NULL`, `createdAt VARCHAR(255) NOT NULL`
- [x] 1.2 เพิ่ม index `idx_sj_customer (customerId)`,
      `idx_sj_status_date (status, jobDate)`, `idx_sj_schedule (scheduleId)`,
      `idx_sj_createdAt (createdAt)`
- [x] 1.3 เพิ่มตาราง `service_job_equipments` — `jobId VARCHAR(36) NOT NULL`,
      `equipmentId VARCHAR(36) NOT NULL`, `sortOrder INT NOT NULL DEFAULT 0`,
      **PRIMARY KEY (jobId, equipmentId)** ตามแบบ
      `alert_snoozes (alertType, referenceId)` / `task_links` — composite PK
      คือสิ่งที่ทำให้เครื่องซ้ำในใบเดียวกันเป็นไปไม่ได้โดยโครงสร้าง
- [x] 1.4 เพิ่ม index `idx_sje_equipment (equipmentId)` สำหรับคิวรี่
      "ใบ Job ทั้งหมดของเครื่องตัวนี้" ที่หน้าประวัติเครื่องใช้
- [x] 1.5 ขยับ `SCHEMA_VERSION` เป็น **38** — ห้ามลด ห้ามใช้เลขซ้ำ อ่านคอมเมนต์
      เตือนเหนือค่าคงที่นั้นก่อนแก้ (v33 เคยถูกเผาแล้วทำ production พัง 500)
- [x] 1.6 migration ต้อง idempotent — `CREATE TABLE IF NOT EXISTS` และ index
      ห่อด้วย try/catch ที่ยอมรับเฉพาะ `isBenignSchemaError`

## 2. Phase 2 — Store + เลขที่เอกสาร
- [x] 2.1 `app/lib/serviceJobNumber.ts` — `JOB<DDMMYY>-NN` **ใช้ตัวออกเลข
      ที่ `add-receivables` ทำไว้ อย่าเขียนตัวที่สอง** เพิ่มแค่ prefix `JOB`
- [x] 2.2 `app/lib/serviceJobStore.ts` — `createJob` / `updateJob` / `getJob` /
      `listJobs` / `listJobsForEquipment` / `completeJob` / `cancelJob`
- [x] 2.3 `createJob` จองเลขผ่าน `used_docnos` ด้วย INSERT-ก่อน แล้วจัดการ
      `ER_DUP_ENTRY` ตามแบบ `saveQuotationAtomic` — ห้าม SELECT แล้วเชื่อ
- [x] 2.4 บันทึกใบ + แถวเครื่องทั้งหมดใน `withTransaction` เดียว และ **mint
      UUID ภายใน callback** เพราะ `withTransaction` retry ได้ถึง 3 ครั้ง
- [x] 2.5 ปฏิเสธเครื่องที่ `customerId` ไม่ตรงกับลูกค้าของใบ พร้อมข้อความไทย
- [x] 2.6 `completeJob` — เปลี่ยนสถานะ + เขียน `service_logs` 1 แถวต่อเครื่อง
      (`serviceReportNumber` = `jobNo`) + ปิดนัดที่ผูกไว้ ทั้งหมดใน
      transaction เดียว และ **idempotent** — ปิดซ้ำต้องไม่เกิด log ซ้ำ
- [x] 2.7 เทสต์ store ตามแบบใน `__tests__/lib/` — ครอบคลุมเครื่องหลายตัว,
      เครื่องซ้ำ, เครื่องคนละลูกค้า, ปิดงานซ้ำ, และนัดที่ถูกลบไปแล้ว

## 3. Phase 3 — API
- [x] 3.1 `app/api/service-jobs/route.ts` — GET (list) / POST (create)
- [x] 3.2 `app/api/service-jobs/[id]/route.ts` — GET / PUT / DELETE
- [x] 3.3 `app/api/service-jobs/[id]/complete/route.ts` — POST ปิดงาน
- [x] 3.4 ทุก route เป็น `withRoute("<fallback ไทย>", handler)` +
      `await requireAuth()` และทุกค่าผ่าน `sanitizePlainText`
- [x] 3.5 เทสต์ route — 400 เมื่อไม่มีเครื่องเลย, 400 เมื่อวันที่ผิดรูปแบบ,
      404 เมื่อไม่พบใบ

## 4. Phase 4 — หน้าจอสร้างใบ
- [x] 4.1 `app/service-job/page.tsx` — โครงเดียวกับ `/quotation`: auth gate +
      early-return spinner, chrome เดิม, `LeaveGuard`
- [x] 4.2 เลือกบริษัท → ผู้ติดต่อ → เครื่อง ด้วย `SearchableDropdown` ทั้งหมด
      กรองกันเป็นชั้น **ห้ามใช้ native `<select>` เด็ดขาด** (AGENTS.md)
- [x] 4.3 หมายเลขเครื่องมาจากแถวที่เลือกเสมอ **ไม่มีช่องให้พิมพ์เอง**
- [x] 4.4 เพิ่ม/ลบ/เรียงเครื่องในใบได้ และกันเลือกเครื่องซ้ำพร้อมข้อความไทย
- [x] 4.5 ช่องชื่อช่างเป็นตัวเลือก — เว้นว่างได้
- [x] 4.6 `app/service-job/saved/page.tsx` — รายการใบที่ออกแล้ว กรองตามสถานะ
      และวันที่ แสดงวันที่ด้วย `formatDisplayDate`
- [x] 4.7 ปุ่ม "ปิดงาน" พร้อม `ConfirmDialog` และ toast แบบที่ทั้งแอปใช้

## 5. Phase 5 — เอกสารที่พิมพ์
- [x] 5.1 แผ่นเอกสารในหน้าเดียวกัน + ดาวน์โหลด PDF ด้วย jspdf +
      html2canvas-pro **กลไกเดียวกับ `/quotation`** อย่าสร้างตัวที่สอง
- [x] 5.2 หัวกระดาษ: โลโก้/ชื่อบริษัท/ที่อยู่จาก company profile ใน `settings`
      และ **เลขที่ใบเด่นชัด** เพราะเป็นเลขที่ใช้อ้างอิงตอนกระดาษกลับมา
- [x] 5.3 บล็อกข้อมูลลูกค้า: บริษัท / ผู้ติดต่อ / วันที่ / ช่าง
- [x] 5.4 ตารางเครื่อง: ลำดับ / ชื่อเครื่อง / **หมายเลขเครื่อง** /
      คอลัมน์ "งานที่ทำ" ที่ **เว้นว่างและสูงพอเขียนด้วยมือได้**
- [x] 5.5 ช่องบรรยายงานรวม **แบบมีเส้นบรรทัด** — กระดาษเปล่าไม่มีเส้นทำให้
      ลายมือเอียงและสแกนกลับมาอ่านยาก
- [x] 5.6 บล็อกลายเซ็น 2 ฝั่ง: "ช่างผู้ปฏิบัติงาน" / "ลูกค้าผู้รับบริการ"
      แต่ละฝั่งมีเส้นลายเซ็น + บรรทัดชื่อตัวบรรจง + บรรทัดวันที่
- [x] 5.7 ถ้าไม่ได้กรอกชื่อช่าง ให้พิมพ์เป็น **เส้นบรรทัดว่าง** ไม่ใช่ที่ว่างเปล่า
- [x] 5.8 ตรวจการขึ้นหน้าใหม่เมื่อมีเครื่องหลายตัว — ตารางต้องไม่ถูกตัดกลาง
      บล็อกลายเซ็น และบล็อกลายเซ็นต้องไม่หลุดไปอยู่หน้าใหม่ตัวเปล่าๆ

## 6. Phase 6 — เชื่อมกับของเดิม
- [x] 6.1 สร้างใบ Job จากนัดหมายใน `service_schedules` ได้ตรงๆ ดึงลูกค้าและ
      เครื่องมาให้
- [x] 6.2 ผูก `scheduleId` แบบ **id ธรรมดา + index ไม่ใช้ FK** ตามแบบ
      `sales_records.quotationId` — นัดถูกลบแล้วใบต้องไม่หายและหน้าต้องไม่พัง
- [x] 6.3 หน้าประวัติเครื่อง (`app/customers/EquipmentTab.tsx` /
      `EquipmentDetailsModal`) แสดงใบ Job ที่เครื่องนั้นเคยอยู่ พร้อมเลขที่ใบ
      วันที่ และสถานะ
- [x] 6.4 ยืนยันว่าไม่มีโค้ดไหนแก้ `customer_equipments.calibrationDate`
      อัตโนมัติจากใบ Job — ระบบไม่รู้ว่าใบนั้นสอบเทียบจริงหรือไปเช็คไฟ

## 7. Phase 7 — เอกสารประกอบ
- [x] 7.1 เพิ่มตารางใหม่ เส้นทางใหม่ และ store ใหม่ลง `ARCHITECTURE.md`
- [x] 7.2 บันทึกกฎ "ประวัติเครื่องเขียนตอนปิดงาน ไม่ใช่ตอนออกใบ" ไว้ใน
      `ARCHITECTURE.md` พร้อมเหตุผล — เป็นกฎที่คนมาทีหลังจะเผลอเปลี่ยน
- [x] 7.3 `openspec validate add-service-job-sheet --strict` ผ่าน

## 8. Phase 8 — ตรวจ
- [x] 8.1 `npx tsc --noEmit` สะอาด
- [x] 8.2 `npx vitest run` ผ่านทั้งชุด
- [x] 8.3 grep ยืนยันว่าไม่มี native `<select>` ในไฟล์ที่เพิ่มใหม่
- [ ] 8.4 ใบทดสอบด้วยมือภาษาไทย: ออกใบ 2 เครื่อง → ดาวน์โหลด → เปิดดูว่ามีที่
      ให้เขียนจริงและลายเซ็นครบ → ปิดงาน → เปิดประวัติเครื่องทั้งสองตัว
