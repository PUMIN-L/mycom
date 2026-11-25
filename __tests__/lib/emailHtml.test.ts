// @vitest-environment node
/**
 * The system's designed emails (lib/emailHtml.ts) — pure strings, no DOM:
 *  • one look: a navy header bar, a white card, ≤ 600px, inline CSS only;
 *  • every value escaped — a customer's name is typed by people;
 *  • no picture fetched from the web (mail apps block them);
 *  • the same facts again as plain text, for a mail app that shows no HTML.
 */
import { describe, it, expect } from "vitest";
import { escapeHtml, renderEmail } from "@/app/lib/emailHtml";

describe("escapeHtml", () => {
  it("makes markup characters text", () => {
    expect(escapeHtml(`<b>"A&B"</b> it's`)).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt; it&#039;s");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("renderEmail", () => {
  const email = renderEmail({
    title: "เปลี่ยนค่าคอมของ PO",
    intro: "มีการเปลี่ยนว่า PO ใบนี้เป็นค่าคอมของใคร",
    blocks: [
      { kind: "change", label: "ค่าคอมของ", from: "ลูกค้าฟอร์ด", to: "ลูกค้าพี่ต่อ" },
      { kind: "facts", rows: [["ลูกค้า", "<script>alert(1)</script> & Co"], ["เลขที่ PO ลูกค้า", "PO-6611"]] },
      { kind: "code", code: "123456", note: "ใช้ได้ 15 นาที และใช้ได้ครั้งเดียว" },
      {
        kind: "table",
        title: "ดีลลูกค้าฟอร์ด",
        head: ["กำไรสะสม", "ฟอร์ด", "พี่ต่อ"],
        alignRight: [1, 2],
        rows: [["0–100,000", "27%", { text: "23% → 25%", highlight: true }]],
      },
      { kind: "note", text: "ดูรายละเอียดได้ที่หน้า ค่าคอมมิชชั่น" },
    ],
    warning: "ถ้าไม่ใช่คุณเป็นคนเปลี่ยน ให้ตรวจสอบบัญชีผู้ดูแลระบบทันที",
  });

  it("is the system's look: navy header, white card, at most 600px wide", () => {
    expect(email.html).toContain("max-width: 600px");
    expect(email.html).toContain("background-color: #0f172a");
    expect(email.html).toContain("เปลี่ยนค่าคอมของ PO");
    expect(email.html).toContain("มีการเปลี่ยนว่า PO ใบนี้เป็นค่าคอมของใคร");
    expect(email.html).toContain("Profin Lab Scale");
  });

  it("escapes every value", () => {
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co");
  });

  it("draws the change, the facts, the code, the table and the warning", () => {
    expect(email.html).toMatch(/ลูกค้าฟอร์ด[\s\S]*→[\s\S]*ลูกค้าพี่ต่อ/);
    expect(email.html).toContain("PO-6611");
    expect(email.html).toContain("123456");
    expect(email.html).toContain("ใช้ได้ 15 นาที และใช้ได้ครั้งเดียว");
    expect(email.html).toContain("ดีลลูกค้าฟอร์ด");
    expect(email.html).toMatch(/<th[^>]*>กำไรสะสม<\/th>/);
    // Money columns right-aligned; a changed cell stands out.
    expect(email.html).toMatch(/<td[^>]*text-align: right[^>]*>27%<\/td>/);
    expect(email.html).toMatch(/<td[^>]*background-color: #fef3c7[^>]*>23% → 25%<\/td>/);
    expect(email.html).toContain("ถ้าไม่ใช่คุณเป็นคนเปลี่ยน ให้ตรวจสอบบัญชีผู้ดูแลระบบทันที");
    expect(email.html).toContain("ดูรายละเอียดได้ที่หน้า ค่าคอมมิชชั่น");
  });

  it("fetches nothing from the web", () => {
    expect(email.html).not.toMatch(/<img|url\(|<link|<script/i);
  });

  it("says the same in plain text — none of the template's markup, the values as typed", () => {
    expect(email.text).not.toMatch(/<\/?(div|table|tr|td|th|span|p|h1|h3)\b/i);
    expect(email.text).toContain("เปลี่ยนค่าคอมของ PO");
    expect(email.text).toContain("ค่าคอมของ: ลูกค้าฟอร์ด → ลูกค้าพี่ต่อ");
    expect(email.text).toContain("ลูกค้า: <script>alert(1)</script> & Co");
    expect(email.text).toContain("เลขที่ PO ลูกค้า: PO-6611");
    expect(email.text).toContain("รหัสยืนยัน: 123456");
    expect(email.text).toContain("ดีลลูกค้าฟอร์ด");
    expect(email.text).toContain("กำไรสะสม | ฟอร์ด | พี่ต่อ");
    expect(email.text).toContain("0–100,000 | 27% | 23% → 25%");
    expect(email.text).toContain("ถ้าไม่ใช่คุณเป็นคนเปลี่ยน ให้ตรวจสอบบัญชีผู้ดูแลระบบทันที");
  });
});
