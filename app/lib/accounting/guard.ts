import "server-only";
import { NextResponse } from "next/server";
import { ApiError, requireAuth } from "../apiHelpers";
import { getTwoFactorUser, type TwoFactorUser } from "../twoFactor";
import type { SessionPayload } from "../session";
import { isAccountingEnabled } from "./flags";

export { isAccountingEnabled };

// Who may use the accounting module, checked on the SERVER by every one of
// its routes (the pages only show what the routes answer):
//   • the module is switched on — always outside production; in production
//     only with NEXT_PUBLIC_ACCOUNTING_ENABLED=1, so a half-built module
//     merged early stays dark on the live site (404 — as if it were not there);
//   • a signed-in admin (401 otherwise);
//   • with two-factor login switched on (403 otherwise): the money and tax data
//     of every customer must not hang on a password alone.

export const TWO_FACTOR_REQUIRED =
  "ระบบบัญชีใช้ได้เมื่อเปิดการยืนยันตัวตนสองขั้นตอน (2FA) แล้วเท่านั้น — เปิดได้ที่หน้า ตั้งค่าระบบ";

export interface AccountingUser {
  session: SessionPayload;
  user: TwoFactorUser;
  /** For the audit log. */
  actor: { userId: string; username: string };
}

export async function requireAccountingUser(): Promise<AccountingUser> {
  if (!isAccountingEnabled()) throw new ApiError(404, "ไม่พบหน้านี้");
  const session = await requireAuth();
  const user = await getTwoFactorUser(session.userId);
  if (!user) throw new ApiError(401, "Unauthorized");
  if (!user.totpEnabled) throw new ApiError(403, TWO_FACTOR_REQUIRED);
  return { session, user, actor: { userId: user.id, username: user.username } };
}

/** JSON the browser must not keep: every accounting answer is customer and money data. */
export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
