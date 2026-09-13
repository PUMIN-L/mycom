"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";

/**
 * Pages that the maintenance overlay blocks. Only these paths show the
 * full-screen "under maintenance" page — other public pages (/catalog,
 * /about, /showcase, etc.) remain accessible during maintenance.
 */
const BLOCKED_PATHS = ["/", "/contact"];

/**
 * Full-screen maintenance overlay shown to non-admin visitors when
 * maintenance mode is enabled in /settings. Admins who are logged in
 * bypass the overlay entirely (they see MaintenanceBanner instead).
 *
 * Mounted once in app/layout.tsx — it polls GET /api/settings/maintenance
 * on mount and every 60 s so a toggle takes effect within a minute for
 * visitors already on the page.
 */
export default function MaintenanceOverlay() {
  const { isLoggedIn, isLoading } = useAuth();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/settings/maintenance?t=" + Date.now());
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setEnabled(Boolean(data.enabled));
        }
      } catch {
        // Network error — leave overlay state unchanged.
      } finally {
        if (!cancelled) setChecked(true);
      }
    }

    check();
    const interval = setInterval(check, 60_000); // re-check every minute
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Don't render anything until we know both the auth state AND the
  // maintenance flag. This avoids a flash of the overlay for admins.
  if (isLoading || !checked) return null;

  // Admins bypass the overlay.
  if (isLoggedIn) return null;

  // Only block specific pages (/, /contact). Other public pages like
  // /catalog, /about, /showcase remain accessible during maintenance.
  if (!BLOCKED_PATHS.includes(pathname)) return null;

  // Maintenance mode is off — nothing to show.
  if (!enabled) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white"
      style={{ fontFamily: "var(--font-thai), var(--font-sans), sans-serif" }}
    >
      <div className="max-w-lg mx-auto px-6 text-center">
        {/* Animated gear icon */}
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <svg
              className="w-24 h-24 text-orange-500 animate-[spin_8s_linear_infinite]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93s.844.166 1.21-.02l.77-.443a1.12 1.12 0 011.37.17l.774.773a1.12 1.12 0 01.17 1.37l-.443.77c-.186.366-.213.82-.02 1.21s.506.71.93.78l.893.15c.543.09.94.56.94 1.11v1.093c0 .55-.397 1.02-.94 1.11l-.893.149c-.424.07-.764.384-.93.78s-.166.844.02 1.21l.443.77a1.12 1.12 0 01-.17 1.37l-.774.773a1.12 1.12 0 01-1.37.17l-.77-.443c-.366-.186-.82-.213-1.21-.02s-.71.506-.78.93l-.15.894c-.09.542-.56.94-1.11.94h-1.093c-.55 0-1.02-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93s-.844-.166-1.21.02l-.77.443a1.12 1.12 0 01-1.37-.17l-.773-.774a1.12 1.12 0 01-.17-1.37l.443-.77c.186-.366.213-.82.02-1.21s-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.11v-1.093c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.383.93-.78s.166-.844-.02-1.21l-.443-.77a1.12 1.12 0 01.17-1.37l.774-.773a1.12 1.12 0 011.37-.17l.77.443c.365.186.82.213 1.21.02s.71-.506.78-.93l.148-.894z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
          เว็บไซต์อยู่ระหว่างปรับปรุง
        </h1>

        <p className="text-lg text-gray-600 mb-2">
          ขณะนี้เว็บไซต์กำลังอยู่ในระหว่างการปรับปรุง
        </p>
        <p className="text-gray-500 mb-8">
          กรุณากลับมาเยี่ยมชมใหม่ในภายหลัง ขออภัยในความไม่สะดวก
        </p>

        <div className="inline-flex items-center gap-2 px-5 py-3 bg-orange-50 border border-orange-200 rounded-xl text-orange-700 text-sm font-medium">
          <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
          กำลังดำเนินการปรับปรุงระบบ...
        </div>
      </div>
    </div>
  );
}
