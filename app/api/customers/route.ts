import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { withRoute, requireAuth, jsonError } from "../../lib/apiHelpers";

export const GET = withRoute(
  "Failed to load customers",
  async () => {
    await requireAuth();

    const [rows] = await query(`
      SELECT customers.*, companies.name as companyName 
      FROM customers 
      LEFT JOIN companies ON customers.companyId = companies.id 
      ORDER BY customers.createdAt DESC
    `);
    return NextResponse.json(rows);
  }
);

export const POST = withRoute(
  "Failed to create customer",
  async (request: Request) => {
    await requireAuth();

    const data = await request.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (!data.companyId || typeof data.companyId !== "string" || data.companyId.trim() === "") {
      return jsonError("companyId is required", 400);
    }
    
    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return jsonError("Name is required", 400);
    }

    const companyId = sanitizePlainText(data.companyId).substring(0, 255);
    const name = sanitizePlainText(data.name).substring(0, 255);
    const department = sanitizePlainText(data.department || "").substring(0, 255);
    const phone = sanitizePlainText(data.phone || "").substring(0, 255);
    const email = sanitizePlainText(data.email || "").substring(0, 255);
    const note = sanitizePlainText(data.note || "").substring(0, 2000);

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
  }
);
