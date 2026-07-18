# Architecture

A guide for anyone — human or AI — about to change this codebase. Read this
first, then read [`AGENTS.md`](./AGENTS.md).

---

## ⚠️ Read before writing any Next.js code

This project runs **Next.js 16** (App Router) with **React 19**. Per
[`AGENTS.md`](./AGENTS.md), the framework has breaking changes vs. older
versions you may "remember". **Before writing framework-touching code, read the
relevant guide under [`node_modules/next/dist/docs/`](./node_modules/next/dist/docs/)**
(e.g. `01-app/01-getting-started/15-route-handlers.md`). A few things that bite:

- Route Handler `params` is a **Promise**: `const { id } = await params`.
- `cookies()` / `headers()` are **async**: `await cookies()`.
- `GET` Route Handlers are **not cached** by default.

---

## What this is

A trilingual (TH / EN / ZH) marketing + product-catalog site for **Profin Lab
Scale**, with a lightweight admin mode (login → manage products, rich "showcase"
content, PDF documents, a real contact-email inbox, and a **quotation builder**
that exports PDFs). Stack:

| Concern        | Tech |
| -------------- | ---- |
| Framework      | Next.js 16 App Router, React 19, TypeScript |
| Styling        | Tailwind CSS v4 |
| Database       | MySQL-compatible (TiDB Cloud — port 4000, TLS) via `mysql2` |
| Auth           | JWT session cookie signed with `jose`, passwords hashed with `bcryptjs` |
| Image hosting  | Cloudinary (product images + PDF documents) |
| Rich-text sanitize | `sanitize-html` (pure JS — **never** jsdom/DOMPurify server-side, see §5) |
| Email          | `nodemailer` over SMTP (contact form + recipient-change notices) |
| Client PDF     | `jspdf` + `html2canvas-pro` (quotation export, client-only) |
| i18n           | Custom React context (no library) |
| Tests          | Vitest + `@testing-library/react`, v8 coverage, pre-push gate |
| Hosting        | Vercel (region `sin1`) + Vercel Cron |

---

## Directory map

```
app/
├── layout.tsx            Root layout + <head> metadata. Wraps app in
│                         LanguageProvider → AuthProvider → NavProvider.
├── page.tsx              Home. Streams <Products> via Suspense (force-dynamic).
├── globals.css           Tailwind + CSS variables (--accent, --bg-*, fonts).
├── robots.ts / sitemap.ts   SEO route handlers (use lib/site.ts).
│
├── api/                  ── Route Handlers (the backend) ──
│   ├── auth/             login · logout · me  (session lifecycle)
│   ├── products/         CRUD products + nested categories/ (+ reorder)
│   ├── contents/         CRUD showcase content + by-product/ lookup
│   ├── documents/        CRUD PDF documents + proxy/ (inline PDF streaming)
│   ├── quotations/       save/list/delete quotes + docnos/ ledger + cleanup/ cron
│   ├── settings/         contact-email/ (get/change the contact inbox address)
│   ├── contact/          public contact form → sends real email
│   ├── upload/           Cloudinary upload + delete/
│   └── health/           DB reachability probe (public, force-dynamic)
│
├── lib/                  ── Server/shared logic. NO React here. ──
│   ├── types.ts          ⭐ SINGLE SOURCE OF TRUTH for data models.
│   ├── db.ts             Pool + schema-version bootstrap/seed + retrying query().
│   ├── productStore.ts   Product/category queries (re-exports types).
│   ├── contentStore.ts   Showcase-content queries (re-exports types).
│   ├── documentStore.ts  PDF-document queries.
│   ├── quotationStore.ts Quotations + docNo ledger + image-safe delete/purge.
│   ├── quotationTotals.ts ⭐ Money math (subtotal/discount/VAT) — shared by UI + list.
│   ├── quotationNumber.ts docNo running-number helpers (DOCNO_START=22, nextDocNo).
│   ├── settingsStore.ts  Key/value settings (contact_email).
│   ├── session.ts        JWT encrypt/decrypt + cookie helpers (server-only).
│   ├── apiHelpers.ts     ⭐ withRoute / requireAuth / jsonError / ApiError + CSRF guard.
│   ├── cloudinaryHelper.ts  upload / delete / collect-image-urls / pdf-cover.
│   ├── sanitizeHtml.ts   ⭐ sanitizeRichText — pure-JS HTML sanitizer (see §5).
│   ├── mailer.ts         SMTP send (contact + recipient-change), isMailConfigured.
│   ├── localize.ts       Pick `field_<lang>` with fallback.
│   ├── pagination.ts     pageList() — first-3…last-3 page window.
│   ├── contact.ts        LINE id/url + email (shared by Contact + product pages).
│   ├── getProductsData.ts   React.cache'd parallel fetch for the home page.
│   └── site.ts           SITE_URL/NAME/etc. for metadata, robots, sitemap.
│
├── context/             Client React contexts: AuthContext, NavContext.
├── i18n/                LanguageContext + translations.ts (the string table).
├── components/          Shared client UI (see "Shared UI" below).
├── about/ catalog/ contact/   Public pages.
├── create-product/ edit-product/ create-content/   Admin product/content pages.
├── document/            PDF document viewer/manager page.
├── quotation/           Admin quotation builder (client-side PDF export).
├── settings/            Admin settings (change contact-email recipient).
├── login/               Admin login page.
└── showcase/            Public content browsing + admin in-place editing.

__tests__/               Vitest suites (unit tests for lib/* + api/*). See §Testing.
.githooks/pre-push       Runs the test suite before every push (see §Testing).
scratch/                 One-off maintenance scripts (NOT part of the app).
```

