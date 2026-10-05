"use client";
// /assets/item/[id] and /stock/item/[id] — one piece: what it is, where it
// is, its status, its timeline; edit, change status, print its sticker,
// delete. The page a sticker's QR opens, so it is laid out for a phone first.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import Toast from "../Toast";
import ConfirmDialog from "../ConfirmDialog";
import type { InventoryEvent, InventoryGroup, InventoryItem, InventoryKind } from "../../lib/types";
import {
  inventoryStatus,
  inventoryStatusLabel,
  statusDetailText,
  INVENTORY_BASE_PATH,
  INVENTORY_PRICE_LABEL,
  INVENTORY_TITLE,
} from "../../lib/inventoryStatus";
import { formatDisplayDate, formatDisplayDateTime } from "../../lib/dateFormat";
import { ItemEditModal, StatusChangeModal, useInventorySuggestions } from "./InventoryModals";
import type { SupplierOption } from "./InventoryFields";
import { StatusBadge, useToast, apiJson, inventoryApi, formatBaht, primaryButton, secondaryButton, dangerButton } from "./inventoryUi";
import { labelsStorageKey } from "./InventoryListPage";

interface Loaded {
  item: InventoryItem;
  group: InventoryGroup | null;
  events: InventoryEvent[];
}

/** One timeline line, in words. */
export function describeEvent(kind: InventoryKind, e: InventoryEvent): string {
  switch (e.eventType) {
    case "created":
      return `รับเข้า · ${inventoryStatusLabel(kind, e.toValue)}${e.detail ? ` · ${e.detail}` : ""}`;
    case "status":
      return `สถานะ: ${e.fromValue === e.toValue ? inventoryStatusLabel(kind, e.toValue) : `${inventoryStatusLabel(kind, e.fromValue)} → ${inventoryStatusLabel(kind, e.toValue)}`}${e.detail ? ` · ${e.detail}` : ""}`;
    case "location":
      return `ย้ายที่เก็บ: ${e.fromValue || "ไม่ระบุ"} → ${e.toValue || "ไม่ระบุ"}`;
    case "group":
      return `ย้ายรายการ: ${e.fromValue || "—"} → ${e.toValue || "—"}`;
    default:
      return e.detail || e.eventType;
  }
}

