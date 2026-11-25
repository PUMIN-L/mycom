// @vitest-environment node
/**
 * The commission calculator (lib/accounting/commission.ts) — pure. Every figure
 * below is worked out by hand, and the first block is the owner's own table
 * ("ตารางค่าคอม 3 ปีแรก: กำไรทั้งหมดมาจากยอดของฟอร์ด (ต่อเดือน)"):
 *  • the company always takes 50% of a deal's profit, the other 50% goes to
 *    ฟอร์ด and พี่ต่อ;
 *  • a ลูกค้าฟอร์ด deal climbs a step ladder: the month's running profit, in
 *    PO-date order, each slice at its own step's rates (27/23 up to 100,000,
 *    32/18 up to 300,000, 34/16 up to 500,000, 37/13 beyond);
 *  • a ลูกค้าพี่ต่อ deal is flat 15/35 and does not move the ladder;
 *  • a PO nobody chose, a loss, or a profit not known yet takes nothing.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMMISSION_RULES,
  FIRST_EFFECTIVE_MONTH,
  ladderSlices,
  monthCommission,
  rateRulesProblems,
  rateSetForMonth,
  splitAmount,
  type CommissionPoInput,
  type RateRules,
  type RateSet,
} from "@/app/lib/accounting/commission";

/** Baht → satang. */
const baht = (n: number) => Math.round(n * 100);

function po(id: string, issueDate: string, kind: CommissionPoInput["kind"], profitBaht: number | null, createdAt = `${issueDate}T09:00:00.000Z`): CommissionPoInput {
  return { id, issueDate, createdAt, kind, profitSatang: profitBaht === null ? null : baht(profitBaht) };
}

function byId(results: ReturnType<typeof monthCommission>) {
  return new Map(results.map((r) => [r.id, r]));
}

describe("the owner's table — one month, all profit from ลูกค้าฟอร์ด", () => {
  const rows: [profit: number, ford: number, tor: number, company: number][] = [
    [50_000, 13_500, 11_500, 25_000],
    [100_000, 27_000, 23_000, 50_000],
    [200_000, 59_000, 41_000, 100_000],
    [300_000, 91_000, 59_000, 150_000],
    [400_000, 125_000, 75_000, 200_000],
    [500_000, 159_000, 91_000, 250_000],
    [600_000, 196_000, 104_000, 300_000],
  ];
  it.each(rows)("profit %d → ฟอร์ด %d, พี่ต่อ %d, บริษัท %d", (profit, ford, tor, company) => {
    const [r] = monthCommission([po("p", "2026-11-05", "ford", profit)], DEFAULT_COMMISSION_RULES);
    expect(r.fordSatang).toBe(baht(ford));
    expect(r.torSatang).toBe(baht(tor));
    expect(r.companySatang).toBe(baht(company));
    expect(r.ladderFromSatang).toBe(0);
    expect(r.ladderToSatang).toBe(baht(profit));
  });

  it("300,000 = the first 100,000 × 27% + the next 200,000 × 32% (the note under the table)", () => {
    expect(ladderSlices(0, baht(300_000), DEFAULT_COMMISSION_RULES.ladder)).toEqual([
      { fromSatang: 0, toSatang: baht(100_000), fordBp: 2700, torBp: 2300, fordSatang: baht(27_000), torSatang: baht(23_000), companySatang: baht(50_000) },
      { fromSatang: baht(100_000), toSatang: baht(300_000), fordBp: 3200, torBp: 1800, fordSatang: baht(64_000), torSatang: baht(36_000), companySatang: baht(100_000) },
    ]);
  });
});

