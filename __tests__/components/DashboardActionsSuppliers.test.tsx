/**
 * The admin panel's way into /suppliers calls them what that page does:
 * ซัพพลายเออร์ — not "ผู้ผลิต (Suppliers)".
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

describe("admin panel — the suppliers card", () => {
  it("is called จัดการซัพพลายเออร์ and leads to /suppliers", () => {
    render(<DashboardActions />);
    const link = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/suppliers");
    expect(link).toBeDefined();
    expect(link!.textContent).toContain("จัดการซัพพลายเออร์");
    expect(link!.textContent).not.toContain("ผู้ผลิต");
  });
});
