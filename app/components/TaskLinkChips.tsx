"use client";

/**
 * TaskLinkChips — the link chips on a task card of the manual task board
 * (`/crm/alerts`). Tasks 13.1-13.5, 13.7.
 *
 * A task links to customers / sold machines / quotations / documents through
 * `task_links`, which has NO foreign keys: quotations are purged on their own
 * 2-year retention schedule and a customer can be deleted, so a link is a soft
 * reference and its target may simply be gone. This file owns everything that
 * follows from that:
 *
 *   • the shared, module-level loader for the four target directories, so
 *     liveness is resolved with ONE request per KIND for the whole page — never
 *     one per chip (task 13.5). Every chip on every card, plus the link picker
 *     in TaskFormModal, read the same cache and share the same in-flight
 *     promise.
 *   • `resolveTaskLinkChip()` — the pure "is this target still there?" verdict
 *     (task 13.2). Exported so it can be unit-tested without rendering.
 * The destinations themselves (task 13.1, incl. the READ-ONLY `view=1` for a
 * quotation — task 13.4) come from `taskLinkHref()` in `app/lib/taskBoard.ts`,
 * shared with the board's own cards so the two can never drift apart.
 *
 * Display rule (spec: crm-task-board): show the target's CURRENT name while it
 * still exists — a customer renamed after the link was made reads with the new
 * name — and fall back to the `label` SNAPSHOT stored on the link row only when
 * the target can no longer be found. A dead target renders as
 * "<label> (ถูกลบแล้ว)", dimmed and NOT clickable: it must never navigate to a
 * 404 or an empty page, and must never break the card around it (task 13.3).
 * Nothing here ever deletes a `task_links` row — a dead link's label is the
 * only surviving evidence of what the task referred to, and only the admin
 * removes it (task 13.7, via TaskFormModal).
 *
 * Four chip states, so the UI never claims a deletion it did not verify — the
 * same distinction `SalesTable`'s "ใบเสนอราคาถูกลบแล้ว" button already draws:
 *   live        a loaded directory contains this id → clickable. A directory
 *               whose REFRESH failed still counts here for an id its last good
 *               load held: the evidence is stale, not absent, and one failed
 *               poll must not deaden every chip on the board.
 *   missing     the directory loaded, is complete, and does NOT contain it
 *               → "(ถูกลบแล้ว)", dimmed, inert
 *   checking    the directory is still loading → inert, no verdict shown
 *   unverified  the directory failed to load and never held this id, or came
 *               back capped so a missing id proves nothing → inert, labelled as
 *               a failed check rather than as a deletion
 *
 * Props
 * -----
 *   links        the task's `TaskLink[]` (`CrmTask.links`); null/empty renders
 *                `emptyText`, or nothing at all when that is omitted.
 *   navigable    default true. Pass false to render the chips as plain,
 *                non-navigating tags — TaskFormModal uses that for the links
 *                already picked in an open form.
 *   onRemove     when given, each chip gets a ✕ that calls back with that link.
 *                The caller decides what removal means (the form drops it from
 *                its draft); this component never writes anything.
 *   targets      normally omitted — the component subscribes to the shared
 *                loader itself. Pass a snapshot to drive it from your own
 *                subscription or from a test, which also suppresses fetching.
 *   size         "sm" (default) | "md".
 *   className    extra classes on the wrapping flex container.
 *   emptyText    Thai text shown when there are no links at all.
 */

import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  DELETED_TARGET_LABEL,
  TASK_LINK_TARGET_META,
  taskLinkHref,
} from "../lib/taskBoard";
import { TASK_LINK_TARGETS, type TaskLink, type TaskLinkTarget } from "../lib/types";

// ── Kind metadata ───────────────────────────────────────────────────────────

