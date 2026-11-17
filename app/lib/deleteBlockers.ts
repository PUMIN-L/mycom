import type { RowDataPacket } from "mysql2";
import { query } from "./db";

// What still points at a customer, a company or a salesperson — the same
// tables their DELETE routes refuse on, counted, so /customers can say in the
// delete dialog WHY a record cannot go ("เครื่องมือ 2 เครื่อง, ใบ Job 1 ใบ")
// before the admin presses ลบ, instead of a bare "ลบไม่สำเร็จ" after.
//
// Read-only. The DELETE routes stay the authority: they check again at the
// moment of deleting, so a link added between this count and the click is
// still refused there.

export interface CustomerLinkCounts {
  /** customer_equipments — no FK; deleting would orphan the machines. */
  equipments: number;
  /** sales_records — no FK; the sales history would name nobody. */
  salesRecords: number;
  /** service_schedules (customer-scoped follow-up calls) — ON DELETE
   *  CASCADE, so deleting would silently wipe the call history. */
  callSchedules: number;
  /** service_jobs — read the customer's name live, no FK. */
  serviceJobs: number;
}

export interface CompanyLinkCounts {
  customers: number;
  serviceJobs: number;
}

export interface SalespersonLinkCounts {
  salesRecords: number;
}

/** COUNT(*) comes back as a number or, for BIGINT, a string. */
function countOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function firstRow(sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  const [rows] = await query<RowDataPacket[]>(sql, params);
  return (rows[0] as Record<string, unknown> | undefined) ?? {};
}

export async function customerLinkCounts(id: string): Promise<CustomerLinkCounts> {
  const row = await firstRow(
    `SELECT
       (SELECT COUNT(*) FROM customer_equipments WHERE customerId = ?) AS equipments,
       (SELECT COUNT(*) FROM sales_records WHERE customerId = ?) AS salesRecords,
       (SELECT COUNT(*) FROM service_schedules WHERE customerId = ?) AS callSchedules,
       (SELECT COUNT(*) FROM service_jobs WHERE customerId = ?) AS serviceJobs`,
    [id, id, id, id]
  );
  return {
    equipments: countOf(row.equipments),
    salesRecords: countOf(row.salesRecords),
    callSchedules: countOf(row.callSchedules),
    serviceJobs: countOf(row.serviceJobs),
  };
}

export async function companyLinkCounts(id: string): Promise<CompanyLinkCounts> {
  const row = await firstRow(
    `SELECT
       (SELECT COUNT(*) FROM customers WHERE companyId = ?) AS customers,
       (SELECT COUNT(*) FROM service_jobs WHERE companyId = ?) AS serviceJobs`,
    [id, id]
  );
  return { customers: countOf(row.customers), serviceJobs: countOf(row.serviceJobs) };
}

export async function salespersonLinkCounts(id: string): Promise<SalespersonLinkCounts> {
  const row = await firstRow(
    "SELECT (SELECT COUNT(*) FROM sales_records WHERE salespersonId = ?) AS salesRecords",
    [id]
  );
  return { salesRecords: countOf(row.salesRecords) };
}
