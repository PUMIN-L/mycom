"use client";

import { useLineContact } from "../hooks/useLineContact";
import PhoneText from "./PhoneText";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";
import { LINE_ID, LINE_URL, lineQrUrl } from "../lib/contact";
import { CONTACT_HONEYPOT_FIELD } from "../lib/contactSpamGuard";

import LineQrModal from "./LineQrModal";

interface ContactProps {
  /** Live values from Settings (app/lib/settingsStore.ts) — this is a client
   * component, so the parent server component fetches them and passes them
   * down as props rather than this component reading them directly. */
  email: string;
  phone: string;
  address: string;
}

export default function Contact({ email, phone, address }: ContactProps) {
  const t = useT();
  const { isLineModalOpen, closeLineModal, handleLineClick } = useLineContact();
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  // The spam trap below. Only a bot ever types into it.
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // Which localized error to show — mapped from the response status so EN/ZH
  // visitors don't see the API's Thai-only error strings.
  const [errorKey, setErrorKey] = useState<"error" | "errorRateLimit" | "errorUnavailable" | "errorPhone">("error");

  // Status-reset timer. Cleared before each submit (and on unmount) so a stale
  // timer from a previous attempt can't flip "sending" back to "idle" mid-flight
  // and re-enable the button for a duplicate send.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);
  const scheduleStatusReset = (ms: number) => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus("idle"), ms);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setStatus("sending");

    try {
      // Sends a real email server-side (/api/contact → SMTP). The recipient is
      // configurable from the admin /settings page.
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formState, [CONTACT_HONEYPOT_FIELD]: honeypot }),
      });
      if (!res.ok) {
        let errKey: typeof errorKey = "error";
        if (res.status === 429) errKey = "errorRateLimit";
        else if (res.status === 503) errKey = "errorUnavailable";
        else {
          try {
            const data = await res.json();
            if (data.error === "invalid_phone") errKey = "errorPhone";
          } catch (e) {}
        }
        
        setErrorKey(errKey);
        setStatus("error");
        scheduleStatusReset(5000);
        return;
      }
      setStatus("sent");
      setFormState({ name: "", email: "", phone: "", subject: "", message: "" });
      scheduleStatusReset(3000);
    } catch {
      setErrorKey("error");
      setStatus("error");
      scheduleStatusReset(5000);
    }
  };

  return (
    // The header's -100px pull-up only from md, so on a phone the heading
    // sits 40px under the menu bar instead of relying on it.
    <section id="contact" className="pt-10 pb-20 md:py-48 bg-white relative">
      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-12 md:mb-24 md:mt-[-100px]">
          <span className="inline-block text-xl font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.contact.sectionTag)}
          </span>
          {/* h1, not h2: this component renders only on /contact, where this is
              the page's main heading. Starting the document at h2 left that page
              with no h1 at all. */}
          <h1 className="text-4xl md:text-5xl font-bold text-[var(--brand-navy)] mb-6">
            {t(translations.contact.title)}
          </h1>
          <div className="w-20 h-[1px] bg-[var(--accent)] mx-auto mb-8" />
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-lg md:text-xl font-normal leading-relaxed">
            {t(translations.contact.subtitle)}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Contact Info */}
          <div className="space-y-12">
            <h3 className="text-2xl md:text-3xl font-bold text-[var(--brand-navy)] mb-8">Get in Touch</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
              {/* Address */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.addressLabel)}
                </h4>
                <p className="text-lg text-[var(--text-secondary)] leading-relaxed font-normal">
                  {address}
                </p>
              </div>

              {/* Phone */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.phoneLabel)}
                </h4>
                {/* Each number is a tel: link — on a phone, tapping it calls. */}
                <p className="text-lg text-[var(--text-secondary)] font-normal">
                  <PhoneText phone={phone} linkClassName="hover:text-[var(--accent)] transition-colors" />
                </p>
              </div>

              {/* Email */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.emailLabel)}
                </h4>
                <a href={`mailto:${email}`} className="text-lg text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors font-normal break-all">
                  {email}
                </a>
              </div>

              {/* LINE */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.lineLabel)}
                </h4>
                <button
                  type="button"
                  onClick={handleLineClick}
                  className="text-lg text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors font-normal cursor-pointer text-left"
                >
                  {LINE_ID}
                </button>

                {/* Shown inline, not only behind the modal: a visitor already on
                    the contact page is there to make contact, and on a desktop
                    the QR is the step they need next — their phone is in reach,
                    the browser is not. Same lineQrUrl() the modal uses. */}
                <a
                  href={LINE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-xl border border-gray-200 bg-white p-2 transition-colors hover:border-[#06C755]"
                  aria-label={`LINE QR Code ${LINE_ID}`}
                >
                  <Image
                    src={lineQrUrl(200)}
                    alt={`LINE QR Code ${LINE_ID}`}
                    width={140}
                    height={140}
                    unoptimized
                    className="rounded-lg"
                  />
                </a>
              </div>
            </div>

            {/* No map: customers never come to the premises — the equipment is
                delivered and serviced at theirs, anywhere in Thailand. A map
                and "Open in Google Maps" told them otherwise. The address
                above stays, as text. */}
          </div>

          {/* Contact Form */}
          {/* p-6 on a phone: p-12 (48px a side) left the inputs ~216px wide
              on a 360px screen. */}
          <div className="bg-[var(--bg-secondary)] p-6 sm:p-10 md:p-16">
            <form onSubmit={handleSubmit} className="space-y-8 relative">
              {/* Spam trap: off-screen, out of the tab order and hidden from
                  screen readers, so no person fills it — a bot that fills every
                  input does, and /api/contact drops that submission. */}
              <div aria-hidden="true" className="absolute -left-[10000px] top-0 w-px h-px overflow-hidden">
                <label>
                  Website
                  <input
                    type="text"
                    name={CONTACT_HONEYPOT_FIELD}
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.name)}
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-lg text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.email)}
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-lg text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.phone)}
                </label>
                <input
                  type="tel"
                  required
                  value={formState.phone}
                  onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-lg text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.subject)}
                </label>
                <input
                  type="text"
                  required
                  value={formState.subject}
                  onChange={(e) => setFormState({ ...formState, subject: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-lg text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.message)}
                </label>
                <textarea
                  required
                  rows={4}
                  value={formState.message}
                  onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-lg text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
                />
              </div>
              {status === "error" && (
                <p className="text-sm text-red-500 font-semibold" role="alert">
                  {t(translations.contact.form[errorKey])}
                </p>
              )}
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full bg-[var(--brand-navy)] text-white py-5 text-sm font-bold uppercase tracking-[0.3em] hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
              >
                {status === "sending"
                  ? t(translations.contact.form.sending)
                  : status === "sent"
                    ? t(translations.contact.form.success)
                    : t(translations.contact.form.send)}
              </button>
            </form>
          </div>
        </div>
      </div>

      <LineQrModal
        isOpen={isLineModalOpen}
        onClose={closeLineModal}
      />
    </section>
  );
}
