import { NextResponse } from "next/server";
import { pingDb, getDbConnection, query } from "../../lib/db";
import { getAllContents } from "../../lib/contentStore";
import { getAllDocuments } from "../../lib/documentStore";
import type { RowDataPacket } from "mysql2";

// Post-deploy health check. Hit `GET /api/health` after a Vercel deploy to
// confirm (a) the database is reachable and (b) the required env vars are set.
//
// Public + uncached on purpose — it must reflect live state, and you need to
// reach it before logging in. It reports the PRESENCE of config (never the
// values) and, on a DB failure, only the mysql2 error *code* (e.g. ETIMEDOUT,
// ER_ACCESS_DENIED_ERROR) — enough to diagnose without leaking host/creds.
//
// TEMPORARY: `?deep=1` runs the exact code path the /showcase pages use
// (init + `contents` queries + row mapping) inside try/catch and returns the
// real error, so we can see what 500s on Vercel. REMOVE the deep block once the
// showcase 500 is fixed — it leaks error/stack detail.
export const runtime = "nodejs"; // mysql2 needs the Node.js runtime (not Edge)
export const dynamic = "force-dynamic"; // always probe, never serve a cached result

// Env vars the app cannot function without.
const REQUIRED_ENV = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "SESSION_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

// Not fatal, but features degrade without them (admin user isn't seeded).
const RECOMMENDED_ENV = ["ADMIN_PASSWORD"] as const;

const missingOf = (keys: readonly string[]) =>
  keys.filter((k) => !process.env[k]);

// Run a probe, returning either its result object or the caught error's detail.
async function probe(
  fn: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    const err = e as { message?: string; code?: string; stack?: string } | null;
    return {
      ok: false,
      error: err?.message ?? String(e),
      code: err?.code ?? null,
      stack: err?.stack?.split("\n").slice(0, 6).join(" | ") ?? null,
    };
  }
}

async function runDeepProbes() {
  return {
    init: await probe(async () => {
      await getDbConnection();
      return {};
    }),
    // Raw query straight against the contents table — isolates a SQL/schema
    // problem from the JS row-mapping. Also reveals how mysql2 hands back the
    // JSON `blocks` column on Vercel (string vs object vs Buffer).
    rawContents: await probe(async () => {
      const [rows] = await query<RowDataPacket[]>(
        "SELECT * FROM contents LIMIT 1"
      );
      const sample = rows[0];
      return {
        rows: rows.length,
        blocksType: sample
          ? Buffer.isBuffer(sample.blocks)
            ? "buffer"
            : typeof sample.blocks
          : "no-rows",
        columns: sample ? Object.keys(sample) : [],
      };
    }),
    getAllContents: await probe(async () => ({
      count: (await getAllContents()).length,
    })),
    getAllDocuments: await probe(async () => ({
      count: (await getAllDocuments()).length,
    })),
  };
}

export async function GET(request: Request) {
  const deepRequested =
    new URL(request.url).searchParams.get("deep") === "1";

  const missingRequired = missingOf(REQUIRED_ENV);
  const missingRecommended = missingOf(RECOMMENDED_ENV);

  let db: { connected: true; latencyMs: number } | { connected: false; error: string };
  try {
    const { latencyMs } = await pingDb();
    db = { connected: true, latencyMs };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    db = { connected: false, error: code ?? "CONNECTION_FAILED" };
  }

  const healthy = db.connected && missingRequired.length === 0;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      db,
      env: { missingRequired, missingRecommended },
      ...(deepRequested ? { deep: await runDeepProbes() } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