---

## How a request flows

### Public read (e.g. the home page)
1. `page.tsx` (Server Component) calls `getProductsData()` but does **not**
   `await` it — the promise is passed to `<Products>` and read with React `use()`,
   so the page streams and only the products area shows a skeleton while loading.
2. `getProductsData` (wrapped in `React.cache`) fetches categories + products in
   parallel from the stores, which query the DB pool from `db.ts`.
3. `<Products>` (Client Component) seeds local state from the resolved data so
   admin add/delete can update the UI optimistically.

### Mutations (admin)
Client components call the `/api/**` Route Handlers with `fetch`. Handlers
validate, check auth (`requireAuth()`), pass the same-origin CSRF guard, call a
store function, and return JSON.

---

## Conventions — follow these when adding code

### 1. Data types live in `lib/types.ts` — only there
`ProductData`, `ProductCategory`, `ContentData`, `ContentBlock`, `DocumentData`
are defined once in [`app/lib/types.ts`](./app/lib/types.ts). The stores
re-export them, so server code can keep importing from `./productStore` /
`./contentStore`. Client components should `import type { ... } from "../lib/types"`.

> `types.ts` must stay **dependency-free** (no `mysql2`, `cloudinary`,
> `next/headers`). It is imported by both server and client.

**Adding a field to a product?** Touch these together: `types.ts` (the type),
`db.ts` (column + seed **and bump `SCHEMA_VERSION`**, see §Database),
`productStore.ts` (`rowToProduct`, INSERT, UPDATE), the create/edit forms, and
`localize` usage if it's a translated `field_xx`.

### 2. Route Handlers use the `apiHelpers` toolkit
Defined in [`app/lib/apiHelpers.ts`](./app/lib/apiHelpers.ts). The pattern:

```ts
export const POST = withRoute("Failed to create product", async (req: NextRequest) => {
  await requireAuth();                       // throws ApiError(401) if logged out
  const data = await req.json();
  return NextResponse.json(await addProduct(data), { status: 201 });
});
```

- `withRoute(fallbackMessage, handler)` — wraps the handler so any thrown error
  becomes JSON. `ApiError` → its own status (not logged); anything else → 500
  with `{ error: fallbackMessage, details }` (logged via `console.error`).
- **CSRF / same-origin guard:** `withRoute` rejects any state-changing request
  (`POST/PUT/PATCH/DELETE`) whose `Origin` host ≠ the request host with **403**.
  Requests with no `Origin` header (server-to-server, curl) pass. Tests that hit
  a mutating handler must set matching `origin` + `host` headers.
- `requireAuth()` — one-line auth gate; returns the session or throws `ApiError(401)`.
- `jsonError(message, status, details?)` — the standard `{ error, details? }` shape.
- For *expected* non-200s (404 / 400 validation) you may either
  `return NextResponse.json(..., { status })` directly or `throw new ApiError(...)`.

The wrapped handler keeps the native `(request, context)` signature, so dynamic
`params` typing still works. **Don't** go back to per-handler `try/catch` +
manual auth checks — that's the duplication this replaced.

