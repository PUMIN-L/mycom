# หมายเหตุ: ตอนลบโหมดปรับปรุงเว็บ

ตอนลบโหมดปรับปรุงเว็บ ให้ลบเงื่อนไข `maintenanceOn` ใน sitemap ออกด้วย ไม่อย่างนั้น build จะพังเพราะไม่มีฟังก์ชันให้เรียก

การลบยังช่วย SEO นิดหน่อยด้วย เพราะทุกหน้าไม่ต้องอ่านค่านี้จากฐานข้อมูลก่อนแสดงผล หน้าจึงเร็วขึ้นเล็กน้อย และเบราว์เซอร์จะไม่ต้องเช็คสถานะทุก 1 นาทีอีก

## จุดที่ต้องแก้ใน sitemap

ไฟล์ `app/sitemap.ts`:

- ลบ `import { isMaintenanceMode } from "./lib/settingsStore";`
- ลบ `const maintenanceOn = await isMaintenanceMode();` และคอมเมนต์ที่อยู่เหนือบรรทัดนี้
- ใน `staticRoutes` ให้ลบเงื่อนไข `...(maintenanceOn ? [] : [...])` แล้วใส่ `/catalog` เป็นรายการปกติแทน (ต้องยังอยู่ใน sitemap)

## ไฟล์ที่ลบทิ้งได้ทั้งไฟล์

- [ ] `app/components/MaintenanceOverlay.tsx`: หน้า "กำลังปรับปรุง" ที่เช็คสถานะทุก 1 นาที
- [ ] `app/components/MaintenanceBanner.tsx`: ป้ายแจ้ง admin ที่มุมจอ
- [ ] `app/lib/maintenanceConfig.ts`: รายชื่อหน้าที่ถูกปิด (`MAINTENANCE_BLOCKED_PATHS`)
- [ ] `app/api/settings/maintenance/` ทั้งโฟลเดอร์ (รวม `otp/`)
- [ ] `__tests__/components/MaintenanceOverlay.test.tsx`
- [ ] `__tests__/api/settings-maintenance.test.ts`

## ไฟล์ที่ต้องแก้ (ห้ามลบทั้งไฟล์)

- [ ] `app/layout.tsx`
  - เอา `<MaintenanceOverlay>` และ `<MaintenanceBanner>` ออก
  - ลบบรรทัดที่เรียก `isMaintenanceMode()` และลบ import ทั้งหมดที่เกี่ยวข้อง
- [ ] `app/components/Footer.tsx`
  - ⚠️ **จุดนี้สำคัญที่สุด** ตอนนี้ Footer ซ่อนเบอร์โทร, LINE และที่อยู่ตอนโหมดเปิดอยู่
  - ลบ prop `maintenanceOn` และเงื่อนไข `hideContact` ให้ข้อมูลติดต่อ**แสดงตลอด**
  - ระวังอย่าแก้กลับด้านจนข้อมูลติดต่อหายไปถาวร
- [ ] ลบ `maintenanceOn` ที่ส่งให้ Footer ในทุกหน้า และลบ `isMaintenanceMode()` ออกจาก `Promise.all` ด้วย:
  - `app/page.tsx`
  - `app/about/page.tsx`
  - `app/contact/page.tsx`
  - `app/catalog/layout.tsx`
  - `app/showcase/[id]/page.tsx`
  - `app/showcase/[id]/ShowcaseClient.tsx` (prop `maintenanceOn`)
  - `app/products/page.tsx`
  - `app/products/[slug]/page.tsx`
  - `app/services/[slug]/page.tsx`
- [ ] `app/settings/page.tsx`: ลบ `MaintenanceModeSection` ทั้งส่วน รวมหน้าจอกรอก OTP
- [ ] `app/lib/settingsStore.ts`
  - ลบ `isMaintenanceMode`, `loadMaintenanceMode` และ `MAINTENANCE_MODE_SETTING`
  - แก้คอมเมนต์ของ `getSessionEpoch` ที่เขียนว่า "like isMaintenanceMode()'s fail-open"
- [ ] `app/lib/mailer.ts`: ลบ `sendMaintenanceOtpEmail`
- [ ] `app/sitemap.ts`: ดูหัวข้อ "จุดที่ต้องแก้ใน sitemap" ด้านบน

## เทสต์ที่ต้องแก้ตาม

- [ ] `__tests__/sitemap.test.ts`: ลบเคสที่ทดสอบโหมดปรับปรุง
- [ ] `__tests__/components/Footer.test.tsx`: ลบเคสที่ซ่อนข้อมูลติดต่อ และลบ prop `maintenanceOn`
- [ ] `__tests__/lib/settingsStore.test.ts`: ลบเทสต์ของ `isMaintenanceMode`
- [ ] ลบ prop `maintenanceOn` (และ `isMaintenanceMode` ใน mock ถ้ามี) ออกจาก:
  - `__tests__/pages/showcasePayload.test.tsx`
  - `__tests__/components/ShowcaseClientTextRendering.test.tsx`
  - `__tests__/components/ShowcaseClientSaveBlocks.test.tsx`

## ห้ามลบ

- `app/lib/otpAttempts.ts`: OTP ของส่วนอื่นยังใช้อยู่ (company profile, contact email, Cloudinary orphans, ลบเครื่อง)
- `https://api.qrserver.com` ใน CSP (`next.config.ts`): QR code ของ LINE ยังใช้อยู่
- คำว่า "maintenance" ใน `app/i18n/translations.ts` และ `app/components/ProductsJsonLd.tsx` หมายถึงบริการซ่อมบำรุง ไม่ใช่โหมดปรับปรุงเว็บ

## ไม่ต้องทำ หรือเลือกทำก็ได้

- **`SCHEMA_VERSION`:** ไม่ต้อง bump เพราะไม่ได้เปลี่ยนโครงสร้างตาราง
- **ข้อมูลที่ค้างในตาราง `settings`:** แถวพวกนี้จะค้างอยู่ ปล่อยไว้ได้ไม่มีผลอะไร หรือจะลบด้วยมือครั้งเดียวก็ได้
  ```sql
  DELETE FROM settings WHERE name IN (
    'maintenance_mode', 'maintenance_otp_state', 'maintenance_otp_attempts',
    'maintenance_otp', 'maintenance_otp_legacy_expires_unused'
  );
  ```
- **เอกสารใน `openspec/archive/`:** ไม่ต้องแก้ เป็นแค่ประวัติ
- **ARCHITECTURE.md:** ไม่ได้บันทึกเรื่องนี้ไว้ ไม่ต้องแก้
- **ถ้าลบตอนที่โหมดยังเปิดอยู่ใน production:** ไม่มีปัญหา deploy แล้วเว็บแสดงตามปกติทันที

## ตรวจหลังลบ

- [ ] ค้นหา `isMaintenanceMode`, `maintenanceOn`, `MaintenanceOverlay`, `MaintenanceBanner`, `maintenanceConfig` และ `/api/settings/maintenance` ทั้งโปรเจค ต้องไม่เจอเลย
- [ ] `npx tsc --noEmit` ผ่าน
- [ ] `npm run lint` ไม่มี error เพิ่ม
- [ ] `npm run test:run` ผ่านทั้งหมด
- [ ] เปิดหน้าแรก, /about, /contact, /catalog, /products, หน้าหมวดสินค้า, หน้าบริการ และหน้า showcase แล้ว footer แสดงเบอร์โทร, LINE และที่อยู่ครบ
- [ ] เปิด `/sitemap.xml` แล้วมี `/catalog` อยู่
- [ ] ลบไฟล์นี้ทิ้งเมื่อทำเสร็จ
