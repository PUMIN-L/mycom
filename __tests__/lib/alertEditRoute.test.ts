import { describe, it, expect } from "vitest";
import { resolveAlertEditRoute } from "../../app/lib/alertEditRoute";

// tasks.md 17.5 — the routing decision behind the edit button on /crm/alerts.
// The bug this guards (10.1): a customer-scoped follow-up call has no
// equipmentId, and the old inline code still fetched
// /api/admin/equipments/undefined for it, so editing one never worked.

describe("resolveAlertEditRoute", () => {
  describe("schedules", () => {
    it("routes an equipment-scoped schedule to the equipment fetch (10.3)", () => {
      expect(
        resolveAlertEditRoute({
          type: "schedule",
          data: { id: "sch-1", equipmentId: "eq-9" },
        })
      ).toEqual({ kind: "equipment_fetch", equipmentId: "eq-9" });
    });

    it("routes a customer-scoped schedule to the schedule form (10.2)", () => {
      expect(
        resolveAlertEditRoute({
          type: "schedule",
          data: { id: "sch-2", equipmentId: null, customerId: "cus-1" },
        })
      ).toEqual({ kind: "schedule_form", scheduleId: "sch-2" });
    });

    it("routes the new นัดโทรลูกค้า category the same way (10.5)", () => {
      expect(
        resolveAlertEditRoute({
          type: "customer_call",
          data: { id: "sch-3", customerId: "cus-2" },
        })
      ).toEqual({ kind: "schedule_form", scheduleId: "sch-3" });
    });

    it("never builds an equipment request from a missing id", () => {
      // Every spelling of "there is no equipment" must take the form path —
      // `String(undefined)` is literally how the bad URL was produced.
      for (const equipmentId of [undefined, null, "", "   ", "undefined", "null"]) {
        expect(
          resolveAlertEditRoute({ type: "schedule", data: { id: "sch-4", equipmentId } })
        ).toEqual({ kind: "schedule_form", scheduleId: "sch-4" });
      }
    });

    it("keeps the equipment path when the id merely needs trimming", () => {
      expect(
        resolveAlertEditRoute({ type: "schedule", data: { id: "sch-5", equipmentId: " eq-7 " } })
      ).toEqual({ kind: "equipment_fetch", equipmentId: "eq-7" });
    });

    it("gives up rather than opening a form for a schedule with no id at all", () => {
      expect(resolveAlertEditRoute({ type: "customer_call", data: {} })).toEqual({
        kind: "none",
      });
    });
  });

  describe("the other categories keep their existing behaviour", () => {
    it("sends เอกสารค้าง to the sales record modal", () => {
      expect(
        resolveAlertEditRoute({ type: "missing_doc", data: { id: "sr-1" } })
      ).toEqual({ kind: "sales_record", salesRecordId: "sr-1" });
    });

    it("treats warranty / calibration / incomplete data as the equipment itself", () => {
      for (const type of ["warranty", "calibration", "incomplete"]) {
        expect(resolveAlertEditRoute({ type, data: { id: "eq-1" } })).toEqual({
          kind: "equipment_inline",
        });
      }
    });
  });

  describe("degenerate input", () => {
    it("returns 'none' for null, undefined and a typeless target", () => {
      expect(resolveAlertEditRoute(null)).toEqual({ kind: "none" });
      expect(resolveAlertEditRoute(undefined)).toEqual({ kind: "none" });
      expect(resolveAlertEditRoute({ data: { id: "x" } })).toEqual({ kind: "none" });
    });

    it("does not throw when `data` is missing", () => {
      expect(resolveAlertEditRoute({ type: "schedule" })).toEqual({ kind: "none" });
      expect(resolveAlertEditRoute({ type: "warranty" })).toEqual({ kind: "equipment_inline" });
    });
  });
});
