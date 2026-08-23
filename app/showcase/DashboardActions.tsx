"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";

export default function DashboardActions() {
  const { isLoggedIn, user, logout } = useAuth();
  const [alertsCount, setAlertsCount] = useState<number>(0);
  const [isAlertsLoading, setIsAlertsLoading] = useState<boolean>(true);

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
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="flex justify-center mt-8">
        <Link
          href="/"
          className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition shadow-sm"
        >
          ← กลับสู่หน้าหลัก (Back to Home)
        </Link>
      </div>
    );
  }

  const menuItems = [
    {
      href: "/create-content",
      title: "สร้างคอนเทนต์ใหม่",
      description: "เพิ่มบทความ ข่าวสาร หรือหน้าเว็บใหม่",
      icon: "✨",
      color: "bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400 hover:shadow-orange-100",
    },
    {
      href: "/documents",
      title: "เอกสารดาวน์โหลด",
      description: "จัดการโบรชัวร์และแคตตาล็อก",
      icon: "📁",
      color: "bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400 hover:shadow-blue-100",
    },
    {
      href: "/quotation?new=1",
      title: "สร้างใบเสนอราคา",
      description: "ทำใบเสนอราคาใหม่ให้ลูกค้า",
      icon: "🧾",
      color: "bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400 hover:shadow-emerald-100",
    },
    {
      href: "/billing/saved",
      title: "เอกสารบัญชี / ใบเสนอราคา",
      description: "สร้าง ดู และจัดการใบเสนอราคา ใบแจ้งหนี้ ใบวางบิล ใบเสร็จ",
      icon: "📋",
      color: "bg-teal-50 text-teal-600 border-teal-200 hover:border-teal-400 hover:shadow-teal-100",
    },
    {
      href: "/customers",
      title: "จัดการลูกค้า บริษัท & เซลล์",
      description: "ฐานข้อมูลลูกค้า ข้อมูลติดต่อ และข้อมูลรายชื่อเซลล์",
      icon: "👥",
      color: "bg-indigo-50 text-indigo-600 border-indigo-200 hover:border-indigo-400 hover:shadow-indigo-100",
    },
    {
      href: "/product-specs",
      title: "จัดการสเปคสินค้า",
      description: "เพิ่มและแก้ไขข้อมูลสินค้าในระบบ",
      icon: "📦",
      color: "bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400 hover:shadow-purple-100",
    },
    {
      href: "/suppliers",
      title: "จัดการผู้ผลิต (Suppliers)",
      description: "เพิ่ม แก้ไข และลบรายชื่อซัพพลายเออร์",
      icon: "🏭",
      color: "bg-amber-50 text-amber-600 border-amber-200 hover:border-amber-400 hover:shadow-amber-100",
    },
    {
      href: "/settings",
      title: "ตั้งค่าระบบ",
      description: "ตั้งค่าเว็บไซต์และข้อมูลผู้ใช้งาน",
      icon: "⚙️",
      color: "bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-400 hover:shadow-gray-100",
    },
  ];

  return (
    <div className="mt-8 space-y-10 relative">
      {/* ── Facebook-style Notification Bell ── */}
      {isLoggedIn && !isAlertsLoading && (
        <div className="absolute -top-24 right-0 sm:-top-20 sm:right-4 z-10">
          <Link
            href="/crm/alerts"
            className="relative flex items-center justify-center w-12 h-12 bg-gray-100/80 hover:bg-gray-200 rounded-full transition-all duration-200 shadow-sm"
            title="การแจ้งเตือน (CRM Alerts)"
          >
            <svg className="w-6 h-6 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
            </svg>
            {alertsCount > 0 && (
              <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full min-w-[20px] h-[20px] transform translate-x-1/4 -translate-y-1/4 shadow-sm border-2 border-white">
                {alertsCount > 99 ? '99+' : alertsCount}
              </span>
            )}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
        {menuItems.map((item, idx) => (
          <Link
            key={idx}
            href={item.href}
            className={`flex items-start gap-4 p-6 rounded-2xl border transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-1 bg-white ${item.color.replace(/bg-\w+-50/, "bg-white")}`}
            style={{ borderColor: "var(--border-color, #e5e7eb)" }}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${item.color.split(" ")[0]}`}>
              {item.icon}
            </div>
            <div>
              <h4 className="font-bold text-gray-900 text-lg mb-1">{item.title}</h4>
              <p className="text-sm text-gray-500">{item.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-8 border-t border-gray-100">
        <Link
          href="/"
          className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition shadow-sm"
        >
          ← กลับสู่หน้าหลัก
        </Link>
        <button
          onClick={logout}
          className="px-6 py-2.5 bg-white border border-red-300 text-red-500 font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 transition shadow-sm flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          ออกจากระบบ ({user?.username})
        </button>
      </div>
    </div>
  );
}