/**
 * The icon, the type name and the destination of every chip come from
 * `app/lib/taskBoard.ts` — the React-free helper layer the board section
 * already renders its own cards from. Keeping a second copy here is what would
 * eventually let a chip in the form disagree with the same chip on the card,
 * so this file adds only what taskBoard has no business knowing: Tailwind
 * classes, and the picker's own wording.
 */
export interface TaskLinkKindMeta {
  /** Emoji icon, shared with the board's cards. */
  icon: string;
  /** Thai name of the kind, used in titles and error messages. */
  label: string;
  /**
   * Wording of the kind SELECTOR (task 12.4: ลูกค้า / เครื่องที่ขายแล้ว /
   * ใบเสนอราคา / เอกสาร). It is spelled out more fully than the chip's
   * `label`, because the picker has to say which of the four registries the
   * admin is about to search rather than name an already-picked record.
   */
  pickerLabel: string;
  /** Static Tailwind classes (never interpolated — Tailwind must see them). */
  chipClass: string;
  hoverClass: string;
}

const KIND_STYLE: Record<
  TaskLinkTarget,
  { pickerLabel: string; chipClass: string; hoverClass: string }
> = {
  customer: {
    pickerLabel: "ลูกค้า",
    chipClass: "bg-sky-50 text-sky-700 border-sky-200",
    hoverClass: "hover:bg-sky-100 hover:border-sky-300",
  },
  equipment: {
    pickerLabel: "เครื่องที่ขายแล้ว",
    chipClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    hoverClass: "hover:bg-emerald-100 hover:border-emerald-300",
  },
  quotation: {
    pickerLabel: "ใบเสนอราคา",
    chipClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    hoverClass: "hover:bg-indigo-100 hover:border-indigo-300",
  },
  document: {
    pickerLabel: "เอกสาร",
    chipClass: "bg-amber-50 text-amber-700 border-amber-200",
    hoverClass: "hover:bg-amber-100 hover:border-amber-300",
  },
};

export const TASK_LINK_KIND_META: Record<TaskLinkTarget, TaskLinkKindMeta> =
  Object.fromEntries(
    TASK_LINK_TARGETS.map((kind) => [
      kind,
      { ...TASK_LINK_TARGET_META[kind], ...KIND_STYLE[kind] },
    ])
  ) as Record<TaskLinkTarget, TaskLinkKindMeta>;

export function isTaskLinkTarget(value: unknown): value is TaskLinkTarget {
  return (TASK_LINK_TARGETS as readonly string[]).includes(String(value));
}

// Destinations (task 13.1) live in `taskBoard.taskLinkHref`:
//   customer   → /customers?tab=customers&customerId=<customers.id>
//   equipment  → /customers?tab=equipments&equipmentId=<customer_equipments.id>
//   quotation  → /quotation?id=<quotations.id>&view=1   (READ-ONLY, task 13.4)
//   document   → /document/<documents.id>
// Every id is a STABLE id — never a `docNo`, which the admin can edit and which
// is rewritten when a quotation is cloned — so a link keeps pointing at the
// same record forever.

// ── Label snapshots ─────────────────────────────────────────────────────────

/** The row fields each kind's label is built from (a superset of all four). */
export interface TaskLinkLabelSource {
  name?: string | null;
  companyName?: string | null;
  productName?: string | null;
  serialNumber?: string | null;
  docNo?: string | null;
  title?: string | null;
}

/**
 * Mirrors `buildLinkLabel()` in `app/lib/taskStore.ts` — the same wording, kept
 * here because that module reaches the database and must never be pulled into a
 * client bundle. Whatever this returns is BOTH what the picker shows and what
 * is snapshotted into `task_links.label`, so the chip that survives a purge
 * reads exactly like the row the admin picked (task 12.7).
 */
