/**
 * Hiding a catalog (schema v48, documents.isPublished).
 *
 * A hidden catalog does not exist for a visitor: not on /catalog, not at its
 * /document/[id] page, not in the sitemap. An admin sees every catalog, the
 * hidden ones marked, with the button that hides or shows each.
 *
 * /catalog is cached (ISR), so the admin's copy is rendered only in Draft Mode
 * (a logged-in browser) and the session is read only there — the cached copy
 * never depends on who asked. The same rule as /showcase/[id].
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/app/lib/documentStore", () => ({
  getAllDocuments: vi.fn(),
  getDocument: vi.fn(),
  // The real rule — pure, nothing to fake.
  isDocumentPublic: (d: { isPublished?: boolean }) => d.isPublished !== false,
}));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/app/lib/contentStore", () => ({ getAllContentsMeta: vi.fn(async () => []) }));
vi.mock("@/app/lib/productStore", () => ({
  getAllProducts: vi.fn(async () => []),
  isProductPublic: () => true,
}));
vi.mock("@/app/lib/settingsStore", () => ({ isMaintenanceMode: vi.fn(async () => false) }));
vi.mock("@/app/lib/getProductsData", () => ({ getProductsData: vi.fn(async () => ({ categories: [], products: [] })) }));
vi.mock("@/app/document/[id]/PdfViewerWrapper", () => ({ default: () => null }));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/catalog",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
let mockAuth = { isLoggedIn: false, isLoading: false };
vi.mock("@/app/context/AuthContext", () => ({ useAuth: () => mockAuth }));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));

import { draftMode } from "next/headers";
import { getAllDocuments, getDocument } from "@/app/lib/documentStore";
import { getSession } from "@/app/lib/session";
import CatalogPage from "@/app/catalog/page";
import CatalogClient from "@/app/catalog/CatalogClient";
import DocumentPreviewPage, { generateMetadata } from "@/app/document/[id]/page";
import sitemap from "@/app/sitemap";
import type { DocumentData } from "@/app/lib/types";

const doc = (id: string, isPublished?: boolean): DocumentData => ({
  id,
  title: `แคตตาล็อก ${id}`,
  description: "",
  pdfUrl: `https://res.cloudinary.com/demo/raw/upload/v1/${id}.pdf`,
  coverUrl: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  sortOrder: 0,
  ...(isPublished === undefined ? {} : { isPublished }),
});
const DOCS = [doc("shown", true), doc("hidden", false), doc("old")];
const admin = { userId: "1", username: "admin", expiresAt: new Date() } as never;

function asked({ draft }: { draft: boolean }) {
  vi.mocked(draftMode).mockResolvedValue({ isEnabled: draft, enable: vi.fn(), disable: vi.fn() } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAllDocuments).mockResolvedValue(DOCS);
  mockAuth = { isLoggedIn: false, isLoading: false };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/catalog — what the page hands its client", () => {
  type Props = { initialDocuments: DocumentData[]; adminView: boolean };
  const props = async () => ((await CatalogPage()) as ReactElement<Props>).props;
  const ids = (p: Props) => p.initialDocuments.map((d) => d.id);

  it("a visitor (no Draft Mode): hidden catalogs left out — and the session is never even read", async () => {
    asked({ draft: false });
    vi.mocked(getSession).mockResolvedValue(admin);
    const p = await props();
    expect(ids(p)).toEqual(["shown", "old"]);
    expect(p.adminView).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("an admin (Draft Mode + session): every catalog, for the admin view", async () => {
    asked({ draft: true });
    vi.mocked(getSession).mockResolvedValue(admin);
    const element = (await CatalogPage()) as ReactElement<Props>;
    expect(ids(element.props)).toEqual(["shown", "hidden", "old"]);
    expect(element.props.adminView).toBe(true);
    expect(element.key).toBe("admin");
  });

  it("Draft Mode without a session (expired) is a visitor", async () => {
    asked({ draft: true });
    vi.mocked(getSession).mockResolvedValue(null);
    const p = await props();
    expect(ids(p)).toEqual(["shown", "old"]);
    expect(p.adminView).toBe(false);
  });
});

describe("/document/[id] — a hidden catalog's own page", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("is a 404 for a visitor, title included", async () => {
    vi.mocked(getDocument).mockResolvedValue(doc("hidden", false));
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(DocumentPreviewPage(params("hidden"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await generateMetadata(params("hidden"))).title).toBe("ไม่พบเอกสาร");
  });

  it("opens for an admin, saying it is hidden", async () => {
    vi.mocked(getDocument).mockResolvedValue(doc("hidden", false));
    vi.mocked(getSession).mockResolvedValue(admin);
    render(await DocumentPreviewPage(params("hidden")));
    expect(screen.getByText(/แคตตาล็อกนี้ถูกซ่อนอยู่/)).toBeTruthy();
  });

  it("a shown catalog opens for a visitor, with no such note", async () => {
    vi.mocked(getDocument).mockResolvedValue(doc("shown", true));
    vi.mocked(getSession).mockResolvedValue(null);
    render(await DocumentPreviewPage(params("shown")));
    expect(screen.queryByText(/แคตตาล็อกนี้ถูกซ่อนอยู่/)).toBeNull();
  });
});

describe("sitemap", () => {
  it("lists no hidden catalog", async () => {
    const urls = (await sitemap()).map((e) => e.url).filter((u) => u.includes("/document/"));
    expect(urls.map((u) => u.split("/document/")[1])).toEqual(["shown", "old"]);
  });
});

describe("CatalogClient — the admin's hide / show button", () => {
  function stubPatch(ok = true) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => ({ ok, status: ok ? 200 : 500, json: async () => (ok ? { success: true } : { error: "พัง" }) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("a visitor's copy has no button and no badge", () => {
    render(<CatalogClient initialDocuments={[doc("shown", true)]} adminView={false} />);
    expect(screen.queryByRole("button", { name: /ซ่อน|แสดง/ })).toBeNull();
  });

  it("hides a catalog: PATCH isPublished false, then the card is marked", async () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    const fetchMock = stubPatch();
    render(<CatalogClient initialDocuments={[doc("shown", true)]} adminView />);
    fireEvent.click(screen.getByRole("button", { name: "ซ่อน" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "แสดง" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/shown", expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ isPublished: false });
    expect(screen.getByText("ซ่อนอยู่")).toBeTruthy();
    expect(screen.getByText(/ซ่อนอยู่ 1 รายการ/)).toBeTruthy();
  });

  it("shows a hidden one again", async () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    const fetchMock = stubPatch();
    render(<CatalogClient initialDocuments={[doc("hidden", false)]} adminView />);
    expect(screen.getByText("ซ่อนอยู่")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "แสดง" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ซ่อน" })).toBeTruthy());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ isPublished: true });
    expect(screen.queryByText("ซ่อนอยู่")).toBeNull();
  });

  it("a failed save changes nothing on screen and says so", async () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    stubPatch(false);
    render(<CatalogClient initialDocuments={[doc("shown", true)]} adminView />);
    fireEvent.click(screen.getByRole("button", { name: "ซ่อน" }));
    expect(await screen.findByText(/พัง/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "ซ่อน" })).toBeTruthy();
    expect(screen.queryByText("ซ่อนอยู่")).toBeNull();
  });

  it("the button is beside the link, not inside it (no PDF opens on click)", () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    render(<CatalogClient initialDocuments={[doc("shown", true)]} adminView />);
    expect(screen.getByRole("button", { name: "ซ่อน" }).closest("a")).toBeNull();
  });

  it("a copy made for the other kind of viewer is rendered again, once", () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    render(<CatalogClient initialDocuments={[doc("shown", true)]} adminView={false} />);
    expect(refresh).toHaveBeenCalledTimes(1);

    cleanup();
    refresh.mockClear();
    mockAuth = { isLoggedIn: false, isLoading: false };
    render(<CatalogClient initialDocuments={[doc("shown", true)]} adminView={false} />);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// The same switch on the admin's document library (/documents).
describe("/documents — the hide / show button", () => {
  it("hides a catalog: PATCH isPublished false, then the card is marked and the button flips", async () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { default: DocumentListClient } = await import("@/app/documents/DocumentListClient");
    render(<DocumentListClient initialDocuments={[doc("shown", true)]} />);

    expect(screen.queryByText("ซ่อนอยู่")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ซ่อน" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "แสดง" })).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/shown");
    expect(fetchMock.mock.calls[0][1]!.method).toBe("PATCH");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ isPublished: false });
    expect(screen.getByText("ซ่อนอยู่")).toBeTruthy();
  });

  it("a failed save leaves the card as it was", async () => {
    mockAuth = { isLoggedIn: true, isLoading: false };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const { default: DocumentListClient } = await import("@/app/documents/DocumentListClient");
    render(<DocumentListClient initialDocuments={[doc("hidden", false)]} />);

    fireEvent.click(screen.getByRole("button", { name: "แสดง" }));
    expect(await screen.findByText(/เปลี่ยนการแสดงแคตตาล็อกไม่สำเร็จ/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "แสดง" })).toBeTruthy();
    expect(screen.getByText("ซ่อนอยู่")).toBeTruthy();
  });
});
