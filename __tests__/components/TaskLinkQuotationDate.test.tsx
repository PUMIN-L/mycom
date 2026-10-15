/**
 * The task picker names a quotation with the day it was saved — on Bangkok's
 * calendar. `createdAt` is a UTC instant: its first ten characters are still
 * yesterday here until 07:00, so a quotation saved at 03:00 read as the day
 * before.
 */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useTaskLinkTargets, __resetTaskLinkTargets } from "@/app/components/TaskLinkChips";

function Probe() {
  const snap = useTaskLinkTargets(["quotation"]);
  return (
    <ul>
      {snap.quotation.options.map((o) => (
        <li key={o.id}>{o.subLabel}</li>
      ))}
    </ul>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetTaskLinkTargets();
});

describe("task link picker — a quotation's date", () => {
  it("is the day it was saved in Bangkok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        // 20:00 UTC on 14 Oct = 03:00 on 15 Oct in Bangkok.
        json: async () => [{ id: "q1", docNo: "QT151026-22", customer: "บริษัท ก", createdAt: "2026-10-14T20:00:00.000Z" }],
      }))
    );
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("บริษัท ก · 2026-10-15")).toBeInTheDocument());
  });
});
