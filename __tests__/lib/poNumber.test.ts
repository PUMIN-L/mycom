// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PO_DOCNO_PREFIX, poDocNoPrefix, nextPoDocNo, pad2 } from "@/app/lib/poNumber";
import { DOCNO_START } from "@/app/lib/quotationNumber";

describe("poNumber", () => {
  describe("poDocNoPrefix", () => {
    it("builds PO<DDMMYY>- for a given ISO date", () => {
      expect(poDocNoPrefix("2026-09-15")).toBe("PO150926-");
    });

    it("uses the PO literal prefix", () => {
      expect(PO_DOCNO_PREFIX).toBe("PO");
    });
  });

  describe("nextPoDocNo", () => {
    it("starts at DOCNO_START on a day nothing has been issued", () => {
      expect(nextPoDocNo("2026-09-15", [])).toBe(`PO150926-${pad2(DOCNO_START)}`);
    });

    it("continues past the highest number already issued that day", () => {
      const used = ["PO150926-22", "PO150926-23"];
      expect(nextPoDocNo("2026-09-15", used)).toBe("PO150926-24");
    });

    it("never mints a number a different day's PO already owns", () => {
      const used = ["PO150926-22"];
      expect(nextPoDocNo("2026-09-16", used)).toBe(`PO160926-${pad2(DOCNO_START)}`);
    });

    it("walks forward past a number already reserved right after the max", () => {
      // A number sitting one past the running max (e.g. reserved by a
      // concurrent save) must not be handed out again — nextDocNo walks
      // forward from max+1 until it finds a free one.
      const used = ["PO150926-22", "PO150926-24", "PO150926-25"];
      expect(nextPoDocNo("2026-09-15", used)).toBe("PO150926-26");
    });

    it("does NOT recognise a legacy YYMMDD shape — PO is a brand-new doc type", () => {
      // "150926" as YYMMDD would be 15 Sep 2026 too (coincidentally the same
      // date here), so use a date where current/legacy differ to prove only
      // the current shape is scanned.
      const used = ["PO260715-22"]; // legacy-shaped, unrelated to nextPoDocNo
      expect(nextPoDocNo("2026-07-15", used)).toBe(`PO150726-${pad2(DOCNO_START)}`);
    });
  });
});
