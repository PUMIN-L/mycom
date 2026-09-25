// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SERVICE_PAGES, serviceByIcon, serviceBySlug, servicePath } from "@/app/lib/servicePages";
import { translations } from "@/app/i18n/translations";

describe("service pages", () => {
  it("gives every home-page service card a page", () => {
    for (const item of translations.services.items) {
      expect(serviceByIcon(item.icon), `no page for the "${item.icon}" card`).toBeDefined();
    }
  });

  it("has unique slugs and resolves them", () => {
    const slugs = SERVICE_PAGES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of SERVICE_PAGES) {
      expect(serviceBySlug(s.slug)).toBe(s);
      expect(servicePath(s.slug)).toBe(`/services/${s.slug}`);
    }
    expect(serviceBySlug("nope")).toBeUndefined();
  });

  it("has complete copy in every language for every page", () => {
    for (const s of SERVICE_PAGES) {
      const copy = translations.servicePages.pages[s.slug];
      const texts = [
        copy.title,
        copy.metaDescription,
        copy.intro,
        copy.listTitle,
        copy.list2Title,
        ...copy.list,
        ...copy.list2,
      ];
      for (const text of texts) {
        expect(text.th, `${s.slug}: missing Thai`).toBeTruthy();
        expect(text.en, `${s.slug}: missing English`).toBeTruthy();
        expect(text.zh, `${s.slug}: missing Chinese`).toBeTruthy();
      }
      // Google shows ~160 characters of a description and drops the rest.
      expect([...copy.metaDescription.th].length, `${s.slug}: Thai description too long`).toBeLessThanOrEqual(160);
      expect([...copy.metaDescription.en].length, `${s.slug}: English description too long`).toBeLessThanOrEqual(160);
    }
  });
});
