// @vitest-environment node
/**
 * /api/admin/missing-images (the list) and …/check (a batch): logged-in
 * admins only; a batch is 1–20 strings; only Cloudinary files are fetched;
 * the same-origin guard and a per-admin rate limit apply to the check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/session", () => ({ getSession: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn() }));
vi.mock("@/app/lib/imageReferences", () => ({ listImageReferences: vi.fn(async () => []) }));

import { getSession } from "@/app/lib/session";
import { listImageReferences } from "@/app/lib/imageReferences";
import { GET as listGET, maxDuration as listMaxDuration } from "@/app/api/admin/missing-images/route";
import { POST as checkPOST, maxDuration } from "@/app/api/admin/missing-images/check/route";

const CLD = "https://res.cloudinary.com/demo/image/upload/v1/";
const ADMIN = { userId: "admin-001", username: "admin" };
let userSeq = 0;

const checkRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/admin/missing-images/check", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // A fresh admin per test, so the per-admin rate limit never carries over.
  userSeq += 1;
  vi.mocked(getSession).mockResolvedValue({ ...ADMIN, userId: `admin-${userSeq}` } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/admin/missing-images", () => {
  it("refuses without a session, and reads nothing", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await listGET();
    expect(res.status).toBe(401);
    expect(listImageReferences).not.toHaveBeenCalled();
  });

  it("answers the pages and each file once", async () => {
    vi.mocked(listImageReferences).mockResolvedValue([
      { url: `${CLD}a.jpg`, kind: "content", sourceId: "c1", title: "A", where: "บล็อกที่ 1 (รูป)", href: "/showcase/c1", hidden: false },
      { url: `${CLD}a.jpg`, kind: "product", sourceId: "p1", title: "P", where: "รูปสินค้า", href: "/edit-product/p1", hidden: true },
    ]);
    const res = await listGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pages: [
        { kind: "content", sourceId: "c1", title: "A", href: "/showcase/c1", hidden: false },
        { kind: "product", sourceId: "p1", title: "P", href: "/edit-product/p1", hidden: true },
      ],
      images: [{ url: `${CLD}a.jpg`, uses: [{ page: 0, where: "บล็อกที่ 1 (รูป)" }, { page: 1, where: "รูปสินค้า" }] }],
    });
  });
});

describe("GET /api/admin/missing-images — rate limit", () => {
  it("reads every document at most 10 times a minute per admin", async () => {
    for (let i = 0; i < 10; i++) expect((await listGET()).status).toBe(200);
    const refused = await listGET();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await refused.json()).error).toBe("โหลดรายการรูปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");
    expect(listImageReferences).toHaveBeenCalledTimes(10);
  });
});

describe("POST /api/admin/missing-images/check", () => {
  it("refuses without a session, and fetches nothing", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkPOST(checkRequest({ urls: [`${CLD}a.jpg`] }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers each file: there, missing, or could not tell — and never fetches a non-Cloudinary address", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(null, { status: url.endsWith("gone.jpg") ? 404 : 200, headers: { "x-cld-error": "Resource not found" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkPOST(checkRequest({ urls: [`${CLD}a.jpg`, `${CLD}gone.jpg`, "http://169.254.169.254/latest"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { url: `${CLD}a.jpg`, status: "ok", httpStatus: 200 },
        { url: `${CLD}gone.jpg`, status: "missing", httpStatus: 404, detail: "Resource not found" },
        { url: "http://169.254.169.254/latest", status: "error", httpStatus: null, detail: "unsupported" },
      ],
    });
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([`${CLD}a.jpg`, `${CLD}gone.jpg`]);
  });

  it.each([
    ["no list", {}],
    ["not a list", { urls: "x" }],
    ["an empty list", { urls: [] }],
    ["more than 20", { urls: Array.from({ length: 21 }, (_, i) => `${CLD}${i}.jpg`) }],
  ])("refuses %s (400, in Thai)", async (_, body) => {
    const res = await checkPOST(checkRequest(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ต้องส่งรายการลิงก์รูป 1–20 รายการ");
  });

  it("refuses anything but strings in the list", async () => {
    const res = await checkPOST(checkRequest({ urls: [`${CLD}a.jpg`, { url: "x" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ลิงก์รูปต้องเป็นข้อความ");
  });

  it("refuses a body that is not JSON", async () => {
    const res = await checkPOST(checkRequest("{nope"));
    expect(res.status).toBe(400);
  });

  it("refuses a request from another site (same-origin guard)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkPOST(checkRequest({ urls: [`${CLD}a.jpg`] }, { origin: "https://evil.example", host: "localhost" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("slows a runaway loop down: 120 batches a minute per admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    for (let i = 0; i < 120; i++) {
      expect((await checkPOST(checkRequest({ urls: [`${CLD}a.jpg`] }))).status).toBe(200);
    }
    const refused = await checkPOST(checkRequest({ urls: [`${CLD}a.jpg`] }));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await refused.json()).error).toBe("ตรวจถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
  });

  it("is allowed a minute to run — and so is the list, which reads every document", () => {
    expect(maxDuration).toBe(60);
    expect(listMaxDuration).toBe(60);
  });
});
