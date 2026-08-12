import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import { getDocument, deleteDocument, updateDocument } from "../../../lib/documentStore";

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

    return NextResponse.json({ success: true, orphanedImages });
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
