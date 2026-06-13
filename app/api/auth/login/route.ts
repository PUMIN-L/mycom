import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "../../../lib/db";
import { createSession } from "../../../lib/session";
import { withRoute } from "../../../lib/apiHelpers";
import { RowDataPacket } from "mysql2";

const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();

export const POST = withRoute(
  "เกิดข้อผิดพลาด กรุณาลองใหม่",
  async (request: NextRequest) => {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const limitRecord = rateLimitMap.get(ip);
    
    if (limitRecord && limitRecord.expiresAt > now) {
      if (limitRecord.count >= 5) {
        return NextResponse.json(
          { error: "เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณารอสักครู่" },
          { status: 429 }
        );
      }
    } else if (limitRecord && limitRecord.expiresAt <= now) {
      rateLimitMap.delete(ip);
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "กรุณากรอก username และ password" },
        { status: 400 }
      );
    }

    const [rows] = await query<RowDataPacket[]>(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // Record failed attempt
      const current = rateLimitMap.get(ip);
      rateLimitMap.set(ip, {
        count: (current?.count || 0) + 1,
        expiresAt: current ? current.expiresAt : now + 15 * 60 * 1000 // 15 mins block
      });

      return NextResponse.json(
        { error: "username หรือ password ไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    // Clear failed attempts on success
    rateLimitMap.delete(ip);

    // Create JWT session cookie
    await createSession(user.id, user.username);
    return NextResponse.json({ success: true, username: user.username });
  }
);
