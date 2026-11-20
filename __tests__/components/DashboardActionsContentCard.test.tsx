/**
 * The admin hub has no "สร้างคอนเทนต์ใหม่" card — the owner asked for it to be
 * taken off /adminpanel (2026-11-20). The page it led to, /create-content, is
 * still there (the showcase pages link to it, and it opens by its address);
 * only the hub's way in is gone, and its neighbours are untouched.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/adminpanel",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false, user: { username: "admin", userId: "u1" }, logout: vi.fn() }),
}));

import DashboardActions from "@/app/adminpanel/DashboardActions";

const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

describe("admin panel — no สร้างคอนเทนต์ใหม่ card", () => {
  it("has no card that leads to /create-content, and the words are gone", () => {
    render(<DashboardActions />);
    expect(hrefs()).not.toContain("/create-content");
    expect(screen.queryByText("สร้างคอนเทนต์ใหม่")).toBeNull();
    expect(screen.queryByText(/เพิ่มบทความ ข่าวสาร หรือหน้าเว็บใหม่/)).toBeNull();
  });

  it("keeps the other cards, in order — the Dashboard first, then the downloads", () => {
    render(<DashboardActions />);
    const list = hrefs();
    expect(list.slice(0, 2)).toEqual(["/dashboard", "/documents"]);
    for (const href of ["/quotation?new=1", "/quotation/saved", "/customers", "/suppliers", "/settings"]) {
      expect(list, href).toContain(href);
    }
  });
});
