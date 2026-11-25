// @vitest-environment node
/**
 * Changing the commission rate table (lib/accounting/commissionRateChange.ts) —
 * pure: what a change is, what is wrong with one, how a set reads, and the
 * before → after table the emails show. A set starts on the 1st of a month
 * (the owner's rule); the first set ("ตั้งแต่เริ่มต้น") can be edited, never
 * removed.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_COMMISSION_RULES, FIRST_EFFECTIVE_MONTH, type RateRules, type RateSet } from "@/app/lib/accounting/commission";
import {
  applyRateChange,
  cleanRateChange,
  effectiveMonthLabel,
  formatPercent,
  isEffectiveMonth,
  ladderRowViews,
  percentTextToBp,
  rateChangeProblems,
  rateChangeTable,
  sameRules,
} from "@/app/lib/accounting/commissionRateChange";

const copy = (r: RateRules = DEFAULT_COMMISSION_RULES): RateRules => JSON.parse(JSON.stringify(r));
const FIRST: RateSet = { id: "r0", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: copy() };

describe("months", () => {
  it("a set starts at the beginning, or on the 1st of a real month", () => {
    expect(isEffectiveMonth(FIRST_EFFECTIVE_MONTH)).toBe(true);
    expect(isEffectiveMonth("2029-04")).toBe(true);
    for (const bad of ["2029-13", "2029-4", "29-04", "2029-04-01", "", null, 202904]) expect(isEffectiveMonth(bad)).toBe(false);
  });
  it("reads as Thai", () => {
    expect(effectiveMonthLabel(FIRST_EFFECTIVE_MONTH)).toBe("ตั้งแต่เริ่มต้น");
    expect(effectiveMonthLabel("2029-04")).toBe("ตั้งแต่เดือนเมษายน 2572");
  });
});

describe("percent", () => {
  it("shows a rate as people write it", () => {
    expect(formatPercent(2700)).toBe("27%");
    expect(formatPercent(2750)).toBe("27.5%");
    expect(formatPercent(1234)).toBe("12.34%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(10_000)).toBe("100%");
  });
  it("reads what is typed — at most 2 decimals, 0 to 100", () => {
    expect(percentTextToBp("27")).toBe(2700);
    expect(percentTextToBp(" 27.5 ")).toBe(2750);
    expect(percentTextToBp("12.34%")).toBe(1234);
    expect(percentTextToBp("0")).toBe(0);
    expect(percentTextToBp("100")).toBe(10_000);
    for (const bad of ["", "abc", "-1", "100.01", "101", "1.234", "1,5"]) expect(percentTextToBp(bad)).toBeNull();
  });
});

describe("ladderRowViews — the steps as the owner's table writes them", () => {
  it("0 – 100,000 / 100,001 – 300,000 / 300,001 – 500,000 / เกิน 500,000, with the company's share", () => {
    expect(ladderRowViews(DEFAULT_COMMISSION_RULES.ladder)).toEqual([
      { label: "0 – 100,000", fordBp: 2700, torBp: 2300, companyBp: 5000 },
      { label: "100,001 – 300,000", fordBp: 3200, torBp: 1800, companyBp: 5000 },
      { label: "300,001 – 500,000", fordBp: 3400, torBp: 1600, companyBp: 5000 },
      { label: "เกิน 500,000", fordBp: 3700, torBp: 1300, companyBp: 5000 },
    ]);
  });
  it("one step only: every profit", () => {
    expect(ladderRowViews([{ upToSatang: null, fordBp: 3000, torBp: 2000 }])).toEqual([{ label: "กำไรทุกยอด", fordBp: 3000, torBp: 2000, companyBp: 5000 }]);
  });
});

describe("cleanRateChange — the shape the browser sends", () => {
  it("keeps a save or a remove", () => {
    expect(cleanRateChange({ kind: "save", effectiveMonth: "2029-04", rules: DEFAULT_COMMISSION_RULES })).toEqual({
      kind: "save",
      effectiveMonth: "2029-04",
      rules: DEFAULT_COMMISSION_RULES,
    });
    expect(cleanRateChange({ kind: "remove", effectiveMonth: "2029-04", extra: 1 })).toEqual({ kind: "remove", effectiveMonth: "2029-04" });
  });
  it("drops anything not in a step", () => {
    const body = { kind: "save", effectiveMonth: "0000-00", rules: { ladder: [{ upToSatang: null, fordBp: 1, torBp: 2, evil: "x" }], torFlat: { fordBp: 3, torBp: 4, x: 1 }, y: 2 } };
    expect(cleanRateChange(body)).toEqual({ kind: "save", effectiveMonth: "0000-00", rules: { ladder: [{ upToSatang: null, fordBp: 1, torBp: 2 }], torFlat: { fordBp: 3, torBp: 4 } } });
  });
  it("is null for anything else", () => {
    for (const bad of [null, "x", {}, { kind: "edit", effectiveMonth: "2029-04" }, { kind: "save", effectiveMonth: 1 }, { kind: "save", effectiveMonth: "2029-04" }, { kind: "save", effectiveMonth: "2029-04", rules: { ladder: "x", torFlat: {} } }]) {
      expect(cleanRateChange(bad)).toBeNull();
    }
  });
});

describe("rateChangeProblems", () => {
  it("a new set from a month, different from what applied — fine", () => {
    const rules = copy();
    rules.ladder[1].fordBp = 3300;
    rules.ladder[1].torBp = 1700;
    expect(rateChangeProblems({ kind: "save", effectiveMonth: "2029-04", rules }, [FIRST])).toEqual([]);
  });

  it("says what is wrong with the table, and with the month", () => {
    const rules = copy();
    rules.ladder[0].fordBp = 9000;
    expect(rateChangeProblems({ kind: "save", effectiveMonth: "2029-04", rules }, [FIRST])).toContain("ขั้นที่ 1: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%");
    expect(rateChangeProblems({ kind: "save", effectiveMonth: "2029-4", rules: copy() }, [FIRST])).toEqual(["เดือนที่เริ่มใช้ไม่ถูกต้อง"]);
  });

  it("a step ends on a whole baht", () => {
    const rules = copy();
    rules.ladder[0].upToSatang = 10_000_050;
    expect(rateChangeProblems({ kind: "save", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules }, [FIRST])).toContain("ขั้นที่ 1: กำไรสูงสุดของขั้นต้องเป็นจำนวนเต็มบาท");
  });

  it("nothing to save when it is what already applies to that month", () => {
    expect(rateChangeProblems({ kind: "save", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: copy() }, [FIRST])).toEqual(["ตารางนี้เหมือนเดิม ไม่มีอะไรเปลี่ยน"]);
    // Nothing saved yet: the owner's table applies — saving it unchanged changes nothing.
    expect(rateChangeProblems({ kind: "save", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: copy() }, [])).toEqual(["ตารางนี้เหมือนเดิม ไม่มีอะไรเปลี่ยน"]);
    // A new month with the same rates as the set before it adds nothing.
    expect(rateChangeProblems({ kind: "save", effectiveMonth: "2029-04", rules: copy() }, [FIRST])).toEqual(["ตารางนี้เหมือนเดิม ไม่มีอะไรเปลี่ยน"]);
  });

  it("removes a later set only — never the first, nor one that is not there", () => {
    const later: RateSet = { id: "r1", effectiveMonth: "2029-04", rules: copy() };
    expect(rateChangeProblems({ kind: "remove", effectiveMonth: "2029-04" }, [FIRST, later])).toEqual([]);
    expect(rateChangeProblems({ kind: "remove", effectiveMonth: FIRST_EFFECTIVE_MONTH }, [FIRST, later])).toEqual(["ลบตารางชุดแรกไม่ได้ — แก้ตัวเลขแทน"]);
    expect(rateChangeProblems({ kind: "remove", effectiveMonth: "2030-01" }, [FIRST, later])).toEqual(["ไม่พบตารางชุดนี้"]);
  });
});

describe("applyRateChange", () => {
  const changed = copy();
  changed.torFlat = { fordBp: 2000, torBp: 3000 };
  it("replaces a month's set, adds a new one in month order, removes one", () => {
    const later: RateSet = { id: "r1", effectiveMonth: "2029-04", rules: changed };
    expect(applyRateChange([FIRST], { kind: "save", effectiveMonth: "2029-04", rules: changed })).toEqual([FIRST, { id: null, effectiveMonth: "2029-04", rules: changed }]);
    expect(applyRateChange([later, FIRST], { kind: "save", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules: changed }).map((s) => [s.effectiveMonth, s.rules.torFlat.fordBp])).toEqual([
      [FIRST_EFFECTIVE_MONTH, 2000],
      ["2029-04", 2000],
    ]);
    expect(applyRateChange([FIRST, later], { kind: "remove", effectiveMonth: "2029-04" })).toEqual([FIRST]);
  });
  it("sameRules compares the figures", () => {
    expect(sameRules(copy(), copy())).toBe(true);
    expect(sameRules(copy(), changed)).toBe(false);
  });
});

describe("rateChangeTable — before → after, what changed standing out", () => {
  it("an edit: each changed rate as 'before → after', highlighted; the company's share follows", () => {
    const rules = copy();
    rules.ladder[1].fordBp = 3300;
    rules.ladder[1].torBp = 1700;
    rules.torFlat.torBp = 3600;
    const t = rateChangeTable({ kind: "save", effectiveMonth: FIRST_EFFECTIVE_MONTH, rules }, [FIRST]);
    expect(t.title).toBe("ตั้งแต่เริ่มต้น — แก้ชุดนี้");
    expect(t.head).toEqual(["ช่วงกำไรสะสมของเดือน (บาท)", "ฟอร์ด", "พี่ต่อ", "บริษัท"]);
    expect(t.alignRight).toEqual([1, 2, 3]);
    expect(t.rows[0]).toEqual(["0 – 100,000", "27%", "23%", "50%"]);
    expect(t.rows[1]).toEqual(["100,001 – 300,000", { text: "32% → 33%", highlight: true }, { text: "18% → 17%", highlight: true }, "50%"]);
    expect(t.rows[4]).toEqual(["ดีลลูกค้าพี่ต่อ", "15%", { text: "35% → 36%", highlight: true }, { text: "50% → 49%", highlight: true }]);
  });

  it("a new set: compared with what applied to that month before; a step added or taken away shows", () => {
    const rules: RateRules = { ladder: [{ upToSatang: 20_000_000, fordBp: 3000, torBp: 2000 }, { upToSatang: null, fordBp: 3500, torBp: 1500 }], torFlat: { fordBp: 1500, torBp: 3500 } };
    const t = rateChangeTable({ kind: "save", effectiveMonth: "2029-04", rules }, [FIRST]);
    expect(t.title).toBe("ตั้งแต่เดือนเมษายน 2572 — เพิ่มชุดใหม่");
    expect(t.rows[0][0]).toEqual({ text: "0 – 200,000 (เดิม 0 – 100,000)", highlight: true });
    expect(t.rows[1][0]).toEqual({ text: "เกิน 200,000 (เดิม 100,001 – 300,000)", highlight: true });
    // The old table's steps 3 and 4 are gone.
    expect(t.rows[2][0]).toEqual({ text: "300,001 – 500,000 — ลบขั้นนี้", highlight: true });
    expect(t.rows[3][0]).toEqual({ text: "เกิน 500,000 — ลบขั้นนี้", highlight: true });
    expect(t.rows.at(-1)).toEqual(["ดีลลูกค้าพี่ต่อ", "15%", "35%", "50%"]);
  });

  it("a removal: the set that goes, as it was", () => {
    const later: RateSet = { id: "r1", effectiveMonth: "2029-04", rules: copy() };
    const t = rateChangeTable({ kind: "remove", effectiveMonth: "2029-04" }, [FIRST, later]);
    expect(t.title).toBe("ตั้งแต่เดือนเมษายน 2572 — ลบชุดนี้");
    expect(t.rows[0]).toEqual(["0 – 100,000", "27%", "23%", "50%"]);
  });
});
