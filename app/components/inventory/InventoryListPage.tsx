"use client";
// /assets and /stock — the register: totals, search, filters, groups with
// their pieces, many-at-once changes, Excel, stickers. Phone-friendly (these
// two pages are used walking round the storeroom and from sticker QRs).
// Spec: openspec/changes/add-inventory-tracking.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import Toast from "../Toast";
import ConfirmDialog from "../ConfirmDialog";
import SearchableDropdown from "../SearchableDropdown";
import DatePicker from "../DatePicker";
import type { InventoryGroup, InventoryItem, InventoryKind } from "../../lib/types";
import {
  inventoryStatuses,
  statusDetailText,
  INVENTORY_BASE_PATH,
  INVENTORY_TITLE,
  MAX_ITEMS_PER_BULK,
} from "../../lib/inventoryStatus";
import {
  buildInventoryView,
  isFiltering,
  filterChoices,
  EMPTY_FILTERS,
  type InventoryFilters,
  type InventorySort,
  type GroupView,
} from "../../lib/inventorySearch";
import { inventoryExportSheets, inventoryExportFilename } from "../../lib/inventoryExport";
import { downloadExcel } from "../../lib/xlsxExport";
import { formatDisplayDate, toLocalDateString } from "../../lib/dateFormat";
import AddItemsModal from "./AddItemsModal";
import {
  GroupModal,
  MergeGroupModal,
  StatusChangeModal,
  LocationChangeModal,
  useInventorySuggestions,
} from "./InventoryModals";
import type { SupplierOption, StatusValue } from "./InventoryFields";
import {
  StatusBadge,
  useToast,
  apiJson,
  inventoryApi,
  formatBaht,
  dateFromString,
  stringFromDate,
  inputClass,
  primaryButton,
  secondaryButton,
} from "./inventoryUi";

type Dialog =
  | { type: "add"; groupId?: string }
  | { type: "group"; group?: InventoryGroup }
  | { type: "merge"; group: InventoryGroup }
  | { type: "deleteGroup"; group: InventoryGroup }
  | { type: "status"; items: InventoryItem[] }
  | { type: "location"; items: InventoryItem[] };

const SORT_OPTIONS: { value: InventorySort; label: string }[] = [
  { value: "name", label: "เรียงตามชื่อ ก–ฮ" },
  { value: "newest", label: "ซื้อล่าสุดก่อน" },
  { value: "value", label: "มูลค่ามากสุดก่อน" },
  { value: "count", label: "จำนวนมากสุดก่อน" },
];

/** Where the sticker page finds which pieces to print (see InventoryLabelsPage). */
export function labelsStorageKey(kind: InventoryKind): string {
  return `inventory-labels:${kind}`;
}

