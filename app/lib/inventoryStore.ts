import "server-only";
import type { RowDataPacket } from "mysql2";
import { query, withTransaction } from "./db";
import { sanitizePlainText } from "./sanitizeHtml";
import { isValidDateString } from "./dateFormat";
import { parseNonNegativeMoney } from "./moneyAmount";
import {
  INVENTORY_KINDS,
  type InventoryKind,
  type InventoryGroup,
  type InventoryItem,
  type InventoryEvent,
  type InventoryEventType,
} from "./types";
import {
  inventoryStatus,
  defaultInventoryStatus,
  formatInventoryCode,
  statusDetailText,
  MAX_ITEMS_PER_ADD,
  MAX_ITEMS_PER_BULK,
} from "./inventoryStatus";

// The asset register (/assets) and stock (/stock): groups (a model of thing)
// holding items (one physical piece each), with a timeline per item.
// Spec: openspec/changes/add-inventory-tracking.
//
// Both registers live in the same tables, told apart by `kind`. Keeping them
// apart is this module's job: every statement filters on kind, an item only
// joins a group of its own kind, and each kind has its own code counter.
// There are no foreign keys (like the task board): a group is deleted only
// when empty, an item's events are written and deleted in the item's own
// transaction, and supplierId is a soft link — a deleted supplier leaves the
// name the item carries.
//
// Lock order, so two transactions never wait on each other in a circle:
// group rows first (ascending id), then item rows.

export type { InventoryKind, InventoryGroup, InventoryItem, InventoryEvent } from "./types";

/** Bad input. Routes answer 400 with `message` (Thai) as-is. */
export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

/** The group or item is not there — or belongs to the other register. */
export class InventoryNotFoundError extends Error {
  constructor(message = "ไม่พบข้อมูลนี้ อาจถูกลบไปแล้ว") {
    super(message);
    this.name = "InventoryNotFoundError";
  }
}

/** deleteGroup() on a group that still holds items. */
export class GroupNotEmptyError extends Error {
  constructor(public readonly itemCount: number) {
    super(`รายการนี้ยังมี ${itemCount} ชิ้น ลบไม่ได้ — ลบหรือย้ายชิ้นออกก่อน หรือใช้ "รวมรายการ"`);
    this.name = "GroupNotEmptyError";
  }
}

export function isInventoryKind(value: unknown): value is InventoryKind {
  return (INVENTORY_KINDS as readonly unknown[]).includes(value);
}

/** Structural shape of the connection a withTransaction callback receives. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxConn = { query: (sql: string, params?: unknown[]) => Promise<any> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ── Cleaning input ───────────────────────────────────────────────────────────

const TEXT_MAX = 255;
const NOTE_MAX = 5000;

function text(value: unknown, max = TEXT_MAX): string {
  if (value === null || value === undefined) return "";
  return sanitizePlainText(String(value)).trim().substring(0, max);
}

function requiredText(value: unknown, label: string): string {
  const v = text(value);
  if (!v) throw new InventoryValidationError(`กรุณาระบุ${label}`);
  return v;
}

/** YYYY-MM-DD, or null when empty (and allowed to be). */
function dateOrNull(value: unknown, label: string, required: boolean): string | null {
  const v = text(value, 20);
  if (!v) {
    if (required) throw new InventoryValidationError(`กรุณาระบุ${label}`);
    return null;
  }
  if (!isValidDateString(v)) {
    throw new InventoryValidationError(`${label}ต้องเป็นวันที่ในรูปแบบ YYYY-MM-DD`);
  }
  return v;
}

export interface InventoryGroupInput {
  name?: unknown;
  brand?: unknown;
  model?: unknown;
  category?: unknown;
  note?: unknown;
}

interface CleanGroup {
  name: string;
  brand: string;
  model: string;
  category: string;
  note: string;
}

function cleanGroup(input: InventoryGroupInput): CleanGroup {
  if (!input || typeof input !== "object") throw new InventoryValidationError("ข้อมูลรายการไม่ถูกต้อง");
  return {
    name: requiredText(input.name, "ชื่อรายการ"),
    brand: text(input.brand),
    model: text(input.model),
    category: text(input.category),
    note: text(input.note, NOTE_MAX),
  };
}

