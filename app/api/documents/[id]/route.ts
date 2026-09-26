import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import { getDocument, deleteDocument, updateDocument } from "../../../lib/documentStore";

export const dynamic = "force-dynamic";

export const DELETE = withRoute(
  "ลบเอกสารไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;

    const doc = await getDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "ไม่พบเอกสารนี้" }, { status: 404 });
    }

    // Collect Cloudinary URLs for client-side deletion confirmation.
    // We no longer auto-delete from Cloudinary.
    const orphanedImages: string[] = [];
    if (doc.pdfUrl && doc.pdfUrl.includes("cloudinary.com")) {
      orphanedImages.push(doc.pdfUrl);
    }
    if (doc.coverUrl && doc.coverUrl.includes("cloudinary.com")) {
      orphanedImages.push(doc.coverUrl);
    }
    
    // Delete from database
    await deleteDocument(id);
    revalidateTag("documents", { expire: 0 });

    return NextResponse.json({ success: true, orphanedImages });
  }
);

export const PUT = withRoute(
  "แก้ไขเอกสารไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    
    const doc = await getDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "ไม่พบเอกสารนี้" }, { status: 404 });
    }

    const { title, description } = body;
    if (!title) {
      return NextResponse.json({ error: "กรุณากรอกชื่อเอกสาร" }, { status: 400 });
    }

    await updateDocument(id, { title, description });
    revalidateTag("documents", { expire: 0 });

    return NextResponse.json({ success: true });
  }
);
