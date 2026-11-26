/**
 * The commission payout summary on A4 (app/accounting/commission/CommissionPayoutPaper.tsx),
 * as the pages are drawn for the PDF:
 *  • page 1: the company, the title and the paid range, three cards (what
 *    ฟอร์ด / พี่ต่อ got, from which deals; both), one line of facts, the table;
 *  • a later page: the short header and the table's head again;
 *  • the last page: the totals, the rates used, the notes, where to sign;
 *  • every page: หน้า x/y, who exported it and when;
 *  • the cost breakdown under each PO when it was switched on.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PayoutPaperPages } from "@/app/accounting/commission/CommissionPayoutPaper";
import { paperUnits } from "@/app/lib/accounting/commissionPayoutPaper";
import type { PayoutReport, PoCosts } from "@/app/lib/accounting/commissionTypes";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const REPORT: PayoutReport = {
  from: "2026-11-01",
  to: "2026-11-30",
  rows: [
    {
      id: "pay-A", salesOrderId: "A", customerPoNo: "PO-A", buyerName: "ลูกค้า A", issueDate: "2026-11-03", kind: "ford",
      profitSatang: 8_000_000, ladderFromSatang: 0, ladderToSatang: 8_000_000, fordSatang: 2_160_000, torSatang: 1_840_000, companySatang: 4_000_000,
      rateSetId: null, paidDate: "2026-11-24", createdBy: "admin", changedSince: false,
    },
    {
      id: "pay-T", salesOrderId: "T", customerPoNo: "PO-T", buyerName: "ลูกค้า T", issueDate: "2026-11-05", kind: "tor",
      profitSatang: 10_000_000, ladderFromSatang: null, ladderToSatang: null, fordSatang: 1_500_000, torSatang: 3_500_000, companySatang: 5_000_000,
      rateSetId: null, paidDate: "2026-11-25", createdBy: "admin", changedSince: true,
    },
  ],
  rateSets: [{ id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES }],
  changedSince: 1,
  seller: { name: "บริษัท ทดสอบ จำกัด", address: "เลขที่ 1 กรุงเทพฯ", taxId: "0105555000000", branchCode: "00000", phone: "02-000-0000", email: "" },
  exportedBy: "admin",
  exportedAt: "2026-11-25T03:00:00.000Z",
};
const COSTS_A: PoCosts = {
  poId: "A",
  customerPoNo: "PO-A",
  deliveries: [
    {
      saleId: "a1", saleDate: "2026-11-10", invoiceRef: "INV2026110001", credit: false, salesSatang: 10_000_000, costSatang: 2_000_000, profitSatang: 8_000_000, costMissing: false, storedCostSatang: 0,
      items: [{ id: "a1-i1", productName: "เครื่องชั่ง A", qty: 1, costSatang: 1_500_000 }],
      costs: [
        { id: "a1-ship", costType: "shipping", typeLabel: "ค่าขนส่ง", label: "Kerry", note: "", amountSatang: 500_000, counted: true },
        { id: "a1-comm", costType: "commission", typeLabel: "ค่าคอมมิชชั่น", label: "", note: "", amountSatang: 200_000, counted: false },
      ],
    },
  ],
  totals: { salesSatang: 10_000_000, costSatang: 2_000_000, profitSatang: 8_000_000, notCountedSatang: 200_000, waitingCostSalesSatang: 0 },
};

describe("the payout summary paper", () => {
  it("one page: the company, the range, what each person got, the table, the totals, the rates, the notes, where to sign, the page", () => {
    render(<PayoutPaperPages report={REPORT} units={paperUnits(REPORT)} pages={[{ units: [0, 1], tail: true }]} />);
    const page = screen.getByTestId("paper-page-1");
    for (const text of [
      "บริษัท ทดสอบ จำกัด",
      "สรุปการจ่ายค่าคอมมิชชั่น",
      "วันที่จ่าย 1 Nov 2026 – 30 Nov 2026",
      "ฟอร์ดได้รับ",
      "36,600.00",
      "จากลูกค้าฟอร์ด 21,600.00 · จากลูกค้าพี่ต่อ 15,000.00",
      "พี่ต่อได้รับ",
      "53,400.00",
      "รวมจ่าย",
      "90,000.00",
      "จ่าย 2 PO · กำไรรวม 180,000.00 · ส่วนของบริษัท 90,000.00",
      "PO-A",
      "ลูกค้า A",
      "PO วันที่ 3 Nov 2026",
      "กำไรสะสม 0 – 80,000",
      "PO-T",
      "ลูกค้าพี่ต่อ",
      "รวม 2 รายการ",
      "อัตราที่ใช้คิด",
      "0 – 100,000: ฟอร์ด 27% · พี่ต่อ 23% · บริษัท 50%",
      "ลูกค้าพี่ต่อ: ฟอร์ด 15% · พี่ต่อ 35% · บริษัท 50%",
      "มี 1 รายการที่ข้อมูลเปลี่ยนหลังบันทึกจ่าย",
      "ผู้จ่าย",
      "ผู้รับ (ฟอร์ด)",
      "ผู้รับ (พี่ต่อ)",
      "หน้า 1/1",
      "ส่งออกโดย admin",
    ]) {
      expect(page).toHaveTextContent(text);
    }
    expect(page.querySelector("img")).toHaveAttribute("src", "/images/profin-logo-3.png");
  });

  it("two pages: the short header and the table's head again; the totals and signatures on the last only; every page numbered", () => {
    render(<PayoutPaperPages report={REPORT} units={paperUnits(REPORT)} pages={[{ units: [0], tail: false }, { units: [1], tail: true }]} />);
    const p1 = screen.getByTestId("paper-page-1");
    const p2 = screen.getByTestId("paper-page-2");
    expect(p1).toHaveTextContent("หน้า 1/2");
    expect(p2).toHaveTextContent("หน้า 2/2");
    expect(p1).toHaveTextContent("ฟอร์ดได้รับ");
    expect(p2).not.toHaveTextContent("ฟอร์ดได้รับ");
    expect(p2).toHaveTextContent("สรุปการจ่ายค่าคอมมิชชั่น (ต่อ)");
    for (const p of [p1, p2]) expect(p.querySelector("thead")).toHaveTextContent("วันที่จ่าย");
    expect(p1).toHaveTextContent("PO-A");
    expect(p1).not.toHaveTextContent("PO-T");
    expect(p2).toHaveTextContent("PO-T");
    expect(p1).not.toHaveTextContent("ผู้จ่าย");
    expect(p2).toHaveTextContent("ผู้จ่าย");
  });

  it("with the costs switched on: each PO's deliveries and cost lines under its row — said to be as the data stands now", () => {
    const report = { ...REPORT, costs: { A: COSTS_A } };
    const units = paperUnits(report);
    render(<PayoutPaperPages report={report} units={units} pages={[{ units: units.map((_, i) => i), tail: true }]} />);
    const page = screen.getByTestId("paper-page-1");
    for (const text of [
      "ส่งของครั้งที่ 1",
      "INV2026110001",
      "ยอดขาย 100,000.00",
      "ต้นทุนสินค้า: เครื่องชั่ง A × 1",
      "15,000.00",
      "ค่าขนส่ง: Kerry",
      "ค่าคอมมิชชั่น — ไม่นำมาหัก",
      "ยอดขาย 100,000.00 − ต้นทุน 20,000.00 = กำไร 80,000.00",
      "ไม่มีข้อมูลต้นทุน",
      "รายละเอียดต้นทุนเป็นข้อมูล ณ วันที่ส่งออก",
    ]) {
      expect(page).toHaveTextContent(text);
    }
  });

  it("without the costs: no cost lines, no note about them", () => {
    render(<PayoutPaperPages report={REPORT} units={paperUnits(REPORT)} pages={[{ units: [0, 1], tail: true }]} />);
    const page = screen.getByTestId("paper-page-1");
    expect(page).not.toHaveTextContent("ส่งของครั้งที่");
    expect(page).not.toHaveTextContent("รายละเอียดต้นทุนเป็นข้อมูล");
  });
});
