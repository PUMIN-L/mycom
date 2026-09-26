// @vitest-environment node
/**
 * uploadFormData — the drop-in for fetch("/api/upload"). Small files keep the
 * route; files over DIRECT_UPLOAD_THRESHOLD go straight to Cloudinary with
 * signatures from /api/upload/sign, because Vercel refuses a request body over
 * 4.5 MB before /api/upload ever sees it. Either way the caller gets the same
 * Response shape it always read.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadFormData } from "@/app/lib/uploadClient";
import { DIRECT_UPLOAD_THRESHOLD, MAX_IMAGE_BYTES, MAX_PDF_BYTES } from "@/app/lib/uploadLimits";

const MB = 1024 * 1024;

function fileOf(bytes: number, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function form(file: File, isDocument = false): FormData {
  const fd = new FormData();
  fd.append("file", file);
  if (isDocument) fd.append("isDocument", "true");
  return fd;
}

const SIGNED_IMAGE = {
  cloudName: "demo-cloud",
  apiKey: "key-123",
  uploads: [
    { resourceType: "image", params: { folder: "samples/mycom", timestamp: 1700000000, allowed_formats: "jpg,png" }, signature: "sig-img" },
  ],
};
const SIGNED_DOC = {
  cloudName: "demo-cloud",
  apiKey: "key-123",
  uploads: [
    { resourceType: "image", params: { folder: "samples/mycom", timestamp: 1700000000, allowed_formats: "pdf" }, signature: "sig-cover" },
    { resourceType: "raw", params: { folder: "samples/mycom", timestamp: 1700000000, public_id: "doc_1_x.pdf" }, signature: "sig-raw" },
  ],
};

type Answer = { status: number; body: unknown } | "network-error";
function stubFetch(routes: Record<string, Answer | ((init?: RequestInit) => Answer)>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const entry = routes[url];
    if (!entry) throw new Error(`unexpected fetch ${url}`);
    const answer = typeof entry === "function" ? entry(init) : entry;
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CLOUD_IMAGE = "https://api.cloudinary.com/v1_1/demo-cloud/image/upload";
const CLOUD_RAW = "https://api.cloudinary.com/v1_1/demo-cloud/raw/upload";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadFormData — small files keep /api/upload", () => {
  it("sends the very same FormData to /api/upload and returns its answer", async () => {
    const fetchMock = stubFetch({ "/api/upload": { status: 200, body: { url: "https://res.cloudinary.com/x.jpg" } } });
    const fd = form(fileOf(DIRECT_UPLOAD_THRESHOLD, "a.jpg", "image/jpeg"));
    const res = await uploadFormData(fd);
    expect(await res.json()).toEqual({ url: "https://res.cloudinary.com/x.jpg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: fd });
  });
});

describe("uploadFormData — large files go straight to Cloudinary", () => {
  it("uploads an image with the signed parameters and answers { url }", async () => {
    const fetchMock = stubFetch({
      "/api/upload/sign": { status: 200, body: SIGNED_IMAGE },
      [CLOUD_IMAGE]: { status: 200, body: { secure_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/big.jpg" } },
    });
    const file = fileOf(DIRECT_UPLOAD_THRESHOLD + 1, "big.jpg", "image/jpeg");
    const res = await uploadFormData(form(file));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/big.jpg" });
    // Never through /api/upload — Vercel would refuse it.
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/upload")).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ kind: "image" });
    const sent = fetchMock.mock.calls.find(([u]) => u === CLOUD_IMAGE)![1]!.body as FormData;
    expect(sent.get("file")).toBe(file);
    expect(sent.get("api_key")).toBe("key-123");
    expect(sent.get("signature")).toBe("sig-img");
    expect(sent.get("folder")).toBe("samples/mycom");
    expect(sent.get("timestamp")).toBe("1700000000");
    expect(sent.get("allowed_formats")).toBe("jpg,png");
  });

  it("uploads a PDF twice and answers { url: raw copy, coverUrl: .jpg of the image copy }", async () => {
    const fetchMock = stubFetch({
      "/api/upload/sign": { status: 200, body: SIGNED_DOC },
      [CLOUD_IMAGE]: { status: 200, body: { secure_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/samples/mycom/abc.pdf" } },
      [CLOUD_RAW]: { status: 200, body: { secure_url: "https://res.cloudinary.com/demo-cloud/raw/upload/v1/samples/mycom/doc_1_x.pdf" } },
    });
    const res = await uploadFormData(form(fileOf(8 * MB, "catalog.pdf", "application/pdf"), true));
    expect(await res.json()).toEqual({
      url: "https://res.cloudinary.com/demo-cloud/raw/upload/v1/samples/mycom/doc_1_x.pdf",
      coverUrl: "https://res.cloudinary.com/demo-cloud/image/upload/v1/samples/mycom/abc.jpg",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ kind: "document" });
    const raw = fetchMock.mock.calls.find(([u]) => u === CLOUD_RAW)![1]!.body as FormData;
    expect(raw.get("public_id")).toBe("doc_1_x.pdf");
  });

  it("refuses a file over the limit before asking for anything", async () => {
    const fetchMock = stubFetch({});
    const res = await uploadFormData(form(fileOf(MAX_IMAGE_BYTES + 1, "huge.jpg", "image/jpeg")));
    expect(res.status).toBe(413);
    const doc = await uploadFormData(form(fileOf(MAX_PDF_BYTES + 1, "huge.pdf", "application/pdf"), true));
    expect(doc.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a type /api/upload would refuse", async () => {
    stubFetch({});
    expect((await uploadFormData(form(fileOf(5 * MB, "x.svg", "image/svg+xml")))).status).toBe(400);
    expect((await uploadFormData(form(fileOf(5 * MB, "x.docx", "application/msword"), true))).status).toBe(400);
  });

  it("passes the signing route's refusal through (e.g. an expired session)", async () => {
    stubFetch({ "/api/upload/sign": { status: 401, body: { error: "Unauthorized" } } });
    const res = await uploadFormData(form(fileOf(5 * MB, "big.jpg", "image/jpeg")));
    expect(res.status).toBe(401);
  });

  it("reports Cloudinary refusing the upload, with its reason", async () => {
    stubFetch({
      "/api/upload/sign": { status: 200, body: SIGNED_IMAGE },
      [CLOUD_IMAGE]: { status: 400, body: { error: { message: "Invalid Signature" } } },
    });
    const res = await uploadFormData(form(fileOf(5 * MB, "big.jpg", "image/jpeg")));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Invalid Signature");
  });

  it("reports a PDF whose second copy failed — never half an answer", async () => {
    stubFetch({
      "/api/upload/sign": { status: 200, body: SIGNED_DOC },
      [CLOUD_IMAGE]: { status: 200, body: { secure_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/a.pdf" } },
      [CLOUD_RAW]: "network-error",
    });
    const res = await uploadFormData(form(fileOf(8 * MB, "c.pdf", "application/pdf"), true));
    expect(res.status).toBe(502);
  });
});
