import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import type { QueryResult, FieldPacket, RowDataPacket } from "mysql2";

// Bump whenever the schema below changes — a mismatch re-runs the (idempotent)
// bump; a match lets returning cold instances skip it in one SELECT.
//
// ONLY EVER INCREASE THIS, and never reuse a number that has already shipped.
// The skip check below is `stored >= SCHEMA_VERSION`, so a number the live
// database has already recorded can never trigger a migration again. v33 was
// burned by a feature that was later reverted: lowering the constant back to 32
// did not lower the 33 already written to `settings`, so the next change to
// reuse 33 was skipped entirely and its tables were never created in
// production. Reverting a migration means moving FORWARD to a new number.
const SCHEMA_VERSION = 36;

type DbPool = ReturnType<typeof mysql.createPool>;

// Cache the pool + init flag on globalThis so Next.js dev HMR reuses a single
// pool instead of leaking a new one (and re-running the seed) on every reload.
const globalForDb = globalThis as unknown as {
  _pool?: DbPool;
  _initPromise?: Promise<void>;
};

function createPool(): DbPool {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "4000"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
    // Keep the pool small: on serverless (Vercel) EACH function instance holds
    // its own pool, so a high per-instance limit multiplies across instances and
    // can exhaust the cloud DB's connection budget. A handful is plenty for this
    // low-concurrency CMS (page renders issue queries sequentially).
    connectionLimit: 3,
    // maxIdle MUST equal connectionLimit. With maxIdle < connectionLimit, mysql2's
    // eviction timer destroys the surplus connection after EVERY request, so a page
    // that opens >maxIdle connections at once (e.g. /showcase/[id] runs ~4 queries
    // via Promise.all) pays a full ~1s+ TiDB TLS reconnect on the next view. Keeping
    // maxIdle == connectionLimit means warm sockets are never torn down between
    // requests. (Trade-off: the idle-eviction timer no longer arms, so server-side
    // drops aren't proactively recycled — but query() already retries transient
    // connection errors, which covers that.)
    maxIdle: 3,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 30_000,
  });
}

const pool: DbPool = globalForDb._pool ?? (globalForDb._pool = createPool());

