import { NextResponse } from "next/server";
import { pingDb } from "../../lib/db";

// Post-deploy health check. Hit `GET /api/health` after a Vercel deploy to
// confirm (a) the database is reachable and (b) the required env vars are set.
//
// Public + uncached on purpose — it must reflect live state, and you need to
// reach it before logging in. It reports the PRESENCE of config (never the
// values) and, on a DB failure, only the mysql2 error *code* (e.g. ETIMEDOUT,
// ER_ACCESS_DENIED_ERROR) — enough to diagnose without leaking host/creds.
//
// TEMPORARY: `?deep=1` dynamically imports each server module the /showcase
// pages depend on (one at a time, in try/catch) and then runs the real content
// queries — so we can see EXACTLY which import or query throws on Vercel. Uses
// dynamic import() so a broken module can't take down /api/health itself.
// REMOVE the deep block once the showcase 500 is fixed.
export const runtime = "nodejs"; // mysql2 needs the Node.js runtime (not Edge)
export const dynamic = "force-dynamic"; // always probe, never serve a cached result

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

const RECOMMENDED_ENV = ["ADMIN_PASSWORD"] as const;

const missingOf = (keys: readonly string[]) =>
  keys.filter((k) => !process.env[k]);

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
      stack: err?.stack?.split("\n").slice(0, 8).join(" | ") ?? null,
    };
  }
}

async function runDeepProbes() {
  return {
    // Isolate module LOAD (dynamic import) from the DB queries. Whichever of
    // these `ok:false` first is the module that fails to evaluate on Vercel.
    importSanitizeHtml: await probe(async () => {
      await import("../../lib/sanitizeHtml");
      return {};
    }),
    importDocumentStore: await probe(async () => {
      await import("../../lib/documentStore");
      return {};
    }),
    importContentStore: await probe(async () => {
      await import("../../lib/contentStore");
      return {};
    }),
    // If the modules loaded, run the actual queries the pages use.
    rawContents: await probe(async () => {
      const { query } = await import("../../lib/db");
      const [rows] = await query("SELECT * FROM contents LIMIT 1");
      const arr = rows as unknown as Array<Record<string, unknown>>;
      const sample = arr[0];
      return {
        rows: arr.length,
        blocksType: sample
          ? Buffer.isBuffer(sample.blocks)
            ? "buffer"
            : typeof sample.blocks
          : "no-rows",
      };
    }),
    getAllContents: await probe(async () => {
      const { getAllContents } = await import("../../lib/contentStore");
      return { count: (await getAllContents()).length };
    }),
    getAllDocuments: await probe(async () => {
      const { getAllDocuments } = await import("../../lib/documentStore");
      return { count: (await getAllDocuments()).length };
    }),
  };
}

export async function GET(request: Request) {
  const deepRequested = new URL(request.url).searchParams.get("deep") === "1";

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
