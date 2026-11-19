/**
 * The sale's view window (app/dashboard/ViewRecordModal.tsx), item 8: a real
 * dialog drawn over the admin bell (z-90) — it used to open under it — that
 * Esc closes, with the sale's date in พ.ศ.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ViewRecordModal from "@/app/dashboard/ViewRecordModal";
import type { SalesRecord } from "@/app/lib/types";

const RECORD = {
  id: "s1", saleDate: "2026-10-05", saleType: "service", customerName: "คุณเอ", companyName: "บริษัท เอ", productName: "สอบเทียบ",
  qty: 1, salespersonName: "สมชาย", totalAmount: 5000, costAmount: 2000, quotationRef: "", poRef: "PO-1", deliveryRef: "", invoiceRef: "", note: "",
} as unknown as SalesRecord;

describe("ViewRecordModal", () => {
  it("is a dialog over the admin bell, dated in พ.ศ.", () => {
    render(<ViewRecordModal record={RECORD} onClose={vi.fn()} onEdit={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "รายละเอียดยอดขาย" });
    expect(dialog.parentElement!.className).toContain("z-[100]");
    expect(screen.getByText("5 ต.ค. 2569")).toBeTruthy();
  });

  it("closes on Esc, and on its ✕", () => {
    const onClose = vi.fn();
    render(<ViewRecordModal record={RECORD} onClose={onClose} onEdit={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The ✕ in the corner (the footer has its own ปิด too).
    fireEvent.click(screen.getAllByRole("button", { name: "ปิด" })[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
