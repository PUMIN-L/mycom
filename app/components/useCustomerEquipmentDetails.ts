"use client";

/**
 * Fetch-and-open state for `CustomerDetailsModal`/`EquipmentDetailsModal`,
 * shared between `/crm/alerts` (the "แก้ไข" button on a card, and a task
 * chip) and `/crm/tasks` (a task chip only, once the task board moved to its
 * own page — spec: move-task-board-to-own-page). Both pages need the exact
 * same "fetch one row, open it IN PLACE, never navigate away" behavior; this
 * is the one place it lives instead of a second copy per page drifting apart
 * (the same reasoning as `useTaskTopics.ts`).
 */

import { useCallback, useState } from "react";
import type { Customer, CustomerEquipment } from "../lib/types";

export function useCustomerEquipmentDetails(
  showToast: (message: string, type: "success" | "error") => void
) {
  const [viewingCustomerDetails, setViewingCustomerDetails] = useState<Customer | null>(null);
  const [viewingEquipmentDetails, setViewingEquipmentDetails] = useState<CustomerEquipment | null>(null);

  /** Returns whether it succeeded, so a caller with its own state to close
   *  (like an alert card's "selected" panel) only closes it on success. */
  const openCustomerProfile = useCallback(
    async (customerId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`);
        if (res.ok) {
          setViewingCustomerDetails(await res.json());
          return true;
        }
        showToast("โหลดข้อมูลลูกค้าไม่สำเร็จ", "error");
        return false;
      } catch {
        showToast("โหลดข้อมูลลูกค้าไม่สำเร็จ", "error");
        return false;
      }
    },
    [showToast]
  );

  const openEquipmentDetails = useCallback(
    async (equipmentId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/equipments/${encodeURIComponent(equipmentId)}`);
        if (res.ok) {
          setViewingEquipmentDetails(await res.json());
          return true;
        }
        showToast("โหลดข้อมูลอุปกรณ์ไม่สำเร็จ", "error");
        return false;
      } catch {
        showToast("โหลดข้อมูลอุปกรณ์ไม่สำเร็จ", "error");
        return false;
      }
    },
    [showToast]
  );

  return {
    viewingCustomerDetails,
    setViewingCustomerDetails,
    viewingEquipmentDetails,
    setViewingEquipmentDetails,
    openCustomerProfile,
    openEquipmentDetails,
  };
}
