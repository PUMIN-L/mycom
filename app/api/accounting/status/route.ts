import { withRoute, requireAuth, ApiError } from "../../../lib/apiHelpers";
import { getTwoFactorUser } from "../../../lib/twoFactor";
import { isAccountingEnabled, noStoreJson } from "../../../lib/accounting/guard";

// GET /api/accounting/status — what the accounting pages need to know before
// anything else: whether the signed-in admin may use the module yet. The one
// accounting route that answers WITHOUT two-factor on, so the page can say
// "turn 2FA on first" instead of failing.
export const GET = withRoute("โหลดสถานะระบบบัญชีไม่สำเร็จ", async () => {
  if (!isAccountingEnabled()) throw new ApiError(404, "ไม่พบหน้านี้");
  const session = await requireAuth();
  const user = await getTwoFactorUser(session.userId);
  if (!user) throw new ApiError(401, "Unauthorized");
  return noStoreJson({ twoFactorEnabled: user.totpEnabled, username: user.username });
});
