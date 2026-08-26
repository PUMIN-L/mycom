import type { Metadata } from "next";
import DashboardActions from "./DashboardActions";

// Admin Panel hub (moved from /showcase — see
// openspec/changes/rename-adminpanel-unblock-content). Gated by middleware;
// noindex because it's an internal tool, never a public page.
export const metadata: Metadata = {
  title: "ระบบจัดการ (Admin Panel)",
  robots: { index: false, follow: false },
};

export default function AdminPanelPage() {
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
