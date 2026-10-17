/**
 * The printed quotation's "เงื่อนไข" heading appears only when a condition has
 * something to print. It used to be unconditional, so a quotation whose
 * conditions were all removed (or left blank) went to the customer with a
 * bare heading — as if the terms had gone missing. หมายเหตุ beside it was
 * already shown only with a note.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quotation",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

import QuotationPage from "@/app/quotation/page";

const DOC_NO = "QT261017-1";

type Condition = { id: string; label: string; value: string };

/** Opens a saved quotation whose conditions are `conditions`. */
async function renderSaved(conditions: Condition[]) {
  const record = { id: "q1", docNo: DOC_NO, data: { docNo: DOC_NO, docDate: "2026-10-17", items: [], conditions } };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input) === "/api/quotations/q1" ? record : [];
    return { ok: true, status: 200, json: async () => body };
  }));
  window.history.replaceState(null, "", "/quotation?id=q1&view=1");
  render(<QuotationPage />);
  await waitFor(() => expect(document.body.textContent).toContain(DOC_NO));
}

function footerHeadings(): string[] {
  const footer = document.querySelector("#quote-footer");
  if (!footer) throw new Error("no #quote-footer rendered");
  return Array.from(footer.querySelectorAll(".font-bold")).map((el) => el.textContent?.trim() ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("quotation printout — เงื่อนไข heading", () => {
  it("is left out when there are no conditions", async () => {
    await renderSaved([]);
    expect(footerHeadings()).not.toContain("เงื่อนไข");
  });

  it("is left out when every condition is blank", async () => {
    await renderSaved([{ id: "c1", label: "", value: "" }, { id: "c2", label: "", value: "" }]);
    expect(footerHeadings()).not.toContain("เงื่อนไข");
  });

  it("is shown with the conditions that have text, and only those", async () => {
    await renderSaved([
      { id: "c1", label: "เงื่อนไขชำระเงิน", value: "เครดิต 30 วัน" },
      { id: "c2", label: "", value: "" },
      { id: "c3", label: "", value: "ราคานี้ไม่รวมค่าติดตั้ง" },
    ]);
    expect(footerHeadings()).toContain("เงื่อนไข");
    const footer = document.querySelector("#quote-footer")!;
    const bullets = Array.from(footer.querySelectorAll(".whitespace-pre-line"))
      .map((el) => el.textContent?.trim())
      .filter((t) => t?.startsWith("•"));
    expect(bullets).toEqual(["• เงื่อนไขชำระเงิน: เครดิต 30 วัน", "• ราคานี้ไม่รวมค่าติดตั้ง"]);
  });
});
