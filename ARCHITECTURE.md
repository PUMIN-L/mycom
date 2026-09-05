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
│   ├── contact/          public contact form (stores lead + emails) + messages/ inbox
│   ├── revisions/        edit history list + [id]/restore/ (product/content/document)
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
│   ├── contactMessageStore.ts  Persisted contact-form leads (admin inbox).
│   ├── revisionStore.ts  Edit-history snapshots for product/content/document.
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

instrumentation.ts       Next 16 server error hook (onRequestError) — structured
                         error logging; wire Sentry here (see §Observability).
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
| —                                               | all `/api/admin/**`, incl. `POST`/`GET /api/admin/sales` + `[id]/items` and `GET /api/admin/equipments/serial-check` (§8a) | |

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
deleted/auto-purged. Save + reserve run in **one transaction**
(`saveQuotationAtomic`, `SELECT … FOR UPDATE` on the ledger row): a docNo owned by
a *different* quote aborts with 409, and the quote can never be persisted without
its reservation — so the "one live number" invariant holds under failure and
concurrency. A Vercel Cron (`/api/quotations/cleanup`, gated by `CRON_SECRET`) purges
quotations past `RETENTION_DAYS`.

**Retention is 2 years (`RETENTION_DAYS = 730`), not 30 days.** This business's
sales cycle runs for months to years, so the old 30-day window purged the
quotation right about when the customer decided to buy — leaving the sale form's
quotation picker (§8a) empty exactly when it mattered. The ledger's own window is
separate and much shorter by design (a docNo is date-prefixed, so it only has to
outlive its own day) and must never be widened along with it; in practice the
cron no longer calls `purgeOldDocNos` at all — `used_docnos` is kept for
conversion-rate analytics, and the function remains for manual use.

> Consequence: `listQuotations()` gained **server-side search**. Its
> `LIST_SAFETY_LIMIT = 2000` cap used to be justified by the 30-day purge; with
> 2 years of quotations the cap can genuinely be hit, and older-but-still-live
> quotations would fall off the bottom of the list unseen. `GET /api/quotations`
> therefore accepts `?search=` (matched in SQL against `docNo` and the customer
> company/contact inside the `data` JSON, with `!` as the LIKE escape char) and
> `?limit=`. Both are optional — omitting them behaves exactly as before. Filter
> the picker through these params; do not raise the cap.

### 8a. Sales records → line items (schema v33)
A sale is **two** tables: `sales_records` (one row per bill) and
`sales_record_items` (one row per product line — `productId`, `productName`,
`categoryId`, `qty`, `unitPrice`, `totalAmount`, `costAmount`, `sortOrder`, and a
nullable `quotationItemId` naming the QuoteItem it came from). FK
`fk_sri_sales → sales_records(id) ON DELETE CASCADE`.

**Why the child table exists:** before v33 a bill *was* the single
`sales_records` row, with one `productId` and one `categoryId`. A bill of several
different machines therefore attributed **all** of its revenue to one product and
one category, so "สินค้าขายดี" and "รายได้ตามหมวดหมู่" were wrong for every
multi-machine sale. `getTopProducts` / `getRevenueByCategory` now group by the
line items (`LEFT JOIN` + `COALESCE` so lines with no product/category still land
in the existing `"ไม่ระบุสินค้า"` / `"ไม่ระบุหมวด"` buckets rather than
disappearing; `deals = COUNT(DISTINCT salesRecordId)`, one bill = one deal).

- The scalar columns on `sales_records` are still filled, because the overview
  cards and exports read them: `qty`/`totalAmount`/`costAmount` = the **sums**
  over the lines, and `productId`/`productName`/`categoryId`/`unitPrice` = the
  **main** line (highest `totalAmount`, ties broken by lowest `sortOrder`).
  Revenue attribution must never be read from them again.
