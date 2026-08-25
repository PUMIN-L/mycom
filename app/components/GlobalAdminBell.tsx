"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";

export default function GlobalAdminBell() {
  const { isLoggedIn } = useAuth();
  const pathname = usePathname();
  const [alertsCount, setAlertsCount] = useState<number>(0);
  const [isAlertsLoading, setIsAlertsLoading] = useState<boolean>(true);

  // Poll alerts only if logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    
    async function fetchAlerts() {
      try {
        const res = await fetch("/api/admin/alerts?t=" + Date.now());
        if (res.ok) {
          const data = await res.json();
          const total = 
            (data.expiringWarranties?.length || 0) + 
            (data.upcomingSchedules?.length || 0) + 
            (data.incompleteEquipments?.length || 0) +
            (data.missingDocuments?.length || 0);
          setAlertsCount(total);
        }
      } catch (err) {
        console.error("Failed to fetch alerts count", err);
      } finally {
        setIsAlertsLoading(false);
      }
    }
    
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000); // 5 min
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;

  // Determine if it's an admin path
  const isPublicPath = 
    pathname === "/" ||
    pathname === "/about" ||
    pathname === "/contact" ||
    pathname?.startsWith("/catalog") ||
    pathname?.startsWith("/th") ||
    pathname?.startsWith("/en") ||
    pathname?.startsWith("/zh");

  // Don't show on public pages, and don't show on the alerts page itself
  if (isPublicPath || pathname === "/crm/alerts") {
    return null;
  }

  // Floating Action Button at Bottom-Left to avoid colliding with Toasts at Bottom-Right
  return (
    <div className="fixed bottom-8 left-6 md:bottom-10 md:left-10 z-[90] animate-fade-in group">
      <Link
        href="/crm/alerts"
        className="relative flex items-center justify-center w-14 h-14 bg-white hover:bg-gray-50 border-2 border-indigo-600 rounded-full transition-transform duration-300 group-hover:scale-110 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgb(79,70,229,0.2)]"
        title="การแจ้งเตือน (CRM Alerts)"
      >
        <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
        </svg>
        {!isAlertsLoading && alertsCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-[11px] font-extrabold leading-none text-white bg-red-600 rounded-full transform translate-x-1/4 -translate-y-1/4 shadow-sm border-2 border-white min-w-[24px]">
            {alertsCount > 99 ? '99+' : alertsCount}
          </span>
        )}
      </Link>
    </div>
  );
}
