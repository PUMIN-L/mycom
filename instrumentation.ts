import { type Instrumentation } from "next";

// Server-side error observability (Next 16). onRequestError fires for errors
// that propagate UNCAUGHT out of the Next server — i.e. Server Component render
// and Server Action failures. NOTE: our Route Handlers are wrapped in withRoute,
// which converts thrown errors into a 500 Response, so they never reach here —
// those are captured (logged) inside withRoute itself. Wire a future tracker in
// BOTH places for full coverage.
//
// Today it emits ONE structured line per error so failures are greppable and
// can drive an alert. To wire a real tracker (Sentry has first-class Vercel
// serverless support), add its SDK, init it in `register()`, and call
// `captureException(err)` below (and in withRoute's 500 branch).
export const onRequestError: Instrumentation.onRequestError = (
  err,
  request,
  context
) => {
  const e = err as { message?: string; digest?: string };
  console.error(
    JSON.stringify({
      event: "request_error",
      message: e?.message ?? String(err),
      digest: e?.digest,
      path: request?.path,
      method: request?.method,
      routePath: context?.routePath,
      routeType: context?.routeType,
      at: new Date().toISOString(),
    })
  );
  // TODO: Sentry.captureException(err) once a DSN is configured.
};

export function register() {
  // Placeholder for observability SDK init (e.g. Sentry.init / registerOTel).
}
