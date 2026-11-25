// The commission month as an Excel workbook (ARCHITECTURE.md §8h) — pure,
// for the browser (downloadExcel writes the file; nothing is kept):
//  • "สรุปรายเดือน" — every PO of the month as the screen shows it, a รวม row;
//  • "ขั้นบันได" — how each PO's commission was worked out, slice by slice;
//  • "รายละเอียดต้นทุน" — what each PO's profit is made of, line by line.
// Money in baht as numbers (#,##0.00 in Excel, still numbers to add up).

import type { ExcelSheet } from "../xlsxExport";
import { formatDisplayDate } from "../dateFormat";
import { monthLabel } from "./exportRules";
import { formatSatang, satangToBaht } from "./money";
import { BP_WHOLE, COMMISSION_KIND_LABELS } from "./commission";
import { effectiveMonthLabel, formatPercent, formatWholeBaht } from "./commissionRateChange";
import { deliveryTitles } from "./commissionPayoutPaper";
import { COMMISSION_STATUS_LABELS, type CommissionMonth, type CommissionMonthRow, type PersonTotals, type PoCosts } from "./commissionTypes";

const baht = satangToBaht;
const signed = (satang: number) => (satang > 0 ? `+${formatSatang(satang)}` : formatSatang(satang));
const kindLabel = (row: Pick<CommissionMonthRow, "kind">) => (row.kind ? COMMISSION_KIND_LABELS[row.kind] : "ยังไม่เลือก");

export const commissionMonthFilename = (month: string) => `commission_${month}.xlsx`;

const SUMMARY_MONEY = ["กำไร", "ฟอร์ด", "พี่ต่อ", "บริษัท", "ฟอร์ดที่จ่าย", "พี่ต่อที่จ่าย", "ส่วนต่างฟอร์ด", "ส่วนต่างพี่ต่อ"];
const LADDER_MONEY = ["กำไรสะสมจาก", "ถึง", "กำไรในช่วงนี้", "ฟอร์ด", "พี่ต่อ", "บริษัท"];

function personLine(name: string, t: PersonTotals): string {
  const parts = [
    `${name}: ทั้งเดือน ${formatSatang(t.totalSatang)}`,
    `จ่ายแล้ว ${formatSatang(t.paidSatang ?? 0)}`,
    `จ่ายได้ตอนนี้ ${formatSatang(t.payableSatang)}`,
    `รอ ${formatSatang(t.waitingSatang)}`,
  ];
  if ((t.differenceSatang ?? 0) !== 0) parts.push(`ส่วนต่างหลังจ่าย ${signed(t.differenceSatang)}`);
  return parts.join(" · ");
}

function statusText(row: CommissionMonthRow): string {
  const text = COMMISSION_STATUS_LABELS[row.commissionStatus] ?? "";
  return row.commissionStatus === "paid" && row.paidButNot ? `${text} (ตอนนี้: ${COMMISSION_STATUS_LABELS[row.paidButNot]})` : text;
}

