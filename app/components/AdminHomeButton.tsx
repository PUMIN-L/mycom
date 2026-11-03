"use client";

import NavButton from "./NavButton";

export const ADMIN_HOME_HREF = "/adminpanel";
export const ADMIN_HOME_LABEL = "กลับหน้าระบบจัดการ";

/**
 * The way back to the admin hub, the same on every admin page (NavButton with
 * the home icon). A page with unsaved work passes `onNavigate`, its leave
 * guard.
 */
export default function AdminHomeButton({
  onNavigate,
  className = "",
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  return <NavButton href={ADMIN_HOME_HREF} label={ADMIN_HOME_LABEL} icon="home" onNavigate={onNavigate} className={className} />;
}
