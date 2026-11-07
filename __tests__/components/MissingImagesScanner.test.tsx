/**
 * /settings → ตรวจหารูปที่หาย (app/components/MissingImagesScanner.tsx).
 * The list is loaded, the files checked 20 to a batch, and the pages with a
 * missing file shown with a link to fix each; files that could not be
 * checked can be checked again on their own; the scan can be stopped; a
 * lapsed session is said in Thai. Its place: just above the orphan scanner.
 */
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import MissingImagesScanner from "@/app/components/MissingImagesScanner";
import SettingsPage from "@/app/settings/page";
import type { ImageCheckResult, ImageIndex } from "@/app/lib/missingImages";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

const CLD = "https://res.cloudinary.com/demo/image/upload/v1/";
const LIST = "/api/admin/missing-images";
const CHECK = "/api/admin/missing-images/check";

const INDEX: ImageIndex = {
  pages: [
    { kind: "content", sourceId: "c1", title: "No.120-FWP", href: "/showcase/c1", hidden: false },
    { kind: "product", sourceId: "p1", title: "เครื่องชั่ง", href: "/edit-product/p1", hidden: true },
    { kind: "quotation", sourceId: "q1", title: "QT-1 · บริษัท ก", href: "/quotation?id=q1&view=1", hidden: false },
  ],
  images: [
    { url: `${CLD}gone-a.jpg`, uses: [{ page: 0, where: "บล็อกที่ 1 (ข้อความ + รูป)" }] },
    { url: `${CLD}gone-b.png`, uses: [{ page: 0, where: "บล็อกที่ 2 (แกลเลอรี) · รูปที่ 1" }, { page: 1, where: "รูปสินค้า" }] },
    { url: `${CLD}ok.jpg`, uses: [{ page: 2, where: "รายการที่ 1" }] },
  ],
};