describe("several POs in one month — in PO-date order, unpaid ones counted too", () => {
  it("80,000 / 150,000 / 400,000 → each takes the slice of the running profit it spans", () => {
    // Given out of order: the ladder runs by PO date, not by the order given.
    const out = monthCommission(
      [po("C", "2026-11-20", "ford", 400_000), po("A", "2026-11-03", "ford", 80_000), po("B", "2026-11-10", "ford", 150_000)],
      DEFAULT_COMMISSION_RULES
    );
    expect(out.map((r) => r.id)).toEqual(["A", "B", "C"]);
    const r = byId(out);
    expect([r.get("A")!.ladderFromSatang, r.get("A")!.ladderToSatang]).toEqual([0, baht(80_000)]);
    expect([r.get("B")!.ladderFromSatang, r.get("B")!.ladderToSatang]).toEqual([baht(80_000), baht(230_000)]);
    expect([r.get("C")!.ladderFromSatang, r.get("C")!.ladderToSatang]).toEqual([baht(230_000), baht(630_000)]);
    expect([r.get("A")!.fordSatang, r.get("A")!.torSatang, r.get("A")!.companySatang]).toEqual([baht(21_600), baht(18_400), baht(40_000)]);
    expect([r.get("B")!.fordSatang, r.get("B")!.torSatang, r.get("B")!.companySatang]).toEqual([baht(47_000), baht(28_000), baht(75_000)]);
    expect([r.get("C")!.fordSatang, r.get("C")!.torSatang, r.get("C")!.companySatang]).toEqual([baht(138_500), baht(61_500), baht(200_000)]);
    // B straddles the first step: 20,000 at 27/23, 130,000 at 32/18.
    expect(r.get("B")!.slices.map((s) => [s.fromSatang, s.toSatang, s.fordSatang, s.torSatang])).toEqual([
      [baht(80_000), baht(100_000), baht(5_400), baht(4_600)],
      [baht(100_000), baht(230_000), baht(41_600), baht(23_400)],
    ]);
    // The month as a whole is the owner's table at 630,000: 600,000's 196,000 + 30,000 × 37%.
    const sum = (k: "fordSatang" | "torSatang" | "companySatang") => out.reduce((s, x) => s + x[k], 0);
    expect([sum("fordSatang"), sum("torSatang"), sum("companySatang")]).toEqual([baht(207_100), baht(107_900), baht(315_000)]);
  });

  it("150,000 then 400,000 → 43,000 / 134,500 for ฟอร์ด, 32,000 / 65,500 for พี่ต่อ", () => {
    const r = byId(monthCommission([po("B", "2026-11-10", "ford", 150_000), po("C", "2026-11-20", "ford", 400_000)], DEFAULT_COMMISSION_RULES));
    expect([r.get("B")!.fordSatang, r.get("B")!.torSatang]).toEqual([baht(43_000), baht(32_000)]);
    expect([r.get("C")!.fordSatang, r.get("C")!.torSatang]).toEqual([baht(134_500), baht(65_500)]);
  });

  it("the same PO date: the one recorded first goes first, then by id", () => {
    const out = monthCommission(
      [
        po("x", "2026-11-05", "ford", 100_000, "2026-11-05T10:00:00.000Z"),
        po("y", "2026-11-05", "ford", 100_000, "2026-11-05T08:00:00.000Z"),
        po("b", "2026-11-06", "ford", 1_000, "2026-11-06T08:00:00.000Z"),
        po("a", "2026-11-06", "ford", 1_000, "2026-11-06T08:00:00.000Z"),
      ],
      DEFAULT_COMMISSION_RULES
    );
    expect(out.map((r) => r.id)).toEqual(["y", "x", "a", "b"]);
    // y takes the whole first step at 27%, x the next 100,000 at 32%.
    expect(byId(out).get("y")!.fordSatang).toBe(baht(27_000));
    expect(byId(out).get("x")!.fordSatang).toBe(baht(32_000));
  });
});

describe("what does not climb the ladder", () => {
  it("a ลูกค้าพี่ต่อ deal is flat 15 / 35 and leaves the ladder where it was", () => {
    const r = byId(
      monthCommission(
        [po("A", "2026-11-03", "ford", 80_000), po("T", "2026-11-05", "tor", 100_000), po("C", "2026-11-20", "ford", 400_000)],
        DEFAULT_COMMISSION_RULES
      )
    );
    expect([r.get("T")!.fordSatang, r.get("T")!.torSatang, r.get("T")!.companySatang]).toEqual([baht(15_000), baht(35_000), baht(50_000)]);
    expect([r.get("T")!.ladderFromSatang, r.get("T")!.ladderToSatang]).toEqual([null, null]);
    expect(r.get("T")!.slices).toEqual([]);
    // C starts where A ended: 80,000 → 480,000.
    expect([r.get("C")!.ladderFromSatang, r.get("C")!.ladderToSatang]).toEqual([baht(80_000), baht(480_000)]);
    expect([r.get("C")!.fordSatang, r.get("C")!.torSatang, r.get("C")!.companySatang]).toEqual([baht(130_600), baht(69_400), baht(200_000)]);
  });

  it("a PO nobody chose yet gets nothing and leaves the ladder alone", () => {
    const r = byId(
      monthCommission([po("N", "2026-11-01", null, 100_000), po("A", "2026-11-03", "ford", 80_000)], DEFAULT_COMMISSION_RULES)
    );
    const n = r.get("N")!;
    expect([n.fordSatang, n.torSatang, n.companySatang, n.countedSatang]).toEqual([0, 0, 0, 0]);
    expect([n.ladderFromSatang, n.ladderToSatang]).toEqual([null, null]);
    expect(r.get("A")!.ladderFromSatang).toBe(0);
  });

  it("a loss, or a profit not known yet, counts as 0 — on the ladder but taking no room", () => {
    const r = byId(
      monthCommission(
        [po("L", "2026-11-01", "ford", -50_000), po("U", "2026-11-02", "ford", null), po("A", "2026-11-03", "ford", 80_000), po("TL", "2026-11-04", "tor", -1_000)],
        DEFAULT_COMMISSION_RULES
      )
    );
    for (const id of ["L", "U", "TL"]) {
      const x = r.get(id)!;
      expect([x.fordSatang, x.torSatang, x.companySatang, x.countedSatang]).toEqual([0, 0, 0, 0]);
      expect(x.slices).toEqual([]);
    }
    expect([r.get("L")!.ladderFromSatang, r.get("L")!.ladderToSatang]).toEqual([0, 0]);
    expect([r.get("U")!.ladderFromSatang, r.get("U")!.ladderToSatang]).toEqual([0, 0]);
    expect([r.get("A")!.ladderFromSatang, r.get("A")!.ladderToSatang]).toEqual([0, baht(80_000)]);
  });
});

