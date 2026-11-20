/**
 * The admin hub leads to the dashboard — its first card. Every other admin
 * page has a Dashboard button beside its way back (AdminHomeButton); the hub
 * is where that way back leads, so its own way to the dashboard is a card,
 * like everything else it leads to.
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

describe("admin panel — the dashboard card", () => {
  it("comes first and leads to /dashboard", () => {
    render(<DashboardActions />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/dashboard");
    expect(links[0].textContent).toContain("Dashboard");
  });

  it("is there once — no second way to the same page", () => {
    render(<DashboardActions />);
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/dashboard")).toHaveLength(1);
  });
});
