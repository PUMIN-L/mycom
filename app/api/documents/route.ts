import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../lib/apiHelpers";
import { addDocument, getAllDocuments } from "../../lib/documentStore";

export const dynamic = "force-dynamic";

export const GET = withRoute(
  "Failed to fetch documents",
  async () => {
    const docs = await getAllDocuments();
    return NextResponse.json(docs);
  }
);

export const POST = withRoute(
  "Failed to create document",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body.id || !body.title || !body.pdfUrl || !body.coverUrl) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newDoc = {
      id: body.id,
      title: body.title,
      description: body.description || "",
      pdfUrl: body.pdfUrl,
      coverUrl: body.coverUrl,
      createdAt: new Date().toISOString(),
      sortOrder: body.sortOrder || 0,
    };

    await addDocument(newDoc);
    return NextResponse.json(newDoc, { status: 201 });
  }
);
