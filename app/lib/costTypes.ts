// The kinds of cost typed into a sale (the /dashboard sale form) and how they
// read — shared by the dashboard and the commission's cost breakdown (§8h), so
// a cost reads the same in both. Product cost lives on the sale's lines; the
// others are bill-level rows (sale_cost_items).
export const COST_TYPE_LABELS: Record<string, string> = {
  product_cost: "ต้นทุนสินค้า",
  transport: "ค่ารถ / ค่าเดินทาง",
  shipping: "ค่าขนส่ง",
  service_visit: "ค่าเซอร์วิส / ค่าติดตั้ง",
  repair: "ค่าซ่อม",
  commission: "ค่าคอมมิชชั่น",
  other: "อื่นๆ",
};
