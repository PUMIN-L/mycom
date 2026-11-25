// @vitest-environment node
/**
 * The commission emails (lib/accounting/commissionEmails.ts) — to the owner's
 * fixed inbox only (the owner, 2026-11-25: "อีเมล ampumin@gmail.com เท่านั้น"),
 * the same one the password codes use, never the contact email an admin
 * session can change. This file: a PO's commission switched from one person to
 * the other.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/app/lib/mailer", () => ({ isMailConfigured: vi.fn(() => true), sendSystemHtmlEmail: vi.fn(async () => {}) }));
import { isMailConfigured, sendSystemHtmlEmail } from "@/app/lib/mailer";
import { PASSWORD_OTP_EMAIL } from "@/app/lib/passwordReset";
import { COMMISSION_EMAIL, commissionOwnerChangedEmail, notifyCommissionOwnerChanged } from "@/app/lib/accounting/commissionEmails";

const CHANGE = {
  customerPoNo: "PO-6611",
  buyerName: "บริษัท <เอ> จำกัด",
  issueDate: "2026-11-10",
  from: "ford" as const,
  to: "tor" as const,
  username: "admin",
  at: "2026-11-25T08:30:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isMailConfigured).mockReturnValue(true);
});

describe("where they go", () => {
  it("the owner's fixed inbox — the password codes' one", () => {
    expect(COMMISSION_EMAIL).toBe(PASSWORD_OTP_EMAIL);
    expect(COMMISSION_EMAIL).toBe("ampumin@gmail.com");
  });
});

describe("commissionOwnerChangedEmail", () => {
  const email = commissionOwnerChangedEmail(CHANGE);

  it("says which PO, from whom to whom, in the subject", () => {
    expect(email.subject).toBe("แจ้งเตือน: PO PO-6611 เปลี่ยนเป็นค่าคอมของ ลูกค้าพี่ต่อ");
  });

  it("tells the PO, the change, who and when — escaped — and warns", () => {
    expect(email.html).toMatch(/ลูกค้าฟอร์ด[\s\S]*→[\s\S]*ลูกค้าพี่ต่อ/);
    expect(email.html).toContain("PO-6611");
    expect(email.html).toContain("บริษัท &lt;เอ&gt; จำกัด");
    expect(email.html).toContain("10 Nov 2026");
    expect(email.html).toContain("admin");
    expect(email.html).toContain("25 Nov 2026");
    expect(email.html).toContain("ถ้าไม่ใช่คุณเป็นคนเปลี่ยน");
    // No money in it — the screen shows the figures.
    expect(email.html).not.toMatch(/บาท|฿/);
  });

  it("and the same in plain text", () => {
    expect(email.text).toContain("ค่าคอมของ: ลูกค้าฟอร์ด → ลูกค้าพี่ต่อ");
    expect(email.text).toContain("เลขที่ PO ลูกค้า: PO-6611");
    expect(email.text).toContain("ลูกค้า: บริษัท <เอ> จำกัด");
    expect(email.text).toContain("เปลี่ยนโดย: admin");
  });
});

describe("notifyCommissionOwnerChanged", () => {
  it("sends it to the owner's inbox and says it went", async () => {
    await expect(notifyCommissionOwnerChanged(CHANGE)).resolves.toBe(true);
    expect(sendSystemHtmlEmail).toHaveBeenCalledTimes(1);
    const [to, subject, html, text] = vi.mocked(sendSystemHtmlEmail).mock.calls[0];
    expect(to).toBe("ampumin@gmail.com");
    expect(subject).toContain("PO-6611");
    expect(html).toContain("ลูกค้าพี่ต่อ");
    expect(text).toContain("ลูกค้าพี่ต่อ");
  });

  it("says it did not go — never throws — when mail is not set up or sending fails", async () => {
    vi.mocked(isMailConfigured).mockReturnValue(false);
    await expect(notifyCommissionOwnerChanged(CHANGE)).resolves.toBe(false);
    expect(sendSystemHtmlEmail).not.toHaveBeenCalled();

    vi.mocked(isMailConfigured).mockReturnValue(true);
    vi.mocked(sendSystemHtmlEmail).mockRejectedValueOnce(new Error("SMTP down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyCommissionOwnerChanged(CHANGE)).resolves.toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