describe("money to the satang", () => {
  it("rounds each share half up and gives the company the rest, so the three add up exactly", () => {
    // 333.33 × 27% = 89.9991 → 90.00; × 23% = 76.6659 → 76.67; the company 166.66.
    expect(splitAmount(33_333, 2700, 2300)).toEqual({ fordSatang: 9_000, torSatang: 7_667, companySatang: 16_666 });
    const [r] = monthCommission([po("p", "2026-11-05", "ford", 333.33)], DEFAULT_COMMISSION_RULES);
    expect(r.fordSatang + r.torSatang + r.companySatang).toBe(33_333);
  });

  it("a PO straddling a step by a satang still adds up", () => {
    const out = monthCommission(
      [{ id: "a", issueDate: "2026-11-01", createdAt: "x", kind: "ford", profitSatang: 9_999_999 }, { id: "b", issueDate: "2026-11-02", createdAt: "x", kind: "ford", profitSatang: 2 }],
      DEFAULT_COMMISSION_RULES
    );
    const b = byId(out).get("b")!;
    expect(b.slices.map((s) => [s.fromSatang, s.toSatang])).toEqual([[9_999_999, 10_000_000], [10_000_000, 10_000_001]]);
    expect(b.fordSatang + b.torSatang + b.companySatang).toBe(2);
    for (const x of out) {
      expect(x.fordSatang + x.torSatang + x.companySatang).toBe(x.countedSatang);
      for (const s of x.slices) expect(s.fordSatang + s.torSatang + s.companySatang).toBe(s.toSatang - s.fromSatang);
    }
  });

  it("a billion-baht profit loses nothing", () => {
    const [r] = monthCommission([{ id: "big", issueDate: "2026-11-01", createdAt: "x", kind: "ford", profitSatang: 100_000_000_000 }], DEFAULT_COMMISSION_RULES);
    expect(r.fordSatang).toBe(36_997_400_000);
    expect(r.torSatang).toBe(13_002_600_000);
    expect(r.companySatang).toBe(50_000_000_000);
  });
});

describe("another table", () => {
  const rules: RateRules = {
    ladder: [
      { upToSatang: baht(1_000), fordBp: 1000, torBp: 1000 },
      { upToSatang: null, fordBp: 2000, torBp: 2000 },
    ],
    torFlat: { fordBp: 500, torBp: 500 },
  };
  it("uses the steps and rates it is given", () => {
    const r = byId(monthCommission([po("f", "2026-11-01", "ford", 1_500), po("t", "2026-11-02", "tor", 1_000)], rules));
    expect([r.get("f")!.fordSatang, r.get("f")!.torSatang, r.get("f")!.companySatang]).toEqual([baht(200), baht(200), baht(1_100)]);
    expect([r.get("t")!.fordSatang, r.get("t")!.torSatang, r.get("t")!.companySatang]).toEqual([baht(50), baht(50), baht(900)]);
  });
});