function summarySheet(data: CommissionMonth, label: string): ExcelSheet {
  const { totals } = data;
  const title = [
    `สรุปค่าคอมมิชชั่น — PO ลงวันที่เดือน${label}`,
    `คิดตามตารางอัตรา ${effectiveMonthLabel(data.rateSet.effectiveMonth)} · ขั้นบันไดนับกำไรสะสมของเดือนตามวันที่ PO รวม PO ที่ลูกค้ายังไม่จ่าย`,
    personLine("ฟอร์ด", totals.ford),
    personLine("พี่ต่อ", totals.tor),
    `บริษัท: ${formatSatang(totals.companySatang)} · กำไรที่นับ ${formatSatang(totals.profitSatang)}`,
  ];
  if (totals.unassigned > 0) title.push(`ยังไม่เลือกค่าคอมของใคร ${totals.unassigned} ใบ — ยังไม่นับ`);
  if (data.invoicesWithoutPo > 0) title.push(`ใบแจ้งหนี้ที่ไม่ได้ออกจาก PO ${data.invoicesWithoutPo} ใบ — ไม่นับค่าคอม (ค่าคอมอิงตาม PO)`);

  const sum = { profit: 0, ford: 0, tor: 0, company: 0, paidFord: 0, paidTor: 0, diffFord: 0, diffTor: 0 };
  const rows: Record<string, unknown>[] = data.rows.map((r, i) => {
    const payout = r.commissionStatus === "paid" ? (r.payout ?? null) : null;
    const diffFord = r.differenceFordSatang ?? 0;
    const diffTor = r.differenceTorSatang ?? 0;
    sum.profit += r.profitSatang ?? 0;
    sum.ford += r.fordSatang;
    sum.tor += r.torSatang;
    sum.company += r.companySatang;
    if (payout) {
      sum.paidFord += payout.fordSatang;
      sum.paidTor += payout.torSatang;
      sum.diffFord += diffFord;
      sum.diffTor += diffTor;
    }
    const onLadder = r.kind === "ford" && r.ladderFromSatang !== null && r.ladderToSatang !== null && r.ladderToSatang > r.ladderFromSatang;
    return {
      "ลำดับ": i + 1,
      "วันที่ PO": formatDisplayDate(r.issueDate),
      "เลขที่ PO": r.customerPoNo,
      "ลูกค้า": r.buyerName,
      "ค่าคอมของ": kindLabel(r),
      "กำไร": r.profitSatang === null ? "" : baht(r.profitSatang),
      "ช่วงในบันได": onLadder ? `${formatWholeBaht(r.ladderFromSatang!)} – ${formatWholeBaht(r.ladderToSatang!)}` : "",
      "ฟอร์ด": baht(r.fordSatang),
      "พี่ต่อ": baht(r.torSatang),
      "บริษัท": baht(r.companySatang),
      "สถานะ": statusText(r),
      "วันที่จ่าย": payout ? formatDisplayDate(payout.paidDate) : "",
      "ฟอร์ดที่จ่าย": payout ? baht(payout.fordSatang) : "",
      "พี่ต่อที่จ่าย": payout ? baht(payout.torSatang) : "",
      "ส่วนต่างฟอร์ด": payout ? baht(diffFord) : "",
      "ส่วนต่างพี่ต่อ": payout ? baht(diffTor) : "",
    };
  });
  if (rows.length > 0) {
    rows.push({
      "ลำดับ": "",
      "วันที่ PO": "",
      "เลขที่ PO": "",
      "ลูกค้า": "รวม",
      "ค่าคอมของ": "",
      "กำไร": baht(sum.profit),
      "ช่วงในบันได": "",
      "ฟอร์ด": baht(sum.ford),
      "พี่ต่อ": baht(sum.tor),
      "บริษัท": baht(sum.company),
      "สถานะ": "",
      "วันที่จ่าย": "",
      "ฟอร์ดที่จ่าย": baht(sum.paidFord),
      "พี่ต่อที่จ่าย": baht(sum.paidTor),
      "ส่วนต่างฟอร์ด": baht(sum.diffFord),
      "ส่วนต่างพี่ต่อ": baht(sum.diffTor),
    });
  }
  return { name: "สรุปรายเดือน", title, rows, moneyColumns: SUMMARY_MONEY, autoSizeColumns: true };
}

function ladderSheet(data: CommissionMonth, label: string): ExcelSheet {
  const flat = data.rateSet.rules.torFlat;
  const pct = (fordBp: number, torBp: number) => ({ "% ฟอร์ด": formatPercent(fordBp), "% พี่ต่อ": formatPercent(torBp), "% บริษัท": formatPercent(BP_WHOLE - fordBp - torBp) });
  const sum = { amount: 0, ford: 0, tor: 0, company: 0 };
  const rows: Record<string, unknown>[] = [];
  for (const r of data.rows) {
    const po = { "เลขที่ PO": r.customerPoNo, "ลูกค้า": r.buyerName, "ค่าคอมของ": kindLabel(r) };
    if (r.kind === "tor" && r.countedSatang > 0) {
      rows.push({
        ...po,
        "กำไรสะสมจาก": "อัตราคงที่ ไม่อยู่ในขั้นบันได",
        "ถึง": "",
        "กำไรในช่วงนี้": baht(r.countedSatang),
        ...pct(flat.fordBp, flat.torBp),
        "ฟอร์ด": baht(r.fordSatang),
        "พี่ต่อ": baht(r.torSatang),
        "บริษัท": baht(r.companySatang),
      });
      sum.amount += r.countedSatang;
      sum.ford += r.fordSatang;
      sum.tor += r.torSatang;
      sum.company += r.companySatang;
      continue;
    }
    if (r.kind !== "ford") continue;
    for (const s of r.slices ?? []) {
      const amount = s.toSatang - s.fromSatang;
      rows.push({
        ...po,
        "กำไรสะสมจาก": baht(s.fromSatang),
        "ถึง": baht(s.toSatang),
        "กำไรในช่วงนี้": baht(amount),
        ...pct(s.fordBp, s.torBp),
        "ฟอร์ด": baht(s.fordSatang),
        "พี่ต่อ": baht(s.torSatang),
        "บริษัท": baht(s.companySatang),
      });
      sum.amount += amount;
      sum.ford += s.fordSatang;
      sum.tor += s.torSatang;
      sum.company += s.companySatang;
    }
  }
  if (rows.length > 0) {
    rows.push({
      "เลขที่ PO": "",
      "ลูกค้า": "รวม",
      "ค่าคอมของ": "",
      "กำไรสะสมจาก": "",
      "ถึง": "",
      "กำไรในช่วงนี้": baht(sum.amount),
      "% ฟอร์ด": "",
      "% พี่ต่อ": "",
      "% บริษัท": "",
      "ฟอร์ด": baht(sum.ford),
      "พี่ต่อ": baht(sum.tor),
      "บริษัท": baht(sum.company),
    });
  }
  return {
    name: "ขั้นบันได",
    title: [
      `ขั้นบันไดค่าคอม — PO เดือน${label}`,
      "ลูกค้าฟอร์ด: แต่ละ PO รับช่วงของกำไรสะสมของเดือนที่ตัวเองอยู่ แต่ละช่วงคิดตามอัตราของขั้นนั้น",
      `ลูกค้าพี่ต่อ: อัตราคงที่ ฟอร์ด ${formatPercent(flat.fordBp)} · พี่ต่อ ${formatPercent(flat.torBp)} · บริษัท ${formatPercent(BP_WHOLE - flat.fordBp - flat.torBp)}`,
    ],
    rows,
    moneyColumns: LADDER_MONEY,
    autoSizeColumns: true,
  };
}

