/**
 * The home page's service cards link to each service's own page
 * (app/services/[slug]) — that link is how people and crawlers find them.
 */
import { render, cleanup, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/i18n/LanguageContext", () => ({
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));

import Services from "@/app/components/Services";

afterEach(cleanup);

describe("Services — home page cards", () => {
  it("links every card to its service page", () => {
    render(<Services />);
    const learnMore = screen
      .getAllByRole("link", { name: /ดูรายละเอียดบริการ/ })
      .map((a) => a.getAttribute("href"));
    expect(learnMore).toEqual([
      "/services/equipment-sales",
      "/services/calibration-repair",
      "/services/lab-design-construction",
    ]);
    // The card title is a link to the same page.
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.querySelector("a")?.getAttribute("href"));
    expect(titles).toEqual(learnMore);
  });
});
