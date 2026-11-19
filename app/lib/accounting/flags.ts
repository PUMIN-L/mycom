// Whether the accounting module is switched on — read by its routes (guard.ts)
// and by the admin panel's menu, so both agree. Always on outside production;
// in production only with NEXT_PUBLIC_ACCOUNTING_ENABLED=1 (inlined into the
// browser bundle at build time, so changing it needs a redeploy). Until then
// a half-built module merged early stays dark on the live site.
export function isAccountingEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED === "1";
}

/**
 * Step 10: once the module is on, the old /billing issues nothing new — this
 * is said wherever it would have (its builder, its save route). Its old
 * documents still open, print and take payments there.
 */
export const ISSUING_MOVED_MESSAGE = "เปิดใช้ระบบบัญชีแล้ว — ใบแจ้งหนี้ ใบวางบิล และใบเสร็จใหม่ ให้ออกที่ ระบบบัญชี";
