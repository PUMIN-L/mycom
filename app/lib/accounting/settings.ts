import "server-only";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { query } from "../db";
import { getCompanyProfile, getSetting, setSetting } from "../settingsStore";
import { writeAudit } from "./audit";
import { EMPTY_SELLER, type BankAccountInput } from "./sellerProfile";
import type { AccountingSettings, BankAccount, SellerProfile } from "./types";

// The accounting module's settings: our company as it prints (kept as
// VERSIONS, so a move of address never changes an old invoice — each document
// points at the version it was issued under), VAT, default credit, and the
// bank accounts payments come into.
//
// Saving the company unchanged writes no new version: the table holds one row
// per real change, nothing more.

export const DEFAULT_VAT_RATE = 7;
export const DEFAULT_CREDIT_DAYS = 30;
const VAT_RATE_KEY = "acc_vat_rate";
const CREDIT_DAYS_KEY = "acc_default_credit_days";

interface Actor {
  userId: string;
  username: string;
}

const SELLER_FIELDS: (keyof SellerProfile)[] = ["name", "address", "taxId", "branchCode", "phone", "email"];
/** How the audit log names a changed field — it is read on a Thai page. */
const SELLER_LABELS: Record<keyof SellerProfile, string> = {
  name: "ชื่อบริษัท",
  address: "ที่อยู่",
  taxId: "เลขผู้เสียภาษี",
  branchCode: "สาขา",
  phone: "เบอร์โทร",
  email: "อีเมล",
};

function rowToSeller(r: RowDataPacket): SellerProfile {
  return {
    name: String(r.name ?? ""),
    address: String(r.address ?? ""),
    taxId: String(r.taxId ?? ""),
    branchCode: String(r.branchCode ?? ""),
    phone: String(r.phone ?? ""),
    email: String(r.email ?? ""),
  };
}

/** The latest version of our company, with its id — or, before the first save, the website's address and phone to start from. */
export async function getSellerProfile(): Promise<{ seller: SellerProfile; versionId: string | null }> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, name, address, taxId, branchCode, phone, email FROM acc_seller_versions ORDER BY createdAt DESC, id DESC LIMIT 1"
  );
  if (rows[0]) return { seller: rowToSeller(rows[0]), versionId: String(rows[0].id) };
  const profile = await getCompanyProfile();
  return { seller: { ...EMPTY_SELLER, address: profile.addressDisplay, phone: profile.phone }, versionId: null };
}

/** A version by id — what a document issued under it prints. */
export async function getSellerVersion(id: string): Promise<SellerProfile | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT name, address, taxId, branchCode, phone, email FROM acc_seller_versions WHERE id = ? LIMIT 1",
    [id]
  );
  return rows[0] ? rowToSeller(rows[0]) : null;
}

/** Saves `seller` (already checked) as the new current version — unless it is the current one already. */
export async function saveSellerProfile(seller: SellerProfile, actor: Actor): Promise<string> {
  const current = await getSellerProfile();
  if (current.versionId && SELLER_FIELDS.every((f) => current.seller[f] === seller[f])) return current.versionId;
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO acc_seller_versions (id, name, address, taxId, branchCode, phone, email, createdAt, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, seller.name, seller.address, seller.taxId, seller.branchCode, seller.phone, seller.email, new Date().toISOString(), actor.username]
  );
  const changed = current.versionId
    ? SELLER_FIELDS.filter((f) => current.seller[f] !== seller[f]).map((f) => SELLER_LABELS[f])
    : ["ตั้งค่าครั้งแรก"];
  await writeAudit(null, { ...actor, action: "settings.update", detail: `ข้อมูลบริษัท: ${changed.join(", ")}` });
  return id;
}

