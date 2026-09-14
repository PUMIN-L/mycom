"use client";

/**
 * The task board's topic list (`task_topics`), loaded once and shared across
 * every caller for the whole browser session — spec: add-equipment-quick-
 * task-button.
 *
 * Two "สร้างสิ่งที่ต้องทำ" quick-create buttons need this list before they can
 * open `TaskFormModal` (a task with no active topic is refused by
 * `POST /api/admin/tasks`, so there is no honest "open now, fail later" path):
 * the one on the Viewing Customer modal (`/customers`) and the one on
 * `EquipmentDetailsModal` (opened from BOTH the "อุปกรณ์ที่ขาย" tab on
 * `/customers` and the equipment-scoped alert cards on `/crm/alerts`). Caching
 * this per-caller (as the customer button originally did, in its own page
 * state) would mean a THIRD near-identical copy of "fetch once, remember it"
 * the moment a third entry point needed it — this file is the one place
 * instead, mirroring the module-level cache `useTaskLinkTargets`
 * (`TaskLinkChips.tsx`) already uses for the four link-target directories.
 *
 * Deliberately NOT a React hook / `useSyncExternalStore` subscription: nothing
 * here needs to re-render reactively when the cache fills in elsewhere — each
 * caller awaits `ensureTaskTopicsLoaded()` inside its own click handler and
 * manages its own loading-spinner state around that await, exactly as before.
 * The only thing worth sharing across callers is the CACHE itself.
 */

import type { TaskTopic } from "../lib/types";

type Status = "idle" | "loading" | "ready" | "error";

interface State {
  status: Status;
  /** Non-null only once a load has SUCCEEDED at least once. */
  topics: TaskTopic[] | null;
}

let state: State = { status: "idle", topics: null };
/** Dedupes concurrent callers (e.g. two buttons clicked in quick succession
 *  across two open tabs of the same session) onto ONE request. */
let inFlight: Promise<TaskTopic[] | null> | null = null;

async function load(): Promise<TaskTopic[] | null> {
  state = { status: "loading", topics: null };
  try {
    // No `includeHidden` — a task can only be filed under a topic that is
    // still offered, so hidden ones have no place in this list (matching the
    // customer button's original reasoning).
    const res = await fetch("/api/admin/task-topics");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    const topics = Array.isArray(body) ? (body as TaskTopic[]) : [];
    state = { status: "ready", topics };
    return topics;
  } catch {
    // Deliberately NOT "error, topics: []" — that would be indistinguishable
    // from a genuinely empty topic list and would stop a later click from
    // ever retrying. Falling back to `idle` is what makes the next call try
    // again instead of remembering this failure forever.
    state = { status: "idle", topics: null };
    return null;
  } finally {
    inFlight = null;
  }
}

/**
 * Load the topic list if it has not been loaded yet this session, or return
 * the cached one. Concurrent/repeated calls while a load is in flight, or
 * after one has already succeeded, never issue a second request.
 *
 * Resolves to `null` on failure — the caller is responsible for telling the
 * admin (in whatever way its own screen already reports errors: a toast on
 * `/customers`, `alert()` inside `EquipmentDetailsModal`) and for NOT opening
 * a create-task form with nothing to file the task under.
 */
export async function ensureTaskTopicsLoaded(): Promise<TaskTopic[] | null> {
  if (state.status === "ready") return state.topics;
  if (inFlight) return inFlight;
  inFlight = load();
  return inFlight;
}

/** Test seam: drops the module-level cache back to its initial state. */
export function __resetTaskTopics(): void {
  state = { status: "idle", topics: null };
  inFlight = null;
}
