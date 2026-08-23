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
  getPeriodDateRange
} from "../../../lib/salesDashboardStore";

// GET /api/admin/dashboard — aggregated stats for the dashboard page.
// Returns overview cards, chart data, rankings, and smart insights in one call
// to minimize round-trips from the client.
export const GET = withRoute(
  "โหลดข้อมูล Dashboard ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    const url = request.nextUrl;
    const periodType = url.searchParams.get("periodType") || "month";
    const periodValue = url.searchParams.get("periodValue") || undefined;
    
    const { curStart, curEnd, prevStart, prevEnd, periodLabel } = getPeriodDateRange(periodType, periodValue);

    const [
      overviewData,
      revenueMonthly,
      revenueQuarterly,
      revenueByCategory,
      topProducts,
      topCustomers,
      salespersonLeaderboard,
      insights,
    ] = await Promise.all([
      getDashboardOverview(curStart, curEnd, prevStart, prevEnd),
      getRevenueByMonth(curStart, curEnd),
      getRevenueByQuarter(curStart, curEnd),
      getRevenueByCategory(curStart, curEnd),
      getTopProducts(10, curStart, curEnd),
      getTopCustomers(10, curStart, curEnd),
      getSalespersonLeaderboard(curStart, curEnd),
      getSmartInsights(curStart, curEnd, prevStart, prevEnd, periodLabel),
    ]);

    const overview = {
      ...overviewData,
      periodLabel
    };

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
