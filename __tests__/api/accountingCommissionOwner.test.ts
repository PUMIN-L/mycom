// @vitest-environment node
/**
 * PUT /api/accounting/sales-orders/[id]/commission — { commissionOf: "ford" | "tor" }:
 * whose commission a customer PO is. Behind the module's gate. A SWITCH from
 * one person to the other emails the owner's fixed inbox; the first choice
 * does not. A failed email never undoes the change — the answer says so.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/app/lib/session";
vi.mock("@/app/lib/twoFactor", () => ({ getTwoFactorUser: vi.fn() }));
import { getTwoFactorUser } from "@/app/lib/twoFactor";
vi.mock("@/app/lib/mailer", () => ({ isMailConfigured: vi.fn(() => true), sendSystemHtmlEmail: vi.fn(async () => {}) }));
import { isMailConfigured, sendSystemHtmlEmail } from "@/app/lib/mailer";
vi.mock("@/app/lib/accounting/commissionOwner", () => ({ setSalesOrderCommission: vi.fn() }));
import { setSalesOrderCommission } from "@/app/lib/accounting/commissionOwner";

import { PUT } from "@/app/api/accounting/sales-orders/[id]/commission/route";

const admin = { userId: "admin-001", username: "admin", expiresAt: new Date() } as never;
const user = { id: "admin-001", username: "admin", passwordHash: "x", totpEnabled: true };
const ctx = { params: Promise.resolve({ id: "so1" }) };
const ORDER = { id: "so1", docType: "SO", customerPoNo: "PO-6611", buyerName: "บริษัท เอ จำกัด", issueDate: "2026-11-10", commissionOf: "tor" };
const put = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/accounting/sales-orders/so1/commission", {
    method: "PUT",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const changed = (from: "ford" | "tor" | null, to: "ford" | "tor") =>
  vi.mocked(setSalesOrderCommission).mockResolvedValue({ order: { ...ORDER, commissionOf: to } as never, from, to });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getTwoFactorUser).mockResolvedValue(user as never);
  vi.mocked(isMailConfigured).mockReturnValue(true);
});

describe("PUT /api/accounting/sales-orders/[id]/commission", () => {
  it("the first choice: saved as the admin who did it, never cached, no email", async () => {
    changed(null, "ford");
    const res = await PUT(put({ commissionOf: "ford" }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(setSalesOrderCommission).toHaveBeenCalledWith("so1", "ford", { userId: "admin-001", username: "admin" });
    expect(sendSystemHtmlEmail).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ order: { ...ORDER, commissionOf: "ford" }, emailSent: null });
  });

  it("a switch to the other person emails the owner's inbox", async () => {
    changed("ford", "tor");
    const res = await PUT(put({ commissionOf: "tor" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).emailSent).toBe(true);
    const [to, subject, html] = vi.mocked(sendSystemHtmlEmail).mock.calls[0];
    expect(to).toBe("ampumin@gmail.com");
    expect(subject).toBe("แจ้งเตือน: PO PO-6611 เปลี่ยนเป็นค่าคอมของ ลูกค้าพี่ต่อ");
    expect(html).toContain("บริษัท เอ จำกัด");
    expect(html).toContain("admin");
  });

  it("no email when nothing changed", async () => {
    changed("tor", "tor");
    const res = await PUT(put({ commissionOf: "tor" }), ctx);
    expect((await res.json()).emailSent).toBeNull();
    expect(sendSystemHtmlEmail).not.toHaveBeenCalled();
  });

  it("keeps the change when the email cannot go — and says so", async () => {
    changed("ford", "tor");
    vi.mocked(isMailConfigured).mockReturnValue(false);
    const res = await PUT(put({ commissionOf: "tor" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).emailSent).toBe(false);

    vi.mocked(isMailConfigured).mockReturnValue(true);
    vi.mocked(sendSystemHtmlEmail).mockRejectedValueOnce(new Error("SMTP down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await PUT(put({ commissionOf: "tor" }), ctx);
    expect(again.status).toBe(200);
    expect((await again.json()).emailSent).toBe(false);
    err.mockRestore();
  });

  it("refuses anything but the two — in Thai, before touching the PO", async () => {
    for (const body of [{ commissionOf: "boss" }, {}, { commissionOf: null }, { commissionOf: ["ford"] }]) {
      const res = await PUT(put(body), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("กรุณาเลือกว่าเป็นค่าคอมของลูกค้าฟอร์ดหรือลูกค้าพี่ต่อ");
    }
    expect(setSalesOrderCommission).not.toHaveBeenCalled();
  });

  it("401s anonymous and 403s without two-factor login", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(put({ commissionOf: "ford" }), ctx)).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue(admin);
    vi.mocked(getTwoFactorUser).mockResolvedValue({ ...user, totpEnabled: false } as never);
    expect((await PUT(put({ commissionOf: "ford" }), ctx)).status).toBe(403);
    expect(setSalesOrderCommission).not.toHaveBeenCalled();
  });
});
