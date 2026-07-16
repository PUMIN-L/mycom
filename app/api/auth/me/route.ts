import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({ user: { username: session.username, userId: session.userId } });
}