export function buildTaskLinkLabel(
  targetType: TaskLinkTarget,
  source: TaskLinkLabelSource
): string {
  const text = (value: string | null | undefined) => String(value ?? "").trim();
  let label = "";
  switch (targetType) {
    case "customer": {
      const name = text(source.name);
      const company = text(source.companyName);
      label = company ? (name ? `${name} (${company})` : company) : name;
      break;
    }
    case "equipment": {
      const product = text(source.productName);
      const serial = text(source.serialNumber);
      label = serial ? (product ? `${product} (S/N ${serial})` : `S/N ${serial}`) : product;
      break;
    }
    case "quotation":
      label = text(source.docNo);
      break;
    case "document":
      label = text(source.title);
      break;
  }
  return label.substring(0, 255);
}

// ── Shared target directories (one request per kind, page-wide) ─────────────

export interface TaskLinkTargetOption {
  /** The STABLE id stored in `task_links.targetId`. */
  id: string;
  /** Current display name — also the snapshot taken when this row is picked. */
  label: string;
  /** Extra disambiguating text for the picker only; never snapshotted. */
  subLabel?: string;
}

export type TaskLinkTargetStatus = "idle" | "loading" | "ready" | "error";

export interface TaskLinkTargetKindState {
  status: TaskLinkTargetStatus;
  /** Sorted as the endpoint returned them; safe to feed a dropdown directly. */
  options: TaskLinkTargetOption[];
  byId: ReadonlyMap<string, TaskLinkTargetOption>;
  /**
   * True when the endpoint may have capped its answer, so an id that is absent
   * proves nothing and must NOT be reported as deleted.
   */
  truncated: boolean;
  /** Thai message when the directory could not be loaded. */
  error: string | null;
}

export type TaskLinkTargetsSnapshot = Record<TaskLinkTarget, TaskLinkTargetKindState>;

const EMPTY_INDEX: ReadonlyMap<string, TaskLinkTargetOption> = new Map();

function idleKind(): TaskLinkTargetKindState {
  return { status: "idle", options: [], byId: EMPTY_INDEX, truncated: false, error: null };
}

/** Stable object for SSR + the initial client render (useSyncExternalStore). */
const INITIAL_SNAPSHOT: TaskLinkTargetsSnapshot = {
  customer: idleKind(),
  equipment: idleKind(),
  quotation: idleKind(),
  document: idleKind(),
};

interface KindSource {
  url: string;
  /**
   * The endpoint's own row cap, when it has one. `/api/quotations` answers at
   * most LIST_SAFETY_LIMIT (2000) rows, so a full page means "there may be
   * more" — the chips then say "ตรวจสอบไม่สำเร็จ" instead of "ถูกลบแล้ว".
   */
  cap?: number;
  toOptions: (rows: Record<string, unknown>[]) => TaskLinkTargetOption[];
}

const text = (value: unknown): string => String(value ?? "").trim();

/** Existing list endpoints only — this feature adds no search endpoints. */
const KIND_SOURCES: Record<TaskLinkTarget, KindSource> = {
  customer: {
    url: "/api/customers",
    toOptions: (rows) =>
      rows
        .map((r) => ({
          id: text(r.id),
          label: buildTaskLinkLabel("customer", {
            name: text(r.name),
            companyName: text(r.companyName),
          }),
          subLabel: [text(r.department), text(r.phone)].filter(Boolean).join(" · ") || undefined,
        }))
        .filter((o) => o.id !== ""),
  },
  equipment: {
    url: "/api/admin/equipments",
    toOptions: (rows) =>
      rows
        .map((r) => ({
          id: text(r.id),
          label: buildTaskLinkLabel("equipment", {
            productName: text(r.productName),
            serialNumber: text(r.serialNumber),
          }),
          subLabel:
            [text(r.customerName), text(r.companyName)].filter(Boolean).join(" · ") || undefined,
        }))
        .filter((o) => o.id !== ""),
  },
  quotation: {
    url: "/api/quotations",
    cap: 2000,
    toOptions: (rows) =>
      rows
        .map((r) => ({
          // targetId is quotations.id, NEVER docNo (task 12.6) — docNo is
          // editable and is rewritten when a quotation is cloned.
          id: text(r.id),
          label: buildTaskLinkLabel("quotation", { docNo: text(r.docNo) }),
          subLabel:
            [text(r.customer), text(r.createdAt).substring(0, 10)].filter(Boolean).join(" · ") ||
            undefined,
        }))
        .filter((o) => o.id !== ""),
  },
  document: {
    url: "/api/documents",
    toOptions: (rows) =>
      rows
        .map((r) => ({
          id: text(r.id),
          label: buildTaskLinkLabel("document", { title: text(r.title) }),
          subLabel: text(r.description).substring(0, 80) || undefined,
        }))
        .filter((o) => o.id !== ""),
  },
};

