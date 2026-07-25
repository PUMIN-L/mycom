import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "../lib/site";
import DashboardActions from "./DashboardActions";

export const metadata: Metadata = {
  title: "Showcase",
  description: `รวมบทความและรายละเอียดสินค้าทั้งหมดของ ${SITE_NAME}`,
  alternates: { canonical: "/showcase" },
};

export default function ShowcaseListPage() {
  return (
    <main className="min-h-screen bg-gray-50/50 pb-20 pt-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-12 text-center">
          <h2 className="text-4xl font-bold text-gray-900 font-serif mb-2">ระบบจัดการ (Admin Panel)</h2>
          <p className="text-gray-500 mb-2">เข้าถึงเครื่องมือจัดการเนื้อหา ลูกค้า และใบเสนอราคาได้อย่างรวดเร็ว</p>

          <DashboardActions />
        </div>
      </div>
    </main>
  );
}
