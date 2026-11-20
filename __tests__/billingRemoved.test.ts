// @vitest-environment node
//
// The old billing module (/billing — quotations' saved list, invoices, billing
// notes, receipts, payments and their receivables) was replaced by the
// accounting module (/accounting) and removed. Its data was test documents
// only, and its tables are dropped (db.ts). These pin that nothing is left
// behind that would still reach for it — a link, a fetch, a query.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { config } from "@/proxy";
import robots from "@/app/robots";

const root = path.resolve(__dirname, "..");
const app = path.join(root, "app");

/** Every .ts / .tsx file under app/, as [relative path, source]. */
function appSources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push([path.relative(root, full).replace(/\\/g, "/"), fs.readFileSync(full, "utf8")]);
    }
  };
  walk(app);
  return out;
}

describe("the old /billing is gone", () => {
  it("its pages, routes and the code only it used are deleted", () => {
    for (const gone of [
      "app/billing",
      "app/api/billing",
      "app/api/settings/credit-term",
      "app/lib/billingStore.ts",
      "app/lib/billingPayments.ts",
      "app/lib/billingNumber.ts",
      "app/lib/receivables.ts",
      "app/lib/paymentMethods.ts",
      "app/components/ReceivablesGuidePanel.tsx",
      "app/components/modals/RecordPaymentModal.tsx",
    ]) {
      expect(fs.existsSync(path.join(root, gone)), gone).toBe(false);
    }
  });

  it("no page, route or library still links to it, fetches it or queries its tables", () => {
    const offenders: string[] = [];
    for (const [file, src] of appSources()) {
      // db.ts names the two tables once more, to drop them on existing databases.
      if (file === "app/lib/db.ts") continue;
      for (const pattern of [/["'`]\/billing(?![-\w])/, /\/api\/billing\b/, /\bbilling_documents\b/, /\bbilling_payments\b/, /\/api\/settings\/credit-term\b/]) {
        if (pattern.test(src)) offenders.push(`${file} — ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("db.ts names the old tables only to drop them (and in comments)", () => {
    const db = fs.readFileSync(path.join(app, "lib", "db.ts"), "utf8");
    const mentions = db.split("\n").filter((line) => /\bbilling_(documents|payments)\b/.test(line));
    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) {
      expect(line, line).toMatch(/DROP TABLE IF EXISTS billing_(documents|payments)|^\s*(\/\/|\*)/);
    }
  });

  it("the login gate and robots.txt no longer list it", () => {
    const matcher = config.matcher as string[];
    expect(matcher).not.toContain("/billing");
    expect(matcher).not.toContain("/billing/:path*");
    const rules = robots().rules;
    const disallow = ([] as string[]).concat(...(Array.isArray(rules) ? rules : [rules]).map((r) => r.disallow ?? []));
    expect(disallow).not.toContain("/billing");
  });
});

describe("a bookmark of an old /billing page lands somewhere useful", () => {
  async function redirects() {
    const nextConfig = (await import("../next.config")).default;
    return nextConfig.redirects!();
  }

  it("the saved list → the quotation list, the receivables → the module's, anything else → the module", async () => {
    const list = await redirects();
    const to = (source: string) => list.find((r) => r.source === source);
    expect(to("/billing/saved")).toMatchObject({ destination: "/quotation/saved", permanent: false });
    expect(to("/billing/receivables")).toMatchObject({ destination: "/accounting/receivables", permanent: false });
    expect(to("/billing/:path*")).toMatchObject({ destination: "/accounting", permanent: false });
    // The two exact paths must come BEFORE the catch-all, or it would take them.
    const index = (source: string) => list.findIndex((r) => r.source === source);
    expect(index("/billing/saved")).toBeLessThan(index("/billing/:path*"));
    expect(index("/billing/receivables")).toBeLessThan(index("/billing/:path*"));
  });
});
