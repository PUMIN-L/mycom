// @vitest-environment node
/**
 * The commission month as an Excel workbook (lib/accounting/commissionExport.ts — pure):
 *  • "สรุปรายเดือน": every PO of the month as the screen shows it — whose,
 *    profit, place on the ladder, the three shares, where it stands, what was
 *    paid and the difference since — the totals per person above, a รวม row;
 *  • "ขั้นบันได": how each PO's commission was worked out, slice by slice;
 *  • "รายละเอียดต้นทุน": what each PO's profit is made of, line by line.
 * Money as numbers in baht (#,##0.00 in Excel, still numbers to add up).
 */
import { describe, it, expect } from "vitest";
import { commissionMonthFilename, commissionMonthSheets } from "@/app/lib/accounting/commissionExport";
import type { CommissionMonth, CommissionMonthRow, PoCosts } from "@/app/lib/accounting/commissionTypes";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const baht = (n: number) => Math.round(n * 100);
const slice = (from: number, to: number, fordBp: number, torBp: number, ford: number, tor: number, company: number) => ({
  fromSatang: baht(from),
  toSatang: baht(to),
  fordBp,
  torBp,
  fordSatang: baht(ford),
  torSatang: baht(tor),
  companySatang: baht(company),
});
const row = (o: Partial<CommissionMonthRow> & { id: string }): CommissionMonthRow => ({
  customerPoNo: `PO-${o.id}`,
  buyerName: `ลูกค้า ${o.id}`,
  issueDate: "2026-11-03",
  status: "issued",
  orderStatus: "complete",
  salesSatang: 0,
  costSatang: 0,
  profitSatang: null,
  costMissing: false,
  paidInFull: true,
  owedSatang: 0,
  kind: "ford",
  countedSatang: 0,
  ladderFromSatang: null,
  ladderToSatang: null,
  slices: [],
  fordSatang: 0,
  torSatang: 0,
  companySatang: 0,
  commissionStatus: "payable",
  payout: null,
  differenceFordSatang: 0,
  differenceTorSatang: 0,
  paidButNot: null,
  ...o,
});

const MONTH: CommissionMonth = {
  month: "2026-11",
  rateSet: { id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES },
  rows: [
    row({
      id: "A", issueDate: "2026-11-03", profitSatang: baht(80_000), countedSatang: baht(80_000), ladderFromSatang: 0, ladderToSatang: baht(80_000),
      slices: [slice(0, 80_000, 2700, 2300, 21_600, 18_400, 40_000)],
      fordSatang: baht(21_600), torSatang: baht(18_400), companySatang: baht(40_000), commissionStatus: "paid",
      payout: { id: "pay-A", paidDate: "2026-11-24", profitSatang: baht(80_000), fordSatang: baht(21_000), torSatang: baht(19_000), companySatang: baht(40_000), createdBy: "admin" },
      differenceFordSatang: baht(600), differenceTorSatang: baht(-600),
    }),
    row({ id: "T", issueDate: "2026-11-05", kind: "tor", profitSatang: baht(100_000), countedSatang: baht(100_000), fordSatang: baht(15_000), torSatang: baht(35_000), companySatang: baht(50_000) }),
    row({ id: "N", issueDate: "2026-11-06", kind: null, profitSatang: baht(50_000), commissionStatus: "unassigned" }),
    row({
      id: "B", issueDate: "2026-11-10", profitSatang: baht(150_000), countedSatang: baht(150_000), ladderFromSatang: baht(80_000), ladderToSatang: baht(230_000),
      slices: [slice(80_000, 100_000, 2700, 2300, 5_400, 4_600, 10_000), slice(100_000, 230_000, 3200, 1800, 41_600, 23_400, 65_000)],
      fordSatang: baht(47_000), torSatang: baht(28_000), companySatang: baht(75_000), paidInFull: false, commissionStatus: "awaiting-payment",
    }),
    row({ id: "G", issueDate: "2026-11-25", costMissing: true, ladderFromSatang: baht(230_000), ladderToSatang: baht(230_000), commissionStatus: "cost-missing" }),
  ],
  totals: {
    ford: { totalSatang: baht(83_600), paidSatang: baht(21_000), payableSatang: baht(15_000), waitingSatang: baht(47_000), differenceSatang: baht(600) },
    tor: { totalSatang: baht(81_400), paidSatang: baht(19_000), payableSatang: baht(35_000), waitingSatang: baht(28_000), differenceSatang: baht(-600) },
    companySatang: baht(165_000),
    profitSatang: baht(330_000),
    unassigned: 1,
  },
  invoicesWithoutPo: 2,
};

