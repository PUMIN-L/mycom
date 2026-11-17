"use client";

import CopyText from "../components/CopyText";
import { formatThaiPhone } from "../lib/phone";
import type { Customer } from "../lib/types";
import { companyAddressLines, companyAddressText } from "./companyAddress";
import { thCompare } from "./listHelpers";
import type { Company, Salesperson } from "./types";
import ViewModal from "./ViewModal";

const SECTION_TITLE = "text-sm font-semibold text-gray-400 uppercase tracking-wider";

// ── Company ──────────────────────────────────────────────────────────────────

export function CompanyWindow({
  company,
  customers,
  customersLoaded,
  onClose,
  onEdit,
  onOpenCustomer,
  onAddCustomer,
  onCopied,
  onCopyFailed,
}: {
  company: Company;
  /** Every customer the page holds — the company's own are picked out here. */
  customers: readonly Customer[];
  /** Whether that list has loaded: an empty one that has not is not "none". */
  customersLoaded: boolean;
  onClose: () => void;
  onEdit: () => void;
  onOpenCustomer: (customer: Customer) => void;
  onAddCustomer: () => void;
  onCopied: () => void;
  onCopyFailed: () => void;
}) {
  const address = companyAddressLines(company);
  const contacts = customers.filter((c) => c.companyId === company.id).sort((a, b) => thCompare(a.name, b.name));

  const copyAddress = async () => {
    try {
      // One line: it pastes into a quotation's address box or a courier form.
      await navigator.clipboard.writeText(companyAddressText(company));
      onCopied();
    } catch {
      onCopyFailed();
    }
  };

  return (
    <ViewModal
      name={company.name}
      kind="ข้อมูลบริษัท"
      onClose={onClose}
      onEdit={onEdit}
      icon={
        <svg aria-hidden="true" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
      }
    >
      <div className="space-y-6">
        <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className={SECTION_TITLE}>ที่อยู่</h3>
            {address.length > 0 && (
              <button type="button" onClick={copyAddress} className="text-sm font-semibold text-orange-600 hover:text-orange-700">
                คัดลอกที่อยู่
              </button>
            )}
          </div>
          {address.length > 0 ? (
            <p className="text-gray-800 leading-relaxed" data-testid="company-address">
              {address.map((line, i) => (
                <span key={i} className="block">{line}</span>
              ))}
            </p>
          ) : (
            <p className="text-gray-400 italic">ไม่มีข้อมูลที่อยู่</p>
          )}
        </div>

        <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
          <h3 className={`${SECTION_TITLE} mb-1`}>เบอร์โทรศัพท์</h3>
          <p className="text-gray-800 font-medium tabular-nums">
            <CopyText value={formatThaiPhone(company.phone)} onCopied={onCopied} onFailed={onCopyFailed} />
          </p>
        </div>

        {company.note && (
          <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
            <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">หมายเหตุ</h3>
            <p className="text-orange-900 whitespace-pre-wrap">{company.note}</p>
          </div>
        )}

        {/* The company's contacts — from the customer list the page already
            holds, so no extra request. Each opens that customer's own window. */}
        <div className="rounded-2xl border border-gray-100 p-5" data-testid="company-contacts">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className={SECTION_TITLE}>
              ลูกค้าในบริษัทนี้{customersLoaded && <span className="text-gray-500 normal-case"> ({contacts.length})</span>}
            </h3>
            <button type="button" onClick={onAddCustomer} className="text-sm font-semibold text-orange-600 hover:text-orange-700">
              + เพิ่มลูกค้าในบริษัทนี้
            </button>
          </div>
          {!customersLoaded ? (
            <p className="text-sm text-gray-400">โหลดรายชื่อลูกค้าไม่สำเร็จ — ยังบอกไม่ได้ว่าบริษัทนี้มีใครบ้าง</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-gray-400">ยังไม่มีลูกค้าในบริษัทนี้</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-gray-50 -mx-2">
              {contacts.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(c)}
                    className="w-full text-left flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900 truncate">{c.name}</span>
                      {c.department && <span className="block text-xs text-gray-500 truncate">{c.department}</span>}
                    </span>
                    <span className="shrink-0 text-sm text-gray-500 tabular-nums">{formatThaiPhone(c.phone)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ViewModal>
  );
}

// ── Salesperson ──────────────────────────────────────────────────────────────

export function SalespersonWindow({
  salesperson,
  onClose,
  onEdit,
  onCopied,
  onCopyFailed,
}: {
  salesperson: Salesperson;
  onClose: () => void;
  onEdit: () => void;
  onCopied: () => void;
  onCopyFailed: () => void;
}) {
  return (
    <ViewModal
      name={salesperson.name}
      kind={<span className="text-orange-600 font-medium">พนักงานขาย</span>}
      onClose={onClose}
      onEdit={onEdit}
      // An icon, not the name's first letter ("ค" for every "คุณ…").
      icon={
        <svg aria-hidden="true" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase">อีเมล</p>
            <p className="text-gray-900 font-medium break-all"><CopyText value={salesperson.email} onCopied={onCopied} onFailed={onCopyFailed} /></p>
          </div>
        </div>

        <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase">เบอร์โทรศัพท์</p>
            <p className="text-gray-900 font-medium tabular-nums"><CopyText value={formatThaiPhone(salesperson.phone)} onCopied={onCopied} onFailed={onCopyFailed} /></p>
          </div>
        </div>

        {salesperson.note && (
          <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100 mt-4">
            <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">หมายเหตุ</h3>
            <p className="text-orange-900 whitespace-pre-wrap">{salesperson.note}</p>
          </div>
        )}
      </div>
    </ViewModal>
  );
}
