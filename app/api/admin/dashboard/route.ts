import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getDashboardOverview,
  getRevenueByMonth,
  getRevenueByQuarter,
  getRevenueByCategory,
  getTopProducts,
  getTopCustomers,
  getSalespersonLeaderboard,
  getSmartInsights,
} from "../../../lib/salesDashboardStore";

// GET /api/admin/dashboard — aggregated stats for the dashboard page.
// Returns overview cards, chart data, rankings, and smart insights in one call
// to minimize round-trips from the client.
export const GET = withRoute(
  "โหลดข้อมูล Dashboard ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    const url = request.nextUrl;
    const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
    const dateFrom = url.searchParams.get("dateFrom") || undefined;
    const dateTo = url.searchParams.get("dateTo") || undefined;

    const [
      overview,
      revenueMonthly,
      revenueQuarterly,
      revenueByCategory,
      topProducts,
      topCustomers,
      salespersonLeaderboard,
      insights,
    ] = await Promise.all([
      getDashboardOverview(),
      getRevenueByMonth(year),
      getRevenueByQuarter(year),
      getRevenueByCategory(dateFrom, dateTo),
      getTopProducts(10, dateFrom, dateTo),
      getTopCustomers(10, dateFrom, dateTo),
      getSalespersonLeaderboard(dateFrom, dateTo),
      getSmartInsights(),
    ]);

    return NextResponse.json({
      overview,
      revenueMonthly,
      revenueQuarterly,
      revenueByCategory,
      topProducts,
      topCustomers,
      salespersonLeaderboard,
      insights,
    });
  }
);
