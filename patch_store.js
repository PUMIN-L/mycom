const fs = require('fs');
const file = 'app/lib/salesDashboardStore.ts';
let code = fs.readFileSync(file, 'utf8');

const newFunc = `
export async function getRevenueByDay(dateFromRaw: string, dateToRaw: string): Promise<RevenueByPeriod[]> {
  const params: unknown[] = [dateFromRaw, dateToRaw];
  const [rows] = await query<RowDataPacket[]>(
    \`SELECT DATE_FORMAT(saleDate, '%Y-%m-%d') AS period,
            COALESCE(SUM(totalAmount), 0) AS revenue,
            COALESCE(SUM(costAmount), 0) AS cost,
            COUNT(*) AS deals
     FROM sales_records
     WHERE saleDate >= ? AND saleDate < ?
     GROUP BY period ORDER BY period\`,
    params
  );

  const [expRows] = await query<RowDataPacket[]>(
    \`SELECT DATE_FORMAT(expenseDate, '%Y-%m-%d') AS period,
            COALESCE(SUM(amount), 0) AS expenses
     FROM expenses
     WHERE expenseDate >= ? AND expenseDate < ?
     GROUP BY period ORDER BY period\`,
    params
  );

  const map = new Map(rows.map((r) => [r.period, r]));
  const expMap = new Map(expRows.map((r) => [r.period, r]));
  
  const start = new Date(dateFromRaw + "T00:00:00");
  const end = new Date(dateToRaw + "T00:00:00");
  const result: RevenueByPeriod[] = [];
  let d = new Date(start);
  while (d < end) {
    const m = \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, "0")}-\${String(d.getDate()).padStart(2, "0")}\`;
    const r = map.get(m);
    const exp = expMap.get(m);
    const rev = Number(r?.revenue || 0);
    const c = Number(r?.cost || 0);
    const expAmount = Number(exp?.expenses || 0);
    const profit = rev - c - expAmount;
    result.push({
      period: m,
      revenue: rev,
      deals: Number(r?.deals || 0),
      cost: c,
      expense: expAmount,
      profit,
      margin: rev > 0 ? Math.round((profit / rev) * 10000) / 100 : 0,
    });
    d.setDate(d.getDate() + 1);
  }
  return result;
}
`;

code = code.replace('export async function getRevenueByQuarter', newFunc + '\nexport async function getRevenueByQuarter');
fs.writeFileSync(file, code);