export default function InventoryItemPage({ kind, id }: { kind: InventoryKind; id: string }) {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const base = INVENTORY_BASE_PATH[kind];

  const [data, setData] = useState<Loaded | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  // For the edit dialog: the register (group choices, suggestions) and suppliers.
  const [register, setRegister] = useState<{ groups: InventoryGroup[]; items: InventoryItem[] } | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [dialog, setDialog] = useState<"edit" | "status" | "delete" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoading, isLoggedIn, router]);

  // A promise chain: the state is set in its callbacks, after the request.
  const load = useCallback(
    () =>
      fetch(`${inventoryApi(kind)}/items/${encodeURIComponent(id)}`)
        .then(async (res) => {
          if (res.status === 404) {
            setNotFound(true);
            return;
          }
          if (!res.ok) throw new Error();
          setData((await res.json()) as Loaded);
          setLoadError("");
        })
        .catch(() => setLoadError("โหลดข้อมูลไม่สำเร็จ")),
    [kind, id]
  );

  useEffect(() => {
    if (isLoggedIn) void load();
  }, [isLoggedIn, load]);

  const suggest = useInventorySuggestions(register?.groups ?? [], register?.items ?? []);

  async function openEdit() {
    try {
      if (!register) {
        const [reg, sup] = await Promise.all([
          apiJson<{ groups: InventoryGroup[]; items: InventoryItem[] }>(inventoryApi(kind)),
          fetch("/api/suppliers").then((r) => (r.ok ? r.json() : [])),
        ]);
        setRegister(reg);
        setSuppliers(Array.isArray(sup) ? sup.map((s: SupplierOption) => ({ id: s.id, companyName: s.companyName })) : []);
      }
      setDialog("edit");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ", "error");
    }
  }

  async function openStatus() {
    if (!register) {
      // Suggestions for the borrower / buyer fields; the dialog works without them.
      apiJson<{ groups: InventoryGroup[]; items: InventoryItem[] }>(inventoryApi(kind)).then(setRegister).catch(() => {});
    }
    setDialog("status");
  }

  async function remove() {
    if (!data) return;
    setDeleting(true);
    try {
      await apiJson(`${inventoryApi(kind)}/items/${data.item.id}`, { method: "DELETE" });
      router.push(base);
    } catch (e) {
      setDeleting(false);
      setDialog(null);
      showToast(e instanceof Error ? e.message : "ลบไม่สำเร็จ", "error");
    }
  }

  function printLabel() {
    if (!data) return;
    try {
      sessionStorage.setItem(labelsStorageKey(kind), JSON.stringify([data.item.id]));
    } catch {
      /* the labels page also reads ?ids= */
    }
    router.push(`${base}/labels?ids=${encodeURIComponent(data.item.id)}`);
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
      </div>
    );
  }

  const header = (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
        <Link href={base} className="text-xs font-semibold text-gray-400 hover:text-gray-600">
          ← {INVENTORY_TITLE[kind]}
        </Link>
        <h1 className="font-mono text-xl font-bold text-gray-900 sm:text-2xl">{data?.item.code ?? "…"}</h1>
      </div>
    </header>
  );

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50/60">
        {header}
        <p className="mx-auto max-w-3xl px-4 py-16 text-center text-gray-500">ไม่พบชิ้นนี้ อาจถูกลบไปแล้ว</p>
      </div>
    );
  }

  const item = data?.item;
  const group = data?.group;
  const def = item ? inventoryStatus(kind, item.status) : undefined;

  return (
    <div className="min-h-screen bg-gray-50/60 pb-28">
      {toast && <Toast message={toast.message} type={toast.type} />}
      {header}
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 sm:px-6">
        {loadError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>}
        {!item && !loadError && <p className="py-10 text-center text-gray-400">กำลังโหลด…</p>}
        {item && (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
              <p className="text-lg font-bold text-gray-900">{group?.name ?? "—"}</p>
              <p className="text-sm text-gray-500">{[group?.brand, group?.model, group?.category].filter(Boolean).join(" · ")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge kind={kind} status={item.status} className="text-sm" />
                {(def?.party || def?.date) && (
                  <span className="text-sm text-gray-600">{statusDetailText(kind, item.status, item.statusParty, item.statusDate)}</span>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button type="button" className={primaryButton} onClick={() => void openStatus()}>
                  เปลี่ยนสถานะ
                </button>
                <button type="button" className={secondaryButton} onClick={() => void openEdit()}>
                  แก้ไข
                </button>
                <button type="button" className={secondaryButton} onClick={printLabel}>
                  พิมพ์สติกเกอร์
                </button>
                <button type="button" className={`${dangerButton} sm:ml-auto`} onClick={() => setDialog("delete")}>
                  ลบ
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Detail label="เลขซีเรียล" value={item.serialNumber} mono />
                <Detail label="วันที่ซื้อ" value={formatDisplayDate(item.purchaseDate)} />
                <Detail label={INVENTORY_PRICE_LABEL[kind]} value={formatBaht(item.price)} />
                <Detail label="ผู้ขาย" value={item.supplierName} />
                <Detail label="อยู่ที่ไหน" value={item.location} />
                {kind === "asset" && <Detail label="ผู้ดูแล / ผู้ใช้" value={item.custodian} />}
                {kind === "asset" && <Detail label="วันหมดประกัน" value={formatDisplayDate(item.warrantyUntil)} />}
                <div className="sm:col-span-2">
                  <Detail label="หมายเหตุ" value={item.note} multiline />
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
              <h2 className="mb-3 font-bold text-gray-900">ประวัติ</h2>
              {data.events.length === 0 ? (
                <p className="text-sm text-gray-400">ยังไม่มีประวัติ</p>
              ) : (
                <ol className="space-y-3 border-l-2 border-orange-100 pl-4">
                  {data.events.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-orange-400" />
                      <p className="text-xs text-gray-400">{formatDisplayDateTime(e.createdAt)}</p>
                      <p className="text-sm text-gray-800">{describeEvent(kind, e)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>

      {dialog === "edit" && item && register && (
        <ItemEditModal
          kind={kind}
          item={item}
          groups={register.groups}
          items={register.items}
          suppliers={suppliers}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            setRegister(null); // groups / suggestions may have changed
            showToast("บันทึกแล้ว");
            await load();
          }}
        />
      )}
      {dialog === "status" && item && (
        <StatusChangeModal
          kind={kind}
          title={`เปลี่ยนสถานะ ${item.code}`}
          initial={{ status: item.status, statusParty: item.statusParty, statusDate: item.statusDate ?? "" }}
          partySuggestions={suggest.party}
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            await apiJson(`${inventoryApi(kind)}/items/${item.id}`, { method: "PATCH", body: JSON.stringify(value) });
            setDialog(null);
            showToast("เปลี่ยนสถานะแล้ว");
            await load();
          }}
        />
      )}
      {dialog === "delete" && item && (
        <ConfirmDialog
          message={`ลบ ${item.code}${group ? ` (${group.name})` : ""} และประวัติของชิ้นนี้?\nรหัสนี้จะไม่ถูกนำกลับมาใช้อีก`}
          loading={deleting}
          onCancel={() => setDialog(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}

function Detail({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-gray-900 ${mono ? "font-mono" : ""} ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value || <span className="text-gray-300">—</span>}
      </dd>
    </div>
  );
}
