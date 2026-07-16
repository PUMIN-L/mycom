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
export function withRoute<Args extends unknown[]>(
  fallbackMessage: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.message, error.status);
      }
      console.error(`${fallbackMessage}:`, error);
      const details = error instanceof Error ? error.message : String(error);
      return jsonError(fallbackMessage, 500, details);
    }
  };
}
