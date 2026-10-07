import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAuth, withRoute } from "../../lib/apiHelpers";
import { addDocument, getAllDocuments } from "../../lib/documentStore";

export const dynamic = "force-dynamic";

// The id is the document's address (/document/<id>) and its primary key, so it
// must be a plain URL segment. /documents mints "doc-<milliseconds>".
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Whether a URL is a file in OUR Cloudinary account — what /documents uploads
 * and the only thing /api/documents/proxy will fetch. Any other URL saved here
 * would publish a catalog entry whose PDF the proxy refuses to open, or a cover
 * image served from anywhere at all.
 */
function isOurCloudinaryUrl(value: unknown): value is string {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME ?? "";
  return (
    typeof value === "string" &&
    value.length <= 1024 &&
    cloud !== "" &&
    value.startsWith(`https://res.cloudinary.com/${cloud}/`)
  );
}

export const GET = withRoute(
  "โหลดเอกสารไม่สำเร็จ",
  async () => {
    const docs = await getAllDocuments();
    return NextResponse.json(docs);
  }
);

export const POST = withRoute(
  "เพิ่มเอกสารไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body?.id || !body.title || !body.pdfUrl || !body.coverUrl) {
      return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบ" }, { status: 400 });
    }
    // Each field is checked rather than passed through: a number for the title
    // reached the sanitizer and came back a bare 500, and a URL from anywhere
    // was saved and published.
    if (typeof body.id !== "string" || !DOCUMENT_ID.test(body.id)) {
      return NextResponse.json({ error: "รหัสเอกสารไม่ถูกต้อง" }, { status: 400 });
    }
    if (
      typeof body.title !== "string" ||
      (body.description !== undefined && body.description !== null && typeof body.description !== "string")
    ) {
      return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
    if (!isOurCloudinaryUrl(body.pdfUrl) || !isOurCloudinaryUrl(body.coverUrl)) {
      return NextResponse.json(
        { error: "ไฟล์เอกสารต้องอัปโหลดผ่านระบบเท่านั้น" },
        { status: 400 }
      );
    }
    const sortOrder = body.sortOrder ?? 0;
    if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 2147483647) {
      return NextResponse.json({ error: "ลำดับต้องเป็นจำนวนเต็ม" }, { status: 400 });
    }

    const newDoc = {
      id: body.id,
      title: body.title,
      description: body.description || "",
      pdfUrl: body.pdfUrl,
      coverUrl: body.coverUrl,
      createdAt: new Date().toISOString(),
      sortOrder,
    };

    try {
      await addDocument(newDoc);
    } catch (err) {
      // The id is the primary key: a second document under it is a conflict
      // to report, not a crash.
      if ((err as { code?: string })?.code === "ER_DUP_ENTRY") {
        return NextResponse.json({ error: "มีเอกสารรหัสนี้อยู่แล้ว" }, { status: 409 });
      }
      throw err;
    }
    // The catalog list and sitemap read this table from a cross-request cache.
    revalidateTag("documents", { expire: 0 });
    return NextResponse.json(newDoc, { status: 201 });
  }
);
