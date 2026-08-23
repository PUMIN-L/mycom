const fs = require('fs');
const file = 'app/dashboard/page.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Change handleSalespersonClick
const oldClick = `  const handleSalespersonClick = (s: SalespersonStat) => {
    setShowRecords(true);
    const matching = salesRecords.filter((r) =>
      s.name === "ไม่ระบุเซลล์"
        ? !r.salespersonId || !r.salespersonName
        : r.salespersonId === s.id || r.salespersonName === s.name
    );
    if (matching.length === 1) {
      setViewingRecord(matching[0]);
    } else {
      setRecordSearch(s.name === "ไม่ระบุเซลล์" ? "" : s.name);
      setTimeout(() => {
        document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };`;

const newClick = `  const handleSalespersonClick = (s: SalespersonStat) => {
    setShowRecords(true);
    setRecordSearch(s.name === "ไม่ระบุเซลล์" ? "" : s.name);
    setTimeout(() => {
      document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };`;

code = code.replace(oldClick, newClick);

// 2. Remove "แก้ไข" badge
code = code.replace(
  '<span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-normal opacity-75 hover:opacity-100">แก้ไข</span>',
  ''
);

// 3. Change header text
code = code.replace(
  '<h2 className="text-lg font-bold text-gray-800">ผลงานทีมขาย <span className="text-xs font-normal text-indigo-600 ml-2">(คลิกแถวเพื่อดู/แก้ไขยอดขาย)</span></h2>',
  '<h2 className="text-lg font-bold text-gray-800">ผลงานทีมขาย <span className="text-xs font-normal text-indigo-600 ml-2">(คลิกแถวเพื่อดูประวัติการขาย)</span></h2>'
);

fs.writeFileSync(file, code);