### 3. Which routes require auth
| Public                                          | Auth required (admin) | Other |
| ----------------------------------------------- | --------------------- | ----- |
| `GET /api/products`, `/api/products/[id]`       | `POST/PUT/DELETE` products | |
| `GET /api/products/categories`                  | `POST` + `[id]` `DELETE/PUT` + `reorder` categories | |
| `GET /api/contents/[id]` (& `?all`), `by-product` | `POST` + `[id]` `PUT/DELETE` contents | |
| `GET /api/documents`, `documents/proxy`         | `POST` + `[id]` `PUT/DELETE` documents | |
| `GET /api/auth/me`, `POST /api/auth/login`/`logout` | `POST /api/upload`, `DELETE /api/upload/delete` | |
| `POST /api/contact` (sends email)               | all `/api/quotations/**` (GET/POST/[id]/docnos) | `cleanup` = **cron** (`CRON_SECRET`) |
| `GET /api/health`                               | `GET`/`PUT /api/settings/contact-email` | |

> History note: content + upload mutations were originally **unauthenticated**
> (only the client UI was gated). They now call `requireAuth()` server-side. Keep
> any new mutation route behind `requireAuth()` **and** the same-origin guard
> (you get the latter for free by using `withRoute`).

### 4. Localized fields
DB rows store one column per language (`title_th`, `title_en`, `title_zh`). Read
them with [`localize(record, "title", lang)`](./app/lib/localize.ts) — fallback
order is requested → en → th (and th → en → zh). Do **not** re-implement the
`if (lang === ...)` ladder inline.

### 5. Rich-text sanitization — pure JS only ⚠️
User-authored HTML (showcase blocks, product descriptions) is sanitized
server-side with [`sanitizeRichText`](./app/lib/sanitizeHtml.ts), which uses
**`sanitize-html`** (pure JS). Sanitization happens on **write** in the stores.

