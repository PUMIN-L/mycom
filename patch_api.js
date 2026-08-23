const fs = require('fs');
const file = 'app/api/admin/dashboard/route.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace('getRevenueByQuarter,', 'getRevenueByDay,\n  getRevenueByQuarter,');
code = code.replace('getRevenueByMonth(curStart, curEnd),', 'periodType === "month" ? getRevenueByDay(curStart, curEnd) : getRevenueByMonth(curStart, curEnd),');

fs.writeFileSync(file, code);
