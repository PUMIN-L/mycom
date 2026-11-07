/**
 * isMaintenanceBlockedPath — which paths the maintenance overlay covers.
 * "/index" is the home page: Vercel's cached copy of "/" is rendered with that
 * path (usePathname() on the server), while the browser reads "/".
 */
import { describe, it, expect } from "vitest";
import { MAINTENANCE_BLOCKED_PATHS, isMaintenanceBlockedPath } from "@/app/lib/maintenanceConfig";

describe("isMaintenanceBlockedPath", () => {
  it("covers every listed page", () => {
    for (const path of MAINTENANCE_BLOCKED_PATHS) expect(isMaintenanceBlockedPath(path)).toBe(true);
  });

  it('reads "/index" as the home page', () => {
    expect(isMaintenanceBlockedPath("/index")).toBe(true);
  });

  it("leaves every other page alone", () => {
    for (const path of ["/about", "/showcase/1", "/products", "/index.html", "/index/", "/contact/index", "/catalog/x", "", null, undefined]) {
      expect(isMaintenanceBlockedPath(path)).toBe(false);
    }
  });
});
