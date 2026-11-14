// @vitest-environment node
/**
 * One word for one thing. The suppliers page, the admin panel's card for it
 * and the product forms that link a product to its suppliers said ผู้ผลิต
 * ("Suppliers") in some places and ซัพพลายเออร์ in others — and the supplier's
 * window now says "ผูกได้ที่หน้าแก้ไขสินค้า", which only helps if that page
 * calls them the same. This fails if the old word comes back in what these
 * files SHOW (comments may still tell the history).
 */
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const FILES = [
  "app/suppliers/page.tsx",
  "app/suppliers/SupplierDetailsModal.tsx",
  "app/components/SupplierInfo.tsx",
  "app/adminpanel/DashboardActions.tsx",
  "app/create-product/page.tsx",
  "app/edit-product/[id]/page.tsx",
  "app/showcase/[id]/ShowcaseClient.tsx",
];

/** The source without its comments: `// …` to the end of a line, `/* … *\/` and `{/* … *\/}`. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("suppliers are ซัพพลายเออร์ everywhere they are shown", () => {
  it.each(FILES)("%s never shows ผู้ผลิต", (file) => {
    const shown = withoutComments(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
    const lines = shown.split("\n").filter((l) => l.includes("ผู้ผลิต"));
    expect(lines).toEqual([]);
  });

  it("the comment stripper keeps code that only looks like a comment", () => {
    expect(withoutComments('const u = "https://x"; // gone\n/* gone */ const b = 1;')).toBe('const u = "https://x"; \n const b = 1;');
  });
});