export default function InventoryListPage({ kind }: { kind: InventoryKind }) {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const base = INVENTORY_BASE_PATH[kind];

  const [data, setData] = useState<{ groups: InventoryGroup[]; items: InventoryItem[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<InventorySort>("name");
  // Groups start closed, and open while searching / filtering (to show what
  // matched). A tap flips that, in each mode separately.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoading, isLoggedIn, router]);

  // A promise chain, not async/await: the state is set in its callbacks, after
  // the request — which is also what the hooks lint can see.
  const load = useCallback(
    () =>
      apiJson<{ groups: InventoryGroup[]; items: InventoryItem[] }>(inventoryApi(kind)).then(
        (next) => {
          setData(next);
          setLoadError("");
          // A selected piece that is gone now (deleted elsewhere) is dropped.
          const ids = new Set(next.items.map((i) => i.id));
          setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
        },
        (e: unknown) => setLoadError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ")
      ),
    [kind]
  );

  useEffect(() => {
    if (!isLoggedIn) return;
    void load();
    fetch("/api/suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SupplierOption[]) =>
        setSuppliers(Array.isArray(rows) ? rows.map((s) => ({ id: s.id, companyName: s.companyName })) : [])
      )
      .catch(() => setSuppliers([]));
  }, [isLoggedIn, load]);

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const view = useMemo(() => buildInventoryView(kind, groups, items, filters, sort), [kind, groups, items, filters, sort]);
  const filtering = isFiltering(filters);
  // Pieces that have left and match everything else, hidden only because
  // "show gone" is off — so a search for a sold piece's serial does not
  // look like the piece never existed.
  const hiddenGone =
    filters.showGone || filters.statuses.length > 0
      ? 0
      : inventoryStatuses(kind)
          .filter((s) => s.gone)
          .reduce((n, s) => n + (view.statusCounts[s.key] ?? 0), 0);
  const suggest = useInventorySuggestions(groups, items);
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  /** Every piece of a group, whatever the filters — a group with none may be deleted. */
  const totalByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.groupId, (m.get(i.groupId) ?? 0) + 1);
    return m;
  }, [items]);

  const filterOptions = useMemo(
    () => ({
      category: filterChoices(groups.map((g) => g.category), filters.category, "ทุกหมวด"),
      location: filterChoices(items.map((i) => i.location), filters.location, "ทุกที่เก็บ"),
      supplier: filterChoices(items.map((i) => i.supplierName), filters.supplier, "ทุกผู้ขาย"),
    }),
    [groups, items, filters.category, filters.location, filters.supplier]
  );

  const setFilter = <K extends keyof InventoryFilters>(key: K, value: InventoryFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  function toggleStatusCard(key: string) {
    setFilters((f) => ({
      ...f,
      statuses: f.statuses.includes(key) ? f.statuses.filter((s) => s !== key) : [...f.statuses, key],
    }));
  }

  function toggleExpanded(id: string) {
    (filtering ? setCollapsedWhileFiltering : setExpanded)((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const selectedItems = useMemo(
    () => [...selected].map((id) => itemsById.get(id)).filter((i): i is InventoryItem => !!i),
    [selected, itemsById]
  );

  async function afterChange(message: string) {
    setDialog(null);
    showToast(message);
    await load();
  }

  async function bulkStatus(targets: InventoryItem[], value: StatusValue) {
    if (targets.length === 1) {
      await apiJson(`${inventoryApi(kind)}/items/${targets[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: value.status, statusParty: value.statusParty, statusDate: value.statusDate }),
      });
    } else {
      await apiJson(`${inventoryApi(kind)}/items/bulk`, {
        method: "POST",
        body: JSON.stringify({ ids: targets.map((i) => i.id), ...value }),
      });
    }
    await afterChange(targets.length === 1 ? `เปลี่ยนสถานะ ${targets[0].code} แล้ว` : `เปลี่ยนสถานะ ${targets.length} ชิ้นแล้ว`);
  }

  async function bulkLocation(targets: InventoryItem[], location: string) {
    await apiJson(`${inventoryApi(kind)}/items/bulk`, {
      method: "POST",
      body: JSON.stringify({ ids: targets.map((i) => i.id), location }),
    });
    setSelected(new Set());
    await afterChange(`ย้าย ${targets.length} ชิ้นแล้ว`);
  }

  async function deleteGroup(group: InventoryGroup) {
    setBusy(true);
    try {
      await apiJson(`${inventoryApi(kind)}/groups/${group.id}`, { method: "DELETE" });
      await afterChange(`ลบรายการ "${group.name}" แล้ว`);
    } catch (e) {
      setDialog(null);
      showToast(e instanceof Error ? e.message : "ลบไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    try {
      await downloadExcel(inventoryExportFilename(kind, toLocalDateString(new Date())), inventoryExportSheets(kind, view.groups));
    } catch {
      showToast("ส่งออกไม่สำเร็จ", "error");
    }
  }

  function printLabels(ids: string[]) {
    try {
      sessionStorage.setItem(labelsStorageKey(kind), JSON.stringify(ids));
    } catch {
      /* private mode: the labels page says nothing was chosen */
    }
    router.push(`${base}/labels`);
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
      </div>
    );
  }

  const statuses = inventoryStatuses(kind);

  // Bottom padding: room to scroll the last card clear of the admin bell
  // (bottom-left) and, while pieces are chosen, of the action bar.
  return (
    <div className={`min-h-screen bg-gray-50/60 ${selected.size > 0 ? "pb-44" : "pb-28"}`}>
      {toast && <Toast message={toast.message} type={toast.type} />}

      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <Link href="/adminpanel" className="text-xs font-semibold text-gray-400 hover:text-gray-600">
              ← ระบบจัดการ
            </Link>
            <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">{INVENTORY_TITLE[kind]}</h1>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={exportExcel} disabled={!data}>
              ส่งออก Excel
            </button>
            <button type="button" className={primaryButton} onClick={() => setDialog({ type: "add" })} disabled={!data}>
              + เพิ่มของ
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{loadError}</span>
            <button type="button" className="font-semibold underline" onClick={() => void load()}>
              ลองใหม่
            </button>
          </div>
        )}

        {/* Totals: what is shown. Status cards also filter. */}
        <section className="grid grid-cols-3 gap-2 sm:gap-3">
          <SummaryCard label="รายการ" value={String(view.groups.length)} />
          <SummaryCard label="ชิ้น" value={String(view.items.length)} />
          <SummaryCard label="มูลค่า (ที่ยังมีอยู่)" value={formatBaht(view.value)} />
        </section>
        <section className="flex gap-2 overflow-x-auto pb-1">
          {statuses.map((s) => {
            const on = filters.statuses.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleStatusCard(s.key)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left transition ${
                  on ? "border-orange-400 bg-orange-50 ring-2 ring-orange-100" : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
                aria-pressed={on}
              >
                <span className="block text-xs text-gray-500">{s.label}</span>
                <span className="block text-lg font-bold text-gray-900">{view.statusCounts[s.key] ?? 0}</span>
              </button>
            );
          })}
        </section>

        {/* Search + filters */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
              <input
                type="search"
                className={`${inputClass} pl-9`}
                placeholder="ค้นหา ชื่อ ยี่ห้อ รุ่น รหัส ซีเรียล ที่เก็บ ผู้ขาย…"
                value={filters.query}
                onChange={(e) => setFilter("query", e.target.value)}
                aria-label="ค้นหา"
              />
            </div>
            <button
              type="button"
              className={`${secondaryButton} md:hidden`}
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              ตัวกรอง {showFilters ? "▴" : "▾"}
            </button>
          </div>
          <div className={`${showFilters ? "grid" : "hidden"} grid-cols-1 gap-2 sm:grid-cols-2 md:grid md:grid-cols-3 lg:grid-cols-6`}>
            <SearchableDropdown options={filterOptions.category} value={filters.category} onChange={(v) => setFilter("category", v)} placeholder="ทุกหมวด" />
            <SearchableDropdown options={filterOptions.location} value={filters.location} onChange={(v) => setFilter("location", v)} placeholder="ทุกที่เก็บ" />
            <SearchableDropdown options={filterOptions.supplier} value={filters.supplier} onChange={(v) => setFilter("supplier", v)} placeholder="ทุกผู้ขาย" />
            <DatePicker
              selected={dateFromString(filters.dateFrom)}
              onChange={(d) => setFilter("dateFrom", stringFromDate(d))}
              className={inputClass}
              placeholderText="ซื้อตั้งแต่วันที่"
              isClearable
            />
            <DatePicker
              selected={dateFromString(filters.dateTo)}
              onChange={(d) => setFilter("dateTo", stringFromDate(d))}
              className={inputClass}
              placeholderText="ถึงวันที่"
              isClearable
            />
            <SearchableDropdown
              options={SORT_OPTIONS}
              value={sort}
              onChange={(v) => setSort(v as InventorySort)}
              searchable={false}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2 text-gray-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-500"
                checked={filters.showGone}
                onChange={(e) => setFilter("showGone", e.target.checked)}
              />
              แสดงของที่ออกไปแล้วด้วย ({statuses.filter((s) => s.gone).map((s) => s.label).join(" / ")})
            </label>
            {(filtering || filters.showGone) && (
              <button type="button" className="font-semibold text-orange-600 hover:underline" onClick={() => setFilters(EMPTY_FILTERS)}>
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </section>

        {filtering && hiddenGone > 0 && (
          <button
            type="button"
            onClick={() => setFilter("showGone", true)}
            className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-left text-sm text-amber-800 hover:bg-amber-100"
          >
            มี {hiddenGone} ชิ้นที่ออกไปแล้วตรงกับการค้นหานี้ (ซ่อนอยู่) — กดเพื่อแสดง
          </button>
        )}

        {/* Groups */}
        {!data && !loadError && <p className="py-10 text-center text-gray-400">กำลังโหลด…</p>}
        {data && view.groups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-500">
            {filtering ? (
              "ไม่พบรายการที่ตรงกับการค้นหา"
            ) : (
              <>
                ยังไม่มีข้อมูล
                <div className="mt-3">
                  <button type="button" className={primaryButton} onClick={() => setDialog({ type: "add" })}>
                    + เพิ่มของชิ้นแรก
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <div className="space-y-3">
          {view.groups.map((gv) => (
            <GroupCard
              key={gv.group.id}
              kind={kind}
              view={gv}
              open={filtering ? !collapsedWhileFiltering.has(gv.group.id) : expanded.has(gv.group.id)}
              onToggle={() => toggleExpanded(gv.group.id)}
              totalItems={totalByGroup.get(gv.group.id) ?? 0}
              selected={selected}
              onSelect={toggleSelected}
              onAdd={() => setDialog({ type: "add", groupId: gv.group.id })}
              onEdit={() => setDialog({ type: "group", group: gv.group })}
              onMerge={groups.length > 1 ? () => setDialog({ type: "merge", group: gv.group }) : undefined}
              onDelete={() => setDialog({ type: "deleteGroup", group: gv.group })}
              onStatus={(item) => setDialog({ type: "status", items: [item] })}
            />
          ))}
        </div>
        {data && (
          <div className="pt-2 text-center">
            <button type="button" className="text-sm font-semibold text-gray-500 hover:text-gray-800" onClick={() => setDialog({ type: "group" })}>
              + สร้างรายการเปล่า (ยังไม่มีชิ้น)
            </button>
          </div>
        )}
      </main>

      {/* Many at once */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-800 bg-gray-900 text-white shadow-2xl">
          {/* Left padding: the admin bell floats over the bottom-left corner. */}
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 py-3 pl-24 pr-4 sm:pr-6 md:pl-32">
            <span className="mr-auto text-sm font-semibold">เลือก {selected.size} ชิ้น</span>
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-40"
              disabled={selected.size > MAX_ITEMS_PER_BULK}
              onClick={() => setDialog({ type: "status", items: selectedItems })}
            >
              เปลี่ยนสถานะ
            </button>
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-40"
              disabled={selected.size > MAX_ITEMS_PER_BULK}
              onClick={() => setDialog({ type: "location", items: selectedItems })}
            >
              ย้ายที่เก็บ
            </button>
            <button type="button" className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20" onClick={() => printLabels([...selected])}>
              พิมพ์สติกเกอร์
            </button>
            <button type="button" className="rounded-lg px-3 py-2 text-sm text-gray-300 hover:text-white" onClick={() => setSelected(new Set())}>
              ล้าง
            </button>
            {selected.size > MAX_ITEMS_PER_BULK && (
              <span className="w-full text-xs text-amber-300">เปลี่ยนได้ครั้งละไม่เกิน {MAX_ITEMS_PER_BULK} ชิ้น</span>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      {dialog?.type === "add" && data && (
        <AddItemsModal
          kind={kind}
          groups={groups}
          items={items}
          suppliers={suppliers}
          presetGroupId={dialog.groupId}
          onClose={() => setDialog(null)}
          onAdded={(message) => {
            if (dialog.groupId) setExpanded((prev) => new Set(prev).add(dialog.groupId!));
            void afterChange(message);
          }}
        />
      )}
      {dialog?.type === "group" && (
        <GroupModal
          kind={kind}
          group={dialog.group}
          categorySuggestions={suggest.category}
          onClose={() => setDialog(null)}
          onSaved={(g) => void afterChange(dialog.group ? `บันทึก "${g.name}" แล้ว` : `สร้างรายการ "${g.name}" แล้ว`)}
        />
      )}
      {dialog?.type === "merge" && (
        <MergeGroupModal
          kind={kind}
          from={dialog.group}
          groups={groups}
          itemCount={totalByGroup.get(dialog.group.id) ?? 0}
          onClose={() => setDialog(null)}
          onMerged={(message) => void afterChange(message)}
        />
      )}
      {dialog?.type === "deleteGroup" && (
        <ConfirmDialog
          message={`ลบรายการ "${dialog.group.name}"?`}
          loading={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void deleteGroup(dialog.group)}
        />
      )}
      {dialog?.type === "status" && (
        <StatusChangeModal
          kind={kind}
          title={dialog.items.length === 1 ? `เปลี่ยนสถานะ ${dialog.items[0].code}` : `เปลี่ยนสถานะ ${dialog.items.length} ชิ้น`}
          initial={
            dialog.items.length === 1
              ? { status: dialog.items[0].status, statusParty: dialog.items[0].statusParty, statusDate: dialog.items[0].statusDate ?? "" }
              : { status: "", statusParty: "", statusDate: "" }
          }
          partySuggestions={suggest.party}
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            await bulkStatus(dialog.items, value);
            if (dialog.items.length > 1) setSelected(new Set());
          }}
        />
      )}
      {dialog?.type === "location" && (
        <LocationChangeModal
          title={`ย้ายที่เก็บ ${dialog.items.length} ชิ้น`}
          suggestions={suggest.location}
          onClose={() => setDialog(null)}
          onSubmit={(location) => bulkLocation(dialog.items, location)}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 sm:px-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="truncate text-lg font-bold text-gray-900 sm:text-2xl">{value}</p>
    </div>
  );
}

function GroupCard({
  kind,
  view,
  open,
  onToggle,
  totalItems,
  selected,
  onSelect,
  onAdd,
  onEdit,
  onMerge,
  onDelete,
  onStatus,
}: {
  kind: InventoryKind;
  view: GroupView;
  open: boolean;
  onToggle: () => void;
  totalItems: number;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onAdd: () => void;
  onEdit: () => void;
  /** Absent when there is no other group to merge into. */
  onMerge?: () => void;
  onDelete: () => void;
  onStatus: (item: InventoryItem) => void;
}) {
  const { group, items, counts, value } = view;
  const base = INVENTORY_BASE_PATH[kind];
  const ids = items.map((i) => i.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const subtitle = [group.brand, group.model].filter(Boolean).join(" · ");

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          className="mt-1.5 h-4 w-4 shrink-0 accent-orange-500"
          checked={allOn}
          disabled={ids.length === 0}
          onChange={(e) => onSelect(ids, e.target.checked)}
          aria-label={`เลือกทุกชิ้นของ ${group.name}`}
        />
        <div className="min-w-0 flex-1 cursor-pointer text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden="true" className="text-gray-400">{open ? "▾" : "▸"}</span>
            <h2 className="font-bold text-gray-900">
              <button
                type="button"
                aria-expanded={open}
                className="rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
              >
                {group.name}
              </button>
            </h2>
            {subtitle && <span className="text-sm text-gray-500">{subtitle}</span>}
            {group.category && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{group.category}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-gray-700">{items.length} ชิ้น</span>
            {inventoryStatuses(kind)
              .filter((s) => counts[s.key])
              .map((s) => (
                <span key={s.key} className={`rounded-full border px-2 py-0.5 ${s.badge}`}>
                  {s.label} {counts[s.key]}
                </span>
              ))}
            <span className="ml-auto font-semibold text-gray-700">{formatBaht(value)}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50/60 px-4 py-2 text-xs font-semibold">
        <button type="button" className="text-orange-600 hover:underline" onClick={onAdd}>
          + เพิ่มชิ้น
        </button>
        <button type="button" className="text-gray-600 hover:underline" onClick={onEdit}>
          แก้ไขรายการ
        </button>
        {onMerge && (
          <button type="button" className="text-gray-600 hover:underline" onClick={onMerge}>
            รวมรายการ
          </button>
        )}
        {totalItems === 0 && (
          <button type="button" className="text-red-600 hover:underline" onClick={onDelete}>
            ลบรายการ
          </button>
        )}
      </div>
      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {items.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">ไม่มีชิ้นที่แสดง</li>}
          {items.map((it) => {
            const detail = statusDetailText(kind, it.status, it.statusParty, it.statusDate);
            const overdue =
              it.status === "loaned" && it.statusDate && it.statusDate < toLocalDateString(new Date());
            return (
              <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-orange-500"
                  checked={selected.has(it.id)}
                  onChange={(e) => onSelect([it.id], e.target.checked)}
                  aria-label={`เลือก ${it.code}`}
                />
                <div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-x-4 gap-y-1 text-sm md:grid-cols-[6.5rem_minmax(0,1fr)_6.5rem_7rem_minmax(0,1.3fr)_auto]">
                  <Link href={`${base}/item/${it.id}`} className="font-mono font-semibold text-orange-600 hover:underline">
                    {it.code}
                  </Link>
                  <span className="truncate text-right text-gray-700 md:text-left" title={it.serialNumber}>
                    {it.serialNumber ? `S/N ${it.serialNumber}` : <span className="text-gray-300">ไม่มีซีเรียล</span>}
                  </span>
                  <span className="text-gray-500">{formatDisplayDate(it.purchaseDate)}</span>
                  <span className="text-right font-semibold text-gray-800 md:text-left">{formatBaht(it.price)}</span>
                  <span className="col-span-2 truncate text-gray-500 md:col-span-1" title={[it.location, it.supplierName].filter(Boolean).join(" · ")}>
                    {[it.location && `📍 ${it.location}`, it.supplierName && `🏭 ${it.supplierName}`].filter(Boolean).join("  ") || (
                      <span className="text-gray-300">—</span>
                    )}
                  </span>
                  <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:justify-end">
                    <button type="button" onClick={() => onStatus(it)} title="เปลี่ยนสถานะ" className="rounded-full focus:outline-none focus:ring-2 focus:ring-orange-200">
                      <StatusBadge kind={kind} status={it.status} className="cursor-pointer hover:brightness-95" />
                    </button>
                    {detail && (
                      <span className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-gray-500"}`}>
                        {detail}
                        {overdue && " (เลยกำหนด)"}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