- Bootstrap backfills one line item per pre-existing sale, reusing the **sale's
  own id** as the line item's id — deterministic, so two instances booting at
  once collide on the PK instead of inserting a second line (which would double
  that sale's historical revenue). Purely additive and idempotent: it never
  UPDATEs or DELETEs, so no historical figure moves.
- `sales_records.quotationId` (v33, `idx_sr_quotation`) links a sale back to the
  quotation it was converted from. It is a **soft link with no FK** on purpose:
  the retention cron hard-deletes quotations, and an FK would either block that
  purge or cascade revenue rows away with it. A sale whose quotation is gone
  reads and edits normally — `quotationRef` (the docNo as text) is always stored
  alongside, and the UI degrades to a disabled "ใบเสนอราคาถูกลบแล้ว" button, not
  an error page.

**`POST /api/admin/sales` is atomic — there is no HTTP 207 any more.**
`createSaleWithLineItems` writes the sales record, every line item and every
`customer_equipments` row inside ONE `withTransaction`; the old flow (commit the
sale, then loop `addEquipment`) could leave a committed sale with only some of
its machines, and the 207 "partial success" response it needed is gone. Either
201 with the whole bill, or nothing is written. `withTransaction` retries its
callback up to 3×, so every UUID is minted **inside** the callback. The legacy
flat single-product payload is still accepted and normalized into exactly one
line item — a sale with no line item would silently vanish from the reports.

Three read-only lookups, all behind `requireAuth()` and all **advisory** (task
5.4 / D12–D13): they feed warnings the user can confirm past, so they must never
fail a save.

| Route | Answers |
| ----- | ------- |
| `GET /api/admin/sales/[id]/items` | the line items **and** machines of one bill, plus its `quotationId`/`quotationRef` — loaded lazily when a sales-table row is expanded, not for every row on page load |
| `GET /api/quotations/[id]/sold` | which lines of a quotation are already sold, summed **across every sale** that references it (a customer taking the remaining machines a month later creates a second sale against the same quote). Never 404s: an unconverted — or purged — quotation is an empty list |
| `GET /api/admin/equipments/serial-check?serials=a,b` | serials already present in `customer_equipments` (trim + case-insensitive, same identity rule the equipment writer uses). Duplicates are **legal** (resale, re-registration), so this only opens a confirm dialog |

### 8b. The two cost definitions — never read them interchangeably ⚠️
The dashboard plots two reddish series that mean **different** things, and they
are *supposed* to differ:

```
sales_records.costAmount   ( = RevenueByPeriod.cost — Chart 1 "ต้นทุนสินค้า" )
  =   SUM(sales_record_items.costAmount)                            per-line product cost
  +   SUM(sale_cost_items.amount WHERE costType <> 'product_cost')  ค่ารถ / ค่าขนส่ง / ค่าคอม
  EXCLUDES the `expenses` table (ค่าเช่า / เงินเดือน / ค่าน้ำ-ค่าไฟ)

RevenueByPeriod.expense    ( Chart 2 "รายจ่าย" )
  =   cost  +  SUM(expenses.amount)      i.e. ต้นทุนสินค้า + รายจ่ายบริษัท
```

Chart 1 is "every cost typed into the sale itself"; Chart 2 adds company
overhead. The dashboard states this in a permanent Thai note under the charts, so
a reader comparing the two bars isn't left guessing. `profit` is always computed
from the **raw** values — `revenue - cost - rawExpense` — never from `expense`,
which already contains `cost` (that would double-count it).

Product cost lives on the **line item**, and only there:

- New write paths never create a `product_cost` row in `sale_cost_items`;
  `addCostItem` refuses one (`ProductCostIsPerLineError`), and the UI aliases
  (`product` → `product_cost`, `labor` → `service_visit`) exist so such a value
  can't fall through to the bill-level `other` bucket and be counted twice.
- Legacy `product_cost` rows are **kept as history** (cost data is never
  auto-deleted) but are **never summed**: the v33 backfill already moved that
  money onto the line item, so counting both would double the product cost —
  and silently restate every profit/margin figure that reads `costAmount`.
- `getCostItems` therefore hides those legacy rows and reports
  `SUM(sales_record_items.costAmount)` as **one synthetic `product_cost` entry**
  under the derived id `product-cost:<saleId>`. The cost form thus reads back
  exactly the number that is counted (GET → save → GET is a fixed point);
  showing a legacy row instead would re-submit a number nobody counts and revert
  the last correction on the very next save.
- Cost writes are **absolute**, never `costAmount + delta` (a delta can't survive
  a `withTransaction` retry), and `recalcCostAmount` / `recalcSaleTotals`
  re-derive the cached totals under `SELECT … FOR UPDATE` on the sale row.

### 9. Email (contact form) + lead persistence
[`app/lib/mailer.ts`](./app/lib/mailer.ts) sends via SMTP (`nodemailer`, Gmail by
default). The public `POST /api/contact` **persists the lead to `contact_messages`
first** (via [`contactMessageStore`](./app/lib/contactMessageStore.ts)), then
emails the address stored in `settings.contact_email` (default from
[`contact.ts`](./app/lib/contact.ts), changeable at `/settings`). A send failure
is logged and reported as `emailed:false` but the submission still succeeds — the
lead is never dropped, and admins read it via `GET /api/contact/messages`.
Changing the recipient notifies **both** the old and new addresses. Visitor
fields go into structured `{name,address}` objects to prevent header injection.

### 9a. Edit history (revisions)
Every `updateProduct` / `updateContent` / `updateDocument` snapshots the previous
value into `revisions` ([`revisionStore.ts`](./app/lib/revisionStore.ts)) BEFORE
overwriting, so an accidental edit is restorable via
`POST /api/revisions/[id]/restore`. Restore lives in the route (not the store) so
the stores → `revisionStore` dependency stays acyclic. Restore is itself an
update, so it too is undoable.

### 9b. Observability
[`instrumentation.ts`](./instrumentation.ts) (Next 16, project root) exports
`onRequestError`, which fires for every uncaught server error. Today it emits one
structured JSON line per error; wire a real tracker (Sentry has first-class Vercel
support) by initialising it in `register()` and calling `captureException` in the
hook. The daily cleanup cron logs a structured success line and rethrows failures
so Vercel marks the run FAILED instead of losing it silently.

### 10. Sessions
[`app/lib/session.ts`](./app/lib/session.ts) is `server-only`. A 3-day HS256 JWT
stored in an httpOnly `session` cookie. `createSession` / `getSession` /
`deleteSession`. `SESSION_SECRET` **must** be set or the module throws at import.

### 11. Shared UI components — don't re-implement inline
[`app/components/`](./app/components/): `ConfirmDialog`, `Toast`, `Spinner`,
`ColorPickerDropdown`, `BlockRangeControl` (image-size / block-spacing slider with
−/+ steps + live readout), `RichTextEditor`. Import the shared version instead of
defining a local one.

**Dropdowns are always [`SearchableDropdown`](./app/components/SearchableDropdown.tsx),
never a native `<select>`.** The OS paints a native one, so on a dark-mode machine
it opens as a dark grey popup inside a white form — the reason this rule exists.
The shared component also portals its panel to `<body>`, so a scrolling modal
can't clip it. `searchable={false}` drops the search box for a few fixed options;
wrap it in `<fieldset disabled>` for the disabled state (it takes no `disabled`
prop). Money inputs are [`FormattedNumberInput`](./app/components/FormattedNumberInput.tsx)
(thousands separators) and dates are [`DatePicker`](./app/components/DatePicker.tsx)
(month/year dropdowns, portalled to `#root-portal`) for the same reason: a raw
`<input type="number">` or `type="date"` looks nothing like the rest of the admin UI.

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

- **Migrations fail loud, not silent.** The `ADD COLUMN` / `CREATE INDEX` steps
  swallow only *benign* errors (already-exists / unsupported-syntax); a real
  failure (lock timeout, permission) rethrows so `schema_version` is never
  stamped over a half-applied migration.
- **Preview deploys never mutate the DB.** Bootstrap (CREATE/ALTER/seed) is
  skipped when `VERCEL_ENV === "preview"`, because previews share the production
  database — a branch bumping `SCHEMA_VERSION` must not alter prod before merge.
  Set `ALLOW_DB_BOOTSTRAP=1` for an environment with its own throwaway DB.
- Tables (`db.ts` is the authoritative list): `users`, `product_categories`,
  `products`, `product_specs`, `contents`, `documents`, `settings`, `quotations`,
  `used_docnos`, `contact_messages`, `revisions`, plus the CRM/sales family —
  `customers`, `companies`, `salespeople`, `suppliers`, `product_suppliers`,
  `billing_documents`, `customer_equipments`, `service_schedules`,
  `service_logs`, `sales_records`, **`sales_record_items`** (v33 — one row per
  product line under a sale, see §8a), `sale_cost_items`, `expenses`,
  `recurring_expenses`, `alert_snoozes`.

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
  set to just below the real, currently-measured numbers (see the comment next
  to `thresholds` in `vitest.config.ts` for the exact figures and date — they
  drift as tests are added, so treat that comment as the source of truth, not
  this doc). Several stores/routes genuinely sit at 0% today (e.g.
  `billingStore.ts`, `expenseStore.ts`, `supplierStore.ts`, the
  `/api/suppliers`, `/api/salespeople` and `/api/product-specs` routes) —
  the threshold is deliberately set low enough to pass with that gap still
  open, rather than pretending otherwise. Closing it means adding real tests
  and then raising the threshold in the same change; lowering the threshold
  to make a failing push pass is not an acceptable fix.
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
- **Pre-push gate:** [`.githooks/pre-push`](./.githooks/pre-push) runs
  `vitest run --coverage` before every push and **blocks** the push on any test
  failure OR on a coverage threshold miss — the thresholds in
  `vitest.config.ts` are not just documentation, this is where they're
  actually enforced. It's wired via `core.hooksPath` (set automatically by the
  `prepare` script on `npm install`), so it's version-controlled — no husky
  needed. Emergency bypass: `git push --no-verify`.

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

