"use client";

import { useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import PasswordConfirmDialog from "./PasswordConfirmDialog";
import { errorMessageOf } from "../lib/apiErrorMessage";
import { formatSatang } from "../lib/accounting/money";

/** What deleting would do — GET /api/accounting/documents/[id] answers it as `impact`. */
export interface DeletionImpactView {
  status: string;
  docNo: string | null;
  isLatestNumber: boolean;
  livePayments: number;
  dependentDocs: number;
  sale: { id: string; costSatang: number; sharedWithOtherDocs: boolean } | null;
  machines: { total: number; withHistory: number };
  /** A receipt: the payment that goes with it. */
  receiptPayment?: { amountSatang: number; voided: boolean; invoiceId: string; invoiceNo: string | null; deposit?: boolean } | null;
  /** Why it cannot be deleted, in the server's words — null when it can. */
  blockedReason?: string | null;
  /** An issued delivery from a customer PO: its quantities go back to that PO. */
  fromOrder?: { id: string; customerPoNo: string } | null;
}

/**
 * Deleting a document. A draft: an ordinary "are you sure". An issued one:
 * everything it takes with it, said first — the dashboard sale (and costs
 * typed into it), the machines, whether its number comes back — and the
 * password again. What blocks it (payments, documents pointing at it) is said
 * instead of a delete button.
 */
export default function DocumentDeleteDialog({
  documentId,
  label,
  impact,
  onCancel,
  onDeleted,
  docType = "INV",
}: {
  documentId: string;
  /** "INV2026110034" or "ร่างใบแจ้งหนี้". */
  label: string;
  impact: DeletionImpactView;
  onCancel: () => void;
  onDeleted: () => void;
  /** "SO": a customer PO — no number of ours, not a tax document. */
  docType?: string;
}) {
  const isOrder = docType === "SO";
  const isBilling = docType === "BN";
  const isCredit = docType === "CN";
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const send = async (password?: string): Promise<string | null> => {
    const res = await fetch(`/api/accounting/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(password === undefined ? {} : { password }),
    });
    return res.ok ? null : errorMessageOf(res, "ลบเอกสารไม่สำเร็จ");
  };

  if (impact.blockedReason || impact.livePayments > 0 || impact.dependentDocs > 0) {
    return (
      <ConfirmDialog
        title="ลบเอกสารนี้ไม่ได้"
        message={
          impact.blockedReason
            ? `${label}: ${impact.blockedReason}`
            : impact.livePayments > 0
              ? `${label} มีรายการรับชำระแล้ว — ยกเลิกรายการรับชำระก่อนจึงจะลบได้`
              : `มีเอกสารอื่นอ้างถึง ${label} (ใบเสร็จ / ใบลดหนี้) — ลบเอกสารนั้นก่อน`
        }
        confirmText="ตกลง"
        cancelText="ปิด"
        onConfirm={onCancel}
        onCancel={onCancel}
      />
    );
  }

  if (impact.status === "draft") {
    return (
      <ConfirmDialog
        title="ลบร่างนี้?"
        message={draftError ? `ลบไม่สำเร็จ: ${draftError}` : `${label} ยังไม่ได้ออกเป็นเอกสาร — ลบแล้วกู้คืนไม่ได้`}
        confirmText={draftError ? "ลองอีกครั้ง" : "ลบร่าง"}
        loading={draftBusy}
        onConfirm={async () => {
          setDraftBusy(true);
          let problem: string | null;
          try {
            problem = await send();
          } catch {
            problem = "ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
          }
          setDraftBusy(false);
          if (problem) setDraftError(problem);
          else onDeleted();
        }}
        onCancel={onCancel}
      />
    );
  }

  return (
    <PasswordConfirmDialog title={`ลบ ${label}?`} confirmText="ลบเอกสาร" danger onSubmit={send} onCancel={onCancel} onDone={onDeleted}>
      <ul className="list-disc pl-5 space-y-1">
        {impact.receiptPayment && !impact.receiptPayment.voided && (
          <li className="tabular-nums">
            {impact.receiptPayment.deposit ? (
              <>เงินมัดจำ {formatSatang(impact.receiptPayment.amountSatang)} บาท ของ {impact.receiptPayment.invoiceNo} จะถูกลบด้วย — มัดจำของ PO ลดลงเท่านี้</>
            ) : (
              <>
                รายการรับชำระ {formatSatang(impact.receiptPayment.amountSatang)} บาท ของ {impact.receiptPayment.invoiceNo ?? "ใบแจ้งหนี้"} จะถูกลบด้วย —
                ยอดนี้กลับเป็นยอดค้างชำระ
              </>
            )}
          </li>
        )}
        {impact.sale && !impact.sale.sharedWithOtherDocs && (
          <li>
            รายการขายใน dashboard ที่สร้างจากใบนี้จะถูกลบด้วย
            {impact.sale.costSatang > 0 && <> (รวมต้นทุนที่กรอกไว้ {formatSatang(impact.sale.costSatang)} บาท)</>}
          </li>
        )}
        {impact.machines.total > 0 && (
          <li>
            เครื่องที่ลงทะเบียนจากใบนี้ {impact.machines.total} เครื่องจะถูกลบ
            {impact.machines.withHistory > 0 && <> — ยกเว้น {impact.machines.withHistory} เครื่องที่มีประวัติบริการแล้ว (เก็บไว้)</>}
          </li>
        )}
        {isCredit && <li>ยอดที่ใบนี้ลดหนี้ไว้จะกลับเป็นยอดของใบแจ้งหนี้</li>}
        {impact.fromOrder && (
          <li>จำนวนที่ส่งในใบนี้จะกลับไปค้างใน PO ลูกค้า {impact.fromOrder.customerPoNo} (ยอดรอส่งของเพิ่มขึ้น)</li>
        )}
        {isOrder ? (
          <li>PO นี้จะหายจากยอดรอส่งของ — ถ้าลูกค้ายกเลิกจริง ให้กด ยกเลิก PO แทน (เก็บประวัติและเหตุผลไว้)</li>
        ) : (
          <li>
            {impact.isLatestNumber
              ? "เป็นใบล่าสุดของเดือน — ใบถัดไปจะได้เลขนี้แทน (ลำดับไม่ขาด)"
              : "ไม่ใช่ใบล่าสุด — เลขนี้จะขาดหายจากลำดับ"}
          </li>
        )}
      </ul>
      {isBilling && (
        <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          ใบวางบิลไม่ใช่เอกสารภาษี — ถ้ามอบให้ลูกค้าไปแล้ว ควรกด ยกเลิกใบวางบิล แทน (เก็บเลขที่และเหตุผลไว้)
        </p>
      )}
      {isCredit && (
        <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          ถ้าส่งใบลดหนี้นี้ให้ลูกค้าไปแล้ว ไม่ควรลบ — ให้กด ยกเลิกใบลดหนี้ แทน (เลขที่ยังอยู่ในทะเบียน พร้อมเหตุผล)
        </p>
      )}
      {!isOrder && !isBilling && !isCredit && (
        <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {!impact.receiptPayment
            ? "ถ้าส่งเอกสารนี้ให้ลูกค้าไปแล้ว ไม่ควรลบ — จะหายจากรายงานภาษีขาย ให้ยกเลิกหรือทำใบลดหนี้แทน"
            : impact.receiptPayment.voided
              ? "ใบเสร็จนี้ยกเลิกแล้ว — ถ้าเคยส่งให้ลูกค้า ควรเก็บไว้ในทะเบียน ไม่ควรลบ (ลบได้เมื่อเป็นข้อมูลทดสอบ)"
              : "ถ้าส่งใบเสร็จนี้ให้ลูกค้าไปแล้ว ไม่ควรลบ — ให้กด ยกเลิกใบเสร็จ แทน (เลขที่ยังอยู่ในทะเบียน พร้อมเหตุผล)"}
        </p>
      )}
    </PasswordConfirmDialog>
  );
}
