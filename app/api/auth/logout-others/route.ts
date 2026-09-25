import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createSession } from "../../../lib/session";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { bumpSessionEpoch, SESSION_EPOCH_TAG } from "../../../lib/settingsStore";
import {
  LOGIN_DEVICE_COOKIE,
  LOGIN_DEVICE_COOKIE_OPTIONS,
  issueLoginDeviceToken,
} from "../../../lib/loginDevice";

// POST /api/auth/logout-others — "ออกจากระบบอุปกรณ์อื่นทั้งหมด".
//
// Bumps the session epoch, which voids every session and login-device token
// issued so far (see settingsStore.ts), then re-issues THIS browser's session
// and device token under the new epoch so the admin who pressed the button
// stays logged in here. Other browsers are logged out on their next request.
export const POST = withRoute(
  "ออกจากระบบอุปกรณ์อื่นไม่สำเร็จ",
  async (_request: NextRequest) => {
    const session = await requireAuth();

    const epoch = await bumpSessionEpoch();
    revalidateTag(SESSION_EPOCH_TAG, { expire: 0 });

    // The new epoch is passed explicitly rather than read back through the
    // cache just busted.
    await createSession(session.userId, session.username, epoch);
    const response = NextResponse.json({ success: true });
    response.cookies.set(
      LOGIN_DEVICE_COOKIE,
      await issueLoginDeviceToken(session.username, epoch),
      LOGIN_DEVICE_COOKIE_OPTIONS
    );
    return response;
  }
);
