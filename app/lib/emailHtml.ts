// The system's designed emails — pure strings, no DOM (safe on the server).
//
// One look for every alert the owner is sent: a navy header bar (the contact
// form email's), a white card, tables that read on a phone (at most 600px
// wide). Inline CSS only — mail apps drop <style> blocks — and no picture
// fetched from the web, which most of them block. Every value is escaped: a
// customer's name is typed by people. Each email also carries the same facts
// as plain text, for a mail app that shows no HTML.

/** Markup characters as text. */
export function escapeHtml(unsafe: string | undefined | null): string {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** A table cell: its text, optionally bold, or highlighted as changed. */
export type EmailCell = string | { text: string; strong?: boolean; highlight?: boolean };

export type EmailBlock =
  /** Label / value rows. */
  | { kind: "facts"; rows: [label: string, value: string][] }
  /** "label: from → to", drawn large. */
  | { kind: "change"; label: string; from: string; to: string }
  /** A one-time code, big, with what to know about it. */
  | { kind: "code"; code: string; note: string }
  /** A table; `alignRight` are the column indexes holding numbers. */
  | { kind: "table"; title?: string; head: string[]; rows: EmailCell[][]; alignRight?: number[] }
  /** A paragraph. */
  | { kind: "text"; text: string }
  /** A small grey line. */
  | { kind: "note"; text: string };

export interface EmailContent {
  title: string;
  intro?: string;
  blocks: EmailBlock[];
  /** "If it was not you…" — in an amber box at the end. */
  warning?: string;
}

const NAVY = "#0f172a";
const BRAND = "Profin Lab Scale";

const cellText = (c: EmailCell) => (typeof c === "string" ? c : c.text);

function cellHtml(c: EmailCell, right: boolean): string {
  const cell = typeof c === "string" ? { text: c } : c;
  const style = [
    "padding: 8px 10px",
    "border-bottom: 1px solid #f1f5f9",
    "font-size: 14px",
    "color: #0f172a",
    right ? "text-align: right" : "text-align: left",
    "white-space: nowrap",
    cell.highlight ? "background-color: #fef3c7" : "",
    cell.strong || cell.highlight ? "font-weight: 700" : "",
  ]
    .filter(Boolean)
    .join("; ");
  return `<td style="${style}">${escapeHtml(cell.text)}</td>`;
}

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "facts":
      return (
        `<table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 15px;">` +
        block.rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding: 9px 0; border-bottom: 1px solid #f1f5f9; width: 38%; color: #64748b; font-weight: 600; vertical-align: top;">${escapeHtml(label)}</td>` +
              `<td style="padding: 9px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 500;">${escapeHtml(value)}</td></tr>`
          )
          .join("") +
        `</table>`
      );
    case "change":
      return (
        `<div style="margin: 0 0 20px; padding: 16px 18px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc;">` +
        `<div style="font-size: 13px; color: #64748b; font-weight: 600; margin-bottom: 6px;">${escapeHtml(block.label)}</div>` +
        `<div style="font-size: 20px; font-weight: 700; color: ${NAVY};">` +
        `<span style="color: #64748b; text-decoration: line-through;">${escapeHtml(block.from)}</span>` +
        ` <span style="color: #64748b;">→</span> ` +
        `<span>${escapeHtml(block.to)}</span></div></div>`
      );
    case "code":
      return (
        `<div style="margin: 0 0 20px; padding: 18px; border: 2px solid ${NAVY}; border-radius: 10px; text-align: center;">` +
        `<div style="font-size: 13px; color: #64748b; font-weight: 600;">รหัสยืนยัน</div>` +
        `<div style="font-family: Consolas, 'Courier New', monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: ${NAVY}; margin: 6px 0;">${escapeHtml(block.code)}</div>` +
        `<div style="font-size: 13px; color: #475569;">${escapeHtml(block.note)}</div></div>`
      );
    case "table": {
      const right = new Set(block.alignRight ?? []);
      return (
        (block.title ? `<h3 style="margin: 0 0 8px; font-size: 15px; color: ${NAVY};">${escapeHtml(block.title)}</h3>` : "") +
        `<table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 20px; border: 1px solid #e2e8f0;">` +
        `<tr>${block.head
          .map(
            (h, i) =>
              `<th style="padding: 8px 10px; background-color: #f1f5f9; color: #475569; font-size: 13px; font-weight: 700; text-align: ${right.has(i) ? "right" : "left"}; white-space: nowrap;">${escapeHtml(h)}</th>`
          )
          .join("")}</tr>` +
        block.rows.map((row) => `<tr>${row.map((c, i) => cellHtml(c, right.has(i))).join("")}</tr>`).join("") +
        `</table>`
      );
    }
    case "text":
      return `<p style="margin: 0 0 16px; font-size: 15px; color: #334155;">${escapeHtml(block.text)}</p>`;
    case "note":
      return `<p style="margin: 0 0 16px; font-size: 13px; color: #64748b;">${escapeHtml(block.text)}</p>`;
  }
}

function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case "facts":
      return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    case "change":
      return `${block.label}: ${block.from} → ${block.to}`;
    case "code":
      return `รหัสยืนยัน: ${block.code}\n(${block.note})`;
    case "table":
      return [block.title, block.head.join(" | "), ...block.rows.map((r) => r.map(cellText).join(" | "))].filter(Boolean).join("\n");
    case "text":
    case "note":
      return block.text;
  }
}

/** The email as HTML (the system's look) and the same facts as plain text. */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const html =
    `<div style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">` +
    `<div style="background-color: ${NAVY}; padding: 20px 24px; border-radius: 8px 8px 0 0;">` +
    `<div style="color: #cbd5e1; font-size: 13px;">${BRAND}</div>` +
    `<h1 style="color: #ffffff; margin: 4px 0 0; font-size: 20px; font-weight: 600;">${escapeHtml(content.title)}</h1></div>` +
    `<div style="padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">` +
    (content.intro ? `<p style="margin: 0 0 20px; font-size: 15px; color: #475569;">${escapeHtml(content.intro)}</p>` : "") +
    content.blocks.map(blockHtml).join("") +
    (content.warning
      ? `<div style="margin-top: 8px; padding: 12px 14px; background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; color: #9a3412; font-size: 14px;">${escapeHtml(content.warning)}</div>`
      : "") +
    `</div>` +
    `<div style="text-align: center; margin-top: 16px; font-size: 12px; color: #94a3b8;">อีเมลฉบับนี้ส่งอัตโนมัติจากระบบเว็บไซต์ ${BRAND}</div>` +
    `</div>`;
  const text = [content.title, content.intro, ...content.blocks.map(blockText), content.warning, `— อีเมลฉบับนี้ส่งอัตโนมัติจากระบบเว็บไซต์ ${BRAND}`]
    .filter(Boolean)
    .join("\n\n");
  return { html, text };
}
