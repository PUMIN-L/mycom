// @vitest-environment node
//
// daysUntilPurge — what the saved-quotations list says about the nightly
// cleanup. The old list counted down from 30 days (the window before it became
// two years) and showed nearly every quotation in red, "a few days left".
import { describe, it, expect } from "vitest";
import { daysUntilPurge, QUOTATION_RETENTION_DAYS } from "@/app/lib/quotationRetention";

const NOW = Date.parse("2026-11-20T03:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const savedDaysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

describe("daysUntilPurge", () => {
  it("a quotation saved just now keeps the whole window — two years", () => {
    expect(QUOTATION_RETENTION_DAYS).toBe(730);
    expect(daysUntilPurge(savedDaysAgo(0), NOW)).toBe(730);
  });

  it("counts from the LAST save, in whole days, a part day rounded up (the purge has not reached it yet)", () => {
    expect(daysUntilPurge(savedDaysAgo(29), NOW)).toBe(701);
    expect(daysUntilPurge(savedDaysAgo(10.5), NOW)).toBe(720);
  });

  it("is 0 at the window's end and past it — never negative", () => {
    expect(daysUntilPurge(savedDaysAgo(730), NOW)).toBe(0);
    expect(daysUntilPurge(savedDaysAgo(800), NOW)).toBe(0);
  });

  it("agrees with the purge's own cut-off: one second inside the window is still a day away", () => {
    // purgeExpiredQuotations deletes createdAt < now − days; this one is not yet below it.
    expect(daysUntilPurge(new Date(NOW - 730 * DAY + 1000).toISOString(), NOW)).toBe(1);
  });

  it("an unreadable or missing date has no countdown", () => {
    expect(daysUntilPurge("not a date", NOW)).toBeNull();
    expect(daysUntilPurge("", NOW)).toBeNull();
    expect(daysUntilPurge(null, NOW)).toBeNull();
    expect(daysUntilPurge(undefined, NOW)).toBeNull();
  });

  it("takes another window when one is given", () => {
    expect(daysUntilPurge(savedDaysAgo(5), NOW, 30)).toBe(25);
  });
});
