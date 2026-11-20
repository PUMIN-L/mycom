"use client";

import { usePathname } from "next/navigation";
import NavButton from "./NavButton";

export const ADMIN_HOME_HREF = "/adminpanel";
export const ADMIN_HOME_LABEL = "กลับหน้าระบบจัดการ";
export const ADMIN_DASHBOARD_HREF = "/dashboard";
export const ADMIN_DASHBOARD_LABEL = "Dashboard";

/** Is `pathname` that section — its root, or a page under it ("/dashboard",
 *  "/dashboard/x"), never another that starts with the same letters? */
const within = (pathname: string, section: string) => pathname === section || pathname.startsWith(`${section}/`);

/**
 * The admin pages' way around, the same on every one of them: the Dashboard
 * (the owner wanted it one click from every back-office page) and the way
 * back to the admin hub — NavButtons with their icons. The page it is on is
 * not offered: no Dashboard button on the dashboard, no way "back" to the hub
 * on the hub.
 *
 * A page with unsaved work passes `guard`, its leave guard: a plain click on
 * either button then calls it with that button's href instead of navigating,
 * while a modified click still opens a new tab and leaves this one, and its
 * work, alone.
 */
export default function AdminHomeButton({
  guard,
  className = "",
}: {
  guard?: (href: string) => void;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const through = (href: string) => (guard ? () => guard(href) : undefined);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {!within(pathname, ADMIN_DASHBOARD_HREF) && (
        <NavButton href={ADMIN_DASHBOARD_HREF} label={ADMIN_DASHBOARD_LABEL} icon="dashboard" onNavigate={through(ADMIN_DASHBOARD_HREF)} />
      )}
      {!within(pathname, ADMIN_HOME_HREF) && (
        <NavButton href={ADMIN_HOME_HREF} label={ADMIN_HOME_LABEL} icon="home" onNavigate={through(ADMIN_HOME_HREF)} />
      )}
    </div>
  );
}
