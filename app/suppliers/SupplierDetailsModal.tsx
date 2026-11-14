"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import SupplierInfo from "../components/SupplierInfo";
import type { Supplier } from "../lib/types";
import { linkedProductList, missingPoFields } from "./supplierHelpers";

const PRIMARY_BUTTON =
  "bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2";
const SECONDARY_BUTTON =
  "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm flex items-center gap-2";

const MISSING_WORD: Record<"address" | "taxId", string> = { address: "ที่อยู่", taxId: "เลขผู้เสียภาษี" };

/**
 * One supplier's window on /suppliers: its details, its note, the products
 * linked to it (each opens its product in a new tab), and what to do next —
 * แก้ไข, or สร้างใบสั่งซื้อ with this supplier already picked. It used to be a
 * centred "luxury" card in English with nothing to do but Close.
 * Esc closes it; focus moves in on open and back to the row on close.
 */
export default function SupplierDetailsModal({
  supplier,
  onClose,
  onEdit,
  onCopied,
  onFailed,
}: {
  supplier: Supplier;
  onClose: () => void;
  /** Edit this supplier; `returnFocus` is where the keyboard goes back to once the form closes. */
  onEdit: (returnFocus: HTMLElement | null) => void;
  onCopied: () => void;
  onFailed: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Set when the window closes into the edit form, which takes the focus itself. */
  const keepFocusRef = useRef(false);

  // Escape closes — as on every other admin window.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focus into the window, and back to what opened it (the row) on close.
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      const back = returnFocusRef.current;
      if (!keepFocusRef.current && back?.isConnected) back.focus();
    };
  }, []);

  const products = linkedProductList(supplier);
  const missing = missingPoFields(supplier);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} data-testid="supplier-view-backdrop"></div>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-view-title"
        className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden outline-none"
      >
        {/* The header does not scroll: the name and ✕ stay in reach. */}
        <div className="px-8 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center shrink-0">
              <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
            </div>
            <div className="min-w-0">
              <h2 id="supplier-view-title" className="text-2xl font-bold text-gray-900 wrap-break-word">{supplier.companyName}</h2>
              <p className="text-sm text-gray-500">ข้อมูลซัพพลายเออร์</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors shrink-0">
            <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain flex-1 px-8 py-6 space-y-6">
          <SupplierInfo supplier={supplier} onCopied={onCopied} onFailed={onFailed} />

          {missing.length > 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="supplier-missing-po">
              ใบสั่งซื้อที่ออกให้ซัพพลายเออร์นี้จะยังไม่มี{missing.map((f) => MISSING_WORD[f]).join("และ")} — กด “แก้ไข” เพื่อเพิ่ม
            </p>
          )}

          {supplier.note?.trim() && (
            <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
              <h3 className="text-sm font-semibold text-orange-700 mb-2">หมายเหตุ</h3>
              <p className="text-orange-900 whitespace-pre-line wrap-break-word">{supplier.note}</p>
            </div>
          )}

          <section aria-labelledby="supplier-products-title">
            <h3 id="supplier-products-title" className="text-sm font-semibold text-gray-500 mb-2">
              สินค้าที่ผูกไว้ ({products.length})
            </h3>
            {products.length > 0 ? (
              <ul className="rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
                {products.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`/edit-product/${encodeURIComponent(p.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="เปิดหน้าแก้ไขสินค้าในแท็บใหม่"
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-gray-800 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    >
                      <span className="min-w-0 wrap-break-word">{p.name}</span>
                      <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">ยังไม่มีสินค้าที่ผูกกับซัพพลายเออร์นี้ — ผูกได้ที่หน้าแก้ไขสินค้า</p>
            )}
          </section>
        </div>

        <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2.5 font-semibold text-gray-500 hover:text-gray-800 rounded-xl transition-colors">
            ปิด
          </button>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                keepFocusRef.current = true;
                onEdit(returnFocusRef.current);
              }}
              className={SECONDARY_BUTTON}
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              แก้ไข
            </button>
            <Link href={`/purchase-order?supplierId=${encodeURIComponent(supplier.id)}`} className={PRIMARY_BUTTON}>
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              สร้างใบสั่งซื้อ
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
