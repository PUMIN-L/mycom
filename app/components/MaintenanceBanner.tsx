"use client";
import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

/**
 * Persistent admin-only banner shown at the top-right corner when maintenance
 * mode is ON. Regular visitors never see this — the MaintenanceOverlay covers
 * them instead. The banner is deliberately NOT dismissable so the admin always
 * knows the mode is active.
 *
 * Mounted once in app/layout.tsx alongside GlobalAdminBell.
 */
export default function MaintenanceBanner() {
  const { isLoggedIn, isLoading } = useAuth();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      setEnabled(false);
      return;
    }

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/settings/maintenance?t=" + Date.now());
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setEnabled(Boolean(data.enabled));
        }
      } catch {
        // Leave state unchanged on error.
      }
    }

    check();
    const interval = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoggedIn]);

  if (isLoading || !isLoggedIn || !enabled) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] max-w-xs animate-in fade-in slide-in-from-right duration-300">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl shadow-lg backdrop-blur-sm">
        <span className="text-lg shrink-0">⚠️</span>
        <div className="text-sm">
          <p className="font-semibold text-amber-800">
            โหมดปรับปรุงเว็บไซต์เปิดอยู่
          </p>
          <p className="text-amber-600 text-xs mt-0.5">
            ผู้ใช้ทั่วไปจะไม่เห็นหน้าเว็บไซต์
          </p>
        </div>
      </div>
    </div>
  );
}
