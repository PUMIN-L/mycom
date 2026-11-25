"use client";

import { useEffect, useState } from "react";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import type { OrderStatus } from "../../lib/accounting/orderRules";
import type { PlanItemStatus, PlanStage } from "../../lib/accounting/depositRules";
import type { DocLineInput } from "../../lib/accounting/invoiceRules";
import type { PriceMode } from "../../lib/accounting/money";
import type { DeliveryOrder } from "../invoices/InvoiceEditor";
import type { DeletionImpactView } from "../DocumentDeleteDialog";

/** A customer PO as GET /api/accounting/sales-orders/[id] answers it. */
export interface OrderDetailView {
  order: {
    id: string;
    docType: string;
    status: string;
    customerPoNo: string;
    issueDate: string;
    expectedDeliveryDate: string | null;
    creditDays: number;
    companyId: string;
    customerId: string;
    salespersonId: string;
    buyerName: string;
    buyerAddress: string;
    buyerTaxId: string;
    buyerBranch: string;
    priceMode: PriceMode;
    vatRate: number;
    subtotalSatang: number;
    discountSatang: number;
    vatBaseSatang: number;
    vatSatang: number;
    totalSatang: number;
    projectName: string;
    note: string;
    externalNote: string;
    voidReason: string | null;
    updatedAt: string;
    isTaxInvoice: boolean;
    /** Whose commission it is (§8h) — absent from an older answer, null until chosen. */
    commissionOf?: "ford" | "tor" | null;
    lines: (DocLineInput & { id: string; amountSatang: number; deliveredQty: number })[];
  };
  orderStatus: OrderStatus;
  backlogSatang: number;
  deliveries: { id: string; docNo: string | null; status: string; source: string; issueDate: string; totalSatang: number; paidSatang?: number; creditedSatang?: number; depositSatang?: number }[];
  invoicedLineDiscounts: Record<string, number>;
  invoicedBillDiscountSatang: number;
  /** Its deposits (step 6) — absent from an older answer. */
  deposits?: { receivedSatang: number; receivedExVatSatang: number; deductedSatang: number; leftSatang: number };
  /** Its payment plan, each item with where it stands. */
  plan?: PlanItemView[];
  impact: DeletionImpactView;
}

export interface PlanItemView {
  id: string;
  label: string;
  stage: PlanStage;
  amountSatang: number;
  dueDate: string;
  receivedSatang: number;
  status: PlanItemStatus;
  late: boolean;
}

/** What a delivery invoice needs of the PO: its header to open with, what is left of each line. */
export function deliveryOrderOf(detail: OrderDetailView): DeliveryOrder {
  const o = detail.order;
  return {
    id: o.id,
    customerPoNo: o.customerPoNo,
    discountSatang: o.discountSatang,
    invoicedDiscountSatang: detail.invoicedBillDiscountSatang,
    depositLeftSatang: detail.deposits?.leftSatang ?? 0,
    lines: o.lines.map((l) => ({ ...l, invoicedDiscountSatang: detail.invoicedLineDiscounts[l.id] ?? 0 })),
    companyId: o.companyId,
    customerId: o.customerId,
    salespersonId: o.salespersonId,
    buyerName: o.buyerName,
    buyerAddress: o.buyerAddress,
    buyerTaxId: o.buyerTaxId,
    buyerBranch: o.buyerBranch,
    priceMode: o.priceMode,
    creditDays: o.creditDays,
    projectName: o.projectName,
  };
}

/**
 * Why nothing more can be delivered from this PO — cancelled, or every line
 * sent in full (by QUANTITY: a free item still to send keeps it open) — or
 * null while something is left.
 */
export function orderClosedReason(detail: Pick<OrderDetailView, "order" | "orderStatus">): string | null {
  if (detail.order.status === "void") return "PO ลูกค้านี้ถูกยกเลิกแล้ว — ส่งของจาก PO นี้ไม่ได้";
  if (detail.orderStatus === "complete") return "PO ลูกค้านี้ส่งของครบแล้ว";
  return null;
}

export type OrderLoad = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ok"; detail: OrderDetailView };

/** GET /api/accounting/sales-orders/[id] — `id` null loads nothing; bump `reloadKey` to fetch again. */
export function useOrderDetail(id: string | null, reloadKey = 0): OrderLoad {
  const [state, setState] = useState<{ key: string; load: OrderLoad }>({ key: "", load: { status: "idle" } });
  const key = id ? `${id}|${reloadKey}` : "";
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/sales-orders/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลด PO ลูกค้าไม่สำเร็จ");
          if (!cancelled) setState({ key: `${id}|${reloadKey}`, load: { status: "error", message } });
          return;
        }
        const detail = (await res.json()) as Partial<OrderDetailView> | null;
        if (cancelled) return;
        // Never render (and crash on) an answer that is not a PO.
        if (!detail?.order || !Array.isArray(detail.order.lines) || !Array.isArray(detail.deliveries)) {
          setState({ key: `${id}|${reloadKey}`, load: { status: "error", message: "โหลด PO ลูกค้าไม่สำเร็จ" } });
          return;
        }
        setState({ key: `${id}|${reloadKey}`, load: { status: "ok", detail: detail as OrderDetailView } });
      } catch {
        if (!cancelled) setState({ key: `${id}|${reloadKey}`, load: { status: "error", message: "โหลด PO ลูกค้าไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);
  if (!id) return { status: "idle" };
  // An answer for another PO (or an older load) is not this one's.
  return state.key === key ? state.load : { status: "loading" };
}
