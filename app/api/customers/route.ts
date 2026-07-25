import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { getSession } from "../../lib/session";
import { stripHtml } from "../../lib/stripHtml";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [rows] = await query(`
      SELECT customers.*, companies.name as companyName 
      FROM customers 
      LEFT JOIN companies ON customers.companyId = companies.id 
      ORDER BY customers.createdAt DESC
    `);
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GET /api/customers error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (!data.companyId || typeof data.companyId !== "string" || data.companyId.trim() === "") {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    
    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const companyId = stripHtml(data.companyId).substring(0, 255);
    const name = stripHtml(data.name).substring(0, 255);
    const department = stripHtml(data.department || "").substring(0, 255);
    const phone = stripHtml(data.phone || "").substring(0, 255);
    const email = stripHtml(data.email || "").substring(0, 255);
    const note = stripHtml(data.note || "").substring(0, 2000);

    await query(
      `INSERT INTO customers (id, companyId, name, department, phone, email, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        companyId,
        name,
        department,
        phone,
        email,
        note,
        now,
      ]
    );

    return NextResponse.json({ id });
  } catch (error: any) {
    console.error("POST /api/customers error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