type Status = ImageCheckResult["status"];
/** status per file; a file not listed answers "ok". */
function mockNetwork(opts: {
  index?: ImageIndex;
  listStatus?: number;
  statuses?: Record<string, Status | Status[]>;
  checkStatus?: number | number[];
  /** Retry-After on a 429 from the check route (seconds). */
  retryAfter?: string;
  gate?: Promise<void>;
}) {
  let checkCall = 0;
  const seen: Record<string, number> = {};
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === LIST) {
      const status = opts.listStatus ?? 200;
      return { ok: status < 400, status, headers: new Headers(), json: async () => (status < 400 ? opts.index ?? INDEX : { error: "x" }) };
    }
    if (url === CHECK) {
      const call = checkCall++;
      if (opts.gate && call > 0) await opts.gate;
      const status = Array.isArray(opts.checkStatus) ? opts.checkStatus[Math.min(call, opts.checkStatus.length - 1)] : opts.checkStatus ?? 200;
      if (status === 0) throw new TypeError("Failed to fetch");
      const headers = new Headers(status === 429 ? { "Retry-After": opts.retryAfter ?? "0" } : {});
      const urls: string[] = JSON.parse(String(init?.body)).urls;
      const results = urls.map((u) => {
        const s = opts.statuses?.[u];
        const n = (seen[u] = (seen[u] ?? 0) + 1);
        const st = Array.isArray(s) ? s[Math.min(n - 1, s.length - 1)] : s ?? "ok";
        return { url: u, status: st, httpStatus: st === "ok" ? 200 : st === "missing" ? 404 : 503 };
      });
      return { ok: status < 400, status, headers, json: async () => (status < 400 ? { results } : { error: "x" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const checkBodies = (m: ReturnType<typeof mockNetwork>) =>
  m.mock.calls.filter(([u]) => String(u) === CHECK).map(([, init]) => JSON.parse(String((init as RequestInit).body)).urls as string[]);

const start = () => fireEvent.click(screen.getByRole("button", { name: "🔍 เริ่มตรวจ" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MissingImagesScanner", () => {
  it("says what it does, and does nothing until asked", () => {
    const fetchMock = mockNetwork({});
    render(<MissingImagesScanner />);
    expect(screen.getByRole("heading", { name: /ตรวจหารูปที่หาย/ })).toBeInTheDocument();
    expect(screen.getByText(/แค่ตรวจ ไม่ลบหรือแก้ไขอะไร/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows each page with a missing file — what is missing where — with a link to fix it", async () => {
    mockNetwork({ statuses: { [`${CLD}gone-a.jpg`]: "missing", [`${CLD}gone-b.png`]: "missing" } });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByText("พบไฟล์หาย 2 ไฟล์ ใน 2 หน้า — เปิดหน้านั้นแล้วอัปโหลดรูปใหม่แทนรูปที่หาย")).toBeInTheDocument();

    const content = screen.getByText("No.120-FWP").closest("li")!;
    expect(within(content).getByText("หน้าเนื้อหา")).toBeInTheDocument();
    expect(within(content).getByText("บล็อกที่ 1 (ข้อความ + รูป)")).toBeInTheDocument();
    expect(within(content).getByText("gone-a.jpg")).toHaveAttribute("title", `${CLD}gone-a.jpg`);
    expect(within(content).getByText("บล็อกที่ 2 (แกลเลอรี) · รูปที่ 1")).toBeInTheDocument();
    const link = within(content).getByRole("link", { name: "เปิดหน้านี้" });
    expect(link).toHaveAttribute("href", "/showcase/c1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("title", "เปิดในแท็บใหม่");

    const product = screen.getByText("เครื่องชั่ง").closest("li")!;
    expect(within(product).getByText("สินค้า")).toBeInTheDocument();
    expect(within(product).getByText("ซ่อนจากลูกค้า")).toBeInTheDocument();
    expect(within(product).getByRole("link", { name: "เปิดหน้านี้" })).toHaveAttribute("href", "/edit-product/p1");

    // A page whose files are all there is not listed.
    expect(screen.queryByText("QT-1 · บริษัท ก")).not.toBeInTheDocument();
    expect(screen.getByText("ไฟล์ที่เว็บใช้").previousSibling).toHaveTextContent("3");
    expect(screen.getByText("ไฟล์หาย").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("ตรวจไม่ได้").previousSibling).toHaveTextContent("0");
  });

  it("says so plainly when nothing is missing", async () => {
    mockNetwork({});
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByText("✅ ไม่พบรูปที่หาย — ทุกไฟล์ที่เว็บใช้ยังอยู่บน Cloudinary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "🔍 ตรวจใหม่อีกครั้ง" })).toBeInTheDocument();
  });

  it("checks 20 files to a batch, each file once", async () => {
    const index: ImageIndex = {
      pages: [{ kind: "content", sourceId: "c", title: "C", href: "/showcase/c", hidden: false }],
      images: Array.from({ length: 45 }, (_, i) => ({ url: `${CLD}${i}.jpg`, uses: [{ page: 0, where: "x" }] })),
    };
    const fetchMock = mockNetwork({ index });
    render(<MissingImagesScanner />);
    start();
    await screen.findByText(/ไม่พบรูปที่หาย/);
    const bodies = checkBodies(fetchMock);
    expect(bodies.map((b) => b.length).sort((a, b) => b - a)).toEqual([20, 20, 5]);
    expect(new Set(bodies.flat()).size).toBe(45);
  });

  it("files that could not be checked are listed, and checked again on their own", async () => {
    const fetchMock = mockNetwork({ statuses: { [`${CLD}ok.jpg`]: ["error", "ok"] } });
    render(<MissingImagesScanner />);
    start();
    const box = (await screen.findByText("ตรวจไม่ได้ 1 ไฟล์ — ยังไม่รู้ว่าหายหรือไม่")).parentElement!.parentElement!;
    expect(within(box).getByText("ok.jpg")).toBeInTheDocument();
    expect(box).toHaveTextContent("Cloudinary ตอบ 503");
    expect(screen.queryByText(/ไม่พบรูปที่หาย/)).not.toBeInTheDocument();

    fireEvent.click(within(box).getByRole("button", { name: "ตรวจซ้ำเฉพาะที่ตรวจไม่ได้" }));
    expect(await screen.findByText(/ไม่พบรูปที่หาย/)).toBeInTheDocument();
    expect(checkBodies(fetchMock).at(-1)).toEqual([`${CLD}ok.jpg`]);
  });

  it("a batch the server refuses — or that never arrives — counts its files as 'could not check'", async () => {
    mockNetwork({ checkStatus: 500 });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByText("ตรวจไม่ได้ 3 ไฟล์ — ยังไม่รู้ว่าหายหรือไม่")).toBeInTheDocument();
    cleanup();
    mockNetwork({ checkStatus: 0 });
    render(<MissingImagesScanner />);
    start();
    const box = (await screen.findByText("ตรวจไม่ได้ 3 ไฟล์ — ยังไม่รู้ว่าหายหรือไม่")).parentElement!.parentElement!;
    expect(box).toHaveTextContent("เชื่อมต่อ Cloudinary ไม่ได้");
  });

  it("a lapsed session is said in Thai — whether loading the list or checking", async () => {
    mockNetwork({ listStatus: 401 });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
    expect(screen.getByRole("button", { name: "🔍 เริ่มตรวจ" })).toBeEnabled();
    cleanup();

    mockNetwork({ checkStatus: 401 });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("เซสชันหมดอายุ");
    expect(screen.queryByText(/ไม่พบรูปที่หาย/)).not.toBeInTheDocument();
  });

  it("the list failing to load says so — in Thai, even when the network itself fails", async () => {
    mockNetwork({ listStatus: 500 });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรายการรูปไม่สำเร็จ");
    cleanup();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรายการรูปไม่สำเร็จ");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it("shows its progress, and หยุด sends no further batch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const index: ImageIndex = {
      pages: [{ kind: "content", sourceId: "c", title: "C", href: "/showcase/c", hidden: false }],
      images: Array.from({ length: 100 }, (_, i) => ({ url: `${CLD}${i}.jpg`, uses: [{ page: 0, where: "x" }] })),
    };
    const fetchMock = mockNetwork({ index, gate });
    render(<MissingImagesScanner />);
    start();
    const bar = await screen.findByRole("progressbar");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "20"));
    expect(screen.getByText(/กำลังตรวจ 20 \/ 100 ไฟล์/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "หยุด" }));
    release();
    expect(await screen.findByText(/หยุดตรวจแล้ว — ตรวจไป/)).toBeInTheDocument();
    // The first batch and the ones already out; nothing after หยุด.
    const sent = checkBodies(fetchMock).length;
    expect(sent).toBeLessThan(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(checkBodies(fetchMock).length).toBe(sent);
    expect(screen.queryByText(/ไม่พบรูปที่หาย/)).not.toBeInTheDocument();
  });

  it("a rate-limited batch waits as told and asks again — its files are not 'could not check'", async () => {
    const fetchMock = mockNetwork({ checkStatus: [429, 200], statuses: { [`${CLD}gone-a.jpg`]: "missing" } });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByText(/พบไฟล์หาย 1 ไฟล์/)).toBeInTheDocument();
    expect(screen.queryByText(/ตรวจไม่ได้ \d+ ไฟล์/)).not.toBeInTheDocument();
    const bodies = checkBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("a batch still limited after three waits counts as 'could not check'", async () => {
    const fetchMock = mockNetwork({ checkStatus: 429 });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByText("ตรวจไม่ได้ 3 ไฟล์ — ยังไม่รู้ว่าหายหรือไม่")).toBeInTheDocument();
    expect(checkBodies(fetchMock)).toHaveLength(4);
  });

  it("หยุด during a rate-limit wait ends the scan at once, without calling the batch failed", async () => {
    const fetchMock = mockNetwork({ checkStatus: 429, retryAfter: "30" });
    render(<MissingImagesScanner />);
    start();
    fireEvent.click(await screen.findByRole("button", { name: "หยุด" }));
    expect(await screen.findByText("หยุดตรวจแล้ว — ตรวจไป 0 จาก 3 ไฟล์")).toBeInTheDocument();
    expect(screen.getByText("ตรวจไม่ได้").previousSibling).toHaveTextContent("0");
    expect(checkBodies(fetchMock)).toHaveLength(1);
  });

  it("a lapsed session ends the scan only once every batch already sent has come back — no new scan can start meanwhile", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const index: ImageIndex = {
      pages: [{ kind: "content", sourceId: "c", title: "C", href: "/showcase/c", hidden: false }],
      images: Array.from({ length: 100 }, (_, i) => ({ url: `${CLD}${i}.jpg`, uses: [{ page: 0, where: "x" }] })),
    };
    const fetchMock = mockNetwork({ index, gate, checkStatus: [401, 200] });
    render(<MissingImagesScanner />);
    start();
    await waitFor(() => expect(checkBodies(fetchMock)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    // The first batch was refused; the second is still out: still scanning.
    expect(screen.getByRole("button", { name: "หยุด" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตรวจใหม่อีกครั้ง|เริ่มตรวจ/ })).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole("alert")).toHaveTextContent("เซสชันหมดอายุ");
    await new Promise((r) => setTimeout(r, 20));
    expect(checkBodies(fetchMock)).toHaveLength(2);
  });

  it("lists twenty pages, the rest on request — under a count of pages by kind", async () => {
    const index: ImageIndex = {
      pages: Array.from({ length: 25 }, (_, i) => ({
        kind: i < 23 ? ("quotation" as const) : ("content" as const),
        sourceId: `s${i}`,
        title: `หน้า ${String(i + 1).padStart(2, "0")}`,
        href: `/x/${i}`,
        hidden: false,
      })),
      images: [{ url: `${CLD}gone.jpg`, uses: Array.from({ length: 25 }, (_, i) => ({ page: i, where: "รายการที่ 1" })) }],
    };
    mockNetwork({ index, statuses: { [`${CLD}gone.jpg`]: "missing" } });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByText("หน้าเนื้อหา 2 · ใบเสนอราคา 23")).toBeInTheDocument();
    expect(screen.getAllByText(/^หน้า \d\d$/)).toHaveLength(20);
    // The content pages come first, so the cut falls on quotations.
    expect(screen.getByText("หน้า 24")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ดูทั้งหมด (25 หน้า)" }));
    expect(screen.getAllByText(/^หน้า \d\d$/)).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "แสดงน้อยลง" }));
    expect(screen.getAllByText(/^หน้า \d\d$/)).toHaveLength(20);
  });

  it("asking for the list too often is said in Thai", async () => {
    mockNetwork({ listStatus: 429 });
    render(<MissingImagesScanner />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรายการรูปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่");
  });

  it("shows the first ten files it could not check, the rest on request", async () => {
    const index: ImageIndex = {
      pages: [{ kind: "content", sourceId: "c", title: "C", href: "/showcase/c", hidden: false }],
      images: Array.from({ length: 12 }, (_, i) => ({ url: `${CLD}e${i}.jpg`, uses: [{ page: 0, where: "x" }] })),
    };
    mockNetwork({ index, checkStatus: 500 });
    render(<MissingImagesScanner />);
    start();
    const box = (await screen.findByText(/ตรวจไม่ได้ 12 ไฟล์/)).parentElement!.parentElement!;
    expect(within(box).getAllByRole("listitem")).toHaveLength(10);
    fireEvent.click(within(box).getByRole("button", { name: "ดูทั้งหมด (12 ไฟล์)" }));
    expect(within(box).getAllByRole("listitem")).toHaveLength(12);
  });
});

describe("/settings", () => {
  it("has the scanner just above the unused-image (orphan) scanner", async () => {
    mockNetwork({});
    render(<SettingsPage />);
    const scanner = await screen.findByRole("heading", { name: /ตรวจหารูปที่หาย/ });
    const orphans = screen.getByRole("heading", { name: /รูปภาพที่ไม่ได้ใช้งาน/ });
    expect(scanner.compareDocumentPosition(orphans) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
