// One collator, built once: `localeCompare(b, "th", options)` builds a new
// one on EVERY call, and sorting ~6,000 customers is ~80,000 calls.
const TH_COLLATOR = new Intl.Collator("th", { numeric: true, sensitivity: "base" });

/** Thai-aware, case-blind, with numbers compared as numbers ("ร้าน 2" < "ร้าน 10"). */
export function thCompare(a: string, b: string): number {
  return TH_COLLATOR.compare(a || "", b || "");
}
