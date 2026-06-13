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
Scale**, with a lightweight admin mode (login → create/edit/delete products and
rich "showcase" content). Stack:

| Concern        | Tech |
| -------------- | ---- |
| Framework      | Next.js 16 App Router, React 19, TypeScript |
| Styling        | Tailwind CSS v4 |
| Database       | MySQL-compatible (TiDB Cloud — port 4000, TLS) via `mysql2` |
| Auth           | JWT session cookie signed with `jose`, passwords hashed with `bcryptjs` |
| Image hosting  | Cloudinary |
| i18n           | Custom React context (no library) |

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
│   ├── products/         CRUD products + nested categories/
│   ├── contents/         CRUD showcase content + by-product/ lookup
│   └── upload/           Cloudinary upload + delete
│
├── lib/                  ── Server/shared logic. NO React here. ──
│   ├── types.ts          ⭐ SINGLE SOURCE OF TRUTH for data models.
│   ├── db.ts             Pool + schema bootstrap + seed + retrying query().
│   ├── productStore.ts   Product/category queries (re-exports types).
│   ├── contentStore.ts   Showcase-content queries (re-exports types).
│   ├── session.ts        JWT encrypt/decrypt + cookie helpers (server-only).
│   ├── apiHelpers.ts     ⭐ withRoute / requireAuth / jsonError / ApiError.
│   ├── cloudinaryHelper.ts  upload / delete / collect-image-urls.
│   ├── localize.ts       Pick `field_<lang>` with fallback.
│   ├── contact.ts        LINE id/url + email (shared by Contact + product pages).
│   ├── getProductsData.ts   React.cache'd parallel fetch for the home page.
│   └── site.ts           SITE_URL/NAME/etc. for metadata, robots, sitemap.
│
├── context/             Client React contexts: AuthContext, NavContext.
├── i18n/                LanguageContext + translations.ts (the string table).
├── components/          Shared client UI (see "Shared UI" below).
├── create-product/      Admin page: create a product.
├── create-content/      Admin page: build showcase content (blocks).
├── login/               Admin login page.
└── showcase/            Public content browsing + admin in-place editing.

scratch/                 One-off maintenance scripts (NOT part of the app):
                         cleanup_cloudinary.ts, cleanup_contents.ts, test-conn.js
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
validate, check auth, call a store function, and return JSON.

---

## Conventions — follow these when adding code

### 1. Data types live in `lib/types.ts` — only there
`ProductData`, `ProductCategory`, `ContentData`, `ContentBlock` are defined once
in [`app/lib/types.ts`](./app/lib/types.ts). The stores re-export them, so server
code can keep importing from `./productStore` / `./contentStore`. Client
components should `import type { ... } from "../lib/types"`.

> `types.ts` must stay **dependency-free** (no `mysql2`, `cloudinary`,
> `next/headers`). It is imported by both server and client.

**Adding a field to a product?** Touch these together: `types.ts` (the type),
`db.ts` (column + seed), `productStore.ts` (`rowToProduct`, INSERT, UPDATE),
the create/edit forms, and `localize` usage if it's a translated `field_xx`.

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
- `requireAuth()` — one-line auth gate; returns the session or throws `ApiError(401)`.
- `jsonError(message, status, details?)` — the standard `{ error, details? }` shape.
- For *expected* non-200s (404 / 400 validation) you may either
  `return NextResponse.json(..., { status })` directly or `throw new ApiError(...)`.

The wrapped handler keeps the native `(request, context)` signature, so dynamic
`params` typing still works. **Don't** go back to per-handler `try/catch` +
manual auth checks — that's the duplication this replaced.

### 3. Which routes require auth
| Public (read)                                   | Auth required (mutations) |
| ----------------------------------------------- | ------------------------- |
| `GET /api/products`, `/api/products/[id]`       | `POST/PUT/DELETE` of products |
| `GET /api/products/categories`                  | `POST` category, `DELETE` category |
| `GET /api/contents/[id]` (& `?all`), `by-product` | `POST/PUT/DELETE` of contents |
| `GET /api/auth/me`                              | `POST /api/upload`, `DELETE /api/upload/delete` |

> History note: content + upload mutations were originally **unauthenticated**
> (only the client UI was gated). They now call `requireAuth()` server-side. Keep
> any new mutation route behind `requireAuth()`.

### 4. Localized fields
DB rows store one column per language (`title_th`, `title_en`, `title_zh`). Read
them with [`localize(record, "title", lang)`](./app/lib/localize.ts) — fallback
order is requested → en → th (and th → en → zh). Do **not** re-implement the
`if (lang === ...)` ladder inline.

### 5. Cloudinary & PDF Document lifecycle
All in [`app/lib/cloudinaryHelper.ts`](./app/lib/cloudinaryHelper.ts):
- `uploadImage(buffer)` — upload, returns the secure URL. PDFs are uploaded twice in the upload route: once as `image` (for cover previews) and once as `raw` (for the actual document).
- `deleteCloudinaryImage(url)` / `deleteCloudinaryImages(urls)`.
- `collectContentImageUrls(content)` — every block carrying an `imageUrl`
  (**both** `image` *and* `text-image` blocks). Use this whenever deleting or
  diffing content images, so `text-image` images aren't orphaned.

