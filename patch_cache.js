const fs = require('fs');
const file = 'app/dashboard/page.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. fetchRecords cache buster
const oldFetchRecords = `  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sales");
      if (res.ok) setSalesRecords(await res.json());
    } catch { /* ignore */ }
  }, []);`;

const newFetchRecords = `  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sales?t=" + Date.now());
      if (res.ok) setSalesRecords(await res.json());
    } catch { /* ignore */ }
  }, []);`;

code = code.replace(oldFetchRecords, newFetchRecords);

// 2. fetchDashboard cache buster
const oldFetchDashboard = `  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("periodType", periodType);
      p.set("periodValue", periodValue);
      const res = await fetch("/api/admin/dashboard?" + p.toString());
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [periodType, periodValue]);`;

const newFetchDashboard = `  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("periodType", periodType);
      p.set("periodValue", periodValue);
      p.set("t", Date.now().toString());
      const res = await fetch("/api/admin/dashboard?" + p.toString());
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [periodType, periodValue]);`;

code = code.replace(oldFetchDashboard, newFetchDashboard);

fs.writeFileSync(file, code);
