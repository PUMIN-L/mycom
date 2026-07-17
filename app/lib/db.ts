import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import type { QueryResult, FieldPacket } from "mysql2";

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
    connectionLimit: 10,
    // Recycle idle connections before the cloud DB (TiDB) drops them, and keep
    // sockets warm. Stale connections still happen, so query() also retries.
    maxIdle: 10,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 30_000,
  });
}

const pool: DbPool = globalForDb._pool ?? (globalForDb._pool = createPool());

async function initializeDb(): Promise<void> {
  const connection = await pool.getConnection();
  try {
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
      } catch {
        // Ignore if already exists or not supported
      }

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
          isPublished BOOLEAN DEFAULT TRUE
        )
      `);
      
      try {
        await connection.query(
          `ALTER TABLE products ADD COLUMN IF NOT EXISTS isPublished BOOLEAN DEFAULT TRUE`
        );
      } catch {
        // Ignore if already exists or not supported
      }
      
      try {
        await connection.query(
          `CREATE INDEX idx_products_category_created ON products (categoryId, createdAt)`
        );
      } catch {
        // Ignore if index already exists
      }

      // ── Seed default admin user ────────────────────────────────────────────
      // Credentials come from the environment, never from source. If
      // ADMIN_PASSWORD is unset we skip the seed instead of creating a weak
      // default account. ADMIN_USERNAME defaults to "admin".
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (adminPassword) {
        const adminUsername = process.env.ADMIN_USERNAME || "admin";
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await connection.query(
          "INSERT IGNORE INTO users (id, username, passwordHash, createdAt) VALUES (?, ?, ?, ?)",
          ["admin-001", adminUsername, passwordHash, new Date().toISOString()]
        );
      } else {
        console.warn(
          "ADMIN_PASSWORD not set — skipping admin user seed. Set ADMIN_PASSWORD to create/seed the admin account."
        );
      }

      // ── Seed product categories ────────────────────────────────────────────
      const seedCategories = [
        { id: 0, th: "เครื่องมือวัดขนาด", en: "Measuring Tools", zh: "测量工具" },
        { id: 1, th: "ตู้อบความร้อน", en: "Heating Ovens", zh: "加热箱" },
        { id: 2, th: "เครื่องทดสอบวัสดุ", en: "Material Testers", zh: "材料测试仪" },
        { id: 3, th: "เครื่องวัดสี", en: "Color Meters", zh: "色差仪" },
        { id: 4, th: "เครื่องชั่งดิจิตอล", en: "Digital Balances", zh: "数显台秤" },
        { id: 5, th: "เครื่องชั่งความละเอียดสูง", en: "Precision Balances", zh: "精密天平" },
        { id: 6, th: "เครื่องมือทดสอบอื่นๆ", en: "Other Testers", zh: "其他测试仪" },
      ];
      for (const cat of seedCategories) {
        await connection.query(
          "INSERT IGNORE INTO product_categories (id, name_th, name_en, name_zh, sortOrder) VALUES (?, ?, ?, ?, ?)",
          [cat.id, cat.th, cat.en, cat.zh, cat.id]
        );
      }

      // ── Seed products ──────────────────────────────────────────────────────
      const seedProducts = [
        { id: "digital-caliper", categoryId: 0, image: "/images/digital-caliper.png", title_th: "เวอร์เนียร์ดิจิตอล", title_en: "Digital Caliper", title_zh: "数显卡尺", desc_th: "เครื่องมือวัดขนาดภายนอก ภายใน และความลึกแบบดิจิตอลความแม่นยำสูง", desc_en: "High-precision digital tool for measuring internal, external, and depth dimensions.", desc_zh: "高精度数显工具，用于测量内外径及深度尺寸。" },
        { id: "micrometer", categoryId: 0, image: "/images/micrometer.png", title_th: "ไมโครมิเตอร์", title_en: "Micrometer", title_zh: "千分尺", desc_th: "เครื่องมือวัดขนาดที่มีความละเอียดสูงพิเศษ สำหรับงานวิศวกรรมที่ต้องการความแม่นยำ", desc_en: "Ultra-high resolution measuring tool for precision engineering tasks.", desc_zh: "超高分辨率测量工具，适用于精密工程任务。" },
        { id: "dial-gauge", categoryId: 0, image: "/images/dial-gauge.png", title_th: "ไดอัลเกจ", title_en: "Dial Gauge", title_zh: "百分表", desc_th: "เครื่องมือวัดความคลาดเคลื่อนของตำแหน่งและระนาบ", desc_en: "Instrument for measuring position and flatness deviations.", desc_zh: "用于测量位置和平面度偏差的仪器。" },
        { id: "industrial-hot-air-oven", categoryId: 1, image: "/images/industrial-oven.png", title_th: "ตู้อบลมร้อนอุตสาหกรรม", title_en: "Industrial Hot Air Oven", title_zh: "工业热风烘箱", desc_th: "ตู้อบความร้อนสูงสำหรับการแปรรูปและทดสอบวัสดุในอุตสาหกรรม", desc_en: "High-temperature oven for material processing and industrial testing.", desc_zh: "用于材料处理和工业测试的高温烘箱。" },
        { id: "laboratory-drying-oven", categoryId: 1, image: "/images/hot-air-oven.png", title_th: "ตู้อบแห้งในห้องปฏิบัติการ", title_en: "Laboratory Drying Oven", title_zh: "实验室干燥箱", desc_th: "ตู้อบสำหรับงานวิเคราะห์และอบแห้งเครื่องแก้วในห้องแล็บ", desc_en: "Oven for analytical tasks and drying glassware in laboratories.", desc_zh: "用于实验室分析任务和玻璃器皿干燥的烘箱。" },
        { id: "vacuum-drying-oven", categoryId: 1, image: "/images/industrial-oven.png", title_th: "ตู้อบสุญญากาศ", title_en: "Vacuum Drying Oven", title_zh: "真空干燥箱", desc_th: "ตู้อบความร้อนในสภาวะสุญญากาศ ป้องกันการเกิดปฏิกิริยาออกซิเดชัน", desc_en: "Heat treatment in vacuum conditions to prevent oxidation.", desc_zh: "真空条件下的热处理，防止氧化。" },
        { id: "cof-tester", categoryId: 2, image: "/images/cof-tester.png", title_th: "เครื่องวัดค่า COF", title_en: "COF Tester", title_zh: "摩擦系数测试仪", desc_th: "วัดค่าสัมประสิทธิ์แรงเสียดทานของฟิล์มและบรรจุภัณฑ์", desc_en: "Measure coefficient of friction for films and packaging.", desc_zh: "测量薄膜和包装材料的摩擦系数。" },
        { id: "viscometer", categoryId: 2, image: "/images/viscometer.png", title_th: "เครื่องวัดความหนืด", title_en: "Viscometer", title_zh: "粘度计", desc_th: "วัดค่าความหนืดของของเหลว สี หมึก กาว และอื่นๆ", desc_en: "Measure viscosity of liquids, paints, inks, and adhesives.", desc_zh: "测量液体、油漆、油墨和粘合剂的粘度。" },
        { id: "film-thickness-gauge", categoryId: 2, image: "/images/film-tester.png", title_th: "เครื่องวัดความหนาฟิล์ม", title_en: "Film Thickness Gauge", title_zh: "薄膜测厚仪", desc_th: "วัดความหนาของแผ่นฟิล์มและพลาสติกแบบละเอียด", desc_en: "Precise measurement of film and plastic sheet thickness.", desc_zh: "精确测量薄膜和塑料片的厚度。" },
        { id: "portable-colorimeter", categoryId: 3, image: "/images/colorimeter.png", title_th: "เครื่องวัดสี", title_en: "Portable Colorimeter", title_zh: "便携式色差仪", desc_th: "เครื่องวัดสีแบบพกพา แม่นยำสูง สำหรับงานควบคุมคุณภาพ", desc_en: "High-precision portable color meter for quality control.", desc_zh: "高精度便携式色差仪，用于质量控制。" },
        { id: "spectrophotometer", categoryId: 3, image: "/images/colorimeter.png", title_th: "สเปกโตรโฟโตมิเตอร์", title_en: "Spectrophotometer", title_zh: "分光光度计", desc_th: "วิเคราะห์ค่าสีเชิงลึกและวัดค่าการสะท้อนแสง", desc_en: "In-depth color analysis and light reflectance measurement.", desc_zh: "深入的颜色分析和光反射率测量。" },
        { id: "gloss-meter", categoryId: 3, image: "/images/colorimeter.png", title_th: "เครื่องวัดความเงา", title_en: "Gloss Meter", title_zh: "光泽度计", desc_th: "วัดค่าความเงาของพื้นผิววัสดุหลายมุมมอง", desc_en: "Measure surface gloss of materials from multiple angles.", desc_zh: "从多个角度测量材料的表面光泽度。" },
        { id: "digital-bench-scale", categoryId: 4, image: "/images/bench-scale.png", title_th: "เครื่องชั่งตั้งโต๊ะดิจิตอล", title_en: "Digital Bench Scale", title_zh: "数显台秤", desc_th: "เครื่องชั่งตั้งโต๊ะความแม่นยำสูงสำหรับงานทั่วไป", desc_en: "High-precision bench scale for general purposes.", desc_zh: "用于通用目的的高精度台秤。" },
        { id: "counting-scale", categoryId: 4, image: "/images/bench-scale.png", title_th: "เครื่องชั่งนับจำนวน", title_en: "Counting Scale", title_zh: "计数秤", desc_th: "ฟังก์ชันนับจำนวนชิ้นงานความแม่นยำสูง", desc_en: "High-precision piece counting function.", desc_zh: "高精度的零件计数功能。" },
        { id: "waterproof-table-scale", categoryId: 4, image: "/images/bench-scale.png", title_th: "เครื่องชั่งกันน้ำ", title_en: "Waterproof Table Scale", title_zh: "防水桌秤", desc_th: "ทนทานต่อความชื้นและน้ำ เหมาะสำหรับอุตสาหกรรมอาหาร", desc_en: "Moisture and water resistant, ideal for food industry.", desc_zh: "防潮防水，是食品行业的理想选择。" },
        { id: "analytical-balance", categoryId: 5, image: "/images/analytical-balance.png", title_th: "เครื่องชั่งวิเคราะห์", title_en: "Analytical Balance", title_zh: "分析天平", desc_th: "ความละเอียดสูงพิเศษ 4-5 ตำแหน่ง สำหรับงานแล็บ", desc_en: "Ultra-high resolution (4-5 digits) for laboratory work.", desc_zh: "超高分辨率（4-5位），用于实验室工作。" },
        { id: "precision-balance", categoryId: 5, image: "/images/precision-balance.png", title_th: "เครื่องชั่งความแม่นยำสูง", title_en: "Precision Balance", title_zh: "精密天平", desc_th: "ชั่งน้ำหนักได้รวดเร็วและแม่นยำ พร้อมระบบกันลม", desc_en: "Fast and accurate weighing with windshield system.", desc_zh: "配备防风罩系统的快速准确称重。" },
        { id: "durometer", categoryId: 6, image: "/images/hardness-tester.png", title_th: "เครื่องวัดความแข็ง", title_en: "Durometer", title_zh: "邵氏硬度计", desc_th: "วัดความแข็งของโลหะ พลาสติก และยาง", desc_en: "Measure hardness of metals, plastics, and rubber.", desc_zh: "测量金属、塑料和橡胶的硬度值。" },
        { id: "leak-tester", categoryId: 6, image: "/images/leak-tester.png", title_th: "เครื่องทดสอบการรั่วซึม", title_en: "Leak Tester", title_zh: "泄漏测试仪", desc_th: "ตรวจสอบความสมบูรณ์ของบรรจุภัณฑ์", desc_en: "Check the integrity of packaging.", desc_zh: "检查包装的完整性。" },
      ];
      const now = new Date().toISOString();
      for (const p of seedProducts) {
        await connection.query(
          "INSERT IGNORE INTO products (id, categoryId, image, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, createdAt, isPublished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [p.id, p.categoryId, p.image, p.title_th, p.title_en, p.title_zh, p.desc_th, p.desc_en, p.desc_zh, now, true]
        );
      }

    } catch (error) {
      console.error("Failed to initialize database table:", error);
      throw error;
    } finally {
      connection.release();
    }
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
    throw error;
  } finally {
    conn.release();
  }
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
