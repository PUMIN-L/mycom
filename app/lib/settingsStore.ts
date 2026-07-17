import { query } from "./db";
import type { RowDataPacket } from "mysql2";
import { CONTACT_EMAIL } from "./contact";

// Key-value settings configurable from the CMS (/settings, admin-only).
// Reads fall back to a hardcoded default so the app works before the row exists.

export const CONTACT_EMAIL_SETTING = "contact_email";

export async function getSetting(name: string): Promise<string | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT value FROM settings WHERE name = ?",
    [name]
  );
  return rows.length > 0 ? String(rows[0].value) : null;
}

export async function setSetting(name: string, value: string): Promise<void> {
  await query(
    "INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [name, value]
  );
}

/** Where contact-form submissions are emailed. Falls back to the shared constant. */
export async function getContactEmail(): Promise<string> {
  return (await getSetting(CONTACT_EMAIL_SETTING)) || CONTACT_EMAIL;
}
