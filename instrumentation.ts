import { type Instrumentation } from "next";

// Server-side error observability (Next 16). Every uncaught error in a Server
// Component, Route Handler, or Server Action is delivered here — a single place
// to forward failures somewhere durable instead of losing them in Vercel's
// ephemeral runtime logs.
//
// Today it emits ONE structured line per error so failures are greppable and
// can drive an alert. To wire a real tracker (Sentry has first-class Vercel
// serverless support), add its SDK, init it in `register()`, and call
// `captureException(err)` below — no other app code has to change.
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