/** The fields of an item a caller may set. */
export const ITEM_FIELDS = [
  "serialNumber",
  "purchaseDate",
  "price",
  "supplierId",
  "supplierName",
  "location",
  "custodian",
  "warrantyUntil",
  "status",
  "statusParty",
  "statusDate",
  "note",
] as const;
type ItemField = (typeof ITEM_FIELDS)[number];
export type InventoryItemInput = Partial<Record<ItemField, unknown>>;

/** An item's fields, validated and ready to store. */
export interface CleanItemFields {
  serialNumber: string;
  purchaseDate: string;
  price: number;
  supplierId: string | null;
  supplierName: string;
  location: string;
  custodian: string;
  warrantyUntil: string | null;
  status: string;
  statusParty: string;
  statusDate: string | null;
  note: string;
}

/**
 * Validate an item's fields for `kind`. A status's extra fields are kept only
 * when the status uses them (cleared otherwise), and checked when it
 * requires them; custodian and warranty are kept for assets only.
 */
export function cleanItemFields(kind: InventoryKind, input: InventoryItemInput): CleanItemFields {
  if (!input || typeof input !== "object") throw new InventoryValidationError("ข้อมูลชิ้นไม่ถูกต้อง");

  const purchaseDate = dateOrNull(input.purchaseDate, "วันที่ซื้อ", true) as string;

  const parsedPrice = parseNonNegativeMoney(input.price);
  if (!parsedPrice.ok) throw new InventoryValidationError(`ราคา: ${parsedPrice.error}`);

  const status = text(input.status, 20);
  const def = inventoryStatus(kind, status);
  if (!def) throw new InventoryValidationError("สถานะไม่ถูกต้อง");

  let statusParty = "";
  if (def.party) {
    statusParty = def.party.required ? requiredText(input.statusParty, def.party.label) : text(input.statusParty);
  }
  let statusDate: string | null = null;
  if (def.date) {
    statusDate = dateOrNull(input.statusDate, def.date.label, def.date.required);
    if (statusDate && def.date.notBeforePurchase && statusDate < purchaseDate) {
      throw new InventoryValidationError(`${def.date.label}ต้องไม่ก่อนวันที่ซื้อ (${purchaseDate})`);
    }
  }

  return {
    serialNumber: text(input.serialNumber),
    purchaseDate,
    price: parsedPrice.amount,
    supplierId: text(input.supplierId) || null,
    supplierName: text(input.supplierName),
    location: text(input.location),
    custodian: kind === "asset" ? text(input.custodian) : "",
    warrantyUntil: kind === "asset" ? dateOrNull(input.warrantyUntil, "วันหมดประกัน", false) : null,
    status,
    statusParty,
    statusDate,
    note: text(input.note, NOTE_MAX),
  };
}

/**
 * What an item becomes when `patch` is laid over it: the fields `patch`
 * carries replace the current ones. When the STATUS changes, its extra fields
 * come from `patch` alone — the old status's borrower must not become the new
 * status's "reserved for" because the caller did not resend it.
 */
export function mergeItemPatch(current: CleanItemFields, patch: InventoryItemInput): InventoryItemInput {
  const merged: InventoryItemInput = { ...current };
  for (const key of ITEM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) merged[key] = patch[key];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "status") && text(patch.status, 20) !== current.status) {
    merged.statusParty = Object.prototype.hasOwnProperty.call(patch, "statusParty") ? patch.statusParty : "";
    merged.statusDate = Object.prototype.hasOwnProperty.call(patch, "statusDate") ? patch.statusDate : null;
  }
  return merged;
}

interface EventDraft {
  eventType: InventoryEventType;
  fromValue: string;
  toValue: string;
  detail: string;
}

/** The timeline lines a change from `before` to `after` writes. */
export function itemChangeEvents(kind: InventoryKind, before: CleanItemFields, after: CleanItemFields): EventDraft[] {
  const events: EventDraft[] = [];
  if (
    before.status !== after.status ||
    before.statusParty !== after.statusParty ||
    before.statusDate !== after.statusDate
  ) {
    events.push({
      eventType: "status",
      fromValue: before.status,
      toValue: after.status,
      detail: statusDetailText(kind, after.status, after.statusParty, after.statusDate),
    });
  }
  if (before.location !== after.location) {
    events.push({ eventType: "location", fromValue: before.location, toValue: after.location, detail: "" });
  }
  return events;
}

