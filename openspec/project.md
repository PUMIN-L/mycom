# Project Context — dIt-e-learing-cms-web

Trilingual (TH/EN/ZH) marketing + product-catalog site for **Profin Lab Scale**
with an admin CMS (products, showcase content, PDF documents, quotations/billing,
customers/suppliers) deployed on Vercel. See [`ARCHITECTURE.md`](../ARCHITECTURE.md)
for the full map — it is the source of truth for conventions.

## Tech stack
- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4
- MySQL-compatible DB (TiDB Cloud) via `mysql2` — schema bootstrapped in
  `app/lib/db.ts`, gated by `SCHEMA_VERSION` (MUST be bumped on schema change)
- Auth: single-admin JWT session cookie (`jose`); **pages** are gated by
  `middleware.ts` (matcher → redirect `/login`), **APIs** by
  `requireAuth()` inside `withRoute()` (`app/lib/apiHelpers.ts`)
- Tests: Vitest (`__tests__/`), pre-push hook runs the suite

## Conventions that specs must respect
- Store modules in `app/lib/*Store.ts`; camelCase DB columns; `createdAt` as ISO
  string; ids are `crypto.randomUUID()` strings
- All user input sanitized with `sanitizePlainText` before persisting
- Every mutation route: `withRoute("fallback msg", handler)` + `await requireAuth()`
- Multi-statement writes that must be atomic use `withTransaction`
- New logic in `app/lib/**` / `app/api/**` ships with unit tests
