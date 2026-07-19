import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { listContactMessages } from "../../../lib/contactMessageStore";

// GET /api/contact/messages (login required) — the admin inbox of stored leads.
export const GET = withRoute("โหลดข้อความติดต่อไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json(await listContactMessages());
});
