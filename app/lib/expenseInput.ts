/**
 * What is wrong with an expense body's TEXT fields, in Thai, or null when
 * nothing is. Shared by the four expense routes (one-off and recurring, create
 * and edit); the amount and the date have their own checks in those routes.
 *
 * Every field is text: a number or an object reached the sanitizer in
 * expenseStore and came back as a bare 500. `creating` makes the title
 * required; an edit may leave it out, but may not blank it — the create form
 * refuses an expense without a name, and an edit used to save one.
 */
export function expenseTextError(body: unknown, creating: boolean): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "ข้อมูลไม่ถูกต้อง";
  const b = body as Record<string, unknown>;
  if (creating || b.title !== undefined) {
    if (typeof b.title !== "string" || b.title.trim() === "") return "กรุณาระบุชื่อรายการ";
  }
  for (const field of ["category", "note"] as const) {
    if (b[field] !== undefined && b[field] !== null && typeof b[field] !== "string") {
      return "ข้อมูลไม่ถูกต้อง";
    }
  }
  return null;
}