**⚠️ PDF Strict Delivery Restrictions:**
By default, Cloudinary restricts delivery of `raw` PDFs to prevent XSS. A global setting in Cloudinary (Security → Restricted media types → "Delivery of PDF and ZIP files") **must** be unchecked for the `react-pdf` viewer to work, otherwise Cloudinary returns `401 deny or ACL failure`.

**⚠️ PDF Proxy Stream Fix:**
PDF URLs are proxied through `/api/documents/proxy` to hide the raw Cloudinary URL and force inline browser rendering. Because Next.js automatically decompresses `fetch` responses (e.g., Cloudinary `gzip`), we explicitly strip `content-encoding` and `content-length` headers before passing the stream to `NextResponse`. Without this, the browser will incorrectly try to decompress an already-decompressed stream, resulting in a corrupted PDF.

### 6. Sessions
[`app/lib/session.ts`](./app/lib/session.ts) is `server-only`. A 3-day HS256 JWT
stored in an httpOnly `session` cookie. `createSession` / `getSession` /
`deleteSession`. `SESSION_SECRET` **must** be set or the module throws at import.

### 7. Shared UI components — don't re-implement inline
[`app/components/`](./app/components/): `ConfirmDialog`, `Toast`, `Spinner`,
`ColorPickerDropdown`. These were previously copy-pasted into multiple pages;
import the shared version instead of defining a local one.

### 8. i18n strings
Add UI copy to [`app/i18n/translations.ts`](./app/i18n/translations.ts) and read
it with `useT()` / `useLanguage()`. Don't hardcode user-facing strings in
components.

---

## Database (`lib/db.ts`)

- A single pooled connection (`connectionLimit: 10`, TLS required). The pool is
  cached on `globalThis` so Next.js dev HMR reuses it instead of leaking pools.
- **Always query through `query<T>(sql, params)` — not `pool.query`.** It retries
  transient connection errors (`ECONNRESET`, `PROTOCOL_CONNECTION_LOST`, …).
  TiDB Cloud closes idle connections server-side, so a pooled connection can be
  dead when grabbed; mysql2 drops the broken socket on error, so a retry gets a
  fresh one. (This is the fix for the `read ECONNRESET ... getAllCategories`
  errors.) Retry is safe here because every INSERT uses an explicit primary key
  and UPDATE/DELETE are idempotent.
- On first `getDbConnection()` call it **creates tables if missing and seeds**
  default categories, products, and an admin user — then sets an init flag so it
  only runs once per server process.
- Tables: `users`, `product_categories`, `products`, `contents`.

> ⚠️ The seed inserts an `admin` user from `ADMIN_USERNAME` / `ADMIN_PASSWORD`
> (env, **not** source) using `INSERT IGNORE`. Because of `INSERT IGNORE`,
> changing `ADMIN_PASSWORD` does **not** update an already-seeded row — rotate
> the existing user's password directly in the DB. Prefer an explicit migration
> step over auto-create-on-first-request for production.

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

# Canonical site URL (optional; falls back to Vercel vars, then localhost:3000)
NEXT_PUBLIC_SITE_URL=
```

---

## Commands

```bash
npm run dev      # local dev
npm run build    # production build (needs DB env to prerender data routes)
npm run start    # serve the build
npm run lint     # eslint

npx tsc --noEmit         # typecheck
npx next typegen         # regenerate route types (run if route handlers change)
```

After changing Route Handlers, run `npx next typegen && npx tsc --noEmit` —
Next.js validates handler signatures via generated types.

---

## Known cleanup opportunities (good first refactors)

These are intentionally **not** done yet; tackle them in small, verifiable steps:

1. **Client data fetching is raw `fetch` everywhere.** A small typed client
   (`lib/api.ts`) wrapping `fetch` + JSON-error handling would remove the
   repeated `res.ok` / `res.json()` boilerplate across pages.
2. **`create-content/page.tsx` and `showcase/[id]/ShowcaseClient.tsx` are large**
   (~600 / ~900 lines) and still define narrow inline view-model types
   (`ProductItem`, minimal `ContentBlock`) and duplicate block-styling controls
   (font size/weight/align/color repeated for `text` and `text-image` blocks).
   Extract a `BlockEditor` / `BlockToolbar` component.
3. **Auth redirect is duplicated** in both create pages
   (`useEffect(() => { if (!loading && !loggedIn) router.replace("/login") })`).
   Extract a `useRequireAuth()` hook.
4. **`Date.now().toString()` for block ids is called during render** (lint:
   `react-hooks/purity`). Generate ids in an event handler or with
   `crypto.randomUUID()` at creation time.
5. **DB bootstrap/seed runs on first request.** Move to an explicit migration +
   seed script for production; remove the hardcoded admin password.
6. **Pre-existing lint debt** (`<a>` instead of `<Link>`, `<img>` instead of
   `next/image`) remains in some components — fix opportunistically.