/** "เครื่องชั่ง Ohaus Y" — how a group is named in the timeline. */
function groupLabel(g: { name: string; brand: string; model: string }): string {
  return [g.name, g.brand, g.model].filter(Boolean).join(" ").substring(0, TEXT_MAX);
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function rowToGroup(r: Row): InventoryGroup {
  return {
    id: String(r.id),
    kind: r.kind,
    name: r.name ?? "",
    brand: r.brand ?? "",
    model: r.model ?? "",
    category: r.category ?? "",
    note: r.note ?? "",
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function rowToItem(r: Row): InventoryItem {
  return {
    id: String(r.id),
    kind: r.kind,
    groupId: String(r.groupId),
    code: r.code,
    seq: Number(r.seq),
    serialNumber: r.serialNumber ?? "",
    purchaseDate: r.purchaseDate,
    price: Number(r.price),
    supplierId: r.supplierId ?? null,
    // The linked supplier's CURRENT name while it exists (see ITEM_SELECT).
    supplierName: r.supplierCurrentName ?? r.supplierName ?? "",
    location: r.location ?? "",
    custodian: r.custodian ?? "",
    warrantyUntil: r.warrantyUntil ?? null,
    status: r.status,
    statusParty: r.statusParty ?? "",
    statusDate: r.statusDate ?? null,
    note: r.note ?? "",
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** The stored fields of an item row, as cleanItemFields returns them. */
function rowToFields(r: Row): CleanItemFields {
  return {
    serialNumber: r.serialNumber ?? "",
    purchaseDate: r.purchaseDate,
    price: Number(r.price),
    supplierId: r.supplierId ?? null,
    supplierName: r.supplierName ?? "",
    location: r.location ?? "",
    custodian: r.custodian ?? "",
    warrantyUntil: r.warrantyUntil ?? null,
    status: r.status,
    statusParty: r.statusParty ?? "",
    statusDate: r.statusDate ?? null,
    note: r.note ?? "",
  };
}

function rowToEvent(r: Row): InventoryEvent {
  return {
    id: String(r.id),
    itemId: String(r.itemId),
    eventType: r.eventType,
    fromValue: r.fromValue ?? "",
    toValue: r.toValue ?? "",
    detail: r.detail ?? "",
    createdAt: r.createdAt,
  };
}

const ITEM_SELECT = `SELECT i.*, s.companyName AS supplierCurrentName
  FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplierId`;

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/**
 * A supplier picked from the list is stored with its id AND its name at the
 * time (what the item shows if the supplier is deleted later). An id that is
 * not a supplier — deleted in another tab — is dropped; the name stays.
 */
async function resolveSupplier(conn: TxConn, fields: CleanItemFields): Promise<CleanItemFields> {
  if (!fields.supplierId) return fields;
  const [rows] = await conn.query("SELECT companyName FROM suppliers WHERE id = ?", [fields.supplierId]);
  if (rows.length === 0) return { ...fields, supplierId: null };
  return { ...fields, supplierName: text(rows[0].companyName) || fields.supplierName };
}

async function insertEvents(
  conn: TxConn,
  kind: InventoryKind,
  rows: Array<EventDraft & { itemId: string }>,
  now: string
): Promise<void> {
  if (rows.length === 0) return;
  const params: unknown[] = [];
  for (const e of rows) {
    params.push(
      crypto.randomUUID(),
      e.itemId,
      kind,
      e.eventType,
      e.fromValue.substring(0, TEXT_MAX),
      e.toValue.substring(0, TEXT_MAX),
      e.detail.substring(0, 500),
      now
    );
  }
  await conn.query(
    `INSERT INTO inventory_events (id, itemId, kind, eventType, fromValue, toValue, detail, createdAt) VALUES ${rows
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ")}`,
    params
  );
}

async function lockGroup(conn: TxConn, kind: InventoryKind, id: string): Promise<Row | null> {
  const [rows] = await conn.query("SELECT * FROM inventory_groups WHERE id = ? AND kind = ? FOR UPDATE", [id, kind]);
  return rows[0] ?? null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Every group and item of one register (no timelines — see getItem). */
export async function listInventory(kind: InventoryKind): Promise<{ groups: InventoryGroup[]; items: InventoryItem[] }> {
  const [groupRows] = await query<RowDataPacket[]>("SELECT * FROM inventory_groups WHERE kind = ? ORDER BY name", [kind]);
  const [itemRows] = await query<RowDataPacket[]>(`${ITEM_SELECT} WHERE i.kind = ? ORDER BY i.seq DESC`, [kind]);
  return { groups: groupRows.map(rowToGroup), items: itemRows.map(rowToItem) };
}

/** One item with its group and its timeline (newest first), or null. */
export async function getItem(
  kind: InventoryKind,
  id: string
): Promise<{ item: InventoryItem; group: InventoryGroup | null; events: InventoryEvent[] } | null> {
  const [itemRows] = await query<RowDataPacket[]>(`${ITEM_SELECT} WHERE i.id = ? AND i.kind = ?`, [id, kind]);
  if (itemRows.length === 0) return null;
  const item = rowToItem(itemRows[0]);
  const [groupRows] = await query<RowDataPacket[]>("SELECT * FROM inventory_groups WHERE id = ? AND kind = ?", [item.groupId, kind]);
  const [eventRows] = await query<RowDataPacket[]>(
    "SELECT * FROM inventory_events WHERE itemId = ? ORDER BY createdAt DESC",
    [id]
  );
  return {
    item,
    group: groupRows[0] ? rowToGroup(groupRows[0]) : null,
    events: eventRows.map(rowToEvent),
  };
}

// ── Groups ───────────────────────────────────────────────────────────────────

export async function createGroup(kind: InventoryKind, input: InventoryGroupInput): Promise<InventoryGroup> {
  const g = cleanGroup(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await query(
    "INSERT INTO inventory_groups (id, kind, name, brand, model, category, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, kind, g.name, g.brand, g.model, g.category, g.note, now, now]
  );
  return { id, kind, ...g, createdAt: now, updatedAt: now };
}

export async function updateGroup(kind: InventoryKind, id: string, input: InventoryGroupInput): Promise<InventoryGroup> {
  const g = cleanGroup(input);
  const now = new Date().toISOString();
  return withTransaction(async (conn: TxConn) => {
    const current = await lockGroup(conn, kind, id);
    if (!current) throw new InventoryNotFoundError("ไม่พบรายการนี้ อาจถูกลบไปแล้ว");
    await conn.query(
      "UPDATE inventory_groups SET name = ?, brand = ?, model = ?, category = ?, note = ?, updatedAt = ? WHERE id = ? AND kind = ?",
      [g.name, g.brand, g.model, g.category, g.note, now, id, kind]
    );
    return { ...rowToGroup(current), ...g, updatedAt: now };
  });
}

/** Delete an EMPTY group. One that still holds items is refused. */
export async function deleteGroup(kind: InventoryKind, id: string): Promise<void> {
  await withTransaction(async (conn: TxConn) => {
    if (!(await lockGroup(conn, kind, id))) throw new InventoryNotFoundError("ไม่พบรายการนี้ อาจถูกลบไปแล้ว");
    // A LOCKING read: it sees an item another transaction has just added,
    // where a plain snapshot read could miss it and orphan that item.
    const [items] = await conn.query("SELECT id FROM inventory_items WHERE groupId = ? FOR UPDATE", [id]);
    if (items.length > 0) throw new GroupNotEmptyError(items.length);
    await conn.query("DELETE FROM inventory_groups WHERE id = ? AND kind = ?", [id, kind]);
  });
}

/**
 * Move every item of group `fromId` into `intoId` (same register), noting the
 * move on each item's timeline, then delete `fromId` — for a model that was
 * created twice. All or nothing.
 */
export async function mergeGroups(
  kind: InventoryKind,
  fromId: string,
  intoId: string
): Promise<{ moved: number; group: InventoryGroup }> {
  if (!intoId || typeof intoId !== "string") throw new InventoryValidationError("กรุณาเลือกรายการที่จะรวมเข้าไป");
  if (fromId === intoId) throw new InventoryValidationError("รวมรายการเข้ากับตัวเองไม่ได้");
  const now = new Date().toISOString();
  return withTransaction(async (conn: TxConn) => {
    const locked: Record<string, Row | null> = {};
    for (const id of [fromId, intoId].sort()) locked[id] = await lockGroup(conn, kind, id);
    const from = locked[fromId];
    const into = locked[intoId];
    if (!from) throw new InventoryNotFoundError("ไม่พบรายการนี้ อาจถูกลบไปแล้ว");
    if (!into) throw new InventoryValidationError("ไม่พบรายการที่จะรวมเข้าไป กรุณาเลือกใหม่");

    const [items] = await conn.query("SELECT id FROM inventory_items WHERE groupId = ? AND kind = ? FOR UPDATE", [
      fromId,
      kind,
    ]);
    if (items.length > 0) {
      await conn.query("UPDATE inventory_items SET groupId = ?, updatedAt = ? WHERE groupId = ? AND kind = ?", [
        intoId,
        now,
        fromId,
        kind,
      ]);
      await insertEvents(
        conn,
        kind,
        items.map((r: Row) => ({
          itemId: String(r.id),
          eventType: "group" as const,
          fromValue: groupLabel(rowToGroup(from)),
          toValue: groupLabel(rowToGroup(into)),
          detail: "",
        })),
        now
      );
    }
    await conn.query("DELETE FROM inventory_groups WHERE id = ? AND kind = ?", [fromId, kind]);
    return { moved: items.length, group: rowToGroup(into) };
  });
}

// ── Items ────────────────────────────────────────────────────────────────────

export interface AddItemsInput extends InventoryItemInput {
  /** An existing group of this register… */
  groupId?: unknown;
  /** …or a new one, created in the same transaction. */
  group?: InventoryGroupInput;
  quantity?: unknown;
  /** One per piece, in order; fewer than `quantity` (or blanks) is fine. */
  serials?: unknown;
}

/**
 * Add 1–MAX_ITEMS_PER_ADD pieces sharing the same fields, each with its own
 * code and serial, to an existing group or a new one. The group, the pieces,
 * their codes and their "received" timeline lines land together or not at all.
 */
export async function addItems(
  kind: InventoryKind,
  input: AddItemsInput
): Promise<{ group: InventoryGroup; items: InventoryItem[] }> {
  if (!input || typeof input !== "object") throw new InventoryValidationError("ข้อมูลไม่ถูกต้อง");
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEMS_PER_ADD) {
    throw new InventoryValidationError(`จำนวนต้องเป็น 1–${MAX_ITEMS_PER_ADD} ชิ้น`);
  }
  const rawSerials = Array.isArray(input.serials) ? input.serials : [];
  if (rawSerials.length > quantity) throw new InventoryValidationError("ใส่ซีเรียลเกินจำนวนชิ้น");
  const serials = Array.from({ length: quantity }, (_, i) => text(rawSerials[i]));

  const groupId = typeof input.groupId === "string" && input.groupId ? input.groupId : null;
  const newGroup = groupId ? null : cleanGroup(input.group ?? {});
  const baseFields = cleanItemFields(kind, { ...input, status: input.status ?? defaultInventoryStatus(kind) });
  const now = new Date().toISOString();

  return withTransaction(async (conn: TxConn) => {
    let group: InventoryGroup;
    if (groupId) {
      const row = await lockGroup(conn, kind, groupId);
      if (!row) throw new InventoryValidationError("ไม่พบรายการที่เลือก อาจถูกลบไปแล้ว กรุณาเลือกใหม่");
      group = rowToGroup(row);
    } else {
      const g = newGroup as CleanGroup;
      group = { id: crypto.randomUUID(), kind, ...g, createdAt: now, updatedAt: now };
      await conn.query(
        "INSERT INTO inventory_groups (id, kind, name, brand, model, category, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [group.id, kind, g.name, g.brand, g.model, g.category, g.note, now, now]
      );
    }

    const fields = await resolveSupplier(conn, baseFields);

    // Hand out `quantity` code numbers. The counter only ever goes up, so a
    // deleted item's code is never handed out again; starting past the
    // highest code in use as well means a lost counter row cannot hand out a
    // code that is already taken.
    await conn.query("INSERT IGNORE INTO inventory_counters (kind, lastNo) VALUES (?, 0)", [kind]);
    const [counterRows] = await conn.query("SELECT lastNo FROM inventory_counters WHERE kind = ? FOR UPDATE", [kind]);
    const [maxRows] = await conn.query("SELECT MAX(seq) AS maxSeq FROM inventory_items WHERE kind = ?", [kind]);
    const start = Math.max(Number(counterRows[0]?.lastNo) || 0, Number(maxRows[0]?.maxSeq) || 0);
    await conn.query("UPDATE inventory_counters SET lastNo = ? WHERE kind = ?", [start + quantity, kind]);

    const items: InventoryItem[] = serials.map((serialNumber, i) => {
      const seq = start + i + 1;
      return {
        id: crypto.randomUUID(),
        kind,
        groupId: group.id,
        code: formatInventoryCode(kind, seq),
        seq,
        ...fields,
        serialNumber,
        createdAt: now,
        updatedAt: now,
      };
    });

    const params: unknown[] = [];
    for (const it of items) {
      params.push(
        it.id, kind, it.groupId, it.code, it.seq, it.serialNumber, it.purchaseDate, it.price,
        it.supplierId, it.supplierName, it.location, it.custodian, it.warrantyUntil,
        it.status, it.statusParty, it.statusDate, it.note, now, now
      );
    }
    await conn.query(
      `INSERT INTO inventory_items (id, kind, groupId, code, seq, serialNumber, purchaseDate, price, supplierId, supplierName, location, custodian, warrantyUntil, status, statusParty, statusDate, note, createdAt, updatedAt) VALUES ${items
        .map(() => `(${placeholders(19)})`)
        .join(", ")}`,
      params
    );

    const receivedDetail = [
      fields.location ? `ที่เก็บ: ${fields.location}` : "",
      statusDetailText(kind, fields.status, fields.statusParty, fields.statusDate),
    ]
      .filter(Boolean)
      .join(" · ");
    await insertEvents(
      conn,
      kind,
      items.map((it) => ({ itemId: it.id, eventType: "created" as const, fromValue: "", toValue: it.status, detail: receivedDetail })),
      now
    );

    return { group, items };
  });
}

export interface UpdateItemInput extends InventoryItemInput {
  /** Move the piece to another group of the same register. */
  groupId?: unknown;
}

/**
 * Change an item: the fields `patch` carries are laid over the current ones
 * and the result is validated as a whole (a sale date is checked against the
 * purchase date even when only one of them changed). Status, place and group
 * changes go on the timeline in the same transaction.
 */
export async function updateItem(kind: InventoryKind, id: string, patch: UpdateItemInput): Promise<InventoryItem> {
  if (!patch || typeof patch !== "object") throw new InventoryValidationError("ข้อมูลไม่ถูกต้อง");
  const now = new Date().toISOString();

  const wantedGroup = typeof patch.groupId === "string" && patch.groupId ? patch.groupId : null;

  await withTransaction(async (conn: TxConn) => {
    // The group it may move into is locked BEFORE the item (lock order above).
    const into = wantedGroup ? await lockGroup(conn, kind, wantedGroup) : null;
    if (wantedGroup && !into) throw new InventoryValidationError("ไม่พบรายการที่จะย้ายไป กรุณาเลือกใหม่");

    const [rows] = await conn.query("SELECT * FROM inventory_items WHERE id = ? AND kind = ? FOR UPDATE", [id, kind]);
    if (rows.length === 0) throw new InventoryNotFoundError();
    const row = rows[0];
    const before = rowToFields(row);

    let after = cleanItemFields(kind, mergeItemPatch(before, patch));
    const supplierChanged =
      Object.prototype.hasOwnProperty.call(patch, "supplierId") || Object.prototype.hasOwnProperty.call(patch, "supplierName");
    if (supplierChanged) after = await resolveSupplier(conn, after);

    const events: Array<EventDraft & { itemId: string }> = itemChangeEvents(kind, before, after).map((e) => ({ ...e, itemId: id }));

    let groupId = String(row.groupId);
    if (wantedGroup && into && wantedGroup !== groupId) {
      const [fromRows] = await conn.query("SELECT * FROM inventory_groups WHERE id = ? AND kind = ?", [groupId, kind]);
      events.push({
        itemId: id,
        eventType: "group",
        fromValue: fromRows[0] ? groupLabel(rowToGroup(fromRows[0])) : "",
        toValue: groupLabel(rowToGroup(into)),
        detail: "",
      });
      groupId = wantedGroup;
    }

    await conn.query(
      `UPDATE inventory_items SET groupId = ?, serialNumber = ?, purchaseDate = ?, price = ?, supplierId = ?, supplierName = ?,
        location = ?, custodian = ?, warrantyUntil = ?, status = ?, statusParty = ?, statusDate = ?, note = ?, updatedAt = ?
       WHERE id = ? AND kind = ?`,
      [
        groupId, after.serialNumber, after.purchaseDate, after.price, after.supplierId, after.supplierName,
        after.location, after.custodian, after.warrantyUntil, after.status, after.statusParty, after.statusDate,
        after.note, now, id, kind,
      ]
    );
    await insertEvents(conn, kind, events, now);
  });

  const fresh = await getItem(kind, id);
  if (!fresh) throw new InventoryNotFoundError();
  return fresh.item;
}

/** Delete an item and its timeline. */
export async function deleteItem(kind: InventoryKind, id: string): Promise<void> {
  await withTransaction(async (conn: TxConn) => {
    const [rows] = await conn.query("SELECT id FROM inventory_items WHERE id = ? AND kind = ? FOR UPDATE", [id, kind]);
    if (rows.length === 0) throw new InventoryNotFoundError();
    await conn.query("DELETE FROM inventory_events WHERE itemId = ?", [id]);
    await conn.query("DELETE FROM inventory_items WHERE id = ? AND kind = ?", [id, kind]);
  });
}

export interface BulkUpdateInput {
  ids?: unknown;
  status?: unknown;
  statusParty?: unknown;
  statusDate?: unknown;
  location?: unknown;
}

/**
 * Give many items the same status (with its extra fields) and/or the same
 * place, each change on its item's timeline. Every item is checked first —
 * one that cannot take the change (a sale date before its purchase) refuses
 * the whole request, naming it, and nothing is written.
 */
export async function bulkUpdateItems(kind: InventoryKind, input: BulkUpdateInput): Promise<{ updated: number }> {
  if (!input || typeof input !== "object") throw new InventoryValidationError("ข้อมูลไม่ถูกต้อง");
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids.filter((v): v is string => typeof v === "string" && v !== ""))] : [];
  if (ids.length === 0) throw new InventoryValidationError("กรุณาเลือกอย่างน้อย 1 ชิ้น");
  if (ids.length > MAX_ITEMS_PER_BULK) {
    throw new InventoryValidationError(`เลือกได้ครั้งละไม่เกิน ${MAX_ITEMS_PER_BULK} ชิ้น`);
  }
  const setsStatus = Object.prototype.hasOwnProperty.call(input, "status") && input.status !== undefined;
  const setsLocation = Object.prototype.hasOwnProperty.call(input, "location") && input.location !== undefined;
  if (!setsStatus && !setsLocation) throw new InventoryValidationError("ยังไม่ได้เลือกว่าจะเปลี่ยนอะไร");

  const patch: InventoryItemInput = {};
  if (setsStatus) {
    patch.status = input.status;
    patch.statusParty = input.statusParty ?? "";
    patch.statusDate = input.statusDate ?? null;
  }
  if (setsLocation) patch.location = input.location;
  const now = new Date().toISOString();

  return withTransaction(async (conn: TxConn) => {
    const [rows] = await conn.query(
      `SELECT * FROM inventory_items WHERE kind = ? AND id IN (${placeholders(ids.length)}) ORDER BY id FOR UPDATE`,
      [kind, ...ids]
    );
    if (rows.length !== ids.length) {
      throw new InventoryValidationError("บางชิ้นถูกลบหรือไม่อยู่ในหน้านี้แล้ว กรุณาโหลดหน้าใหม่แล้วเลือกอีกครั้ง");
    }

    const plans = rows.map((row: Row) => {
      const before = rowToFields(row);
      let after: CleanItemFields;
      try {
        after = cleanItemFields(kind, mergeItemPatch(before, { ...patch, status: setsStatus ? patch.status : before.status }));
      } catch (error) {
        if (error instanceof InventoryValidationError) {
          throw new InventoryValidationError(`${row.code}: ${error.message}`);
        }
        throw error;
      }
      return { id: String(row.id), before, after };
    });

    const events: Array<EventDraft & { itemId: string }> = [];
    for (const p of plans) {
      for (const e of itemChangeEvents(kind, p.before, p.after)) events.push({ ...e, itemId: p.id });
    }

    // Every item gets the same new values, so one statement per field set.
    if (setsStatus) {
      const a = plans[0].after;
      await conn.query(
        `UPDATE inventory_items SET status = ?, statusParty = ?, statusDate = ?, updatedAt = ? WHERE kind = ? AND id IN (${placeholders(ids.length)})`,
        [a.status, a.statusParty, a.statusDate, now, kind, ...ids]
      );
    }
    if (setsLocation) {
      await conn.query(
        `UPDATE inventory_items SET location = ?, updatedAt = ? WHERE kind = ? AND id IN (${placeholders(ids.length)})`,
        [plans[0].after.location, now, kind, ...ids]
      );
    }
    await insertEvents(conn, kind, events, now);
    return { updated: ids.length };
  });
}
