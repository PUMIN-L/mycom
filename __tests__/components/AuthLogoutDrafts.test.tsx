/**
 * Logging out takes the unsaved quotation drafts with it: they hold customers'
 * names, phones and addresses, and must not outlive the session on a computer
 * other people use.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthProvider, useAuth } from "@/app/context/AuthContext";
import { DRAFTS_STORAGE_KEY, LEGACY_DRAFT_KEY } from "@/app/quotation/quoteDraft";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/quotation",
  useSearchParams: () => new URLSearchParams(),
}));

function LogoutButton() {
  const { logout } = useAuth();
  return <button onClick={() => logout()}>ออกจากระบบ</button>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("AuthProvider — logout", () => {
  it("clears every quotation draft, and leaves the rest of the browser's storage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ "u1/new": { savedAt: new Date().toISOString(), state: { items: [] } } }));
    window.localStorage.setItem(LEGACY_DRAFT_KEY, "{}");
    window.localStorage.setItem("something-else", "kept");
    render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "ออกจากระบบ" }));
    await waitFor(() => expect(window.localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull());
    expect(window.localStorage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(window.localStorage.getItem("something-else")).toBe("kept");
  });
});
