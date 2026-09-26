/**
 * The contact form's spam trap: a field no person sees or reaches, sent with
 * every submission. /api/contact drops a submission that filled it, so a real
 * visitor must always send it empty — and a bot that types into it must have
 * that reach the server.
 */
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));

import Contact from "@/app/components/Contact";
import { CONTACT_HONEYPOT_FIELD } from "@/app/lib/contactSpamGuard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VISITOR = {
  name: "สมชาย ใจดี",
  email: "somchai@example.com",
  phone: "0812345678",
  subject: "สอบถามราคา",
  message: "ขอใบเสนอราคาเครื่องชั่งครับ",
};

function renderForm() {
  const { container } = render(
    <Contact email="info@example.com" phone="02-000-0000" address="นนทบุรี" addressMapsQuery="นนทบุรี" />
  );
  const form = container.querySelector("form")!;
  const trap = form.querySelector<HTMLInputElement>(`input[name="${CONTACT_HONEYPOT_FIELD}"]`)!;
  return { form, trap };
}

function fillVisibleFields(form: HTMLFormElement) {
  const [name, subject] = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="text"]:not([name])'));
  fireEvent.change(name, { target: { value: VISITOR.name } });
  fireEvent.change(form.querySelector('input[type="email"]')!, { target: { value: VISITOR.email } });
  fireEvent.change(form.querySelector('input[type="tel"]')!, { target: { value: VISITOR.phone } });
  fireEvent.change(subject, { target: { value: VISITOR.subject } });
  fireEvent.change(form.querySelector("textarea")!, { target: { value: VISITOR.message } });
}

function stubContactApi() {
  const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ success: true, emailed: true }), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Contact form — the spam trap", () => {
  it("is out of every person's reach: hidden from screen readers, skipped by Tab, never autofilled", () => {
    const { trap } = renderForm();
    expect(trap).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
    expect(trap.getAttribute("autocomplete")).toBe("off");
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap.required).toBe(false);
  });

  it("goes out empty with a real visitor's message", async () => {
    const fetchMock = stubContactApi();
    const { form } = renderForm();
    fillVisibleFields(form);
    fireEvent.submit(form);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/contact");
    expect(JSON.parse(String(init!.body))).toEqual({ ...VISITOR, [CONTACT_HONEYPOT_FIELD]: "" });
  });

  it("carries whatever a bot typed into it, so the server can drop that submission", async () => {
    const fetchMock = stubContactApi();
    const { form, trap } = renderForm();
    fillVisibleFields(form);
    fireEvent.change(trap, { target: { value: "http://spam.example" } });
    fireEvent.submit(form);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))[CONTACT_HONEYPOT_FIELD]).toBe("http://spam.example");
  });
});