export async function getVatRate(): Promise<number> {
  const raw = await getSetting(VAT_RATE_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_VAT_RATE;
}

export async function getDefaultCreditDays(): Promise<number> {
  const raw = await getSetting(CREDIT_DAYS_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) ? n : DEFAULT_CREDIT_DAYS;
}

/** Saves VAT and default credit (already checked); audited only when one changed. */
export async function saveAccountingOptions(options: { vatRate: number; creditDays: number }, actor: Actor): Promise<void> {
  const [vat, credit] = await Promise.all([getVatRate(), getDefaultCreditDays()]);
  const changes: string[] = [];
  if (vat !== options.vatRate) {
    await setSetting(VAT_RATE_KEY, String(options.vatRate));
    changes.push(`VAT ${vat}% → ${options.vatRate}%`);
  }
  if (credit !== options.creditDays) {
    await setSetting(CREDIT_DAYS_KEY, String(options.creditDays));
    changes.push(`เครดิต ${credit} → ${options.creditDays} วัน`);
  }
  if (changes.length > 0) await writeAudit(null, { ...actor, action: "settings.update", detail: changes.join(", ") });
}

// ── Bank accounts ────────────────────────────────────────────────────────────

function rowToBank(r: RowDataPacket): BankAccount {
  return {
    id: String(r.id),
    bankName: String(r.bankName ?? ""),
    accountNo: String(r.accountNo ?? ""),
    accountName: String(r.accountName ?? ""),
    isActive: Number(r.isActive) === 1,
    sortOrder: Number(r.sortOrder) || 0,
  };
}

/** Active ones first, then by their order. */
export async function listBankAccounts(): Promise<BankAccount[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, bankName, accountNo, accountName, isActive, sortOrder FROM acc_bank_accounts ORDER BY isActive DESC, sortOrder ASC, createdAt ASC"
  );
  return rows.map(rowToBank);
}

export async function createBankAccount(input: BankAccountInput, actor: Actor): Promise<BankAccount> {
  const id = crypto.randomUUID();
  const [maxRows] = await query<RowDataPacket[]>("SELECT COALESCE(MAX(sortOrder), 0) AS maxOrder FROM acc_bank_accounts");
  const sortOrder = (Number(maxRows[0]?.maxOrder) || 0) + 1;
  await query(
    "INSERT INTO acc_bank_accounts (id, bankName, accountNo, accountName, isActive, sortOrder, createdAt) VALUES (?, ?, ?, ?, 1, ?, ?)",
    [id, input.bankName, input.accountNo, input.accountName, sortOrder, new Date().toISOString()]
  );
  await writeAudit(null, { ...actor, action: "bank.create", detail: `${input.bankName} ${input.accountNo}` });
  return { id, ...input, isActive: true, sortOrder };
}

/**
 * False when there is no such account. `isActive` left out keeps the account
 * as it is — an edit that did not say must not switch a closed one back on.
 */
export async function updateBankAccount(
  id: string,
  input: BankAccountInput & { isActive?: boolean },
  actor: Actor
): Promise<boolean> {
  const sets = ["bankName = ?", "accountNo = ?", "accountName = ?"];
  const values: unknown[] = [input.bankName, input.accountNo, input.accountName];
  if (input.isActive !== undefined) {
    sets.push("isActive = ?");
    values.push(input.isActive ? 1 : 0);
  }
  const [result] = await query<ResultSetHeader>(`UPDATE acc_bank_accounts SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  if (result.affectedRows === 0) return false;
  await writeAudit(null, {
    ...actor,
    action: "bank.update",
    detail: `${input.bankName} ${input.accountNo}${input.isActive === false ? " (ปิดใช้)" : input.isActive ? " (เปิดใช้)" : ""}`,
  });
  return true;
}

/**
 * Removes the account — or, when a payment already names it, only switches it
 * off, so that payment still says which account it came into.
 */
export async function removeBankAccount(id: string, actor: Actor): Promise<"deleted" | "deactivated" | "missing"> {
  const [rows] = await query<RowDataPacket[]>("SELECT bankName, accountNo FROM acc_bank_accounts WHERE id = ? LIMIT 1", [id]);
  if (!rows[0]) return "missing";
  const label = `${rows[0].bankName} ${rows[0].accountNo}`;
  const used = await isBankAccountUsed(id);
  if (used) {
    await query("UPDATE acc_bank_accounts SET isActive = 0 WHERE id = ?", [id]);
    await writeAudit(null, { ...actor, action: "bank.update", detail: `${label} (ปิดใช้ — มีรายการรับเงินอ้างถึง)` });
    return "deactivated";
  }
  await query("DELETE FROM acc_bank_accounts WHERE id = ?", [id]);
  await writeAudit(null, { ...actor, action: "bank.delete", detail: label });
  return "deleted";
}

/** Whether any payment names the account. */
async function isBankAccountUsed(id: string): Promise<boolean> {
  const [rows] = await query<RowDataPacket[]>("SELECT 1 FROM acc_payments WHERE bankAccountId = ? LIMIT 1", [id]);
  return rows.length > 0;
}

export async function getAccountingSettings(): Promise<AccountingSettings> {
  const [{ seller, versionId }, vatRate, creditDays, bankAccounts] = await Promise.all([
    getSellerProfile(),
    getVatRate(),
    getDefaultCreditDays(),
    listBankAccounts(),
  ]);
  return { seller, sellerVersionId: versionId, vatRate, creditDays, bankAccounts };
}