---

## Recent Architectural Changes (July 2026)

**1. Product Soft-Deletion (`pendingDeleteAt`)**
- A product's deletion is now a 2-stage process: "Soft Delete" (marks `pendingDeleteAt` timestamp) and "Hard Delete" (removes from DB + Cloudinary).
- **Important Invariant:** All public endpoints (`getProductsData.ts`, `GET /api/products`, `GET /api/products/[id]`) MUST filter out products where `pendingDeleteAt !== null`. This ensures that items marked for deletion are invisible to the public. If you write new fetch logic for products, you must respect both `isPublished !== false` AND `!pendingDeleteAt`.

**2. Quotation Generation (PDF DoS Protection)**
- Quotation PDFs are generated entirely on the client side using `jspdf` and `html2canvas-pro`. The server only stores the JSON blob.
- To prevent database/memory bloat, the `POST /api/quotations` route strictly enforces a payload size limit (`JSON.stringify(body).length <= 200000` bytes). Do not increase this arbitrarily without checking memory impacts.

**3. Product Search Performance**
- Global search in `app/components/Products.tsx` is performed on the client-side across all products and languages.
- To prevent UI freezing (especially on low-end devices), the search input is governed by a 300ms debounce (`debouncedSearchProduct`). When modifying this component, maintain the use of the debounced value for any filtering logic.

