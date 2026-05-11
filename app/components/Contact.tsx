"use client";

import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";

export default function Contact() {
  const t = useT();
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");

    // Simulate sending (since we don't have a backend)
    // In production, use mailto: or an API
    const mailtoLink = `mailto:ampumin@gmail.com?subject=${encodeURIComponent(
      formState.subject
    )}&body=${encodeURIComponent(
      `Name: ${formState.name}\nEmail: ${formState.email}\n\n${formState.message}`
    )}`;
    window.open(mailtoLink, "_blank");

    setTimeout(() => {
      setStatus("sent");
      setFormState({ name: "", email: "", subject: "", message: "" });
      setTimeout(() => setStatus("idle"), 3000);
    }, 1000);
  };

  return (
    <section id="contact" className="py-32 md:py-48 bg-white relative">
      <div className="section-wrapper relative z-10">
        {/* Section Header */}
        <div className="text-center mb-24">
          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.contact.sectionTag)}
          </span>
          <h2 className="text-4xl md:text-6xl font-serif text-[var(--brand-navy)] mb-6">
            {t(translations.contact.title)}
          </h2>
          <div className="w-20 h-[1px] bg-[var(--accent)] mx-auto mb-8" />
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-lg md:text-xl font-light">
            {t(translations.contact.subtitle)}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          {/* Contact Info */}
          <div className="space-y-12">
            <h3 className="text-3xl font-serif text-[var(--brand-navy)] mb-8">Get in Touch</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
              {/* Address */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.addressLabel)}
                </h4>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-light">
                  {t(translations.contact.address)}
                </p>
              </div>

              {/* Phone */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.phoneLabel)}
                </h4>
                <p className="text-sm text-[var(--text-secondary)] font-light">
                  {t(translations.contact.phone)}
                </p>
              </div>

              {/* Email */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.emailLabel)}
                </h4>
                <a href="mailto:ampumin@gmail.com" className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors font-light">
                  ampumin@gmail.com
                </a>
              </div>

              {/* LINE */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.lineLabel)}
                </h4>
                <a href="https://line.me/ti/p/~puminkmutnb" target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors font-light">
                  @puminkmutnb
                </a>
              </div>
            </div>

            {/* Map Placeholder or Decorative Element */}
            <div className="relative h-64 bg-gray-50 border border-gray-100 overflow-hidden group">
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest text-gray-400 group-hover:text-[var(--accent)] transition-colors">
                Map View
              </div>
              <div className="absolute inset-0 bg-[var(--accent)]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Contact Form */}
          <div className="bg-[var(--bg-secondary)] p-12 md:p-16">
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.name)}
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.email)}
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.subject)}
                </label>
                <input
                  type="text"
                  required
                  value={formState.subject}
                  onChange={(e) => setFormState({ ...formState, subject: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {t(translations.contact.form.message)}
                </label>
                <textarea
                  required
                  rows={4}
                  value={formState.message}
                  onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-200 py-3 text-[var(--brand-navy)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full bg-[var(--brand-navy)] text-white py-5 text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
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
    </section>
  );
}