function costsSheet(data: CommissionMonth, costs: Record<string, PoCosts>, label: string): ExcelSheet {
  const rows: Record<string, unknown>[] = [];
  for (const r of data.rows) {
    const c = costs[r.id];
    if (!c) continue;
    const po = { "เลขที่ PO": r.customerPoNo, "ลูกค้า": r.buyerName };
    if (c.deliveries.length === 0) {
      rows.push({ ...po, "การส่งของ": "", "เลขที่เอกสาร": "", "วันที่": "", "ประเภท": "", "รายการ": "ยังไม่มีการส่งของ", "จำนวนเงิน": "", "หมายเหตุ": "" });
      continue;
    }
    const titles = deliveryTitles(c.deliveries);
    c.deliveries.forEach((d, i) => {
      const at = { ...po, "การส่งของ": titles[i], "เลขที่เอกสาร": d.invoiceRef, "วันที่": formatDisplayDate(d.saleDate) };
      rows.push({ ...at, "ประเภท": "ยอดขาย", "รายการ": "ยอดขาย (ไม่รวม VAT)", "จำนวนเงิน": baht(d.salesSatang), "หมายเหตุ": d.credit ? "ใบลดหนี้ — ยอดติดลบ" : "" });
      for (const item of d.items) {
        rows.push({ ...at, "ประเภท": "ต้นทุนสินค้า", "รายการ": `${item.productName} × ${item.qty}`, "จำนวนเงิน": baht(item.costSatang), "หมายเหตุ": "" });
      }
      for (const cost of d.costs) {
        rows.push({
          ...at,
          "ประเภท": cost.typeLabel,
          "รายการ": `${cost.label}${cost.note ? ` (${cost.note})` : ""}`,
          "จำนวนเงิน": baht(cost.amountSatang),
          "หมายเหตุ": cost.counted ? "" : "ไม่นำมาหัก",
        });
      }
      if (d.costMissing) rows.push({ ...at, "ประเภท": "", "รายการ": "ยังไม่กรอกต้นทุน", "จำนวนเงิน": "", "หมายเหตุ": "ครั้งนี้ยังไม่นับ" });
    });
    rows.push({
      ...po,
      "การส่งของ": "รวม PO นี้",
      "เลขที่เอกสาร": "",
      "วันที่": "",
      "ประเภท": "กำไรที่นับ",
      "รายการ": `ยอดขาย ${formatSatang(c.totals.salesSatang)} − ต้นทุน ${formatSatang(c.totals.costSatang)}`,
      "จำนวนเงิน": baht(c.totals.profitSatang),
      "หมายเหตุ": c.totals.waitingCostSalesSatang > 0 ? `ยังไม่นับยอดขาย ${formatSatang(c.totals.waitingCostSalesSatang)} ของครั้งที่ยังไม่กรอกต้นทุน` : "",
    });
  }
  return {
    name: "รายละเอียดต้นทุน",
    title: [`รายละเอียดต้นทุน — PO เดือน${label}`, "ยอดขายไม่รวม VAT · ค่าคอมมิชชั่นที่ลงเป็นต้นทุนแสดงไว้แต่ไม่นำมาหัก · ครั้งที่ยังไม่กรอกต้นทุนยังไม่นับ"],
    rows,
    moneyColumns: ["จำนวนเงิน"],
    autoSizeColumns: true,
  };
}

/** The workbook: the month, the ladder, and — when they were read — the costs. */
export function commissionMonthSheets(data: CommissionMonth, costs: Record<string, PoCosts> | null): ExcelSheet[] {
  const label = monthLabel(data.month);
  const sheets = [summarySheet(data, label), ladderSheet(data, label)];
  if (costs) sheets.push(costsSheet(data, costs, label));
  return sheets;
}