> **Never** reach for `jsdom`, `isomorphic-dompurify`, or DOMPurify+linkedom on
> the server. `jsdom` fails to load on Vercel's serverless runtime
> (`ERR_REQUIRE_ESM`) and 500s the whole site; DOMPurify+linkedom silently
> returns the input **unsanitized** when the fake DOM lacks features. Both were
> tried and reverted. The same rule applies to any new server dependency with
> native/ESM-loader quirks (see `mailer.ts`'s note).

### 6. Security headers & CSRF
- [`next.config.ts`](./next.config.ts) sets `Content-Security-Policy-Report-Only`
  (tune, then flip to enforcing `Content-Security-Policy`), `X-Frame-Options: DENY`,
  and `Strict-Transport-Security`.
- CSRF is handled by the `withRoute` same-origin guard (§2). Auth is an httpOnly
  cookie, so a same-origin check is the CSRF defense.

### 7. Cloudinary & PDF document lifecycle
All in [`app/lib/cloudinaryHelper.ts`](./app/lib/cloudinaryHelper.ts):
- `uploadImage(buffer)` — upload, returns the secure URL. PDFs are uploaded twice
  in the upload route: once as `image` (for cover previews) and once as `raw`
  (for the actual document).
- `deleteCloudinaryImage(url)` / `deleteCloudinaryImages(urls)`.
- `getPdfCoverUrl(pdfUrl)` — derive a `.jpg` cover from a PDF URL.
- `collectContentImageUrls(content)` — collects **both** a block's singular
  `imageUrl` (`image` / `text-image` blocks) **and** its `imageUrls[]` array
  (`gallery` blocks), de-duplicated. Use this whenever deleting/diffing content
  images so gallery + text-image assets aren't orphaned on Cloudinary.

**Image-deletion safety invariant:** deleting a quotation must never destroy a
Cloudinary image still referenced by a product or content block. `quotationStore`
enforces this in two layers — the upload route only accepts URLs on *our* cloud,
and `deleteQuotation`/`purgeExpiredQuotations` cross-check every URL against
`SELECT image FROM products` + content blocks (`imageUrl` **and** `imageUrls[]`)
before calling `cloudinary.destroy`.

**⚠️ PDF Strict Delivery Restrictions:** By default, Cloudinary restricts
delivery of `raw` PDFs to prevent XSS. A global setting (Security → Restricted
media types → "Delivery of PDF and ZIP files") **must** be unchecked for the
`react-pdf` viewer to work, else Cloudinary returns `401 deny or ACL failure`.

**⚠️ PDF Proxy Stream Fix:** PDF URLs are proxied through `/api/documents/proxy`
to hide the raw Cloudinary URL and force inline rendering. Because Next.js
auto-decompresses `fetch` responses, we strip `content-encoding` and
`content-length` before passing the stream to `NextResponse` — otherwise the
browser double-decompresses and the PDF is corrupted.

### 8. Quotation builder
[`app/quotation/page.tsx`](./app/quotation/page.tsx) builds a quote and exports a
single-page PDF **client-side** (`jspdf` + `html2canvas-pro`, dynamically imported
— they're oklch-safe for Tailwind v4). Money math lives ONLY in
[`quotationTotals.ts`](./app/lib/quotationTotals.ts) (`computeQuoteTotals`) so the
builder UI and the saved-list summary can never drift. Number inputs use a
raw-text `NumberInput` so sub-1 values (e.g. `0.5%` discount) are enterable.

**docNo (quotation number) ledger:** format `QT<YYYYMMDD>-NN`, the trailing
number starts at `DOCNO_START` (22) each day ([`quotationNumber.ts`](./app/lib/quotationNumber.ts)).
Issued numbers are recorded in `used_docnos` — a ledger **separate** from
`quotations` so a number stays reserved (~2 days) even after its quote is
deleted/auto-purged. Saving rejects a docNo already owned by a *different* quote
(409). A Vercel Cron (`/api/quotations/cleanup`, gated by `CRON_SECRET`) purges
quotations older than 30 days and ledger entries older than 2 days.

### 9. Email (contact form)
[`app/lib/mailer.ts`](./app/lib/mailer.ts) sends via SMTP (`nodemailer`, Gmail by
default). The public `POST /api/contact` sends to the address stored in
`settings.contact_email` (default from [`contact.ts`](./app/lib/contact.ts)),
changeable at `/settings` (admin). Changing it notifies **both** the old and new
addresses. Visitor-controlled fields go into structured `{name,address}` objects
(not raw header strings) to prevent header injection.

### 10. Sessions
[`app/lib/session.ts`](./app/lib/session.ts) is `server-only`. A 3-day HS256 JWT
stored in an httpOnly `session` cookie. `createSession` / `getSession` /
`deleteSession`. `SESSION_SECRET` **must** be set or the module throws at import.

### 11. Shared UI components — don't re-implement inline
[`app/components/`](./app/components/): `ConfirmDialog`, `Toast`, `Spinner`,
`ColorPickerDropdown`, `BlockRangeControl` (image-size / block-spacing slider with
−/+ steps + live readout), `RichTextEditor`. Import the shared version instead of
defining a local one.

### 12. i18n strings
Add UI copy to [`app/i18n/translations.ts`](./app/i18n/translations.ts) and read
it with `useT()` / `useLanguage()`. Don't hardcode user-facing strings in
components.

---

## Database (`lib/db.ts`)

- A single pooled connection, TLS required. **`connectionLimit: 3` and
  `maxIdle: 3` must stay equal** — with `maxIdle < connectionLimit`, mysql2's
  eviction timer tears down surplus sockets after every request, so a page that
  opens several connections at once pays a full ~1s+ TiDB TLS reconnect on the
  next view. The pool is cached on `globalThis` so Next.js dev HMR reuses it.
- **Always query through `query<T>(sql, params)` — not `pool.query`.** It retries
  transient connection errors (`ECONNRESET`, `PROTOCOL_CONNECTION_LOST`, …). TiDB
  Cloud closes idle connections server-side, so a pooled socket can be dead when
  grabbed; mysql2 drops it on error and the retry gets a fresh one. Retry is safe
  because INSERTs use explicit primary keys and UPDATE/DELETE are idempotent.
- **Schema-version bootstrap:** on the first `query()`, `db.ts` lazily creates
  tables if missing and seeds default categories/products/admin, then writes
  `settings.schema_version`. A cold instance whose stored version already matches
  `SCHEMA_VERSION` skips the whole seed in a single SELECT.

> ⚠️ **Bump `SCHEMA_VERSION` in `db.ts` whenever you change the schema**, or
> existing databases will skip the (idempotent) migration and never get the new
> columns/tables.

- Tables: `users`, `product_categories`, `products`, `contents`, `documents`,
  `settings`, `quotations`, `used_docnos`.

> ⚠️ The seed inserts an `admin` user (id `admin-001`) from `ADMIN_USERNAME` /
> `ADMIN_PASSWORD` (env, **not** source) — but only if the row doesn't already
> exist, and it **skips seeding entirely when `ADMIN_PASSWORD` is unset** (no weak
> default). Changing `ADMIN_PASSWORD` does **not** rotate an already-seeded
> password — update the existing user's hash in the DB directly.

---

## Environment variables

```
# Database (TiDB Cloud / MySQL)
DB_HOST=          DB_PORT=4000     DB_USER=
DB_PASSWORD=      DB_NAME=

# Auth — REQUIRED (session.ts throws without it)
SESSION_SECRET=

# Admin seed — set ADMIN_PASSWORD to seed/create the admin user on DB init.
# If ADMIN_PASSWORD is unset the admin user is NOT seeded (no weak default).
ADMIN_USERNAME=admin     ADMIN_PASSWORD=

# Cloudinary
CLOUDINARY_CLOUD_NAME=   CLOUDINARY_API_KEY=   CLOUDINARY_API_SECRET=

# Email (contact form) — Gmail App Password by default; host/port optional.
SMTP_USER=        SMTP_PASS=       SMTP_HOST=smtp.gmail.com   SMTP_PORT=465

# Cron — protects /api/quotations/cleanup (Vercel Cron sends this as a Bearer token).
CRON_SECRET=

# Canonical site URL (optional; falls back to VERCEL_PROJECT_PRODUCTION_URL /
# VERCEL_URL, then localhost:3000)
NEXT_PUBLIC_SITE_URL=
```

---

## Commands

```bash
npm run dev            # local dev
npm run build          # production build (needs DB env to prerender data routes)
npm run start          # serve the build
npm run lint           # eslint

npm test               # vitest in WATCH mode (dev)
npm run test:run       # vitest one-shot (what the pre-push hook runs)
npm run test:coverage  # one-shot + coverage report + thresholds

npx tsc --noEmit       # typecheck (also checks the test files)
npx next typegen       # regenerate route types (run if route handlers change)
```

After changing Route Handlers, run `npx next typegen && npx tsc --noEmit` —
Next.js validates handler signatures via generated types.

---

## Testing

- **Runner:** Vitest + `@testing-library/react`, v8 coverage. Global mocks
  (`next/navigation`, `next/headers`, `server-only`, `SESSION_SECRET`) live in
  [`__tests__/setup.ts`](./__tests__/setup.ts).
- **Scope:** unit tests cover the **logic surface** — everything in `app/lib/**`
  and `app/api/**`. The large React UI pages/components are not unit-tested (a few
  shared components have targeted tests). Coverage is scoped via
  `coverage.include` in [`vitest.config.ts`](./vitest.config.ts), which makes v8
  report **every** matching file (even untested ones at 0%), gated by thresholds
  (~95 stmts / 90 branch / 97 funcs / 96 lines).
- **Patterns** (copy these):
  - Lib/route tests start with `// @vitest-environment node` and import via the
    `@/` alias.
  - Drive the **real** `requireAuth`/`withRoute` by mocking
    `@/app/lib/session` → `{ getSession }` (null = anonymous → 401, object =
    admin). Don't stub `requireAuth`.
  - Stores: `vi.mock('@/app/lib/db', () => ({ query: vi.fn() }))`; `query()`
    resolves a tuple `[rows, fields]`.
  - Mutating route requests need matching `origin` + `host` headers (the CSRF
    guard). Dynamic params are passed as `{ params: Promise.resolve({ id }) }`.
- **Pre-push gate:** [`.githooks/pre-push`](./.githooks/pre-push) runs the suite
  before every push and **blocks** the push on any failure. It's wired via
  `core.hooksPath` (set automatically by the `prepare` script on `npm install`),
  so it's version-controlled — no husky needed. Emergency bypass:
  `git push --no-verify`.

---

## Known cleanup opportunities (good first refactors)

Tackle in small, verifiable steps — the test suite is now a safety net for these:

1. **Client data fetching is raw `fetch` everywhere.** A small typed client
   (`lib/api.ts`) wrapping `fetch` + JSON-error handling would remove the
   repeated `res.ok` / `res.json()` boilerplate across pages.
2. **`create-content/page.tsx` and the showcase editor are large** and duplicate
   block-styling controls (font size/weight/align/color repeated for `text` and
   `text-image` blocks). Extract a shared `BlockEditor` / `BlockToolbar`.
3. **Auth redirect is duplicated** in admin pages
   (`useEffect(() => { if (!loading && !loggedIn) router.replace("/login") })`).
   Extract a `useRequireAuth()` hook.
4. **DB bootstrap/seed runs on first request.** Move to an explicit migration +
   seed step for production (the `SCHEMA_VERSION` sentinel already makes it cheap
   to skip, but first-request seeding is still implicit).
5. **Contents are read fresh, not cached — by design.** Unlike products (cached
   across requests via `unstable_cache` tag `products`, so their mutations call
   `revalidateTag("products")`), the showcase pages are `force-dynamic` and read
   contents straight from the DB. That's why contents mutations correctly do
   **not** call `revalidateTag` — there is no cache to bust. If you ever add
   caching for contents, remember to `revalidateTag` on every content write.
6. **Pre-existing lint debt** (`<a>` instead of `<Link>`, `<img>` instead of
   `next/image`) remains in some components — fix opportunistically.
