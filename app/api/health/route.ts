import { NextResponse } from "next/server";
import { pingDb } from "../../lib/db";
import { getSession } from "../../lib/session";

// Post-deploy health check. Hit `GET /api/health` after a Vercel deploy to
// confirm (a) the database is reachable and (b) the required env vars are set.
//
// Anonymous callers get a minimal {status, timestamp} response (enough for
// uptime monitors). Authenticated admins get the full diagnostics including
// which env vars are missing and DB error codes.
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

// Not fatal, but features degrade without them (admin user isn't seeded; the
// contact form can't send email without SMTP creds; the quotation auto-cleanup
// cron is disabled without CRON_SECRET).
const RECOMMENDED_ENV = [
  "ADMIN_PASSWORD",
  "SMTP_USER",
  "SMTP_PASS",
  "CRON_SECRET",
] as const;

const missingOf = (keys: readonly string[]) =>
  keys.filter((k) => !process.env[k]);

export async function GET() {
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
  const timestamp = new Date().toISOString();

  // Anonymous callers get only status + timestamp (enough for uptime monitors).
  // Full diagnostics (env names, DB error codes) are admin-only to prevent
  // information leakage about the server's configuration.
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { status: healthy ? "ok" : "error", timestamp },
      { status: healthy ? 200 : 503 }
    );
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      db,
      env: { missingRequired, missingRecommended },
      timestamp,
    },
    { status: healthy ? 200 : 503 }
  );
}
