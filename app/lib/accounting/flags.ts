// Whether the accounting module is switched on — read by its routes (guard.ts)
// and by the admin panel's menu, so both agree. Always on outside production;
// in production only with NEXT_PUBLIC_ACCOUNTING_ENABLED=1 (inlined into the
// browser bundle at build time, so changing it needs a redeploy). Until then
// a half-built module merged early stays dark on the live site.
export function isAccountingEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ACCOUNTING_ENABLED === "1";
}
