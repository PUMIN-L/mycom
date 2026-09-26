import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { withRoute, requireAuth, jsonError } from "../../lib/apiHelpers";

// `?fields=list` — every column EXCEPT `note`. `note` is the years-long call
// log (up to 2000 Thai characters, ~5.5 KB each), and it is by far the bulk of
// this response; the pickers that load the whole customer list (task links,
// equipment/sales forms, quotation, service job, dashboard) only ever show a
// name, company, department, phone or email.
//
// ⚠️ A row from this list must never be written back through
// PUT /api/customers/[id]: that route treats a missing `note` as an empty one
// and would erase the log. Only /customers and CustomerDetailsModal write
// customers, and both work from full rows (this route without `fields`, or
// GET /api/customers/[id]).
const LIST_COLUMNS =
  "customers.id, customers.companyId, customers.name, customers.department, customers.phone, customers.email, customers.createdAt, customers.noteUpdatedAt";

export const GET = withRoute(
  "โหลดรายชื่อลูกค้าไม่สำเร็จ",
  async (request: Request) => {
    await requireAuth();

    const listOnly = new URL(request.url).searchParams.get("fields") === "list";
    const [rows] = await query(`
      SELECT ${listOnly ? LIST_COLUMNS : "customers.*"}, companies.name as companyName
      FROM customers
      LEFT JOIN companies ON customers.companyId = companies.id
      ORDER BY customers.createdAt DESC
    `);
    return NextResponse.json(rows);
  }
);

export const POST = withRoute(
  "เพิ่มลูกค้าไม่สำเร็จ",
  async (request: Request) => {
    await requireAuth();

    const data = await request.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (!data.companyId || typeof data.companyId !== "string" || data.companyId.trim() === "") {
      return jsonError("กรุณาเลือกบริษัท", 400);
    }
    
    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return jsonError("กรุณากรอกชื่อ", 400);
    }

    const companyId = sanitizePlainText(data.companyId).substring(0, 255);
    const name = sanitizePlainText(data.name).substring(0, 255);
    const department = sanitizePlainText(data.department || "").substring(0, 255);
    const phone = sanitizePlainText(data.phone || "").substring(0, 255);
    const email = sanitizePlainText(data.email || "").substring(0, 255);
    const note = sanitizePlainText(data.note || "").substring(0, 2000);

    await query(
      `INSERT INTO customers (id, companyId, name, department, phone, email, note, createdAt, noteUpdatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        companyId,
        name,
        department,
        phone,
        email,
        note,
        now,
        // A note typed in at creation is the note's first update; no note, no
        // stamp — an empty note sorts to the bottom of /customers.
        note ? now : null,
      ]
    );

    return NextResponse.json({ id });
  }
);
