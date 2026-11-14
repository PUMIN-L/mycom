/**
 * The showcase's admin window of a product's suppliers: Thai labels, a link to
 * each supplier's page, and a failed load said as one — it used to say "no
 * supplier is linked" (or keep the last product's list) when the fetch failed.
 */
import { render, screen, fireEvent, within, configure } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ShowcaseClient is the heaviest component rendered in the suite: the same
// headroom as ShowcaseClientSaveBlocks.test.tsx. Every wait here is for
// something to APPEAR.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true }),
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ShowcaseClient from "@/app/showcase/[id]/ShowcaseClient";

const SUPPLIERS = [
  { id: "s1", companyName: "บริษัท อิมาดะ จำกัด", contactName: "คุณสมชาย", phone: "02-123-4567", address: "กรุงเทพฯ", taxId: "0105556123456", note: "", createdAt: "2026-01-01" },
  { id: "s2", companyName: "ไม่ได้ผูก จำกัด", contactName: "คุณบี", phone: "02-000-0000", address: "", taxId: "", note: "", createdAt: "2026-01-01" },
  { id: "s3", companyName: "YASUDA SEIKI", contactName: "", phone: "", address: "", taxId: "", note: "", createdAt: "2026-01-01" },
];

let supplierIds: string[] = ["s1", "s3"];
let fail = false;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function renderShowcase() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/products/p1") return fail ? json({ error: "x" }, 500) : json({ id: "p1", supplierIds });
      if (url === "/api/suppliers") return json(SUPPLIERS);
      return json({});
    })
  );
  render(
    <ShowcaseClient
      initialContent={{ id: "c1", title: "หัวข้อทดสอบ", blocks: [], createdAt: "2026-09-01", productId: "p1" }}
      initialAllContents={[]}
      initialProducts={[]}
      initialCategories={[]}
      companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
      maintenanceOn={false}
      adminView
    />
  );
}
const openWindow = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /ดูซัพพลายเออร์/ }));
  return screen.getByRole("dialog", { name: "ซัพพลายเออร์ของสินค้านี้" });
};

beforeEach(() => {
  supplierIds = ["s1", "s3"];
  fail = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ShowcaseClient — the product's suppliers window", () => {
  it("lists the linked suppliers with Thai labels, each linking to its page", async () => {
    renderShowcase();
    const win = await openWindow();
    expect(await within(win).findByText("บริษัท อิมาดะ จำกัด")).toBeInTheDocument();
    expect(within(win).getByText("YASUDA SEIKI")).toBeInTheDocument();
    expect(within(win).queryByText("ไม่ได้ผูก จำกัด")).not.toBeInTheDocument();

    const first = within(win).getByText("บริษัท อิมาดะ จำกัด").closest("li")!;
    expect(Array.from(first.querySelectorAll("dt")).map((d) => d.textContent)).toEqual(["ผู้ติดต่อ", "เบอร์โทร"]);
    expect(within(first).getByRole("button", { name: "คัดลอก 02-123-4567" })).toBeInTheDocument();
    const link = within(first).getByRole("link", { name: "ดูข้อมูลทั้งหมด" });
    expect(link).toHaveAttribute("href", "/suppliers?id=s1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(win.textContent).not.toMatch(/Contact Person|Phone Number|Loading|Close/i);
  });

  it("a failed load says so with ลองใหม่ — not that no supplier is linked", async () => {
    fail = true;
    renderShowcase();
    const win = await openWindow();
    const alert = await within(win).findByRole("alert");
    expect(alert).toHaveTextContent("โหลดรายชื่อซัพพลายเออร์ไม่สำเร็จ");
    expect(within(win).queryByText("สินค้านี้ยังไม่ได้ผูกกับซัพพลายเออร์")).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));
    expect(await within(win).findByText("บริษัท อิมาดะ จำกัด")).toBeInTheDocument();
    expect(within(win).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never shows the last list when opened again and the load fails", async () => {
    renderShowcase();
    let win = await openWindow();
    await within(win).findByText("บริษัท อิมาดะ จำกัด");
    fireEvent.click(within(win).getAllByRole("button", { name: "ปิด" })[1]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fail = true;
    win = await openWindow();
    await within(win).findByRole("alert");
    expect(within(win).queryByText("บริษัท อิมาดะ จำกัด")).not.toBeInTheDocument();
  });

  it("says when the product has no supplier", async () => {
    supplierIds = [];
    renderShowcase();
    const win = await openWindow();
    expect(await within(win).findByText("สินค้านี้ยังไม่ได้ผูกกับซัพพลายเออร์")).toBeInTheDocument();
  });

  it("closes with Esc and with ✕", async () => {
    renderShowcase();
    let win = await openWindow();
    await within(win).findByText("บริษัท อิมาดะ จำกัด");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    win = await openWindow();
    fireEvent.click(within(win).getAllByRole("button", { name: "ปิด" })[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