let snapshot: TaskLinkTargetsSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();
const inFlight = new Map<TaskLinkTarget, Promise<void>>();

function patchKind(kind: TaskLinkTarget, patch: Partial<TaskLinkTargetKindState>): void {
  snapshot = { ...snapshot, [kind]: { ...snapshot[kind], ...patch } };
  for (const listener of [...listeners]) listener();
}

function subscribeToTargets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getTargetsSnapshot(): TaskLinkTargetsSnapshot {
  return snapshot;
}

function getTargetsServerSnapshot(): TaskLinkTargetsSnapshot {
  return INITIAL_SNAPSHOT;
}

async function loadKind(kind: TaskLinkTarget): Promise<void> {
  const source = KIND_SOURCES[kind];
  patchKind(kind, { status: "loading", error: null });
  try {
    const res = await fetch(source.url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    const rows = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : Array.isArray((body as { items?: unknown })?.items)
        ? ((body as { items: Record<string, unknown>[] }).items)
        : null;
    if (!rows) throw new Error("unexpected response shape");
    const options = source.toOptions(rows);
    patchKind(kind, {
      status: "ready",
      options,
      byId: new Map(options.map((o) => [o.id, o])),
      truncated: source.cap != null && rows.length >= source.cap,
      error: null,
    });
  } catch {
    // Keep whatever was loaded before — a failed refresh must not empty the
    // picker — but stop answering "deleted" for anything (see resolve below).
    patchKind(kind, {
      status: "error",
      error: `โหลดรายการ${TASK_LINK_KIND_META[kind].pickerLabel}ไม่สำเร็จ`,
    });
  } finally {
    inFlight.delete(kind);
  }
}

function startLoad(kind: TaskLinkTarget): Promise<void> {
  const existing = inFlight.get(kind);
  if (existing) return existing;
  const promise = loadKind(kind);
  inFlight.set(kind, promise);
  return promise;
}

/** Load the given kinds once. Repeated calls while a request is in flight, or
 * after it succeeded, do nothing — this is what keeps N chips to 1 request. */
export function ensureTaskLinkTargets(kinds: readonly TaskLinkTarget[]): void {
  for (const kind of kinds) {
    if (snapshot[kind].status === "idle") void startLoad(kind);
  }
}

/** Explicit retry ("ลองใหม่") and post-save refresh. */
export function reloadTaskLinkTargets(
  kinds: readonly TaskLinkTarget[] = TASK_LINK_TARGETS
): void {
  for (const kind of kinds) void startLoad(kind);
}

/** Test seam: drops the module-level cache back to its initial state. */
export function __resetTaskLinkTargets(): void {
  snapshot = INITIAL_SNAPSHOT;
  inFlight.clear();
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to the shared directories, loading `kinds` on mount. Pass only the
 * kinds you actually need — a card with no equipment chip never asks
 * `/api/admin/equipments` for anything.
 */
export function useTaskLinkTargets(
  kinds: readonly TaskLinkTarget[] = TASK_LINK_TARGETS
): TaskLinkTargetsSnapshot {
  const snap = useSyncExternalStore(
    subscribeToTargets,
    getTargetsSnapshot,
    getTargetsServerSnapshot
  );
  // Join to a primitive so a fresh array literal on every render does not
  // re-run the effect.
  const key = kinds.join(",");
  useEffect(() => {
    ensureTaskLinkTargets(key ? (key.split(",") as TaskLinkTarget[]) : []);
  }, [key]);
  return snap;
}

// ── Chip resolution (pure) ──────────────────────────────────────────────────

export type TaskLinkChipStatus = "live" | "missing" | "checking" | "unverified";

export interface ResolvedTaskLinkChip {
  status: TaskLinkChipStatus;
  /** Never empty: current name → stored snapshot → "<kind> #id". */
  label: string;
  /** Destination, or null whenever the chip must not navigate. */
  href: string | null;
  /** Thai tooltip explaining a non-clickable chip; null when live. */
  note: string | null;
}

/**
 * Decide how one chip renders (task 13.2).
 *
 * Only a directory that loaded COMPLETELY is allowed to declare a target
 * deleted. Loading, a failed load, and a capped response all fall back to the
 * snapshot label WITHOUT the "ถูกลบแล้ว" badge — claiming a deletion we did not
 * verify would be worse than saying we could not check.
 */
export function resolveTaskLinkChip(
  link: Pick<TaskLink, "targetType" | "targetId" | "label">,
  kindState?: TaskLinkTargetKindState
): ResolvedTaskLinkChip {
  const kind = link.targetType;
  const kindLabel = TASK_LINK_KIND_META[kind]?.label ?? "ปลายทาง";
  const snapshotLabel = text(link.label);
  const targetId = text(link.targetId);
  const fallback = snapshotLabel || `${kindLabel} #${targetId}`;
  const state = kindState ?? snapshot[kind];
  const href = taskLinkHref(kind, targetId);

  if (state && state.status === "ready") {
    const current = state.byId.get(targetId);
    if (current) {
      return { status: "live", label: text(current.label) || fallback, href, note: null };
    }
    if (!state.truncated) {
      return {
        status: "missing",
        label: fallback,
        href: null,
        note: `${kindLabel}นี้${DELETED_TARGET_LABEL} จึงเปิดไม่ได้ (ลิงก์ยังเก็บไว้เป็นหลักฐาน ลบออกเองได้ในหน้าแก้ไขงาน)`,
      };
    }
    return {
      status: "unverified",
      label: fallback,
      href: null,
      note: "รายการปลายทางยาวเกินกว่าจะตรวจได้ครบ จึงยังยืนยันไม่ได้ว่ายังอยู่หรือไม่",
    };
  }

  if (state && state.status === "error") {
    // A failed REFRESH keeps whatever the last good load held (see loadKind),
    // and a target that was there then is still worth opening — the page at the
    // other end copes with an id that has since gone. Only a target we have
    // never seen stays inert: without evidence, a click could land nowhere.
    const stale = state.byId.get(targetId);
    if (stale) {
      return {
        status: "live",
        label: text(stale.label) || fallback,
        href,
        note: `ตรวจสอบ${kindLabel}ล่าสุดไม่สำเร็จ ชื่อที่เห็นอาจไม่ใช่ล่าสุด`,
      };
    }
    return {
      status: "unverified",
      label: fallback,
      href: null,
      note: "ตรวจสอบปลายทางไม่สำเร็จ จึงยังเปิดไม่ได้ในตอนนี้",
    };
  }

  return {
    status: "checking",
    label: fallback,
    href: null,
    note: "กำลังตรวจสอบว่าปลายทางยังอยู่หรือไม่...",
  };
}

/** Kinds actually referenced by a link set — what to load, nothing more. */
export function taskLinkKinds(links: readonly TaskLink[] | null | undefined): TaskLinkTarget[] {
  const seen = new Set<TaskLinkTarget>();
  for (const link of links ?? []) {
    if (isTaskLinkTarget(link?.targetType)) seen.add(link.targetType);
  }
  return TASK_LINK_TARGETS.filter((kind) => seen.has(kind));
}

/** Drop malformed rows and repeats of the same (kind, id) pair. */
function usableLinks(links: readonly TaskLink[] | null | undefined): TaskLink[] {
  const out: TaskLink[] = [];
  const seen = new Set<string>();
  for (const link of links ?? []) {
    if (!link || !isTaskLinkTarget(link.targetType)) continue;
    const id = text(link.targetId);
    if (!id) continue;
    const key = `${link.targetType}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

// ── Component ───────────────────────────────────────────────────────────────

export interface TaskLinkChipsProps {
  links: TaskLink[] | null | undefined;
  navigable?: boolean;
  onRemove?: (link: TaskLink) => void;
  targets?: TaskLinkTargetsSnapshot;
  size?: "sm" | "md";
  className?: string;
  emptyText?: string;
}

export default function TaskLinkChips({
  links,
  navigable = true,
  onRemove,
  targets,
  size = "sm",
  className = "",
  emptyText,
}: TaskLinkChipsProps) {
  const chipLinks = useMemo(() => usableLinks(links), [links]);
  // When the caller hands in a snapshot it owns the loading; asking for no
  // kinds keeps this component from firing requests of its own.
  const kinds = useMemo(
    () => (targets ? [] : taskLinkKinds(chipLinks)),
    [targets, chipLinks]
  );
  const loaded = useTaskLinkTargets(kinds);
  const snap = targets ?? loaded;

  if (chipLinks.length === 0) {
    return emptyText ? <p className="text-xs text-gray-400">{emptyText}</p> : null;
  }

  const sizeClass = size === "md" ? "text-sm px-3 py-1.5" : "text-xs px-2.5 py-1";

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {chipLinks.map((link) => {
        const meta = TASK_LINK_KIND_META[link.targetType];
        const chip = resolveTaskLinkChip(link, snap[link.targetType]);
        const base = `inline-flex items-center gap-1.5 rounded-full border font-medium max-w-full transition-colors ${sizeClass}`;
        const title = chip.note
          ? `${meta.label}: ${chip.label} — ${chip.note}`
          : `${meta.label}: ${chip.label}`;
        const body = (
          <>
            <span aria-hidden="true">{meta.icon}</span>
            <span className="truncate">{chip.label}</span>
            {chip.status === "missing" && (
              <span className="shrink-0 font-semibold text-rose-500">
                ({DELETED_TARGET_LABEL})
              </span>
            )}
          </>
        );

        const clickable = navigable && chip.status === "live" && chip.href !== null;

        return (
          <span key={`${link.targetType}:${link.targetId}`} className="inline-flex max-w-full items-center">
            {clickable ? (
              <Link
                href={chip.href as string}
                prefetch={false}
                title={title}
                className={`${base} ${meta.chipClass} ${meta.hoverClass} ${
                  onRemove ? "rounded-r-none border-r-0" : ""
                }`}
              >
                {body}
              </Link>
            ) : (
              <span
                title={title}
                aria-disabled={chip.status !== "live" ? true : undefined}
                className={`${base} ${
                  chip.status === "live"
                    ? meta.chipClass
                    : "border-gray-200 bg-gray-50 text-gray-400"
                } ${chip.status !== "live" ? "cursor-not-allowed" : ""} ${
                  chip.status === "checking" ? "animate-pulse" : ""
                } ${onRemove ? "rounded-r-none border-r-0" : ""}`}
              >
                {body}
              </span>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(link)}
                title={`เอาลิงก์ "${chip.label}" ออกจากงานนี้`}
                aria-label={`เอาลิงก์ ${chip.label} ออกจากงานนี้`}
                className={`inline-flex items-center rounded-full rounded-l-none border border-l-0 border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-600 ${sizeClass}`}
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
