import { query } from "./db";
import type { RowDataPacket } from "mysql2";

// Persisted contact-form submissions. Stored BEFORE (and independently of) the
// email send, so a failed SMTP delivery never drops a sales lead. `emailedOk`
// records whether the notification email actually went out.
export interface ContactMessageRecord {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  emailedOk: boolean;
  createdAt: string;
}

function rowToMessage(r: RowDataPacket): ContactMessageRecord {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    subject: r.subject ?? "",
    message: r.message,
    emailedOk: Boolean(r.emailedOk),
    createdAt: r.createdAt,
  };
}

export async function saveContactMessage(
  msg: Omit<ContactMessageRecord, "emailedOk"> & { emailedOk?: boolean }
): Promise<void> {
  await query(
    `INSERT INTO contact_messages
       (id, name, email, subject, message, emailedOk, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      msg.name,
      msg.email,
      msg.subject,
      msg.message,
      msg.emailedOk ? 1 : 0,
      msg.createdAt,
    ]
  );
}

/** Flag whether the notification email for a stored lead was delivered. */
export async function markContactMessageEmailed(
  id: string,
  ok: boolean
): Promise<void> {
  await query("UPDATE contact_messages SET emailedOk = ? WHERE id = ?", [
    ok ? 1 : 0,
    id,
  ]);
}

/** All stored leads, newest first (admin inbox). */
export async function listContactMessages(): Promise<ContactMessageRecord[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contact_messages ORDER BY createdAt DESC"
  );
  return rows.map(rowToMessage);
}