const COSTS: Record<string, PoCosts> = {
  A: {
    poId: "A",
    customerPoNo: "PO-A",
    deliveries: [
      {
        saleId: "a1", saleDate: "2026-11-10", invoiceRef: "INV2026110001", credit: false, salesSatang: baht(100_000), costSatang: baht(20_000), profitSatang: baht(80_000), costMissing: false, storedCostSatang: 0,
        items: [{ id: "a1-i1", productName: "เครื่องชั่ง A", qty: 1, costSatang: baht(15_000) }],
        costs: [
          { id: "a1-ship", costType: "shipping", typeLabel: "ค่าขนส่ง", label: "Kerry", note: "", amountSatang: baht(5_000), counted: true },
          { id: "a1-comm", costType: "commission", typeLabel: "ค่าคอมมิชชั่น", label: "", note: "", amountSatang: baht(2_000), counted: false },
        ],
      },
    ],
    totals: { salesSatang: baht(100_000), costSatang: baht(20_000), profitSatang: baht(80_000), notCountedSatang: baht(2_000), waitingCostSalesSatang: 0 },
  },
  B: { poId: "B", customerPoNo: "PO-B", deliveries: [], totals: { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 } },
  G: {
    poId: "G",
    customerPoNo: "PO-G",
    deliveries: [{ saleId: "g1", saleDate: "2026-11-26", invoiceRef: "INV2026110009", credit: false, salesSatang: baht(50_000), costSatang: 0, profitSatang: baht(50_000), costMissing: true, storedCostSatang: 0, items: [], costs: [] }],
    totals: { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: baht(50_000) },
  },
};

