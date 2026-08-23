const fs = require('fs');
const file = 'app/lib/salesDashboardStore.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  '  percentage: number;\n}',
  '  percentage: number;\n  profit?: number;\n  profitMargin?: number;\n}'
);

const oldQuery = `    \`SELECT sr.salespersonId AS id,
            COALESCE(sp.name, sr.salespersonId) AS name,
            COALESCE(SUM(sr.totalAmount), 0) AS revenue,
            COUNT(*) AS deals
     FROM sales_records sr`;

const newQuery = `    \`SELECT sr.salespersonId AS id,
            COALESCE(sp.name, sr.salespersonId) AS name,
            COALESCE(SUM(sr.totalAmount), 0) AS revenue,
            COALESCE(SUM(sr.costAmount), 0) AS cost,
            COUNT(*) AS deals
     FROM sales_records sr`;

code = code.replace(oldQuery, newQuery);

const oldMap = `  return rows.map((r) => {
    const rev = Number(r.revenue);
    return {
      id: r.id,
      name: r.name,
      revenue: rev,
      deals: Number(r.deals),
      percentage: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 100) : 0,
    };
  });`;

const newMap = `  return rows.map((r) => {
    const rev = Number(r.revenue);
    const cost = Number(r.cost);
    const profit = rev - cost;
    const profitMargin = rev > 0 ? Math.round((profit / rev) * 100) : 0;
    return {
      id: r.id,
      name: r.name,
      revenue: rev,
      deals: Number(r.deals),
      percentage: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 100) : 0,
      profit,
      profitMargin,
    };
  });`;

code = code.replace(oldMap, newMap);
fs.writeFileSync(file, code);