describe("rateSetForMonth — a set starts on the 1st of a month (the owner's rule)", () => {
  const custom: RateRules = { ladder: [{ upToSatang: null, fordBp: 3000, torBp: 2000 }], torFlat: { fordBp: 1500, torBp: 3500 } };
  const sets: RateSet[] = [
    { id: "s1", effectiveMonth: "2029-04", rules: custom },
    { id: "s0", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: DEFAULT_COMMISSION_RULES },
  ];
  it("takes the latest set that has started by that month", () => {
    expect(rateSetForMonth(sets, "2029-03").id).toBe("s0");
    expect(rateSetForMonth(sets, "2029-04").id).toBe("s1");
    expect(rateSetForMonth(sets, "2031-12").id).toBe("s1");
  });
  it("is the owner's table when nothing was ever saved", () => {
    const set = rateSetForMonth([], "2026-11");
    expect(set.id).toBeNull();
    expect(set.effectiveMonth).toBe(FIRST_EFFECTIVE_MONTH);
    expect(set.rules).toEqual(DEFAULT_COMMISSION_RULES);
  });
  it("falls back to the owner's table for a month before every saved set", () => {
    expect(rateSetForMonth([{ id: "s1", effectiveMonth: "2029-04", rules: custom }], "2028-12").rules).toEqual(DEFAULT_COMMISSION_RULES);
  });
});

describe("rateRulesProblems", () => {
  const valid = () => JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES)) as RateRules;

  it("finds nothing wrong with the owner's table", () => {
    expect(rateRulesProblems(DEFAULT_COMMISSION_RULES)).toEqual([]);
  });

  it("needs a table of steps", () => {
    expect(rateRulesProblems(null)).toEqual(["ตารางอัตราไม่ถูกต้อง"]);
    expect(rateRulesProblems({ ...valid(), ladder: [] })).toContain("ต้องมีอย่างน้อย 1 ขั้น");
    const many = valid();
    many.ladder = Array.from({ length: 11 }, (_, i) => ({ upToSatang: i === 10 ? null : (i + 1) * 100, fordBp: 100, torBp: 100 }));
    expect(rateRulesProblems(many)).toContain("ได้ไม่เกิน 10 ขั้น");
  });

  it("the last step has no ceiling, every other one has one, each above the one before", () => {
    const capped = valid();
    capped.ladder[3].upToSatang = baht(900_000);
    expect(rateRulesProblems(capped)).toContain("ขั้นสุดท้ายต้องเป็น \"เกิน …\" (ไม่มีเพดาน)");
    const open = valid();
    open.ladder[1].upToSatang = null;
    expect(rateRulesProblems(open)).toContain("ขั้นที่ 2: ต้องระบุกำไรสูงสุดของขั้น");
    const down = valid();
    down.ladder[1].upToSatang = baht(50_000);
    expect(rateRulesProblems(down)).toContain("ขั้นที่ 2: ต้องมากกว่าขั้นที่ 1");
    const zero = valid();
    zero.ladder[0].upToSatang = 0;
    expect(rateRulesProblems(zero)).toContain("ขั้นที่ 1: ต้องระบุกำไรสูงสุดของขั้น");
    const satang = valid();
    satang.ladder[2].upToSatang = 50_000_050;
    expect(rateRulesProblems(satang)).toEqual(["ขั้นที่ 3: กำไรสูงสุดของขั้นต้องเป็นจำนวนเต็มบาท"]);
  });

  it("percentages between 0 and 100, at most 2 decimals, ฟอร์ด + พี่ต่อ not over 100", () => {
    const high = valid();
    high.ladder[0].fordBp = 10_001;
    expect(rateRulesProblems(high)).toContain("ขั้นที่ 1: % ของฟอร์ดต้องอยู่ระหว่าง 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
    const frac = valid();
    frac.ladder[2].torBp = 12.5;
    expect(rateRulesProblems(frac)).toContain("ขั้นที่ 3: % ของพี่ต่อต้องอยู่ระหว่าง 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
    const over = valid();
    over.ladder[0] = { upToSatang: baht(100_000), fordBp: 6000, torBp: 5000 };
    expect(rateRulesProblems(over)).toContain("ขั้นที่ 1: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%");
    const flat = valid();
    flat.torFlat = { fordBp: 7000, torBp: 4000 };
    expect(rateRulesProblems(flat)).toContain("ดีลลูกค้าพี่ต่อ: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%");
    const flatBad = valid();
    flatBad.torFlat = { fordBp: -1, torBp: 3500 };
    expect(rateRulesProblems(flatBad)).toContain("ดีลลูกค้าพี่ต่อ: % ของฟอร์ดต้องอยู่ระหว่าง 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
  });
});
