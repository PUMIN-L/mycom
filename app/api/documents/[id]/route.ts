import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import { getDocument, deleteDocument, updateDocument } from "../../../lib/documentStore";
import { deleteCloudinaryImage } from "../../../lib/cloudinaryHelper";
import { safeDeleteCloudinaryImage } from "../../../lib/imageUsageHelper";

export const dynamic = "force-dynamic";

export const DELETE = withRoute(
  "Failed to delete document",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;

    const doc = await getDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Delete files from cloudinary (only if not used by others)
    if (doc.pdfUrl) {
      await safeDeleteCloudinaryImage(doc.pdfUrl, { type: 'document', id });
    }
    if (doc.coverUrl) {
      await safeDeleteCloudinaryImage(doc.coverUrl, { type: 'document', id });
    }
    
    // Delete from database
    await deleteDocument(id);

    return NextResponse.json({ success: true });
  }
);

export const PUT = withRoute(
  "Failed to update document",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    
    const doc = await getDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { title, description } = body;
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    await updateDocument(id, { title, description });

    return NextResponse.json({ success: true });
  }
);
