import "server-only";
import { ApiError } from "./apiHelpers";
import {
  isInventoryKind,
  InventoryValidationError,
  InventoryNotFoundError,
  GroupNotEmptyError,
  type InventoryKind,
} from "./inventoryStore";

// Shared by the /api/admin/inventory/[kind]/** route handlers (a route file
// may only export its handlers). Spec: openspec/changes/add-inventory-tracking.

/** The register named in the URL — anything but "asset"/"stock" is a 404. */
export async function inventoryKindFrom(params: Promise<{ kind: string }>): Promise<InventoryKind> {
  const { kind } = await params;
  if (!isInventoryKind(kind)) throw new ApiError(404, "ไม่พบหน้านี้");
  return kind;
}

/** The store's own errors as the status they mean, with their Thai message;
 *  anything else stays a 500 for withRoute to log. */
export function inventoryApiError(error: unknown): unknown {
  if (error instanceof InventoryValidationError) return new ApiError(400, error.message);
  if (error instanceof InventoryNotFoundError) return new ApiError(404, error.message);
  if (error instanceof GroupNotEmptyError) return new ApiError(409, error.message);
  return error;
}

/** A JSON object body (not an array, not null) — anything else is a 400. */
export function objectBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "ข้อมูลที่ส่งมาไม่ถูกต้อง");
  }
  return raw as Record<string, unknown>;
}
