# Proposal: ทำให้ coverage gate เป็นของจริง ไม่ใช่แค่ตัวเลขในเอกสาร

> ที่มา: adversarial review ทั้งโปรเจกต์ (2026-08-31), มิติ tests-honesty

## Why
`vitest.config.ts` ตั้ง threshold ไว้ที่ 95/90/97/96% และ `ARCHITECTURE.md`
เอกสารไว้ว่าทุกไฟล์ใน `app/lib`+`app/api` "ถูก gate ด้วย threshold" — แต่ความจริง
**ไม่มีอะไรบังคับใช้เลย**: `.githooks/pre-push` รัน `vitest run` เฉยๆ (ไม่มี
`--coverage`), ไม่มี CI ถ้ารัน `--coverage` จริงตอนนี้จะ **fail ทั้ง 4 threshold**
(55.49% / 46.6% / 61.4% / 56.92% เทียบกับ 95/90/97/96% ที่ตั้งไว้) เอกสารกับ
ความจริงห่างกันมาก — และ `crmStore.ts` เป็นตัวอย่างที่แย่ที่สุด: เทส API ทุกตัวที่
ควรทดสอบมันกลับ mock มันทิ้ง ทำให้ logic จริงไม่เคยถูกรันเลยแม้แต่ครั้งเดียว
(coverage 3.52%)

## What Changes

1. **Coverage gate ตายจริง** — ต้องมีจุดบังคับใช้จริง ไม่ใช่แค่ threshold ในไฟล์
   config ที่ไม่มีใครรัน เอกสาร `ARCHITECTURE.md` ต้องแก้ให้ตรงความจริง (หรือ
   ทำให้ความจริงตรงกับเอกสาร)

2. **`crmStore.ts` coverage 3.52%** — `__tests__/api/admin-equipments.test.ts`,
   `admin-schedules.test.ts`, `admin-alerts.test.ts` mock ทั้งโมดูล
   `@/app/lib/crmStore` ทำให้ logic จริงทั้งหมด (`completeScheduleWithLog`
   transaction, `syncEquipmentsForSalesRecord`, `getAlerts` date math) ไม่เคย
   ถูกทดสอบตรงๆ เลย — เทส route ที่มีอยู่แค่ยืนยันว่า route เรียก mock function
   ถูกชื่อ ไม่ได้ยืนยันว่า logic ข้างในถูกต้อง

## Impact
- Affected code: `vitest.config.ts`, `.githooks/pre-push` หรือ CI ใหม่,
  `ARCHITECTURE.md`, เทสใหม่ `__tests__/lib/crmStore.test.ts`
- Affected specs: `test-coverage-integrity` (ใหม่)
- ควรทำ**หลังจาก** กลุ่ม `fix-crm-data-integrity` เสร็จ เพราะจะเขียนเทสจริงให้
  `crmStore` ที่โค้ดจะถูกแก้ไปแล้วในกลุ่มนั้น (จะได้ไม่ต้องเขียนเทสซ้ำสองรอบ)