**4. Testing Updates & Mocks**
- The `updateProduct` mock in Vitest needs to be carefully constructed because it runs within `withTransaction`. When testing API routes that mutate products, use `mockImplementation` or ensure you return the exact object properties requested (e.g. `pendingDeleteAt`).

---

## Recent Architectural Changes (September 2026)

**1. Equipment Calibration Reminders**
- `CustomerEquipment.calibrationDate` (`YYYY-MM-DD`, nullable) records the date of the equipment's most recent calibration — entered by hand in `EquipmentEditModal.tsx`, either an exact date or an approximate one (e.g. when the customer had it calibrated by a different vendor). The logic treats both identically; there's no separate "approximate" flag.
- **Business rule (do not "simplify" this without re-reading the constants):** a calibration is valid for `CALIBRATION_VALIDITY_MONTHS = 12` months (defined in `app/lib/types.ts`, since a client component needs it too). The system must start alerting `CALIBRATION_ALERT_LEAD_MONTHS = 2` months (defined in `app/lib/crmStore.ts`, server-only) *before* that 12-month due date — i.e. the alert fires once `today >= calibrationDate + 10 months`. The "10" is `12 - 2`, not an independently-chosen number; if either constant changes, the trigger point changes with it.
- **No upper bound, unlike warranty alerts:** the `nearingCalibration` query in `getAlerts()` (`app/lib/crmStore.ts`) has only a lower bound (`DATE_ADD(calibrationDate, INTERVAL 10 MONTH) <= today`). Warranty alerts stop firing once `status = 'Expired'`, but nothing marks a calibration "handled" except recording a new `calibrationDate` — so once overdue, it must keep alerting indefinitely (shown as "เลยกำหนดสอบเทียบ" in `app/crm/alerts/page.tsx`) rather than silently disappearing after some window.
- The due date shown to admins (`calibrationDueDate()` helper in `app/crm/alerts/page.tsx`) is `calibrationDate + CALIBRATION_VALIDITY_MONTHS` (12 months, via `addMonthsToDateString()` in `app/lib/dateFormat.ts`) — this is the true due date the customer sees, not the 10-month alert-trigger point. Don't conflate the two when touching this UI.
- Related but separate: `declineWarrantyRenewal()` in `crmStore.ts` is a warranty-only flow (flips equipment `status` to `Expired` + appends a note) triggered from the warranty alert card in `app/crm/alerts/page.tsx`. It has no calibration equivalent — a calibration alert can only be cleared by entering a new `calibrationDate`.
