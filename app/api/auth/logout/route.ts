import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "../../../lib/session";
import { withRoute } from "../../../lib/apiHelpers";

export const POST = withRoute(
  "ออกจากระบบไม่สำเร็จ",
  async (_request: NextRequest) => {
    await deleteSession();
    return NextResponse.json({ success: true });
  }
);
