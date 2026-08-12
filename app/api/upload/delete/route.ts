import { NextRequest, NextResponse } from "next/server";
import { safeDeleteCloudinaryImage } from "../../../lib/imageUsageHelper";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";

/**
 * DELETE /api/upload/delete  (login required)
 * Body: { imageUrl: string }
 *
 * Deletes a single image from Cloudinary. Used when removing one image block
 * without deleting the whole content.
 */
export const DELETE = withRoute(
  "Failed to delete image",
  async (request: NextRequest) => {
    await requireAuth();

    const { imageUrl, contentId } = await request.json();
    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }

    const excludeSource = contentId ? { type: "content" as const, id: contentId } : undefined;
    const ok = await safeDeleteCloudinaryImage(imageUrl, excludeSource);
    return NextResponse.json({ success: ok });
  }
);