async function bootstrapSchemaOnce(): Promise<void> {
  // Never mutate/seed the DB from a Vercel PREVIEW deployment. Preview builds
  // share the production database (until a dedicated preview DB is provisioned),
  // so a branch that bumps SCHEMA_VERSION or edits seeds must NOT run
  // CREATE/ALTER/seed against prod before it is merged. Reads still work against
  // the existing prod schema. Set ALLOW_DB_BOOTSTRAP=1 for an environment that
  // has its OWN throwaway database and should bootstrap it.
  if (
    process.env.VERCEL_ENV === "preview" &&
    process.env.ALLOW_DB_BOOTSTRAP !== "1"
  ) {
    return;
  }
  const connection = await pool.getConnection();
  try {
    // Fast path: skip the whole bootstrap when the schema is already at the
    // current version. Collapses ~37 sequential round trips + a bcrypt hash
    // into ONE SELECT on returning cold instances (Vercel runs this per cold
    // start). All bootstrap statements are idempotent, so re-running after a
    // SCHEMA_VERSION bump is safe.
    try {
      const [verRows] = await connection.query<RowDataPacket[]>(
        "SELECT value FROM settings WHERE name = 'schema_version' LIMIT 1"
      );
      if (verRows.length > 0 && Number(verRows[0].value) >= SCHEMA_VERSION) {
        return;
      }
    } catch {
      // `settings` doesn't exist yet (fresh DB) — fall through to full bootstrap.
    }

    await connection.query(`
        CREATE TABLE IF NOT EXISTS contents (
          id VARCHAR(255) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          blocks JSON NOT NULL,
          createdAt VARCHAR(255) NOT NULL,
          productId VARCHAR(255) NULL
        )
      `);
    // Migration: add productId if it doesn't exist (for existing tables)
    try {
      await connection.query(
        `ALTER TABLE contents ADD COLUMN IF NOT EXISTS productId VARCHAR(255) NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `CREATE INDEX idx_contents_productId ON contents (productId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // NOTE: the FK from contents.productId -> products(id), and the
    // product_specs table (which has an inline FK to products), are created
    // further down — AFTER the `products` table exists (see below `products`
    // block). Creating either before `products` exists throws
    // ER_FK_CANNOT_OPEN_PARENT on a fresh database (errno 1824), which is not
    // a benign error, so bootstrap would fail entirely for a first-time install.

    // ── Users table ────────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(255) PRIMARY KEY,
          username VARCHAR(255) NOT NULL UNIQUE,
          passwordHash VARCHAR(255) NOT NULL,
          createdAt VARCHAR(255) NOT NULL
        )
      `);

    // ── Documents table ────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id VARCHAR(255) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          pdfUrl VARCHAR(1024) NOT NULL,
          coverUrl VARCHAR(1024) NOT NULL,
          createdAt VARCHAR(255) NOT NULL,
          sortOrder INT DEFAULT 0
        )
      `);

    // ── Settings table (key-value store for CMS-configurable options) ─────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS settings (
          name VARCHAR(191) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

    // ── Contact messages (persisted leads from the public contact form) ───
    // Stored independently of the email send so a failed SMTP delivery never
    // drops the lead; `emailedOk` records whether the notification went out.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS contact_messages (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(320) NOT NULL,
          phone VARCHAR(255),
          subject VARCHAR(300),
          message TEXT NOT NULL,
          emailedOk BOOLEAN DEFAULT FALSE,
          createdAt VARCHAR(255) NOT NULL
        )
      `);
    try {
      await connection.query(
        `ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS phone VARCHAR(255) NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `CREATE INDEX idx_contact_messages_createdAt ON contact_messages (createdAt)`
      );
    } catch (error) {
      // Only "index already exists" is benign here — rethrow anything real.
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Revisions (edit history for products / contents / documents) ──────
    // A snapshot of the PREVIOUS value is written before every update so an
    // accidental overwrite can be restored. Generic across entity types.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS revisions (
          id VARCHAR(255) PRIMARY KEY,
          entityType VARCHAR(32) NOT NULL,
          entityId VARCHAR(255) NOT NULL,
          data JSON NOT NULL,
          createdAt VARCHAR(255) NOT NULL
        )
      `);
    try {
      await connection.query(
        `CREATE INDEX idx_revisions_entity ON revisions (entityType, entityId, createdAt)`
      );
    } catch (error) {
      // Only "index already exists" is benign here — rethrow anything real.
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Quotations table (saved quotations; auto-purged after 30 days) ────
    // `uploadedImages` = only images uploaded FOR this quote (deletable);
    // catalog/product images are never stored here, so they survive deletes.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS quotations (
          id VARCHAR(255) PRIMARY KEY,
          docNo VARCHAR(255),
          data JSON NOT NULL,
          uploadedImages JSON NOT NULL,
          createdAt VARCHAR(255) NOT NULL
        )
      `);
    try {
      await connection.query(
        `CREATE INDEX idx_quotations_createdAt ON quotations (createdAt)`
      );
    } catch (error) {
      // Only "index already exists" is benign here — rethrow anything real.
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Used quotation numbers ledger ─────────────────────────────────────
    // Records every issued quotation docNo so a number can't be reused even
    // after its quotation is deleted. docNo starts with the date, so numbers
    // roll over daily. NOTE: no longer purged (kept for conversion-rate
    // analytics), so it only grows — the createdAt index below is what keeps
    // listRecentDocNos()'s `WHERE createdAt >= ?` fast as it does.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS used_docnos (
          docNo VARCHAR(255) PRIMARY KEY,
          quotationId VARCHAR(255) NOT NULL,
          createdAt VARCHAR(255) NOT NULL
        )
      `);
    try {
      await connection.query(
        `CREATE INDEX idx_used_docnos_createdAt ON used_docnos (createdAt)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Product categories table ──────────────────────────────────────────

    await connection.query(`
        CREATE TABLE IF NOT EXISTS product_categories (
          id INT PRIMARY KEY,
          name_th VARCHAR(255) NOT NULL,
          name_en VARCHAR(255) NOT NULL,
          name_zh VARCHAR(255) NOT NULL,
          sortOrder INT DEFAULT 0
        )
      `);

    // ── Products table ──────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(255) PRIMARY KEY,
          categoryId INT NOT NULL,
          image VARCHAR(1024) NOT NULL,
          title_th VARCHAR(255) NOT NULL,
          title_en VARCHAR(255) NOT NULL,
          title_zh VARCHAR(255) NOT NULL,
          desc_th TEXT,
          desc_en TEXT,
          desc_zh TEXT,
          createdAt VARCHAR(255) NOT NULL,
          isPublished BOOLEAN DEFAULT TRUE,
          sortOrder INT DEFAULT 0,
          bestSellerRank INT NULL DEFAULT NULL,
          showBestSellerBadge BOOLEAN DEFAULT TRUE
        )
      `);

    try {
      await connection.query(
        `ALTER TABLE products ADD COLUMN IF NOT EXISTS isPublished BOOLEAN DEFAULT TRUE`
      );
    } catch (error) {
      // Swallow only "already exists" / "syntax unsupported"; rethrow a REAL
      // failure (lock timeout, permission) so it isn't silently skipped and
      // the schema_version below is never stamped over a broken migration.
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE products ADD COLUMN IF NOT EXISTS sortOrder INT DEFAULT 0`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE products ADD COLUMN IF NOT EXISTS bestSellerRank INT NULL DEFAULT NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE products ADD COLUMN IF NOT EXISTS showBestSellerBadge BOOLEAN DEFAULT TRUE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE products ADD COLUMN IF NOT EXISTS pendingDeleteAt VARCHAR(255) NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `CREATE INDEX idx_products_pendingDelete ON products (pendingDeleteAt)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `CREATE INDEX idx_products_category_created ON products (categoryId, createdAt)`
      );
    } catch (error) {
      // Only "index already exists" is benign here — rethrow anything real.
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `CREATE INDEX idx_products_categoryId ON products (categoryId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE products ADD CONSTRAINT fk_product_category FOREIGN KEY (categoryId) REFERENCES product_categories(id) ON DELETE RESTRICT`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── contents -> products FK (moved here so `products` already exists) ───
    try {
      await connection.query(
        `ALTER TABLE contents ADD CONSTRAINT fk_content_product FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Product Specs table (has an inline FK to products, so it must be
    // created after `products` exists — see the NOTE near the contents table) ──
    await connection.query(`
        CREATE TABLE IF NOT EXISTS product_specs (
          id VARCHAR(255) PRIMARY KEY,
          productId VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          detail TEXT NOT NULL,
          createdAt VARCHAR(255) NOT NULL,
          FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

    // ── Companies table ──────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS companies (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          addressNo VARCHAR(255),
          moo VARCHAR(255),
          soi VARCHAR(255),
          road VARCHAR(255),
          subDistrict VARCHAR(255),
          district VARCHAR(255),
          province VARCHAR(255),
          postalCode VARCHAR(255),
          phone VARCHAR(255),
          note TEXT,
          createdAt VARCHAR(255) NOT NULL
        )
      `);

    // ── Customers table ──────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id VARCHAR(255) PRIMARY KEY,
          companyId VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          department VARCHAR(255),
          phone VARCHAR(255),
          email VARCHAR(255),
          note TEXT,
          createdAt VARCHAR(255) NOT NULL
        )
      `);

    try {
      await connection.query(
        `CREATE INDEX idx_customers_companyId ON customers (companyId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `CREATE INDEX idx_customers_createdAt ON customers (createdAt)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE customers ADD CONSTRAINT fk_customer_company FOREIGN KEY (companyId) REFERENCES companies(id) ON DELETE RESTRICT`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Salespeople table ────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS salespeople (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(255),
          email VARCHAR(255),
          note TEXT,
          createdAt VARCHAR(255) NOT NULL
        )
      `);

    // ── Suppliers table ──────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id VARCHAR(255) PRIMARY KEY,
          companyName VARCHAR(255) NOT NULL,
          contactName VARCHAR(255),
          phone VARCHAR(255),
          note TEXT,
          createdAt VARCHAR(255) NOT NULL
        )
      `);

    // ── Product-Suppliers junction table ─────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS product_suppliers (
          productId VARCHAR(255) NOT NULL,
          supplierId VARCHAR(255) NOT NULL,
          PRIMARY KEY (productId, supplierId)
        )
      `);

    try {
      await connection.query(
        `ALTER TABLE product_suppliers ADD CONSTRAINT fk_ps_product FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    try {
      await connection.query(
        `ALTER TABLE product_suppliers ADD CONSTRAINT fk_ps_supplier FOREIGN KEY (supplierId) REFERENCES suppliers(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Billing documents (Invoice / Billing Note / Receipt) ────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS billing_documents (
          id VARCHAR(36) PRIMARY KEY,
          docType VARCHAR(20) NOT NULL DEFAULT 'invoice',
          docNo VARCHAR(255) NOT NULL DEFAULT '',
          linkedQuotationId VARCHAR(36) DEFAULT NULL,
          data JSON NOT NULL,
          paymentMethod VARCHAR(50) DEFAULT NULL,
          paymentDate VARCHAR(20) DEFAULT NULL,
          paymentRef VARCHAR(255) DEFAULT NULL,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_billing_docType (docType),
          INDEX idx_billing_docNo (docNo)
        )
      `);
    try {
      await connection.query(
        `CREATE INDEX idx_billing_createdAt ON billing_documents (createdAt)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── CRM: sold equipment + warranty tracking ──────────────────────────────
    // Document references (quotation / warranty cert / service report) are TEXT
    // reference numbers only — no file uploads, per spec
    // (openspec/changes/add-crm-service-tracking).
    await connection.query(`
        CREATE TABLE IF NOT EXISTS customer_equipments (
          id VARCHAR(36) PRIMARY KEY,
          salesRecordId VARCHAR(255) DEFAULT '',
          customerId VARCHAR(255) NOT NULL,
          productId VARCHAR(255) NOT NULL,
          productName VARCHAR(255) DEFAULT '',
          serialNumber VARCHAR(255) NOT NULL DEFAULT '',
          quotationNumber VARCHAR(255) NOT NULL DEFAULT '',
          warrantyCertNumber VARCHAR(255) NOT NULL DEFAULT '',
          warrantyType VARCHAR(255) NOT NULL DEFAULT '',
          warrantyStartDate VARCHAR(20) DEFAULT NULL,
          warrantyEndDate VARCHAR(20) DEFAULT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'Active',
          note TEXT NULL,
          calibrationDate VARCHAR(20) DEFAULT NULL,
          ownershipSource VARCHAR(20) NOT NULL DEFAULT 'sold_by_us',
          warrantyAlertEnabled TINYINT(1) NOT NULL DEFAULT 1,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_ce_customer (customerId),
          INDEX idx_ce_warrantyEnd (warrantyEndDate),
          INDEX idx_ce_calibrationDate (calibrationDate)
        )
      `);
    try {
      await connection.query(
        `CREATE INDEX idx_ce_createdAt ON customer_equipments (createdAt)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query("ALTER TABLE customer_equipments ADD COLUMN salesRecordId VARCHAR(255) DEFAULT ''");
    } catch (error) {
      // Same pattern as every other migration in this file: swallow only
      // "already exists"; rethrow a REAL failure so it isn't silently skipped
      // and schema_version never gets stamped over a broken migration.
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query("ALTER TABLE customer_equipments ADD COLUMN productName VARCHAR(255) DEFAULT ''");
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    // v31: "note" (free-text log, e.g. "customer declined to renew warranty")
    // and "calibrationDate" (last calibration performed — the alert feed warns
    // 10 months after this date, same idea as the warranty-expiry alert).
    try {
      await connection.query("ALTER TABLE customer_equipments ADD COLUMN IF NOT EXISTS note TEXT NULL");
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query("ALTER TABLE customer_equipments ADD COLUMN IF NOT EXISTS calibrationDate VARCHAR(20) DEFAULT NULL");
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `CREATE INDEX idx_ce_calibrationDate ON customer_equipments (calibrationDate)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    // v35: "ownershipSource" (did WE sell this unit, or did the customer buy it
    // elsewhere and we merely service it) and "warrantyAlertEnabled" (per-unit
    // switch for the "warranty expiring" alert only — calibration and
    // incomplete-record alerts ignore it).
    //
    // ADDITIVE ONLY — deliberately NO `UPDATE` of existing rows anywhere on this
    // path. Every pre-existing unit takes the column defaults ('sold_by_us' +
    // alerts on), which is EXACTLY how the system behaved before this column
    // existed. Guessing the source from `salesRecordId`/`quotationNumber` was
    // rejected on purpose: plenty of units we did sell were entered by hand
    // before sales records existed and have an empty `salesRecordId`, so a
    // heuristic would silently mislabel them as customer-owned with no way to
    // tell a guess from a confirmed value. Reclassifying is an admin decision,
    // made per unit.
    for (const columnDef of [
      "ADD COLUMN IF NOT EXISTS ownershipSource VARCHAR(20) NOT NULL DEFAULT 'sold_by_us'",
      "ADD COLUMN IF NOT EXISTS warrantyAlertEnabled TINYINT(1) NOT NULL DEFAULT 1",
    ]) {
      try {
        await connection.query(`ALTER TABLE customer_equipments ${columnDef}`);
      } catch (error) {
        if (!isBenignSchemaError(error)) throw error;
      }
    }
    // Drop fk_ce_customer so equipments can be created without a customer
    // (serial numbers need to be saved even when no customer is selected)
    try {
      await connection.query(
        `ALTER TABLE customer_equipments DROP FOREIGN KEY fk_ce_customer`
      );
    } catch (error: any) {
      // ER_CANT_DROP_FIELD_OR_KEY = FK already dropped (idempotent)
      if (error.code !== 'ER_CANT_DROP_FIELD_OR_KEY' && !isBenignSchemaError(error)) throw error;
    }
    // NOTE: productId is a loose reference on purpose (no FK) — deleting a
    // product from the catalog must not block on, or cascade-delete, the record
    // of a unit already sold to a customer.

    // ── CRM: service / follow-up call schedules ─────────────────────────────
    // A schedule is scoped to EITHER an equipmentId OR a customerId (never
    // both) — a customer-level schedule is used for a general follow-up call
    // not tied to a specific piece of equipment, and is restricted to
    // scheduleType='phone_call' at the app layer (see crmStore.ts/addSchedule).
    await connection.query(`
        CREATE TABLE IF NOT EXISTS service_schedules (
          id VARCHAR(36) PRIMARY KEY,
          equipmentId VARCHAR(36) NULL,
          customerId VARCHAR(255) NULL,
          scheduleType VARCHAR(20) NOT NULL DEFAULT 'service',
          scheduledDate VARCHAR(20) NOT NULL,
          assignedToAdminId VARCHAR(255) NOT NULL DEFAULT '',
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          notes TEXT,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_ss_equipment (equipmentId),
          INDEX idx_ss_customer (customerId),
          INDEX idx_ss_status_date (status, scheduledDate)
        )
      `);
    try {
      await connection.query(
        `ALTER TABLE service_schedules ADD CONSTRAINT fk_ss_equipment FOREIGN KEY (equipmentId) REFERENCES customer_equipments(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    // v32: existing databases created equipmentId as NOT NULL — relax it so a
    // customer-scoped (no equipment) schedule can be inserted. MODIFY COLUMN
    // is safe/idempotent on an already-nullable column and never touches
    // existing row data (every existing row already has a real value).
    try {
      await connection.query(
        `ALTER TABLE service_schedules MODIFY COLUMN equipmentId VARCHAR(36) NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `ALTER TABLE service_schedules ADD COLUMN IF NOT EXISTS customerId VARCHAR(255) NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `CREATE INDEX idx_ss_customer ON service_schedules (customerId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `ALTER TABLE service_schedules ADD CONSTRAINT fk_ss_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── CRM: post-action logs (service report / call result) ────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS service_logs (
          id VARCHAR(36) PRIMARY KEY,
          scheduleId VARCHAR(36) NOT NULL,
          serviceReportNumber VARCHAR(255) NOT NULL DEFAULT '',
          actionDate VARCHAR(255) NOT NULL,
          resultDetails TEXT,
          customerFeedback TEXT,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_sl_schedule (scheduleId)
        )
      `);
    try {
      await connection.query(
        `ALTER TABLE service_logs ADD CONSTRAINT fk_sl_schedule FOREIGN KEY (scheduleId) REFERENCES service_schedules(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Sales records (permanent, normalized — the source of truth for
    // analytics). Quotations are purged once past their retention window
    // (2 years — RETENTION_DAYS in app/api/quotations/cleanup/route.ts), so
    // they cannot be used for historical revenue reporting. This table stores
    // every closed deal with indexed columns for fast GROUP BY queries.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS sales_records (
          id VARCHAR(36) PRIMARY KEY,
          salespersonId VARCHAR(255) NOT NULL DEFAULT '',
          customerId VARCHAR(255) NOT NULL DEFAULT '',
          companyId VARCHAR(255) NOT NULL DEFAULT '',
          productId VARCHAR(255) NOT NULL DEFAULT '',
          productName VARCHAR(255) NOT NULL DEFAULT '',
          categoryId INT DEFAULT NULL,
          qty INT NOT NULL DEFAULT 1,
          unitPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
          totalAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
          costAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
          saleType VARCHAR(50) NOT NULL DEFAULT 'equipment',
          saleDate DATE NOT NULL,
          quotationRef VARCHAR(255) NOT NULL DEFAULT '',
          poRef VARCHAR(255) NOT NULL DEFAULT '',
          deliveryRef VARCHAR(255) NOT NULL DEFAULT '',
          invoiceRef VARCHAR(255) NOT NULL DEFAULT '',
          receiptRef VARCHAR(255) NOT NULL DEFAULT '',
          warrantyStartDate DATE DEFAULT NULL,
          warrantyEndDate DATE DEFAULT NULL,
          equipmentId VARCHAR(36) DEFAULT NULL,
          quotationId VARCHAR(36) DEFAULT NULL,
          note TEXT,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_sr_saleDate (saleDate),
          INDEX idx_sr_salesperson (salespersonId),
          INDEX idx_sr_customer (customerId),
          INDEX idx_sr_company (companyId),
          INDEX idx_sr_product (productId),
          INDEX idx_sr_category (categoryId),
          INDEX idx_sr_quotation (quotationId)
        )
      `);
    try {
      await connection.query(
        `ALTER TABLE sales_records ADD INDEX idx_sr_company (companyId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    // v21: Add costAmount column to existing sales_records tables
    try {
      await connection.query(
        `ALTER TABLE sales_records ADD COLUMN costAmount DECIMAL(12,2) NOT NULL DEFAULT 0`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // v22: Add saleType column to existing sales_records tables
    try {
      await connection.query(
        `ALTER TABLE sales_records ADD COLUMN saleType VARCHAR(50) NOT NULL DEFAULT 'equipment'`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // v23: Add document tracking and warranty fields to sales_records.
    // One ALTER per column (not a single multi-column ALTER): a multi-column
    // ALTER is one all-or-nothing statement, but on a database where an
    // earlier run got interrupted partway through applying it (crash, TiDB
    // splitting it into multiple internal DDL jobs), some of these columns
    // can already exist while others don't. Re-running the multi-column form
    // would hit ER_DUP_FIELDNAME on the FIRST already-existing column and
    // abort the whole statement — silently leaving the later columns missing
    // forever, since that error is swallowed as benign on every future run
    // too. Each column added (and checked) independently is re-runnable from
    // any partial state.
    for (const columnDef of [
      "ADD COLUMN IF NOT EXISTS poRef VARCHAR(255) NOT NULL DEFAULT ''",
      "ADD COLUMN IF NOT EXISTS deliveryRef VARCHAR(255) NOT NULL DEFAULT ''",
      "ADD COLUMN IF NOT EXISTS invoiceRef VARCHAR(255) NOT NULL DEFAULT ''",
      "ADD COLUMN IF NOT EXISTS receiptRef VARCHAR(255) NOT NULL DEFAULT ''",
      "ADD COLUMN IF NOT EXISTS warrantyStartDate DATE DEFAULT NULL",
      "ADD COLUMN IF NOT EXISTS warrantyEndDate DATE DEFAULT NULL",
    ]) {
      try {
        await connection.query(`ALTER TABLE sales_records ${columnDef}`);
      } catch (error) {
        if (!isBenignSchemaError(error)) throw error;
      }
    }

    // v33: link a sale back to the quotation it was created from. Deliberately
    // has NO FOREIGN KEY to `quotations`: quotations are hard-deleted by the
    // retention cron, and an FK would either block that purge or (with cascade)
    // destroy revenue rows along with it. The link is soft — a sale whose
    // quotation is gone still reads/edits normally, and `quotationRef` (the
    // document number as text) is always stored alongside it.
    try {
      await connection.query(
        `ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS quotationId VARCHAR(36) DEFAULT NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `CREATE INDEX idx_sr_quotation ON sales_records (quotationId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Sale cost items — breakdown of costs per sale (transport, service,
    // repair, shipping, commission etc.). The parent sales_records.costAmount
    // is the cached SUM and is recalculated whenever items change.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS sale_cost_items (
          id VARCHAR(36) PRIMARY KEY,
          salesRecordId VARCHAR(36) NOT NULL,
          costType VARCHAR(50) NOT NULL DEFAULT 'other',
          label VARCHAR(255) NOT NULL DEFAULT '',
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          note TEXT,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_sci_salesRecord (salesRecordId)
        )
      `);
    try {
      await connection.query(
        `ALTER TABLE sale_cost_items ADD CONSTRAINT fk_sci_sales FOREIGN KEY (salesRecordId) REFERENCES sales_records(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── Sale line items (v33) — one row per product line under a sales_record.
    // Created AFTER sales_records (and after sale_cost_items, which the backfill
    // below reads) so the FK's parent already exists on a fresh database.
    //
    // COST COMPOSITION RULE — `sales_records.costAmount` (the number every
    // profit/margin query and Chart 1 "ต้นทุนสินค้า" reads) is EXACTLY:
    //   SUM(sales_record_items.costAmount)                              per-line product cost
    //   + SUM(sale_cost_items.amount WHERE costType <> 'product_cost')  bill-level costs
    //                                                                   (ค่ารถ/ค่าคอม/ฯลฯ)
    // Product cost now lives on the line item ONLY: new write paths must not
    // create `product_cost` rows in sale_cost_items, and existing ones are kept
    // as history but excluded from the sum — otherwise product cost is counted
    // twice.
    //
    // Types mirror sales_records / sale_cost_items exactly. quotationItemId is
    // nullable (a hand-typed line has no source QuoteItem) and, like
    // sales_records.quotationId, carries no FK to quotations.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS sales_record_items (
          id VARCHAR(36) PRIMARY KEY,
          salesRecordId VARCHAR(36) NOT NULL,
          productId VARCHAR(255) NOT NULL DEFAULT '',
          productName VARCHAR(255) NOT NULL DEFAULT '',
          categoryId INT DEFAULT NULL,
          qty INT NOT NULL DEFAULT 1,
          unitPrice DECIMAL(12,2) NOT NULL DEFAULT 0,
          totalAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
          costAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
          quotationItemId VARCHAR(64) DEFAULT NULL,
          sortOrder INT NOT NULL DEFAULT 0,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_sri_salesRecord (salesRecordId),
          INDEX idx_sri_product (productId),
          INDEX idx_sri_category (categoryId),
          INDEX idx_sri_quotationItem (quotationItemId)
        )
      `);
    // Also create each index standalone: a database whose table predates one of
    // them (partially applied earlier run) would never get it from CREATE TABLE
    // IF NOT EXISTS. ER_DUP_KEYNAME on the fresh-DB path is benign.
    for (const indexDef of [
      "CREATE INDEX idx_sri_salesRecord ON sales_record_items (salesRecordId)",
      "CREATE INDEX idx_sri_product ON sales_record_items (productId)",
      "CREATE INDEX idx_sri_category ON sales_record_items (categoryId)",
      "CREATE INDEX idx_sri_quotationItem ON sales_record_items (quotationItemId)",
    ]) {
      try {
        await connection.query(indexDef);
      } catch (error) {
        if (!isBenignSchemaError(error)) throw error;
      }
    }
    try {
      await connection.query(
        `ALTER TABLE sales_record_items ADD CONSTRAINT fk_sri_sales FOREIGN KEY (salesRecordId) REFERENCES sales_records(id) ON DELETE CASCADE`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // v24: Add expenses table for general business expenses
    await connection.query(`
        CREATE TABLE IF NOT EXISTS expenses (
          id VARCHAR(36) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          expenseDate DATE NOT NULL,
          category VARCHAR(100) NOT NULL DEFAULT '',
          note TEXT,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_exp_date (expenseDate)
        )
      `);

    // ── Alert Snoozes ──────────────────────────────────────────────────────────
    await connection.query(`
        CREATE TABLE IF NOT EXISTS alert_snoozes (
          alertType VARCHAR(50) NOT NULL,
          referenceId VARCHAR(255) NOT NULL,
          snoozeUntil VARCHAR(255) NOT NULL,
          createdAt VARCHAR(255) NOT NULL,
          PRIMARY KEY (alertType, referenceId),
          INDEX idx_alert_snoozes_until (snoozeUntil)
        )
      `);

    // ── CRM task board (v35): topics + manual tasks + cross-entity links ─────
    //
    // These three tables back the hand-written "things I need to remember" board
    // on /crm/alerts, which is a separate system from the automatic alert feed:
    // nothing here is ever created, closed or deleted by the system.

    // Topics are DATA, not an enum — the owner adds/renames/recolours/reorders
    // them at runtime, so they cannot live as a constant in the code.
    // `color` holds a TOKEN ("blue", "amber", …) that the UI maps to a class;
    // a raw CSS value from a user must never reach a style/class attribute.
    // Retiring a topic is `isActive = 0`, never a DELETE, so the tasks filed
    // under it keep their label.
    //
    // `icon` and `name` PIN utf8mb4 EXPLICITLY (v36). Every other column in
    // this file inherits the database's default charset, which has always been
    // fine because Thai is 3 bytes and fits utf8mb3 — but an emoji is FOUR, and
    // this is the first column in the app that is required to hold one. On a
    // database whose default is utf8mb3 an unpinned column either rejects the
    // whole INSERT (strict mode, which TiDB sets by default: ERROR 1366
    // "Incorrect string value: '\xF0\x9F...' for column 'icon'") or silently
    // stores '?' — i.e. exactly "I saved a topic and it failed" / "the emoji
    // came out as something else". Pinning costs nothing when the default is
    // already utf8mb4, and removes the failure mode when it is not.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS task_topics (
          id INT PRIMARY KEY,
          name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          icon VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
          color VARCHAR(32) NOT NULL DEFAULT '',
          sortOrder INT DEFAULT 0,
          isActive TINYINT(1) NOT NULL DEFAULT 1,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_tt_active_sort (isActive, sortOrder)
        )
      `);
    // Also create the index standalone: a database whose table predates it
    // (partially applied earlier run) would never get it from CREATE TABLE
    // IF NOT EXISTS. ER_DUP_KEYNAME on the fresh-DB path is benign.
    try {
      await connection.query(
        `CREATE INDEX idx_tt_active_sort ON task_topics (isActive, sortOrder)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // `dueDate` is nullable ON PURPOSE: a note with no deadline is a complete,
    // valid task ("call this customer back sometime"), and only tasks that have
    // a due date which has already arrived are counted by the bell.
    // `topicId` is a soft reference with no FK — see the task_links note below
    // for why this whole table group avoids foreign keys.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS crm_tasks (
          id VARCHAR(36) PRIMARY KEY,
          topicId INT NOT NULL,
          title VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          detail TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
          dueDate VARCHAR(20) DEFAULT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          completedAt VARCHAR(255) DEFAULT NULL,
          createdAt VARCHAR(255) NOT NULL,
          INDEX idx_ct_status_due (status, dueDate),
          INDEX idx_ct_topic (topicId),
          INDEX idx_ct_createdAt (createdAt)
        )
      `);
    for (const indexDef of [
      "CREATE INDEX idx_ct_status_due ON crm_tasks (status, dueDate)",
      "CREATE INDEX idx_ct_topic ON crm_tasks (topicId)",
      "CREATE INDEX idx_ct_createdAt ON crm_tasks (createdAt)",
    ]) {
      try {
        await connection.query(indexDef);
      } catch (error) {
        if (!isBenignSchemaError(error)) throw error;
      }
    }

    // Polymorphic link rows, keyed like `alert_snoozes (alertType, referenceId)`.
    //
    // NO FOREIGN KEY ON THIS TABLE AT ALL — not on `targetId`, and deliberately
    // NOT on `taskId` either, so the whole table follows ONE rule instead of
    // two. `targetId` must stay soft because the targets die independently of
    // the task: quotations are hard-deleted by the 2-year retention cron, and an
    // FK would either block that purge or (with ON DELETE CASCADE) quietly
    // destroy the link — and with it the only record of what the task was about.
    // The same reasoning already governs `sales_records.quotationId` and
    // `customer_equipments.salesRecordId`. Extending it to `taskId` costs one
    // explicit DELETE: deleting a task removes its own link rows in the SAME
    // withTransaction (see taskStore.deleteTask); nothing cascades on its own,
    // and nothing here is ever cleaned up automatically — a link whose target
    // has been purged is KEPT and rendered as "ถูกลบแล้ว".
    //
    // `label` is a SNAPSHOT taken at link time (customer name, product + S/N,
    // quotation docNo, document title) and is deliberately NEVER re-synced with
    // the target. Display prefers the target's CURRENT name while the target
    // still exists and falls back to this snapshot once it is gone — which is
    // the entire point: it is what keeps a chip readable after its target has
    // been deleted or purged.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS task_links (
          taskId VARCHAR(36) NOT NULL,
          targetType VARCHAR(20) NOT NULL,
          targetId VARCHAR(255) NOT NULL,
          label VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
          createdAt VARCHAR(255) NOT NULL,
          PRIMARY KEY (taskId, targetType, targetId),
          INDEX idx_tl_target (targetType, targetId)
        )
      `);
    try {
      await connection.query(
        `CREATE INDEX idx_tl_target ON task_links (targetType, targetId)`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── v36: pin utf8mb4 on the columns that hold what a PERSON typed ────────
    //
    // Repairs a table this bootstrap already created on an existing database:
    // CREATE TABLE IF NOT EXISTS never revisits a table that is already there,
    // so the explicit charsets added above only reach a brand-new install.
    // Widening utf8mb3 → utf8mb4 keeps every byte already stored (utf8mb3 is a
    // strict subset) and is a no-op where the column is utf8mb4 already.
    //
    // Deliberately NOT fatal. An unconverted column is precisely today's state,
    // which the whole app tolerates; taking the entire CMS down (bootstrap
    // failing = every route 500s) because one emoji column could not be
    // widened would be far worse than the bug being fixed. It is logged loudly
    // instead, and none of these columns is part of an index, so no key-length
    // limit can be hit.
    for (const alter of [
      `ALTER TABLE task_topics MODIFY name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`,
      `ALTER TABLE task_topics MODIFY icon VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''`,
      `ALTER TABLE crm_tasks MODIFY title VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`,
      `ALTER TABLE crm_tasks MODIFY detail TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL`,
      `ALTER TABLE task_links MODIFY label VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''`,
    ]) {
      try {
        await connection.query(alter);
      } catch (error) {
        if (isBenignSchemaError(error)) continue;
        console.error(
          `Could not widen a task-board column to utf8mb4 — emoji may not survive a save. Statement: ${alter}`,
          error
        );
      }
    }

    // ── Seed the five default topics — ONLY while the table is fully empty ────
    //
    // The guard covers the WHOLE table, and is NOT a per-id `INSERT IGNORE`.
    // Seeding row-by-row would resurrect a topic the admin deleted, and
    // re-assert a name/colour/emoji he changed, on the next deploy — the seed
    // only ever describes the state of a brand-new installation. Rows that
    // already exist (renamed, recoloured, hidden with isActive = 0, or deleted
    // outright) are therefore left exactly as they are.
    //
    // v36: the guard is now a SEPARATE read followed by a plain multi-row
    // VALUES insert. It used to be one `INSERT ... SELECT ... FROM (SELECT ...
    // UNION ALL ...) AS seed WHERE NOT EXISTS (SELECT 1 FROM task_topics)` —
    // a statement whose guard subquery reads the very table the statement
    // writes. MySQL does run that correctly (verified against 9.7: five rows on
    // an empty table, zero on a re-run), but it is the shape MySQL documents
    // under "you cannot modify a table and select from the same table in a
    // subquery", its outcome depends on whether the optimizer materializes the
    // derived table, and neither property is something a mocked-DB test in this
    // repo can pin down — nor something TiDB has to share. Two plain statements
    // depend on none of it. withTransaction() cannot be used here because it
    // awaits the very init promise this bootstrap is fulfilling.
    const [seededRows] = await connection.query<RowDataPacket[]>(
      "SELECT 1 FROM task_topics LIMIT 1"
    );
    if (seededRows.length === 0) {
      // Colour must be a token the UI can actually render (TASK_TOPIC_COLORS in
      // app/lib/types.ts). v35 shipped 'emerald' and 'violet', which are not in
      // that list, so those two topics drew neutral grey everywhere.
      const defaultTopics: Array<[number, string, string, string, number]> = [
        [1, "โทรหาลูกค้า", "📞", "blue", 1],
        [2, "นัดเข้าไปหาลูกค้า", "🚗", "green", 2],
        [3, "รอทำใบเสนอราคา", "📄", "amber", 3],
        [4, "นัดเข้า Service", "🔧", "purple", 4],
        [5, "อื่นๆ", "📌", "slate", 5],
      ];
      const seededAt = new Date().toISOString();
      try {
        await connection.query(
          `INSERT INTO task_topics (id, name, icon, color, sortOrder, isActive, createdAt)
           VALUES ${defaultTopics.map(() => "(?, ?, ?, ?, ?, 1, ?)").join(", ")}`,
          defaultTopics.flatMap(([id, name, icon, color, sortOrder]) => [
            id,
            name,
            icon,
            color,
            sortOrder,
            seededAt,
          ])
        );
      } catch (error) {
        // Two instances booting at once legitimately race here: both see an
        // empty table and both try to insert ids 1-5. The loser hits a
        // duplicate primary key / lock timeout / TiDB write conflict — in every
        // one of those cases the winner wrote exactly these same rows, so
        // standing down is correct and must NOT fail the whole bootstrap.
        if (!isConcurrentWriteError(error)) throw error;
        // ...but "the winner owns it" is a CLAIM, and it is only true if the
        // rows are actually there now. Verify before standing down: TiDB
        // reports "Information schema is changed ... try again later" for DML
        // that follows DDL closely — exactly this statement's position in the
        // bootstrap — and that message matches the concurrent-write hints. Left
        // unchecked, one such error would leave the board with NO topics AT ALL
        // and nothing would ever say so: schema_version gets stamped and the
        // seed is never attempted again.
        const [afterRows] = await connection.query<RowDataPacket[]>(
          "SELECT 1 FROM task_topics LIMIT 1"
        );
        if (afterRows.length === 0) throw error;
        console.warn(
          "task_topics seed lost a race with a concurrent bootstrap; the other instance owns it:",
          (error as { code?: string }).code
        );
      }
    }

    // v36 repair: v35 seeded topics 2 and 4 with the colour tokens 'emerald'
    // and 'violet', neither of which the app has ever had — they render neutral
    // grey, and `cleanColor` REJECTS them, so the admin cannot even save an
    // edit to such a row without the modal quietly switching its colour. No UI
    // can produce either value, so a row still holding one came from that seed
    // and nothing else: mapping them onto the nearest real tokens repairs what
    // was shipped without touching a colour anybody chose.
    for (const [shipped, replacement] of [
      ["emerald", "green"],
      ["violet", "purple"],
    ]) {
      await connection.query("UPDATE task_topics SET color = ? WHERE color = ?", [
        replacement,
        shipped,
      ]);
    }

    // ── Recurring expense templates (v29) ────────────────────────────────────
    // A template for a monthly cost (rent, salary, ...) that repeats every
    // month with the same amount. Generation is a manual, explicit admin
    // action (POST .../recurring/generate) — never a silent background cron
    // — so a real `expenses` row only ever appears because someone clicked
    // the button, matching the project-wide "never lose/silently mutate
    // financial data" rule. lastGeneratedMonth ("YYYY-MM") prevents
    // generating the same template twice for the same month.
    await connection.query(`
        CREATE TABLE IF NOT EXISTS recurring_expenses (
          id VARCHAR(36) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          category VARCHAR(100) NOT NULL DEFAULT '',
          note TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          lastGeneratedMonth VARCHAR(7),
          createdAt VARCHAR(255) NOT NULL
        )
      `);

    // Traceability only — which recurring template (if any) generated a given
    // expense row. ON DELETE SET NULL: deleting a template must never delete
    // (or otherwise touch) the real expense rows it already generated.
    try {
      await connection.query(
        `ALTER TABLE expenses ADD COLUMN recurringExpenseId VARCHAR(36) DEFAULT NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }
    try {
      await connection.query(
        `ALTER TABLE expenses ADD CONSTRAINT fk_exp_recurring FOREIGN KEY (recurringExpenseId) REFERENCES recurring_expenses(id) ON DELETE SET NULL`
      );
    } catch (error) {
      if (!isBenignSchemaError(error)) throw error;
    }

    // ── v33 backfill: one line item per pre-existing sale ──────────────────
    // Runs after ALL v33 DDL above, so both sales_record_items and
    // sale_cost_items exist. Reporting queries move to sales_record_items in
    // this release, so a sale left without a line item would silently drop its
    // revenue from "สินค้าขายดี" / "รายได้ตามหมวดหมู่" — hence NO filter here:
    // every sale is covered, including saleType='service' and rows with an
    // empty productId (they land in the existing "ไม่ระบุสินค้า"/"ไม่ระบุหมวด"
    // buckets, which is what the pre-migration queries already did).
    //
    // Purely additive and idempotent: a single INSERT ... SELECT guarded by
    // WHERE NOT EXISTS, so a sale that already has ANY line item is skipped and
    // a second run inserts nothing. It never UPDATEs or DELETEs a row in any
    // table — sales_records.totalAmount/costAmount and sale_cost_items are left
    // exactly as they are.
    //
    // costAmount is the product-cost SHARE of the old cached total, i.e. the old
    // sales_records.costAmount minus the bill-level cost items that keep living
    // in sale_cost_items — so the composition rule above reproduces the very
    // same total and no historical figure moves. Legacy `product_cost` rows are
    // intentionally NOT subtracted (they are no longer summed) and NOT deleted.
    // GREATEST(0, …) guards the odd legacy row whose cost items already exceed
    // the cached total, which would otherwise write a negative cost.
    //
    // ids: the sale's OWN id is reused as its backfilled line item's id instead
    // of UUID() (which TiDB does support). It is deterministic, so if two
    // instances boot and run this at the same time the loser collides on the
    // PRIMARY KEY and writes nothing, rather than inserting a SECOND line item
    // for the same sale under a fresh random id — a duplicate that would double
    // that sale's historical revenue with no unique constraint to catch it.
    // Line items created from here on still use crypto.randomUUID() in the app.
    //
    // A single statement is atomic on its own; withTransaction() cannot be used
    // here because it awaits the very init promise this bootstrap is fulfilling.
    try {
      await connection.query(`
        INSERT INTO sales_record_items
          (id, salesRecordId, productId, productName, categoryId, qty,
           unitPrice, totalAmount, costAmount, quotationItemId, sortOrder, createdAt)
        SELECT
          sr.id,
          sr.id,
          sr.productId,
          sr.productName,
          sr.categoryId,
          sr.qty,
          sr.unitPrice,
          sr.totalAmount,
          GREATEST(0, sr.costAmount - COALESCE((
            SELECT SUM(sci.amount)
            FROM sale_cost_items sci
            WHERE sci.salesRecordId = sr.id
              AND sci.costType <> 'product_cost'
          ), 0)),
          NULL,
          0,
          sr.createdAt
        FROM sales_records sr
        WHERE NOT EXISTS (
          SELECT 1 FROM sales_record_items sri WHERE sri.salesRecordId = sr.id
        )
      `);
    } catch (error) {
      // Only a concurrent bootstrap racing us is benign — the other instance is
      // writing (or already wrote) exactly these rows, so failing the whole
      // bootstrap over it would take the app down for nothing. Any other error
      // propagates, so schema_version is never stamped over a skipped backfill.
      if (!isConcurrentWriteError(error)) throw error;
      console.warn(
        "v33 line-item backfill lost a race with a concurrent bootstrap; the other instance owns it:",
        (error as { code?: string }).code
      );
    }

    // ── Seed default admin user ────────────────────────────────────────────
    // Credentials come from the environment, never from source. If
    // ADMIN_PASSWORD is unset we skip the seed instead of creating a weak
    // default account. ADMIN_USERNAME defaults to "admin".
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminPassword) {
      // Only hash + insert when the admin row is absent — bcrypt(cost 12) is
      // ~250ms of CPU, wasted on every run where the account already exists.
      const [adminRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE id = 'admin-001' LIMIT 1"
      );
      if (adminRows.length === 0) {
        const adminUsername = process.env.ADMIN_USERNAME || "admin";
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await connection.query(
          "INSERT IGNORE INTO users (id, username, passwordHash, createdAt) VALUES (?, ?, ?, ?)",
          ["admin-001", adminUsername, passwordHash, new Date().toISOString()]
        );
      }
    } else {
      console.warn(
        "ADMIN_PASSWORD not set — skipping admin user seed. Set ADMIN_PASSWORD to create/seed the admin account."
      );
    }

    // ── Seed product categories ────────────────────────────────────────────
    // const seedCategories = [
    //   { id: 0, th: "เครื่องมือวัดขนาด", en: "Measuring Tools", zh: "测量工具" },
    //   { id: 1, th: "ตู้อบความร้อน", en: "Heating Ovens", zh: "加热箱" },
    //   { id: 2, th: "เครื่องทดสอบวัสดุ", en: "Material Testers", zh: "材料测试仪" },
    //   { id: 3, th: "เครื่องวัดสี", en: "Color Meters", zh: "色差仪" },
    //   { id: 4, th: "เครื่องชั่งดิจิตอล", en: "Digital Balances", zh: "数显台秤" },
    //   { id: 5, th: "เครื่องชั่งความละเอียดสูง", en: "Precision Balances", zh: "精密天平" },
    //   { id: 6, th: "เครื่องมือทดสอบอื่นๆ", en: "Other Testers", zh: "其他测试仪" },
    // ];
    // for (const cat of seedCategories) {
    //   await connection.query(
    //     "INSERT IGNORE INTO product_categories (id, name_th, name_en, name_zh, sortOrder) VALUES (?, ?, ?, ?, ?)",
    //     [cat.id, cat.th, cat.en, cat.zh, cat.id]
    //   );
    // }

    // ── Seed products ──────────────────────────────────────────────────────
    // const seedProducts = [
    //   { id: "digital-caliper", categoryId: 0, image: "/images/digital-caliper.png", title_th: "เวอร์เนียร์ดิจิตอล", title_en: "Digital Caliper", title_zh: "数显卡尺", desc_th: "เครื่องมือวัดขนาดภายนอก ภายใน และความลึกแบบดิจิตอลความแม่นยำสูง", desc_en: "High-precision digital tool for measuring internal, external, and depth dimensions.", desc_zh: "高精度数显工具，用于测量内外径及深度尺寸。" },
    //   { id: "micrometer", categoryId: 0, image: "/images/micrometer.png", title_th: "ไมโครมิเตอร์", title_en: "Micrometer", title_zh: "千分尺", desc_th: "เครื่องมือวัดขนาดที่มีความละเอียดสูงพิเศษ สำหรับงานวิศวกรรมที่ต้องการความแม่นยำ", desc_en: "Ultra-high resolution measuring tool for precision engineering tasks.", desc_zh: "超高分辨率测量工具，适用于精密工程任务。" },
    //   { id: "dial-gauge", categoryId: 0, image: "/images/dial-gauge.png", title_th: "ไดอัลเกจ", title_en: "Dial Gauge", title_zh: "百分表", desc_th: "เครื่องมือวัดความคลาดเคลื่อนของตำแหน่งและระนาบ", desc_en: "Instrument for measuring position and flatness deviations.", desc_zh: "用于测量位置和平面度偏差的仪器。" },
    //   { id: "industrial-hot-air-oven", categoryId: 1, image: "/images/industrial-oven.png", title_th: "ตู้อบลมร้อนอุตสาหกรรม", title_en: "Industrial Hot Air Oven", title_zh: "工业热风烘箱", desc_th: "ตู้อบความร้อนสูงสำหรับการแปรรูปและทดสอบวัสดุในอุตสาหกรรม", desc_en: "High-temperature oven for material processing and industrial testing.", desc_zh: "用于材料处理和工业测试的高温烘箱。" },
    //   { id: "laboratory-drying-oven", categoryId: 1, image: "/images/hot-air-oven.png", title_th: "ตู้อบแห้งในห้องปฏิบัติการ", title_en: "Laboratory Drying Oven", title_zh: "实验室干燥箱", desc_th: "ตู้อบสำหรับงานวิเคราะห์และอบแห้งเครื่องแก้วในห้องแล็บ", desc_en: "Oven for analytical tasks and drying glassware in laboratories.", desc_zh: "用于实验室分析任务和玻璃器皿干燥的烘箱。" },
    //   { id: "vacuum-drying-oven", categoryId: 1, image: "/images/industrial-oven.png", title_th: "ตู้อบสุญญากาศ", title_en: "Vacuum Drying Oven", title_zh: "真空干燥箱", desc_th: "ตู้อบความร้อนในสภาวะสุญญากาศ ป้องกันการเกิดปฏิกิริยาออกซิเดชัน", desc_en: "Heat treatment in vacuum conditions to prevent oxidation.", desc_zh: "真空条件下的热处理，防止氧化。" },
    //   { id: "cof-tester", categoryId: 2, image: "/images/cof-tester.png", title_th: "เครื่องวัดค่า COF", title_en: "COF Tester", title_zh: "摩擦系数测试仪", desc_th: "วัดค่าสัมประสิทธิ์แรงเสียดทานของฟิล์มและบรรจุภัณฑ์", desc_en: "Measure coefficient of friction for films and packaging.", desc_zh: "测量薄膜和包装材料的摩擦系数。" },
    //   { id: "viscometer", categoryId: 2, image: "/images/viscometer.png", title_th: "เครื่องวัดความหนืด", title_en: "Viscometer", title_zh: "粘度计", desc_th: "วัดค่าความหนืดของของเหลว สี หมึก กาว และอื่นๆ", desc_en: "Measure viscosity of liquids, paints, inks, and adhesives.", desc_zh: "测量液体、油漆、油墨和粘合剂的粘度。" },
    //   { id: "film-thickness-gauge", categoryId: 2, image: "/images/film-tester.png", title_th: "เครื่องวัดความหนาฟิล์ม", title_en: "Film Thickness Gauge", title_zh: "薄膜测厚仪", desc_th: "วัดความหนาของแผ่นฟิล์มและพลาสติกแบบละเอียด", desc_en: "Precise measurement of film and plastic sheet thickness.", desc_zh: "精确测量薄膜和塑料片的厚度。" },
    //   { id: "portable-colorimeter", categoryId: 3, image: "/images/colorimeter.png", title_th: "เครื่องวัดสี", title_en: "Portable Colorimeter", title_zh: "便携式色差仪", desc_th: "เครื่องวัดสีแบบพกพา แม่นยำสูง สำหรับงานควบคุมคุณภาพ", desc_en: "High-precision portable color meter for quality control.", desc_zh: "高精度便携式色差仪，用于质量控制。" },
    //   { id: "spectrophotometer", categoryId: 3, image: "/images/colorimeter.png", title_th: "สเปกโตรโฟโตมิเตอร์", title_en: "Spectrophotometer", title_zh: "分光光度计", desc_th: "วิเคราะห์ค่าสีเชิงลึกและวัดค่าการสะท้อนแสง", desc_en: "In-depth color analysis and light reflectance measurement.", desc_zh: "深入的颜色分析和光反射率测量。" },
    //   { id: "gloss-meter", categoryId: 3, image: "/images/colorimeter.png", title_th: "เครื่องวัดความเงา", title_en: "Gloss Meter", title_zh: "光泽度计", desc_th: "วัดค่าความเงาของพื้นผิววัสดุหลายมุมมอง", desc_en: "Measure surface gloss of materials from multiple angles.", desc_zh: "从多个角度测量材料的表面光泽度。" },
    //   { id: "digital-bench-scale", categoryId: 4, image: "/images/bench-scale.png", title_th: "เครื่องชั่งตั้งโต๊ะดิจิตอล", title_en: "Digital Bench Scale", title_zh: "数显台秤", desc_th: "เครื่องชั่งตั้งโต๊ะความแม่นยำสูงสำหรับงานทั่วไป", desc_en: "High-precision bench scale for general purposes.", desc_zh: "用于通用目的的高精度台秤。" },
    //   { id: "counting-scale", categoryId: 4, image: "/images/bench-scale.png", title_th: "เครื่องชั่งนับจำนวน", title_en: "Counting Scale", title_zh: "计数秤", desc_th: "ฟังก์ชันนับจำนวนชิ้นงานความแม่นยำสูง", desc_en: "High-precision piece counting function.", desc_zh: "高精度的零件计数功能。" },
    //   { id: "waterproof-table-scale", categoryId: 4, image: "/images/bench-scale.png", title_th: "เครื่องชั่งกันน้ำ", title_en: "Waterproof Table Scale", title_zh: "防水桌秤", desc_th: "ทนทานต่อความชื้นและน้ำ เหมาะสำหรับอุตสาหกรรมอาหาร", desc_en: "Moisture and water resistant, ideal for food industry.", desc_zh: "防潮防水，是食品行业的理想选择。" },
    //   { id: "analytical-balance", categoryId: 5, image: "/images/analytical-balance.png", title_th: "เครื่องชั่งวิเคราะห์", title_en: "Analytical Balance", title_zh: "分析天平", desc_th: "ความละเอียดสูงพิเศษ 4-5 ตำแหน่ง สำหรับงานแล็บ", desc_en: "Ultra-high resolution (4-5 digits) for laboratory work.", desc_zh: "超高分辨率（4-5位），用于实验室工作。" },
    //   { id: "precision-balance", categoryId: 5, image: "/images/precision-balance.png", title_th: "เครื่องชั่งความแม่นยำสูง", title_en: "Precision Balance", title_zh: "精密天平", desc_th: "ชั่งน้ำหนักได้รวดเร็วและแม่นยำ พร้อมระบบกันลม", desc_en: "Fast and accurate weighing with windshield system.", desc_zh: "配备防风罩系统的快速准确称重。" },
    //   { id: "durometer", categoryId: 6, image: "/images/hardness-tester.png", title_th: "เครื่องวัดความแข็ง", title_en: "Durometer", title_zh: "邵氏硬度计", desc_th: "วัดความแข็งของโลหะ พลาสติก และยาง", desc_en: "Measure hardness of metals, plastics, and rubber.", desc_zh: "测量金属、塑料和橡胶的硬度值。" },
    //   { id: "leak-tester", categoryId: 6, image: "/images/leak-tester.png", title_th: "เครื่องทดสอบการรั่วซึม", title_en: "Leak Tester", title_zh: "泄漏测试仪", desc_th: "ตรวจสอบความสมบูรณ์ของบรรจุภัณฑ์", desc_en: "Check the integrity of packaging.", desc_zh: "检查包装的完整性。" },
    // ];
    // const now = new Date().toISOString();
    // for (const p of seedProducts) {
    //   await connection.query(
    //     "INSERT IGNORE INTO products (id, categoryId, image, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, createdAt, isPublished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    //     [p.id, p.categoryId, p.image, p.title_th, p.title_en, p.title_zh, p.desc_th, p.desc_en, p.desc_zh, now, true]
    //   );
    // }

    // Record the schema version so future cold instances take the fast path.
    await connection.query(
      "INSERT INTO settings (name, value) VALUES ('schema_version', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [String(SCHEMA_VERSION)]
    );

  } finally {
    connection.release();
  }
}

// Bootstrap runs once per process — often on a serverless cold start, where the
// first DB round-trip can hit a transient connection error (TiDB drops idle
// sockets; the region hop makes cold connects flaky). Retry the whole block on
// transient errors: it is idempotent (CREATE IF NOT EXISTS / INSERT IGNORE), so
// re-running is safe, and mysql2 discards a fatally-errored connection on
// release, so each attempt acquires a fresh one. Without this, one flaky cold
// connection 500s the first page request (while /api/health, which skips init,
// still looks healthy).
async function initializeDb(): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await bootstrapSchemaOnce();
      return;
    } catch (error) {
      lastError = error;
      if (isTransientDbError(error) && attempt < MAX_ATTEMPTS) {
        console.warn(
          `DB init transient error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying:`,
          (error as { code?: string }).code
        );
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      console.error("Failed to initialize database table:", error);
      throw error;
    }
  }
  throw lastError;
}

// Memoize initialization as a single shared promise so concurrent cold-start
// callers await ONE init run instead of each racing the full CREATE/seed block.
export async function getDbConnection(): Promise<DbPool> {
  if (!globalForDb._initPromise) {
    globalForDb._initPromise = initializeDb().catch((error) => {
      // Clear on failure so a later call can retry initialization.
      globalForDb._initPromise = undefined;
      throw error;
    });
  }
  await globalForDb._initPromise;
  return pool;
}

// Run statements inside a single transaction on one pooled connection, for
// multi-statement operations that must be atomic (id allocation, reordering).
// A thrown error rolls the whole thing back instead of leaving partial writes.
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const p = await getDbConnection();
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  // Retry the whole transaction on a TRANSIENT connection error (a stale TiDB
  // socket surfaces as PROTOCOL_CONNECTION_LOST on beginTransaction, before any
  // work). Each attempt acquires a FRESH pooled connection (mysql2 discards the
  // errored one on release), rollback discards any partial work, and callers
  // pass idempotent bodies — so retrying is safe and mirrors query()'s behavior.
  // Without this, saves that the old query()-based path would have retried now
  // spuriously 500 after an idle period.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const conn = await p.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        /* ignore rollback failure */
      }
      lastError = error;
      // Business errors (e.g. DocNoConflictError) have no transient DB code, so
      // they propagate immediately instead of being retried.
      if (!isTransientDbError(error) || attempt === MAX_ATTEMPTS) throw error;
      console.warn(
        `DB transaction transient error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying:`,
        (error as { code?: string }).code
      );
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    } finally {
      conn.release();
    }
  }
  throw lastError;
}

// ── Query helper with transient-error retry ──────────────────────────────────
//
// Cloud databases (TiDB Cloud here) close idle connections server-side, so a
// pooled connection can be dead by the time we use it — surfacing as
// `ECONNRESET` / `PROTOCOL_CONNECTION_LOST` on the next query. mysql2 discards
// the broken socket when a query errors, so retrying simply acquires a fresh
// connection. Use this instead of `pool.query` for all app queries.
//
// Safe for the writes in this schema: every INSERT uses an explicit primary key,
// so a rare "committed but ack lost" retry fails with a duplicate-key error
// rather than double-inserting; UPDATE/DELETE are idempotent.
const TRANSIENT_DB_ERROR_CODES = new Set([
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ER_CON_COUNT_ERROR",
]);

function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code;
  return code !== undefined && TRANSIENT_DB_ERROR_CODES.has(code);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: string } | null | undefined)?.code === "ER_DUP_ENTRY";
}

// Errors that mean "another writer got there first / is holding the rows right
// now", as opposed to a broken statement. Only used by the idempotent v33
// backfill, where two instances booting at once legitimately race: the loser
// hits a duplicate primary key (ids are derived from the sale id), a lock
// timeout/deadlock, or TiDB's optimistic write conflict — in every one of those
// cases the winner writes exactly the same rows, so the loser can stand down.
const CONCURRENT_WRITE_ERROR_CODES = new Set([
  "ER_DUP_ENTRY",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);

// TiDB's write conflict (errno 9007) has no mysql2 code mapping, so it is
// matched on message text.
const WRITE_CONFLICT_MESSAGE_HINTS = ["write conflict", "try again later"];

function isConcurrentWriteError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; sqlMessage?: string } | null | undefined;
  if (err?.code !== undefined && CONCURRENT_WRITE_ERROR_CODES.has(err.code)) return true;
  const text = `${err?.message ?? ""} ${err?.sqlMessage ?? ""}`.toLowerCase();
  return WRITE_CONFLICT_MESSAGE_HINTS.some((hint) => text.includes(hint));
}

// Errors that are genuinely safe to ignore when running the idempotent schema
// migrations (ADD COLUMN / CREATE INDEX): the column/index already exists, or
// the engine doesn't support the `IF NOT EXISTS` syntax. Anything else (lock
// timeout, permission, connection) is a REAL failure that must propagate so the
// migration is retried/surfaced instead of being silently — and permanently —
// skipped while schema_version gets stamped anyway.
const BENIGN_SCHEMA_ERROR_CODES = new Set([
  "ER_DUP_FIELDNAME", // column already exists
  "ER_DUP_KEYNAME", // index already exists
  "ER_PARSE_ERROR", // `IF NOT EXISTS` syntax unsupported on this engine
  "ER_FK_DUP_NAME", // foreign key already exists
  "ER_DUP_KEY", // duplicate key/constraint
]);

// ER_CANT_CREATE_TABLE (1005) is a generic wrapper MySQL/TiDB uses for many
// different `ALTER TABLE ADD CONSTRAINT` failures. "the constraint name
// already exists" — the case this bootstrap re-runs into on every deploy — is
// truly benign, but the SAME code also covers a constraint that genuinely
// can't be created (existing data violates it, the referenced column isn't
// indexed, a type/collation mismatch): those must NOT be swallowed, or the FK
// (and whatever ON DELETE CASCADE behavior the app relies on, e.g. deleting
// an equipment cascading to its schedules/logs) silently never exists while
// schema_version still gets stamped as if it did. Telling them apart needs
// the message text, not just the code.
const DUPLICATE_CONSTRAINT_MESSAGE_HINTS = ["duplicate", "already exists"];

function isBenignSchemaError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; sqlMessage?: string } | null | undefined;
  const code = err?.code;
  if (code === undefined) return false;
  if (BENIGN_SCHEMA_ERROR_CODES.has(code)) return true;
  if (code === "ER_CANT_CREATE_TABLE") {
    const text = `${err?.message ?? ""} ${err?.sqlMessage ?? ""}`.toLowerCase();
    return DUPLICATE_CONSTRAINT_MESSAGE_HINTS.some((hint) => text.includes(hint));
  }
  return false;
}

// ── Lightweight connectivity probe (for /api/health) ─────────────────────────
//
// Deliberately does NOT call getDbConnection(), so it never triggers the
// CREATE TABLE / seed bootstrap — it only answers "can we reach the database
// right now?". One retry absorbs a stale pooled socket (TiDB drops idle
// connections server-side; mysql2 discards the broken one on error, so a retry
// grabs a fresh connection). Returns the round-trip latency in ms.
export async function pingDb(): Promise<{ latencyMs: number }> {
  const start = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await pool.query("SELECT 1");
      return { latencyMs: Date.now() - start };
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isTransientDbError(error)) throw error;
    }
  }
  throw lastError;
}

export async function query<T extends QueryResult>(
  sql: string,
  params?: unknown[]
): Promise<[T, FieldPacket[]]> {
  const db = await getDbConnection();
  const MAX_ATTEMPTS = 3;
  const isInsert = /^\s*insert/i.test(sql);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db.query<T>(sql, params);
    } catch (error) {
      // A duplicate-key error on a RETRY of an INSERT almost always means the
      // previous attempt actually committed but its ack was lost to a transient
      // error. Treat it as success rather than surfacing a spurious failure —
      // safe here because every INSERT uses an explicit primary key and no
      // caller reads insertId.
      if (attempt > 1 && isInsert && isDuplicateKeyError(error)) {
        return [{ affectedRows: 0, insertId: 0, warningStatus: 0 } as unknown as T, []];
      }
      lastError = error;
      if (!isTransientDbError(error) || attempt === MAX_ATTEMPTS) throw error;
      console.warn(
        `DB transient error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying:`,
        (error as { code?: string }).code
      );
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}
