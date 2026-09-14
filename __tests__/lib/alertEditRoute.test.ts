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

    it("routes นัดโทรลูกค้า to that customer's own profile, not the schedule form (route-customer-call-edit-to-profile)", () => {
      expect(
        resolveAlertEditRoute({
          type: "customer_call",
          data: { id: "sch-3", customerId: "cus-2" },
        })
      ).toEqual({ kind: "customer_profile", customerId: "cus-2" });
    });

    it("falls back to the schedule form when a นัดโทรลูกค้า row has no usable customerId", () => {
      // Every spelling of "there is no customerId" — should not happen in
      // practice (a customer_call row is customer-scoped by definition), but
      // the button must still do something rather than nothing.
      for (const customerId of [undefined, null, "", "   ", "undefined", "null"]) {
        expect(
          resolveAlertEditRoute({
            type: "customer_call",
            data: { id: "sch-3", customerId },
          })
        ).toEqual({ kind: "schedule_form", scheduleId: "sch-3" });
      }
    });

    it("gives up entirely when a นัดโทรลูกค้า row has neither a usable customerId nor a usable id", () => {
      expect(
        resolveAlertEditRoute({ type: "customer_call", data: { customerId: "undefined" } })
      ).toEqual({ kind: "none" });
    });

    it("trims a customerId that merely needs it", () => {
      expect(
        resolveAlertEditRoute({
          type: "customer_call",
          data: { id: "sch-3", customerId: " cus-9 " },
        })
      ).toEqual({ kind: "customer_profile", customerId: "cus-9" });
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

describe('resolveAlertEditRoute — ลูกหนี้ค้างชำระ', () => {
  it('opens the billing document itself, read-only', () => {
    expect(
      resolveAlertEditRoute({ type: 'receivable', data: { id: 'inv-1' } })
    ).toEqual({ kind: 'billing_document', billingDocumentId: 'inv-1' });
  });

  it('refuses the "undefined"/"null" spellings that built /api/.../undefined in the first place', () => {
    expect(resolveAlertEditRoute({ type: 'receivable', data: { id: 'undefined' } })).toEqual({ kind: 'none' });
    expect(resolveAlertEditRoute({ type: 'receivable', data: { id: 'null' } })).toEqual({ kind: 'none' });
    expect(resolveAlertEditRoute({ type: 'receivable', data: {} })).toEqual({ kind: 'none' });
  });

  it('does not fall through to the equipment path, which would open the wrong modal', () => {
    const route = resolveAlertEditRoute({ type: 'receivable', data: { id: 'inv-1' } });
    expect(route.kind).not.toBe('equipment_inline');
  });
});
