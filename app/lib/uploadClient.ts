// Upload a file the way /api/upload does, from the browser — whatever its size.
//
// A drop-in for `fetch("/api/upload", { method: "POST", body: formData })`:
// the same FormData in ("file", optional isDocument = "true"), a Response of
// the same shape out ({ url } or { url, coverUrl }, or { error } with a status),
// so the callers' handling does not change.
//
// Small files still go through /api/upload and its server-side checks. Files
// over DIRECT_UPLOAD_THRESHOLD cannot: Vercel refuses a request body over
// 4.5 MB before it reaches the function (see lib/uploadLimits.ts). Those are
// checked here against the same limits, then uploaded straight to Cloudinary
// with signatures from /api/upload/sign (login required, folder and formats
// fixed by the signature).

import {
  ALLOWED_IMAGE_TYPES,
  DIRECT_UPLOAD_THRESHOLD,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  isPdfFile,
} from "./uploadLimits";

interface SignedUpload {
  resourceType: "image" | "raw";
  params: Record<string, string | number>;
  signature: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function uploadFormData(formData: FormData): Promise<Response> {
  const file = formData.get("file");
  const isDocument = formData.get("isDocument") === "true";

  if (!(file instanceof Blob) || file.size <= DIRECT_UPLOAD_THRESHOLD) {
    return fetch("/api/upload", { method: "POST", body: formData });
  }

  // The checks /api/upload makes, made here — the file never passes it.
  const maxBytes = isDocument ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return jsonResponse(413, { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${Math.round(maxBytes / (1024 * 1024))}MB)` });
  }
  const name = file instanceof File ? file.name : "";
  if (isDocument && !isPdfFile({ name, type: file.type })) {
    return jsonResponse(400, { error: "เอกสารต้องเป็นไฟล์ PDF เท่านั้น" });
  }
  if (!isDocument && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return jsonResponse(400, { error: "ไม่รองรับไฟล์รูปประเภทนี้ (รองรับ JPEG, PNG, WebP, GIF)" });
  }

  const signRes = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: isDocument ? "document" : "image" }),
  });
  if (!signRes.ok) return signRes; // 401, 429, … — as /api/upload would answer

  const signed = (await signRes.json().catch(() => null)) as {
    cloudName?: string;
    apiKey?: string;
    uploads?: SignedUpload[];
  } | null;
  if (!signed?.cloudName || !signed.apiKey || !Array.isArray(signed.uploads) || signed.uploads.length === 0) {
    return jsonResponse(502, { error: "ขอสิทธิ์อัปโหลดไม่สำเร็จ" });
  }

  // Both copies of a PDF at once, as /api/upload does.
  const results = await Promise.all(
    signed.uploads.map(async (upload): Promise<{ url?: string; error?: string }> => {
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", signed.apiKey!);
      body.append("signature", upload.signature);
      for (const [key, value] of Object.entries(upload.params)) body.append(key, String(value));
      try {
        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName!)}/${upload.resourceType}/upload`,
          { method: "POST", body }
        );
        const data = (await res.json().catch(() => null)) as { secure_url?: unknown; error?: { message?: unknown } } | null;
        if (res.ok && typeof data?.secure_url === "string") return { url: data.secure_url };
        const reason = typeof data?.error?.message === "string" ? data.error.message : `HTTP ${res.status}`;
        return { error: reason };
      } catch {
        return { error: "เชื่อมต่อ Cloudinary ไม่ได้" };
      }
    })
  );

  const failed = results.find((r) => !r.url);
  if (failed) {
    return jsonResponse(502, { error: `อัปโหลดไป Cloudinary ไม่สำเร็จ: ${failed.error}` });
  }
  if (isDocument) {
    const [imageUrl, rawUrl] = results.map((r) => r.url!);
    return jsonResponse(200, { url: rawUrl, coverUrl: imageUrl.replace(/\.pdf$/i, ".jpg") });
  }
  return jsonResponse(200, { url: results[0].url });
}
