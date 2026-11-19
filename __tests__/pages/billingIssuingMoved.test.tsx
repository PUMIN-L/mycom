/**
 * Step 10 (ARCHITECTURE.md §8g) — with the accounting module on, the old
 * /billing issues nothing new: a new document, or a new version of an old
 * one, leads to the accounting module instead; the saved list's "create"
 * menu points there and offers no "New Ver." on a billing document; the old
 * receivables page says where the new debts are. Old documents still open.
 */
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/billing",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import BillingPage from "@/app/billing/page";
import SavedBillingPage from "@/app/billing/saved/page";
import ReceivablesPage from "@/app/billing/receivables/page";
import { buildReceivablesLedger } from "@/app/lib/receivables";

const OLD_DOC = { id: "b1", docNo: "INV2609250001", docType: "invoice", linkedQuotationId: null, data: { customerCompany: "ลูกค้า", items: [] } };
const QUOTES = [{ id: "q1", docNo: "QT-2609-001", createdAt: "2026-09-01T03:00:00.000Z", customer: "บริษัท กอไก่", total: 10000 }];
const BILLINGS = [{ id: "inv1", docType: "invoice", docNo: "INV-2609-010", createdAt: "2026-09-10T03:00:00.000Z", customer: "ห้างขอไข่", total: 50000 }];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url === "/api/billing/b1") return json(OLD_DOC);
    if (url === "/api/billing") return json(BILLINGS);
    if (url === "/api/quotations") return json(QUOTES);
    if (url === "/api/billing/receivables") return json({ today: "2026-09-30", creditTermDays: 30, ...buildReceivablesLedger([], "2026-09-30"), undatedTargets: [] });
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("the old builder", () => {
  it.each(["/billing", "/billing?type=invoice", "/billing?type=receipt", "/billing?id=b1&action=clone"])(
    "%s leads to the accounting module — nothing is issued here",
    async (path) => {
      window.history.replaceState(null, "", path);
      render(<BillingPage />);
      const notice = await screen.findByRole("status");
      expect(within(notice).getByRole("heading", { name: "ออกเอกสารใหม่ที่ระบบบัญชีแล้ว" })).toBeInTheDocument();
      expect(within(notice).getByRole("link", { name: "ออกใบแจ้งหนี้ / ใบกำกับภาษี" })).toHaveAttribute("href", "/accounting/invoices/new");
      expect(within(notice).getByRole("link", { name: "ออกใบวางบิล" })).toHaveAttribute("href", "/accounting/billing-notes/new");
      expect(within(notice).getByRole("link", { name: "รับชำระ / ออกใบเสร็จ (จากใบแจ้งหนี้)" })).toHaveAttribute("href", "/accounting/invoices");
      expect(within(notice).getByRole("link", { name: "ดูเอกสารเก่าที่บันทึกไว้" })).toHaveAttribute("href", "/billing/saved");
      // The builder never mounts: no document read, nothing saved.
      expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/billing/b1")).toBe(false);
      expect(posts()).toHaveLength(0);
    }
  );

  it("still opens an old document — to view and print it", async () => {
    window.history.replaceState(null, "", "/billing?id=b1&view=1");
    render(<BillingPage />);
    await waitFor(() => expect(document.body.textContent).toContain(OLD_DOC.docNo));
    expect(screen.queryByText("ออกเอกสารใหม่ที่ระบบบัญชีแล้ว")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ดาวน์โหลด PDF/ })).toBeInTheDocument();
  });
});

describe("the saved list", () => {
  it("creates invoices, billing notes and receipts in the accounting module — quotations as before", async () => {
    render(<SavedBillingPage />);
    await screen.findByText("QT-2609-001");
    fireEvent.click(screen.getByRole("button", { name: /สร้างเอกสารใหม่/ }));
    expect(screen.getByRole("link", { name: /ใบแจ้งหนี้ \/ ใบกำกับภาษี/ })).toHaveAttribute("href", "/accounting/invoices/new");
    expect(screen.getByRole("link", { name: /ใบวางบิล/ })).toHaveAttribute("href", "/accounting/billing-notes/new");
    expect(screen.getByRole("link", { name: /ใบเสร็จรับเงิน/ })).toHaveAttribute("href", "/accounting/invoices");
    expect(screen.getByRole("link", { name: /ใบเสนอราคา/ })).toHaveAttribute("href", "/quotation?new=1");
  });

  it("offers a new version of a quotation, never of an old billing document", async () => {
    render(<SavedBillingPage />);
    await screen.findByText("INV-2609-010");
    const invoiceRow = screen.getByText("INV-2609-010").closest("tr")!;
    const quoteRow = screen.getByText("QT-2609-001").closest("tr")!;
    expect(within(invoiceRow).queryByRole("button", { name: /แก้ไข \(New Ver\.\)/ })).not.toBeInTheDocument();
    expect(within(quoteRow).getByRole("button", { name: /แก้ไข \(New Ver\.\)/ })).toBeInTheDocument();
    // Deleting an old one is as before.
    expect(within(invoiceRow).getByRole("button", { name: /ลบ/ })).toBeInTheDocument();
  });
});

describe("the old receivables", () => {
  it("says the accounting module's debts are on its own page", async () => {
    render(<ReceivablesPage />);
    const note = await screen.findByTestId("accounting-receivables-note");
    expect(within(note).getByRole("link", { name: "ระบบบัญชี → ลูกหนี้คงค้าง" })).toHaveAttribute("href", "/accounting/receivables");
  });
});