describe("commissionMonthSheets", () => {
  const sheets = commissionMonthSheets(MONTH, COSTS);
  const sheet = (name: string) => sheets.find((s) => s.name === name)!;

  it("three sheets: the month, the ladder, the costs", () => {
    expect(sheets.map((s) => s.name)).toEqual(["สรุปรายเดือน", "ขั้นบันได", "รายละเอียดต้นทุน"]);
    expect(commissionMonthSheets(MONTH, null).map((s) => s.name)).toEqual(["สรุปรายเดือน", "ขั้นบันได"]);
  });

  it("สรุปรายเดือน: the month and the rate set, each person's totals, what is not counted — above the table", () => {
    expect(sheet("สรุปรายเดือน").title).toEqual([
      "สรุปค่าคอมมิชชั่น — PO ลงวันที่เดือนพฤศจิกายน 2569",
      "คิดตามตารางอัตรา ตั้งแต่เริ่มต้น · ขั้นบันไดนับกำไรสะสมของเดือนตามวันที่ PO รวม PO ที่ลูกค้ายังไม่จ่าย",
      "ฟอร์ด: ทั้งเดือน 83,600.00 · จ่ายแล้ว 21,000.00 · จ่ายได้ตอนนี้ 15,000.00 · รอ 47,000.00 · ส่วนต่างหลังจ่าย +600.00",
      "พี่ต่อ: ทั้งเดือน 81,400.00 · จ่ายแล้ว 19,000.00 · จ่ายได้ตอนนี้ 35,000.00 · รอ 28,000.00 · ส่วนต่างหลังจ่าย -600.00",
      "บริษัท: 165,000.00 · กำไรที่นับ 330,000.00",
      "ยังไม่เลือกค่าคอมของใคร 1 ใบ — ยังไม่นับ",
      "ใบแจ้งหนี้ที่ไม่ได้ออกจาก PO 2 ใบ — ไม่นับค่าคอม (ค่าคอมอิงตาม PO)",
    ]);
  });

  it("สรุปรายเดือน: one row per PO as the screen shows it — a paid one with what was paid and the difference since", () => {
    const rows = sheet("สรุปรายเดือน").rows;
    expect(rows[0]).toEqual({
      "ลำดับ": 1,
      "วันที่ PO": "3 Nov 2026",
      "เลขที่ PO": "PO-A",
      "ลูกค้า": "ลูกค้า A",
      "ค่าคอมของ": "ลูกค้าฟอร์ด",
      "กำไร": 80_000,
      "ช่วงในบันได": "0 – 80,000",
      "ฟอร์ด": 21_600,
      "พี่ต่อ": 18_400,
      "บริษัท": 40_000,
      "สถานะ": "จ่ายแล้ว",
      "วันที่จ่าย": "24 Nov 2026",
      "ฟอร์ดที่จ่าย": 21_000,
      "พี่ต่อที่จ่าย": 19_000,
      "ส่วนต่างฟอร์ด": 600,
      "ส่วนต่างพี่ต่อ": -600,
    });
    expect(rows[1]).toMatchObject({ "ค่าคอมของ": "ลูกค้าพี่ต่อ", "ช่วงในบันได": "", "สถานะ": "จ่ายได้", "วันที่จ่าย": "", "ฟอร์ดที่จ่าย": "", "ส่วนต่างฟอร์ด": "" });
    expect(rows[2]).toMatchObject({ "ค่าคอมของ": "ยังไม่เลือก", "กำไร": 50_000, "ฟอร์ด": 0, "สถานะ": "ยังไม่เลือกค่าคอมของใคร" });
    expect(rows[3]).toMatchObject({ "ช่วงในบันได": "80,000 – 230,000", "สถานะ": "รอลูกค้าจ่าย" });
    expect(rows[4]).toMatchObject({ "กำไร": "", "ช่วงในบันได": "", "สถานะ": "ยังไม่กรอกต้นทุน" });
    expect(rows[5]).toEqual({
      "ลำดับ": "",
      "วันที่ PO": "",
      "เลขที่ PO": "",
      "ลูกค้า": "รวม",
      "ค่าคอมของ": "",
      "กำไร": 380_000,
      "ช่วงในบันได": "",
      "ฟอร์ด": 83_600,
      "พี่ต่อ": 81_400,
      "บริษัท": 165_000,
      "สถานะ": "",
      "วันที่จ่าย": "",
      "ฟอร์ดที่จ่าย": 21_000,
      "พี่ต่อที่จ่าย": 19_000,
      "ส่วนต่างฟอร์ด": 600,
      "ส่วนต่างพี่ต่อ": -600,
    });
    expect(rows).toHaveLength(6);
    expect(sheet("สรุปรายเดือน").moneyColumns).toEqual(["กำไร", "ฟอร์ด", "พี่ต่อ", "บริษัท", "ฟอร์ดที่จ่าย", "พี่ต่อที่จ่าย", "ส่วนต่างฟอร์ด", "ส่วนต่างพี่ต่อ"]);
  });

  it("a PO paid that could not be paid as it stands now says so in its status", () => {
    const paidThenRefunded = { ...MONTH, rows: [{ ...MONTH.rows[0], paidButNot: "awaiting-payment" as const }] };
    expect(commissionMonthSheets(paidThenRefunded, null)[0].rows[0]["สถานะ"]).toBe("จ่ายแล้ว (ตอนนี้: รอลูกค้าจ่าย)");
  });

  it("ขั้นบันได: each slice of a ลูกค้าฟอร์ด PO at its step's rates, a ลูกค้าพี่ต่อ PO flat, then the totals", () => {
    const s = sheet("ขั้นบันได");
    expect(s.rows).toEqual([
      { "เลขที่ PO": "PO-A", "ลูกค้า": "ลูกค้า A", "ค่าคอมของ": "ลูกค้าฟอร์ด", "กำไรสะสมจาก": 0, "ถึง": 80_000, "กำไรในช่วงนี้": 80_000, "% ฟอร์ด": "27%", "% พี่ต่อ": "23%", "% บริษัท": "50%", "ฟอร์ด": 21_600, "พี่ต่อ": 18_400, "บริษัท": 40_000 },
      { "เลขที่ PO": "PO-T", "ลูกค้า": "ลูกค้า T", "ค่าคอมของ": "ลูกค้าพี่ต่อ", "กำไรสะสมจาก": "อัตราคงที่ ไม่อยู่ในขั้นบันได", "ถึง": "", "กำไรในช่วงนี้": 100_000, "% ฟอร์ด": "15%", "% พี่ต่อ": "35%", "% บริษัท": "50%", "ฟอร์ด": 15_000, "พี่ต่อ": 35_000, "บริษัท": 50_000 },
      { "เลขที่ PO": "PO-B", "ลูกค้า": "ลูกค้า B", "ค่าคอมของ": "ลูกค้าฟอร์ด", "กำไรสะสมจาก": 80_000, "ถึง": 100_000, "กำไรในช่วงนี้": 20_000, "% ฟอร์ด": "27%", "% พี่ต่อ": "23%", "% บริษัท": "50%", "ฟอร์ด": 5_400, "พี่ต่อ": 4_600, "บริษัท": 10_000 },
      { "เลขที่ PO": "PO-B", "ลูกค้า": "ลูกค้า B", "ค่าคอมของ": "ลูกค้าฟอร์ด", "กำไรสะสมจาก": 100_000, "ถึง": 230_000, "กำไรในช่วงนี้": 130_000, "% ฟอร์ด": "32%", "% พี่ต่อ": "18%", "% บริษัท": "50%", "ฟอร์ด": 41_600, "พี่ต่อ": 23_400, "บริษัท": 65_000 },
      { "เลขที่ PO": "", "ลูกค้า": "รวม", "ค่าคอมของ": "", "กำไรสะสมจาก": "", "ถึง": "", "กำไรในช่วงนี้": 330_000, "% ฟอร์ด": "", "% พี่ต่อ": "", "% บริษัท": "", "ฟอร์ด": 83_600, "พี่ต่อ": 81_400, "บริษัท": 165_000 },
    ]);
    expect(s.moneyColumns).toEqual(["กำไรสะสมจาก", "ถึง", "กำไรในช่วงนี้", "ฟอร์ด", "พี่ต่อ", "บริษัท"]);
  });

  it("รายละเอียดต้นทุน: by PO and delivery — the sales, each cost line, the commission row not deducted, what is not typed yet, the profit counted", () => {
    const rows = sheet("รายละเอียดต้นทุน").rows;
    const a = { "เลขที่ PO": "PO-A", "ลูกค้า": "ลูกค้า A", "การส่งของ": "ส่งของครั้งที่ 1", "เลขที่เอกสาร": "INV2026110001", "วันที่": "10 Nov 2026" };
    expect(rows.slice(0, 5)).toEqual([
      { ...a, "ประเภท": "ยอดขาย", "รายการ": "ยอดขาย (ไม่รวม VAT)", "จำนวนเงิน": 100_000, "หมายเหตุ": "" },
      { ...a, "ประเภท": "ต้นทุนสินค้า", "รายการ": "เครื่องชั่ง A × 1", "จำนวนเงิน": 15_000, "หมายเหตุ": "" },
      { ...a, "ประเภท": "ค่าขนส่ง", "รายการ": "Kerry", "จำนวนเงิน": 5_000, "หมายเหตุ": "" },
      { ...a, "ประเภท": "ค่าคอมมิชชั่น", "รายการ": "", "จำนวนเงิน": 2_000, "หมายเหตุ": "ไม่นำมาหัก" },
      {
        "เลขที่ PO": "PO-A", "ลูกค้า": "ลูกค้า A", "การส่งของ": "รวม PO นี้", "เลขที่เอกสาร": "", "วันที่": "",
        "ประเภท": "กำไรที่นับ", "รายการ": "ยอดขาย 100,000.00 − ต้นทุน 20,000.00", "จำนวนเงิน": 80_000, "หมายเหตุ": "",
      },
    ]);
    // B has not delivered anything; T and N are not in the costs read.
    expect(rows[5]).toMatchObject({ "เลขที่ PO": "PO-B", "การส่งของ": "", "รายการ": "ยังไม่มีการส่งของ", "จำนวนเงิน": "" });
    expect(rows[6]).toMatchObject({ "เลขที่ PO": "PO-G", "ประเภท": "ยอดขาย", "จำนวนเงิน": 50_000 });
    expect(rows[7]).toMatchObject({ "เลขที่ PO": "PO-G", "รายการ": "ยังไม่กรอกต้นทุน", "จำนวนเงิน": "", "หมายเหตุ": "ครั้งนี้ยังไม่นับ" });
    expect(rows[8]).toMatchObject({ "การส่งของ": "รวม PO นี้", "จำนวนเงิน": 0, "หมายเหตุ": "ยังไม่นับยอดขาย 50,000.00 ของครั้งที่ยังไม่กรอกต้นทุน" });
    expect(rows).toHaveLength(9);
    expect(sheet("รายละเอียดต้นทุน").moneyColumns).toEqual(["จำนวนเงิน"]);
  });

  it("the file is named for the month", () => {
    expect(commissionMonthFilename("2026-11")).toBe("commission_2026-11.xlsx");
  });
});
