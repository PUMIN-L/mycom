// @vitest-environment node
/**
 * POST /api/upload/sign — signatures for a browser upload straight to
 * Cloudinary, for files Vercel would refuse to pass to /api/upload (its 4.5 MB
 * body limit). Cloudinary accepts only the exact parameters signed, so this is
 * the whole of what the browser may do: our folder, an image type, a PDF.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";

process.env.CLOUDINARY_CLOUD_NAME = "demo-cloud";
process.env.CLOUDINARY_API_KEY = "key-123";
process.env.CLOUDINARY_API_SECRET = "secret-xyz";

import { POST } from "@/app/api/upload/sign/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/upload/sign", {
    method: "POST",
    headers: { origin: "http://localhost:3000", host: "localhost:3000" },
    body: JSON.stringify(body),
  });

/** Cloudinary's documented signature: sorted params joined with &, + secret, SHA-1. */
function expectedSignature(params: Record<string, string | number>) {
  const s = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(s + "secret-xyz").digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ userId: "u1", username: "admin", expiresAt: new Date() } as never);
});

describe("POST /api/upload/sign", () => {
  it("refuses anyone not logged in", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(req({ kind: "image" }));
    expect(res.status).toBe(401);
  });

  it("refuses an unknown kind", async () => {
    for (const kind of [undefined, "video", "raw", 1]) {
      const res = await POST(req({ kind }));
      expect(res.status, String(kind)).toBe(400);
    }
  });

  it("signs one image upload into our folder, image types only", async () => {
    const res = await POST(req({ kind: "image" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cloudName).toBe("demo-cloud");
    expect(body.apiKey).toBe("key-123");
    expect(JSON.stringify(body)).not.toContain("secret-xyz");
    expect(body.uploads).toHaveLength(1);
    const [u] = body.uploads;
    expect(u.resourceType).toBe("image");
    expect(u.params).toMatchObject({ folder: "samples/mycom", allowed_formats: "jpg,jpeg,png,webp,gif" });
    expect(Math.abs(u.params.timestamp - Date.now() / 1000)).toBeLessThan(5);
    expect(u.signature).toBe(expectedSignature(u.params));
  });

  it("signs a PDF twice, as /api/upload uploads it: an image copy (cover) and a raw copy", async () => {
    const body = await (await POST(req({ kind: "document" }))).json();
    expect(body.uploads.map((u: { resourceType: string }) => u.resourceType)).toEqual(["image", "raw"]);
    const [image, raw] = body.uploads;
    expect(image.params).toMatchObject({ folder: "samples/mycom", allowed_formats: "pdf" });
    expect(raw.params.folder).toBe("samples/mycom");
    expect(raw.params.public_id).toMatch(/^doc_\d+_[a-z0-9]+\.pdf$/);
    for (const u of body.uploads) expect(u.signature).toBe(expectedSignature(u.params));
  });

  it("says so when Cloudinary is not configured", async () => {
    const saved = process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_API_SECRET;
    try {
      const res = await POST(req({ kind: "image" }));
      expect(res.status).toBe(500);
    } finally {
      process.env.CLOUDINARY_API_SECRET = saved;
    }
  });
});
