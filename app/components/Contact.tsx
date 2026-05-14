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
        <div className="text-center mb-24 mt-[-100px] ">
          <span className="inline-block text-xl font-bold uppercase tracking-[0.4em] text-[var(--accent)] mb-4">
            {t(translations.contact.sectionTag)}
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-[var(--brand-navy)] mb-6">
            {t(translations.contact.title)}
          </h2>
          <div className="w-20 h-[1px] bg-[var(--accent)] mx-auto mb-8" />
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto text-lg md:text-xl font-normal leading-relaxed">
            {t(translations.contact.subtitle)}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
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
                  {t(translations.contact.address)}
                </p>
              </div>

              {/* Phone */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.phoneLabel)}
                </h4>
                <p className="text-lg text-[var(--text-secondary)] font-normal">
                  {t(translations.contact.phone)}
                </p>
              </div>

              {/* Email */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.emailLabel)}
                </h4>
                <a href="mailto:ampumin@gmail.com" className="text-lg text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors font-normal">
                  ampumin@gmail.com
                </a>
              </div>

              {/* LINE */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-[var(--accent)]">
                  {t(translations.contact.lineLabel)}
                </h4>
                <a href="https://line.me/ti/p/~puminkmutnb" target="_blank" rel="noopener noreferrer" className="text-lg text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors font-normal">
                  @puminkmutnb
                </a>
              </div>
            </div>

            {/* Map Element */}
            <a 
              href="https://www.google.com/maps/search/?api=1&query=The+Mall+Lifestore+Ngamwongwan" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="relative block h-72 bg-gray-50 border border-gray-100 overflow-hidden shadow-inner rounded-xl group cursor-pointer"
            >
              <iframe 
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3874.0048123793613!2d100.5372332!3d13.8597022!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x30e29b139e1a0001%3A0xe0a174301542f026!2sThe%20Mall%20Lifestore%20Ngamwongwan!5e0!3m2!1sen!2sth!4v1715670000000!5m2!1sen!2sth" 
                width="100%" 
                height="100%" 
                style={{ border: 0 }} 
                loading="lazy" 
                referrerPolicy="no-referrer-when-downgrade"
                className="transition-all duration-700 pointer-events-none"
              ></iframe>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center">
                <div className="bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all transform translate-y-4 group-hover:translate-y-0 text-xs font-bold text-[var(--brand-navy)] flex items-center gap-2">
                  <svg className="w-4 h-4 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  Open in Google Maps
                </div>
              </div>
            </a>
          </div>

          {/* Contact Form */}
          <div className="bg-[var(--bg-secondary)] p-12 md:p-16">
            <form onSubmit={handleSubmit} className="space-y-8">
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
    </section>
  );
}
