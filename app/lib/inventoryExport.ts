// The Excel export of /assets and /stock: what the page shows, as two sheets
// — one row per piece, and one row per group. Pure; the page hands the
// sheets to downloadExcel (lib/xlsxExport.ts), which also neutralises cells
// Excel would read as formulas.

import type { InventoryKind } from "./types";
import type { ExcelSheet } from "./xlsxExport";
import type { GroupView } from "./inventorySearch";
import {
  inventoryStatuses,
  inventoryStatusLabel,
  statusDetailText,
  INVENTORY_PRICE_LABEL,
  INVENTORY_TITLE,
} from "./inventoryStatus";

export function inventoryExportSheets(kind: InventoryKind, groups: GroupView[]): ExcelSheet[] {
  const priceLabel = INVENTORY_PRICE_LABEL[kind];

  const pieces: Record<string, unknown>[] = [];
  for (const { group, items } of groups) {
    for (const it of items) {
      const row: Record<string, unknown> = {
        "รหัส": it.code,
        "ชื่อ": group.name,
        "ยี่ห้อ": group.brand,
        "รุ่น": group.model,
        "หมวด": group.category,
        "ซีเรียล": it.serialNumber,
        "วันที่ซื้อ": it.purchaseDate,
        [priceLabel]: it.price,
        "ผู้ขาย": it.supplierName,
        "ที่เก็บ": it.location,
      };
      if (kind === "asset") {
        row["ผู้ดูแล"] = it.custodian;
        row["วันหมดประกัน"] = it.warrantyUntil ?? "";
      }
      row["สถานะ"] = inventoryStatusLabel(kind, it.status);
      row["รายละเอียดสถานะ"] = statusDetailText(kind, it.status, it.statusParty, it.statusDate);
      row["หมายเหตุ"] = it.note;
      pieces.push(row);
    }
  }

  const statuses = inventoryStatuses(kind);
  const summary = groups.map(({ group, items, counts, value }) => {
    const row: Record<string, unknown> = {
      "ชื่อ": group.name,
      "ยี่ห้อ": group.brand,
      "รุ่น": group.model,
      "หมวด": group.category,
      "จำนวนชิ้น": items.length,
    };
    for (const s of statuses) row[s.label] = counts[s.key] ?? 0;
    row["มูลค่า (ของที่ยังมีอยู่)"] = value;
    return row;
  });

  return [
    { name: "รายชิ้น", rows: pieces, autoSizeColumns: true },
    { name: "สรุปต่อรายการ", rows: summary, autoSizeColumns: true },
  ];
}

/** "ทรัพย์สินบริษัท_2026-10-05.xlsx" */
export function inventoryExportFilename(kind: InventoryKind, today: string): string {
  return `${INVENTORY_TITLE[kind]}_${today}.xlsx`;
}

