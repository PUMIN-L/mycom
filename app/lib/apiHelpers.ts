import "server-only";
import { NextResponse } from "next/server";
import { getSession, SessionPayload } from "./session";

// Shared building blocks for Route Handlers under `app/api/**`.
//
// Goals:
//   • one consistent JSON error shape: { error, details? }
//   • one place that turns thrown errors into 500s (and logs them)
//   • auth as a one-liner: `await requireAuth()`
//
// Pattern for a handler:
//
//   export const POST = withRoute("Failed to create product", async (req) => {
//     await requireAuth();                 // throws ApiError(401) if not logged in
//     const data = await req.json();
//     return NextResponse.json(await addProduct(data), { status: 201 });
//   });

/**
 * An error with an HTTP status. Throw this from inside a handler and
 * `withRoute` will turn it into the matching JSON response (without logging it
 * as an unexpected 500).
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Build the app's standard JSON error response. */
export function jsonError(message: string, status = 500, details?: string) {
  return NextResponse.json(
    details ? { error: message, details } : { error: message },
    { status }
  );
}

/**
 * Require a logged-in session. Returns the session payload, or throws
 * `ApiError(401)` which `withRoute` converts into a 401 response.
 */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Unauthorized");
  return session;
}

/**
 * Wrap a Route Handler so any thrown error becomes a JSON response:
 *   • `ApiError`        → its own status + message (expected, not logged)
 *   • anything else     → 500 with `fallbackMessage` + error details (logged)
 *
 * The wrapped function keeps the handler's original `(request, context)`
 * signature, so dynamic-route `params` typing is preserved.
 */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Defense-in-depth CSRF check (on top of the SameSite=lax session cookie):
 * reject a state-changing request whose Origin host doesn't match the request
 * host. Requests without an Origin header (server-to-server tooling, curl) are
 * allowed through — browsers always send Origin on cross-site non-GET requests.
 */
function crossOriginRejected(args: unknown[]): Response | null {
  const req = args[0] as { method?: string; headers?: Headers } | undefined;
  if (!req || typeof req.method !== "string" || !MUTATING_METHODS.has(req.method)) {
    return null;
  }
  const origin = req.headers?.get("origin");
  if (!origin) return null;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    return jsonError("Invalid Origin header", 403);
  }
  const host = req.headers?.get("host");
  if (host && originHost && originHost !== host) {
    return jsonError("Cross-origin request refused", 403);
  }
  return null;
}

export function withRoute<Args extends unknown[]>(
  fallbackMessage: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    const csrf = crossOriginRejected(args);
    if (csrf) return csrf;
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.message, error.status);
      }
      console.error(`${fallbackMessage}:`, error);
      // Raw error text (SMTP hosts, SQL fragments, driver codes) is for the
      // server log only — in production, clients (several routes are public)
      // get just the fallback message.
      if (process.env.NODE_ENV === "production") {
        return jsonError(fallbackMessage, 500);
      }
      const details = error instanceof Error ? error.message : String(error);
      return jsonError(fallbackMessage, 500, details);
    }
  };
}
