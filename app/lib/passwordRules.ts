// What a new admin password must be. Pure — the forms check it as the admin
// types, and the server (/api/auth/password, /api/auth/forgot-password)
// checks it again, with these same rules, before anything is stored.

export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt reads the first 72 BYTES and silently ignores the rest — a Thai
 *  character is 3 — so a longer password would be a shorter one in disguise. */
export const MAX_PASSWORD_BYTES = 72;

/** What is wrong with `password` as a new password, or null if nothing. */
export function newPasswordProblem(password: unknown, username: string): string | null {
  if (typeof password !== "string" || password === "") return "กรุณากรอกรหัสผ่านใหม่";
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return "รหัสผ่านใหม่ยาวเกินไป (ไม่เกิน 72 ตัวอักษรภาษาอังกฤษ หรือ 24 ตัวอักษรภาษาไทย)";
  }
  if (password.trim() !== password) return "รหัสผ่านใหม่ต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง";
  if (username && password.toLowerCase() === username.toLowerCase()) return "รหัสผ่านใหม่ต้องไม่เหมือนชื่อผู้ใช้";
  return null;
}
