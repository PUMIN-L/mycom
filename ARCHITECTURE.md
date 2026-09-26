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
├── products/ services/  Public catalog + service pages (§14).
│
├── api/                  ── Route Handlers (the backend) ──
│   ├── auth/             login · logout · me  (session lifecycle)
│   ├── products/         CRUD products + nested categories/ (+ reorder)
│   ├── contents/         CRUD showcase content + by-product/ lookup
│   ├── documents/        CRUD PDF documents + proxy/ (inline PDF streaming)
│   ├── quotations/       save/list/delete quotes + docnos/ ledger + cleanup/ cron
│   ├── settings/         contact-email/ (get/change the contact inbox address)
│   ├── contact/          public contact form (stores lead + emails) + messages/ inbox
│   ├── revisions/        edit history list + [id]/restore/ (product/content/document/customer)
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
│   ├── revisionStore.ts  Edit-history snapshots for product/content/document/customer.
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

**Page weight — what not to undo:**
- **Props into a Client Component are serialized into every page.** Structural
  typing lets a full DB row satisfy a narrow prop type, and every extra field
  then ships to every visitor. `/showcase/[id]` passed full product rows
  (three-language descriptions, images, flags) where `ShowcaseClient` reads
  only id, category and titles — ~55 KB of JSON per view, the bulk of the page.
  `page.tsx` now projects to `ShowcaseClient`'s exported `ProductItem` /
  `ProductCategory` with annotated `.map((p): ProductItem => …)` callbacks, so
  an extra field is a compile error (`__tests__/pages/showcasePayload.test.tsx`).
- **`IBM_Plex_Sans_Thai` is `preload: false` in `app/layout.tsx`.** It is the
  Thai fallback for every `h1`–`h6` (`globals.css`) and the Navbar's font, at
  five weights × two subsets — preloading made it 10 of the 12 font files every
  page fetched at high priority. Keep all five weights (headings render Thai
  at 300–700; a missing one is faked by the browser); do not turn the preload
  back on.

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
export const POST = withRoute("เพิ่มสินค้าไม่สำเร็จ", async (req: NextRequest) => {
  await requireAuth();                       // throws ApiError(401) if logged out
  const data = await req.json();
  return NextResponse.json(await addProduct(data), { status: 201 });
});
```

- `withRoute(fallbackMessage, handler)` — wraps the handler so any thrown error
  becomes JSON. `ApiError` → its own status (not logged); anything else → 500
  with `{ error: fallbackMessage, details }` (logged via `console.error`).
- **`req.json()` inside a wrapped handler refuses an unusable body:** not JSON,
  empty, or JSON `null` → `ApiError(400, INVALID_JSON_BODY_MESSAGE)` instead of
  a crash in the handler reported (and logged) as a 500. Objects, arrays and
  other values pass through, so each route still checks its own fields; a
  route that writes `req.json().catch(…)` keeps its own fallback. It works by
  redefining `json` on the request object, which Next's request Proxy (a
  `get` trap only) passes through; a request that refused it would keep its
  plain `json()`.
- **Error messages are Thai** — they reach Thai admins as written (the 4xx
  texts, and `fallbackMessage`, which is what a 500 says in production).
  `__tests__/apiErrorLanguage.test.ts` scans `app/api` + `app/lib` and fails on
  an English-only message; the few allowed (codes a client matches on, such as
  `Unauthorized` and `invalid_phone`, the CSRF refusals, internal errors that
  never reach a screen) are listed there.
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
| —                                               | all `/api/admin/**`, incl. `POST`/`GET /api/admin/sales` + `[id]/items` and `GET /api/admin/equipments/serial-check` (§8a), plus the task board's `/api/admin/tasks/**` + `/api/admin/task-topics/**` (§8c) | |

A public read returns only what a visitor may see: `GET /api/products/[id]`
drops `supplierIds` (which suppliers a product comes from) unless the caller is
logged in — only the admin edit form and the showcase's admin-only suppliers
modal read it.

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

- **Every rich-text write path sanitizes** — products (create/update), contents
  (blocks + title, create/update/restore) and categories (create AND rename:
  `updateCategory` stored the request verbatim until it was found in a
  security review, while the product sidebar renders these names as HTML).
- **After saving, render the server's copy, never your own editor output.**
  quill 2.0.3 (the latest) has an open advisory on its HTML export, so HTML
  from the editor is untrusted until the server has sanitized it. The category
  rename (`Products.tsx`) shows the names the PUT returns; the showcase
  editor's auto-save (`saveBlocks`) takes the PUT's content row as its
  baseline, like the full save does. A reply without them keeps the previous
  value rather than fall back to the local HTML.
- `xlsx` comes from SheetJS's own CDN
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned by sha512 in
  the lockfile) — npm's `xlsx` stopped at 0.18.5, which has a prototype-pollution
  and a ReDoS advisory. Upgrade by changing that URL. Its ESM build no longer
  loads Node's `fs` by itself; the app only calls `writeFile` in the browser
  (download), where that does not matter.

**Showing rich text the way the editor showed it** ([`lib/richTextDisplay.ts`](./app/lib/richTextDisplay.ts)
+ the `rich-text` class in `globals.css`). Quill's editing area is
`white-space: pre-wrap` with no paragraph margins, and it styles its own
`ql-size-*` / `ql-align-*` classes; react-quill-new's getSemanticHTML even
writes every space as `&nbsp;`. A page rendering that HTML plainly collapsed
runs of spaces (once the nbsp became ordinary spaces so lines could wrap),
added gaps between lines, dropped sizes and alignment, or — where paragraphs
were laid out inline — ran every line into one. So:

- A full display (a content block, a content title) is
  `className="rich-text"` + `richTextHtml(html)`.
- A compact one (a product card, a category in a list, a chip) is
  `richTextInline(html)` inside `rich-text`: paragraphs become `<br>` so a
  `line-clamp` still works, list items "• " / "1. " lines; alignment is lost
  with the paragraphs, so `richTextAlign(html)` gives the container the one
  every line shares.
- A text-only place (the catalog cards, related products — kept as text for
  page weight) is `htmlToTextLines(html)` with `whitespace-pre-wrap`. A
  `<title>`, meta description or JSON-LD still wants one line: `htmlToText`.
  A label, alt text, search or length check on a rich field is `stripHtml`,
  which removes the tags AND decodes entities (it used to leave "&amp;" in
  product pickers, the home cards' English line and product names on
  quotations). Never put any of these text results back into HTML; a
  plain-text fallback in an HTML slot goes through `escapeHtmlText`.
- Whitespace that is the whole content of a line ("<p>  </p>") is kept, and a
  paragraph with nothing in it gets a `<br>`: the editor shows both as lines.
- The editor (`RichTextEditor`, wrapper class `rich-text-editor`) gets the
  site's font and line height 1.6 from unlayered rules in `globals.css`:
  `quill.snow.css` is unlayered, so a Tailwind utility cannot override it.
  Its toolbar — size, bold/italic/underline/strike, text and background
  colour, alignment, lists, clear — is pinned by
  `__tests__/components/RichTextEditorToolbar.test.tsx`.

**Plain text is stored as typed (schema v44).** Every other text column — names,
addresses, notes, references, line-item names (the list is `PLAIN_TEXT_COLUMNS`
in `db.ts`) — is written through `sanitizePlainText`, which removes REAL tags
and then decodes sanitize-html's `&amp;` `&lt;` `&gt;` back, so "A&B" is stored
as `A&B`, not `A&amp;B` (which then showed literally everywhere React printed
it). The v44 migration decoded the rows written before, column by column with
its progress in a `settings` row.

"Real tag" is one rule, in [`lib/htmlTags.ts`](./app/lib/htmlTags.ts): a `<`
followed by a known HTML element name, a boundary and a closing `>`, that is
also closed later (`<b>…</b>`), carries an attribute, or is an element that
embeds or runs something (`<img>`, `<script>`, `<br>` …); an unclosed one of
those last kinds, or with an attribute, counts too. Every other `<` is handed
to sanitize-html as `&lt;` and kept — an HTML parser alone takes any `<` + a
letter for a tag and drops the text after it, so "PS<B-200" used to be saved
as "PS". Consequences:

- **Never render a plain-text value as HTML** (`dangerouslySetInnerHTML`): `<`
  is real text — "x < y > z", "<5 กก.", "PS<B-200>", "Size <M>". Print it as
  a React text node.
- **Never run a tag regex (`stripHtml`, `/<[^>]*>/`) or DOMParser over plain
  text.** Both cut those values ("PS<B-200>" parses as an element) —
  `stripHtml`'s `/<[^>]*>?/` even cuts from a lone `<` to the end. Where the
  cut value also fills an edit form (/expenses did), saving writes the cut
  text back.
- A value that may be EITHER — an equipment's or sale line's `productName` can
  be the catalog's rich title, a sale-derived expense row carries a rich
  category name — is shown with `displayText()` (`lib/stripHtml.ts`): a value
  holding a real tag (the same `containsHtmlTag` rule) → `htmlToText`, plain
  text → as typed. The note search-and-replace warning uses that rule too, so
  "no warning" still means "stored exactly as typed".
- Rich-text columns (product title/description, content title/blocks, category
  names) are untouched: they are HTML, and still stored with entities.

> **Never** reach for `jsdom`, `isomorphic-dompurify`, or DOMPurify+linkedom on
> the server. `jsdom` fails to load on Vercel's serverless runtime
> (`ERR_REQUIRE_ESM`) and 500s the whole site; DOMPurify+linkedom silently
> returns the input **unsanitized** when the fake DOM lacks features. Both were
> tried and reverted. The same rule applies to any new server dependency with
> native/ESM-loader quirks (see `mailer.ts`'s note).

### 5a. Customer note search-and-replace
`GET /api/customers/note-search` + `POST /api/customers/note-replace`
(`app/lib/customerNoteSearchStore.ts`, matcher/regex-safety rules in
`app/lib/noteSearch.ts`) — the search block on `/customers`, separate from the
existing name/company filter on that page, which this feature does not touch.

- **What this path may write: exactly `customers.note` (with its
  `noteUpdatedAt` stamp, §5b), plus a `revisions` row.** Nothing here ever
  touches `companyId`, `name`, `department`, `phone` or `email` —
  `__tests__/lib/customerNoteSearchStore.test.ts` asserts that from the SQL
  actually issued, not from a comment, precisely because a bulk path is the one
  place a scope-creeping write is most dangerous.
- **The matcher is a value, not a raw term.** The only way to get a
  `NoteMatcher` is `buildMatcher()` in `noteSearch.ts`, which refuses an empty
  term, a broken pattern, and — the one that actually matters — any pattern
  that can match the empty string (a term-less "match" would replace between
  every character). Refusal codes for search are
  `NOTE_SEARCH_REFUSAL_CODES`; the store takes a `NoteMatcher`, never a string,
  so there is no code path from a dangerous pattern to an `UPDATE`.
- **Snippets are rendered as plain text — no `dangerouslySetInnerHTML`
  anywhere in this feature.** A customer note is a years-long hand-typed call
  log and may contain `<`, `>`, or anything else that reads as a tag.
- **Optimistic concurrency, not a lock.** Each search row's `note` doubles as
  the value shown and the concurrency token: the client echoes it back as
  `expectedNote` on replace, and the store refuses (`"stale"` in
  `NOTE_REPLACE_REFUSAL_CODES`) if the stored value has moved on since the
  search ran — no `SELECT ... FOR UPDATE` held across a request. Other refusal
  codes: `not_found` (customer deleted since the search), `too_long` (result
  would pass 2000 chars and be silently truncated — refused instead), and
  `unsafe_match` (should be unreachable, since `buildMatcher` already refuses
  these — it exists to fail loudly rather than write something odd).
- No schema change — `customers.note` already existed; nothing here bumped
  `SCHEMA_VERSION`.

### 5b. Customer list order — "อัปเดตล่าสุด"
`customers.noteUpdatedAt` (VARCHAR ISO-8601 UTC, schema v42) is when the
**note** last changed — not when the row was last saved. `/customers` shows it
as "อัปเดตล่าสุด" (`displayDateTimeParts`, Bangkok time, e.g.
`05 Sep 2026 20:25`) and sorts by it, newest first, empty notes last
(`app/lib/customerOrder.ts`). A row whose note changed in the last 12 hours
(`isNoteRecentlyUpdated`, `NOTE_RECENT_WINDOW_MS`) gets a pastel green
background (`bg-green-100`); the page's `now` ticks once a minute so the
highlight expires without a reload.

- **The date column is laid out in parts so rows line up:** zero-padded day,
  `tabular-nums` on the cell (Inter has tabular figures), and the month in a
  fixed-width `inline-block` because month names differ in width (`Jul` vs
  `Sep`). A plain string put "5 Sep" and "13 Sep" rows visibly out of line.

- **Every writer of `customers.note` stamps it in the same statement:**
  `POST /api/customers` (note given → creation time, else NULL),
  `PUT /api/customers/[id]` (only when the sanitized note differs from the
  stored one — the same condition as its revision snapshot; returns the stored
  `noteUpdatedAt` so `CustomerDetailsModal` can patch the list in place),
  note-replace (§5a), and the customer restore (§9a). Emptying a note sets it
  NULL. A new writer of `note` must stamp it too, or that customer silently
  stops moving up the list.
- **Pickers load `GET /api/customers?fields=list` — every column but `note`.**
  The call log is the bulk of the full list and none of the pickers read it
  (task links, equipment/sales forms, quotation, service job, dashboard,
  EquipmentTab). ⚠️ Never write a row from that list back through
  `PUT /api/customers/[id]` — the route treats a missing `note` as empty and
  would erase the log. Only `/customers` (full list) and
  `CustomerDetailsModal` (full row) write customers.
- **The `/customers` table is paged, 50 rows** (`CUSTOMERS_PER_PAGE`). Only
  the rendered rows are sliced — sort order, the count, Excel export and deep
  links use the full `filteredCustomers`; searching resets to page 1, and the
  page is clamped by derivation (no setState-in-effect).
- **Sorted on the client, on `/customers` only.** `GET /api/customers` keeps
  `ORDER BY createdAt DESC` because the same list feeds dropdowns in
  `EquipmentEditModal`, `SalesRecordEditModal`, `EquipmentTab`,
  `TaskLinkChips` and `QuotationPickerSection`. The page sorts inside a
  `useMemo` with `sortCustomersByNoteActivity` (parses each timestamp once) —
  a plain `.sort(comparator)` over ~6,000 rows cost ~40–70 ms per render.
- **Backfill (db.ts bootstrap):** rows with a note and no stamp take the newest
  `revisions.createdAt` whose snapshot note DIFFERS from the current note (old
  phone-only saves wrote snapshots too, so "newest snapshot" alone would be
  wrong), else `createdAt`. A failure is logged
  (`noteUpdatedAt backfill FAILED`) and does not abort bootstrap; the page
  falls back to `createdAt` for a NULL stamp.

### 6. Security headers & CSRF
- [`next.config.ts`](./next.config.ts) sets an **enforced**
  `Content-Security-Policy`, plus `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy` and `Strict-Transport-Security`.
- `script-src` allows `'unsafe-eval'` **only under `next dev`** (React needs it
  there; neither React nor Next uses eval in production). The shipped browser
  libraries were run in Chrome under the production policy — pdf.js (both the
  FontFace and the `new Function` glyph-path branch, which it feature-tests and
  falls back from), html2canvas→jsPDF, Quill and xlsx — with output identical
  to the old policy. Before adding a client library that may `eval` /
  `new Function`, check it works without it
  (`__tests__/nextConfigCsp.test.ts` pins the policy).
- `'unsafe-inline'` stays: a nonce-based policy needs per-request rendering
  (Next applies nonces only when rendering dynamically), which would end the
  static caching of `/`, `/about` and `/catalog`.
- `connect-src` allows `https://api.cloudinary.com`: files over 4 MB are
  uploaded from the browser straight to Cloudinary (§7).
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

**Uploads go through `uploadFormData()`** ([`lib/uploadClient.ts`](./app/lib/uploadClient.ts)),
never a bare `fetch("/api/upload")`. Vercel refuses a request body over 4.5 MB
before it reaches a function, so a large catalog PDF could never arrive at the
route whatever its own limit said. Files up to `DIRECT_UPLOAD_THRESHOLD` (4 MB)
still go through `/api/upload`; bigger ones are checked in the browser against
the same limits (`lib/uploadLimits.ts`, shared by all three) and uploaded
straight to Cloudinary with signatures from `POST /api/upload/sign` (login
required; the signature fixes the folder, the allowed formats and — for a PDF's
raw copy — the public id). Same answer shape either way: `{ url }`, or
`{ url, coverUrl }` for a PDF.

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
browser double-decompresses and the PDF is corrupted. The proxy takes an
optional `name` (the document's title, passed by `/document/[id]`) and names
the file after it — `filename*=UTF-8''…` with an ASCII `filename` fallback
(`lib/pdfFilename.ts`); without one it stays `document.pdf`.

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
quotations past `RETENTION_DAYS` **and expired `alert_snoozes` rows**
(`purgeExpiredAlertSnoozes` in `crmStore.ts`, `snoozesPurged` in the log line).
That purge is one day conservative on purpose — it deletes with `<` against
today's Bangkok date, a strict subset of the `snoozeUntil <= today` the alert
queries already treat as spent, so no alert can reappear early because of it.
`service_logs` (real service history) and `used_docnos` (kept for
conversion-rate analytics) are deliberately not swept.

**No PDF of an unsaved document — on every document page.** ⬇️ ดาวน์โหลด PDF
saves first (quotation, billing, PO, service job), and a save that does not
land — an error, no connection, or a number the ledger refused with no free one
to move to — stops there with a Thai toast; nothing is rasterised. The PDF is
the copy the customer keeps: made anyway, the customer would hold a number the
system does not have, free to be issued again to someone else (for billing, a
tax document). The quotation and billing saves used to be "best-effort".

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

### 8c. The manual task board (schema v35, charset fixes v36) — not an alert
The alert feed shows only what the *system* computed. The board that shares the
`/crm/alerts` page is the opposite: post-it notes the owner writes for himself
("โทรหาเจ้านี้", "ทำใบเสนอราคาให้เจ้านั้น"). Nothing on it is ever created,
completed or deleted by the system, it is not part of the alert tab strip, and
it **never writes to `alert_snoozes`** — a task has no snooze. Store:
[`app/lib/taskStore.ts`](./app/lib/taskStore.ts); UI: `TaskBoardSection` /
`TaskFormModal` / `TaskLinkChips` / `TaskTopicManagerModal`.

Three tables, **no foreign key on any of them**:

| Table | Key | Indexes |
| ----- | --- | ------- |
| `task_topics` | `id INT` PK | `idx_tt_active_sort (isActive, sortOrder)` — "active topics in the order the admin arranged" |
| `crm_tasks` | `id VARCHAR(36)` PK | `idx_ct_status_due (status, dueDate)` (the bell's count), `idx_ct_topic (topicId)` (the topic filter), `idx_ct_createdAt` (ordering the undated tasks) |
| `task_links` | composite PK `(taskId, targetType, targetId)` | `idx_tl_target (targetType, targetId)` |

- Topics are **rows, not an enum** — the owner adds/renames/recolours/reorders
  them at runtime. `color` stores a **token** (`blue`, `amber`, …) that the UI
  maps to a class; a raw CSS value from a user must never reach a `class`/`style`
  attribute. Retiring a topic is `isActive = 0`; `DELETE` is refused (400,
  `TopicInUseError`) while any task — pending *or* done — still references it.
  The five default topics are seeded only while the table is **entirely empty**,
  so a deploy never resurrects a deleted topic or re-asserts a renamed one. The
  emptiness check is a **separate `SELECT`** followed by a plain multi-row
  `VALUES` insert — never one `INSERT … SELECT … WHERE NOT EXISTS (SELECT … FROM
  task_topics)`, which reads the table it writes (a restricted shape in MySQL,
  and one whose result depends on the optimizer). If that insert fails with a
  "someone else got there first" error, the table is **re-checked**: standing
  down is only correct when the rows are actually there, or the board silently
  ends up with no topics at all and the version is stamped anyway.
- **`task_topics.icon`, `task_topics.name`, `crm_tasks.title/detail` and
  `task_links.label` pin `utf8mb4` explicitly** (v36). Every other column in
  `db.ts` inherits the database default, which has never mattered because Thai
  is 3 bytes — an emoji is 4. On a `utf8mb3` default an unpinned column rejects
  the whole INSERT under the strict `sql_mode` TiDB ships with (ERROR 1366
  `Incorrect string value: '\xF0\x9F…' for column 'icon'`) and silently stores
  `?` without it. Any new column meant to hold what a person types should pin it
  too.
- `crm_tasks.dueDate` is **nullable on purpose**: "call this customer back
  sometime" is a complete task. Listing order is overdue → due today → due later
  → undated (newest first).
- `task_links.targetType` ∈ `TASK_LINK_TARGETS` (`customer` | `equipment` |
  `quotation` | `document`), keyed exactly like `alert_snoozes
  (alertType, referenceId)`.

**Why the links are soft, `taskId` included.** Link targets die independently of
the task: quotations are hard-deleted by the 2-year retention cron (§8), so an FK
on `targetId` would either block that purge or (with `ON DELETE CASCADE`) destroy
the link — and with it the only record of what the task was about. A link must
never take a task down with it. The same reasoning already governs
`sales_records.quotationId` (§8a). Leaving `taskId` unconstrained too keeps **one
rule for the whole table** and costs exactly one explicit DELETE: `deleteTask`
drops that task's own link rows inside the same `withTransaction`. Nothing here
is ever cleaned up automatically — a link whose target has been purged is
**kept** and rendered as "ถูกลบแล้ว".

**`label` is a snapshot taken at link time and is deliberately never re-synced.**
Display prefers the target's *current* name while the target still exists and
falls back to the stored label once it is gone. That fallback is the entire
point: it is what keeps a chip readable after its target has been deleted or
purged. Do not "fix" it into a live lookup.

| Route (all `requireAuth()`) | What it does |
| --------------------------- | ------------ |
| `GET /api/admin/tasks` | board listing, `?topicId=&status=&limit=`, each task's links attached. Filtering is a **view** — it writes nothing |
| `POST /api/admin/tasks` | create a task **plus all of its links** in one transaction. The topic must exist and still be active |
| `PATCH /api/admin/tasks/[id]` | edit fields, flip `status` (done/pending), and/or **replace the whole link set**. An absent field is left alone; `dueDate: null`/`""` clears it |
| `DELETE /api/admin/tasks/[id]` | permanent, confirm-gated in the UI; drops this task's link rows in the same transaction and never touches the targets |
| `GET /api/admin/task-topics` | active topics (`?includeHidden=1` for the manage-topics modal) |
| `POST /api/admin/task-topics` · `PATCH /api/admin/task-topics/[id]` | add / rename / re-emoji / recolour / hide-restore (`isActive`) |
| `PATCH /api/admin/task-topics/reorder` | the whole new order in one transaction; unknown ids are ignored so a stale tab can't break it. The static segment wins over the sibling `[id]` route |

`GET /api/admin/alerts` gained three keys and **kept every old one**:
`customerCallFollowUps` (capped at 100 rows for display),
`customerCallFollowUpsTotal` (the true count) and `dueTaskCount`. The last is
composed in the route from `countDueTasks()` — `crmStore` must not learn about
the board.

### 9. Email (contact form) + lead persistence
[`app/lib/mailer.ts`](./app/lib/mailer.ts) sends via SMTP (`nodemailer`, Gmail by
default). The public `POST /api/contact` **persists the lead to `contact_messages`
first** (via [`contactMessageStore`](./app/lib/contactMessageStore.ts)), then
emails the address stored in `settings.contact_email` (default from
[`contact.ts`](./app/lib/contact.ts), changeable at `/settings`). A send failure
is logged and reported as `emailed:false` but the submission still succeeds — the
lead is never dropped, and admins read it via `GET /api/contact/messages`.
The same holds when SMTP is not configured at all (it used to answer 503 before
saving anything). Against bots ([`contactSpamGuard.ts`](./app/lib/contactSpamGuard.ts)):
a honeypot input (`website`, off-screen, out of the tab order) — a submission
that fills it is answered "sent" and dropped; and an hourly email cap counted in
the database (`countContactMessagesSince`), because the per-IP limit is per
serverless instance — past 30 leads an hour, leads are still stored but no
longer emailed one by one.
Changing the recipient notifies **both** the old and new addresses. Visitor
fields go into structured `{name,address}` objects to prevent header injection.

### 9a. Edit history (revisions)
Every `updateProduct` / `updateContent` / `updateDocument` that actually changes
something snapshots the previous value into `revisions`
([`revisionStore.ts`](./app/lib/revisionStore.ts)) BEFORE
overwriting, so an accidental edit is restorable via
`POST /api/revisions/[id]/restore`. Restore lives in the route (not the store) so
the stores → `revisionStore` dependency stays acyclic. Restore is itself an
update, so it too is undoable.

**Customers** (`entityType: "customer"`) are in the same history: every write to
`customers.note` — the ✏️ hand edit and the bulk search-and-replace alike —
snapshots the previous note first. Their restore writes **one column of data,
`note`** (plus a fresh `noteUpdatedAt` stamp, §5b — never taken from the
snapshot), and says so in the response (`restoredFields: ["note"]`), because
`note` is the only field those writers ever overwrite; putting `name` / `phone`
/ `email` / `companyId` back from an old snapshot would revert edits nobody asked
to revert and could point a customer at a deleted company. It refuses, in Thai,
a snapshot longer than the 2000-character ceiling the customer routes impose with
`substring(0, 2000)` (that truncation is silent, so a restore must not walk into
it) and a customer row that has since been deleted — an undo of a note does not
resurrect a customer. The allowlist in `app/api/revisions/route.ts` is keyed by
`RevisionEntityType`, so adding a type to the union fails the build until the
list route can serve it.

**Storage is bounded — three rules, all in `revisionStore.ts`.** `revisions` is
the biggest thing this database will hold once ~6,000 customers with years-long
call logs are imported, so:

1. **A customer snapshot stores `{ name, note }`, not the whole row.** The
   restore writes one column, so `companyId` / `department` / `phone` / `email`
   / `id` were bytes that could never be restored. The shape is
   **self-describing, not versioned**: the restore route keys off the presence
   of a `note` key, so the full-row snapshots already in production restore
   exactly as before and no migration is needed. `product` / `content` /
   `document` snapshots are still whole — their restores re-apply every field.
2. **No change, no snapshot — all four entity types.** `PUT /api/customers/[id]`
   compares the **post-`sanitizePlainText`, post-`substring(0, 2000)`** note
   against the stored one and skips the revision when they match (comparing the
   raw request body instead would still snapshot a save that changed nothing
   that gets written). `replaceInNotes` and the restore route already had the
   same rule. `updateContent` / `updateProduct` / `updateDocument` now follow
   it too: they used to decide from **which fields were supplied**, and an edit
   form posts every field on every save, so opening something and pressing save
   wrote a full snapshot — for a content, the whole rich-text document. Each
   store's `set()` now takes a third argument, "does this column's new value
   differ from the row's", and only `saveRevision` is gated on it; **the UPDATE
   is built exactly as before**. The comparison is always against the value the
   UPDATE will write (post-sanitize, post-truncation) and treats a stored NULL
   as the `""` / `0` / `null` that the row-mapper reads it back as.
   `contents.blocks` is JSON, so both sides go through the same
   `sanitizeBlocks()` and a key-sorting serializer (`canonicalize` in
   `contentStore.ts`) — object key order is not a value here, block order is,
   and the written value is still a plain `JSON.stringify`. A product's
   `supplierIds` counts as a change even though it is not a column of
   `products`: it is in the snapshot and a restore re-applies it.
3. **A per-entity ceiling (`REVISION_KEEP`).** After every INSERT, `saveRevision`
   keeps the newest N snapshots for that `(entityType, entityId)` and deletes
   the rest **on the same connection**, so inside `withTransaction` the trim
   commits or rolls back with the snapshot. N is `customer: 10`, `content: 5`
   (full rich-text HTML — individually the largest rows), `product: 20`,
   `document: 20`.
   > ⚠️ The ordering is the load-bearing part: `createdAt` is a VARCHAR ISO
   > string, so two snapshots written in the same millisecond share it exactly.
   > The trim orders `(id = ?) DESC, createdAt DESC, id DESC` — the primary key
   > breaks the tie so the order is total and deterministic, and the row just
   > inserted is pinned to the front so neither a tie nor a skewed serverless
   > clock can make the newest write the one thrown away.

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

**Login (`app/api/auth/login/route.ts`):**
- `username` / `password` must be non-empty **strings** — checked before the
  lock or the DB is touched. `query()` inlines a non-string parameter as-is, so
  `"username": [0]` became `WHERE username = 0`, which matches every user
  (MySQL/TiDB cast non-numeric strings to 0) while its failures were counted
  under the lock key "0". Any route taking a value from a public request body
  into SQL needs the same type check.
- The row the DB returns must BE the typed username (case aside), or it is
  treated as no user. The DB compares by collation, looser than the lock key:
  TiDB's default `utf8mb4_bin` is PAD SPACE, so `"admin "`, `"admin  "`… all
  found the admin row, each under its own lock bucket — 5 more guesses per
  trailing space (an `_ai_` collation does the same with accents).
- Lockout: 5 failures / 15 min per bucket, DB-backed. The bucket is the
  username — unless the request carries a valid **device cookie**
  (`app/lib/loginDevice.ts`: `login_device`, issued on every successful login,
  180 days, httpOnly, `Path=/api/auth/login`, SameSite=Strict), in which case
  it is that device's own bucket. So someone failing on purpose locks the
  username, not the admin's browser, and gains no extra guesses. A trusted
  login clears only its own bucket, never the username's.
- **Revocation ("ออกจากระบบอุปกรณ์อื่นทั้งหมด", /settings):** every session
  and device token carries the **session epoch** it was issued under
  (`settingsStore`: `session_epoch` row, cached, tag `session_epoch`).
  `getSession()` rejects an older one; `POST /api/auth/logout-others` bumps it
  atomically, busts the tag, and re-issues the caller's own session and device
  token under the new epoch (passed explicitly, not read back through the
  cache). Tokens from before epochs existed read as 0. The epoch is read only
  when a valid session cookie is present, and a read error fails open (0) so a
  DB blip does not log everyone out. `middleware.ts` (edge, no DB) checks only
  the signature, so a revoked browser may still load a page shell — every
  protected API goes through `getSession()` and rejects it (the one admin page
  that reads server-side, `/documents`, reads the list `GET /api/documents`
  already serves publicly). On the client, `AuthContext` reads `/api/auth/me`
  once per page load, so a tab open during a revocation still says logged in:
  `/login` calls `refresh()` before redirecting a "logged-in" visitor to
  /adminpanel, or a revoked tab sent there by a 401 would bounce straight back
  (`__tests__/pages/loginRevokedSession.test.tsx`).
- ⚠️ The device key is `"login-device:" + SESSION_SECRET`, deliberately NOT the
  session key: `getSession()` and middleware check only the signature, so a
  token signed with the session key would be accepted as a session. Tests pin
  both directions (`__tests__/lib/loginDevice.test.ts`).

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
`FormattedNumberInput` shows exactly the number it reports: one decimal point
(a second one is dropped from the text too, not just from the number) and every
decimal the value has — `toLocaleString`'s default of 3 showed 1.23456 as
"1.235", and leaving the field then saved that.

**Dates** ([`lib/dateFormat.ts`](./app/lib/dateFormat.ts)): "today" on the
SERVER is `bangkokDateString(new Date())` — Vercel's clock is UTC, still
yesterday in Bangkok until 07:00 (a sale or expense saved without a date used to
get yesterday's). `isValidDateString` is the one validator for a
`YYYY-MM-DD` input and refuses a day that does not exist ("2026-02-31": `new
Date()` rolls it over into March instead of failing, and a DATE column then
rejects it with a 500).

### 12. i18n strings
Add UI copy to [`app/i18n/translations.ts`](./app/i18n/translations.ts) and read
it with `useT()` / `useLanguage()`. Don't hardcode user-facing strings in
components.

### 13. ใบ Job — the printed service job sheet (schema v38)

**It is a piece of paper.** The office fills it in from data the system already
holds, prints it, the technician carries it to the customer's site, writes what
he did on it **by hand**, and the customer signs it **with a pen**. The signed
paper comes back and is filed in a folder. Nothing is scanned, uploaded or
signed on a screen — there is no signature pad and no attachment step, by the
owner's explicit decision.

| Piece | Where |
| --- | --- |
| Builder + A4 sheet + PDF download | `app/service-job/page.tsx` |
| Register of issued sheets, and the **only** ปิดงาน button | `app/service-job/saved/page.tsx` |
| Store | `app/lib/serviceJobStore.ts` |
| Number (`JOB<DDMMYY>-NN`, shared `used_docnos` ledger) | `app/lib/serviceJobNumber.ts` |
| Routes | `app/api/service-jobs/` (`route.ts`, `[id]/`, `[id]/complete/`, `[id]/cancel/`) |

Tables: `service_jobs` (one row per sheet) and `service_job_equipments`
(`PRIMARY KEY (jobId, equipmentId)` — that composite key is what makes the same
machine twice on one sheet impossible *by structure*, not by an if-statement a
future form can forget). `service_logs` gained `equipmentId` + `jobId` with a
**UNIQUE `(jobId, equipmentId)`**, and its `scheduleId` became nullable, because
a walk-in repair is a real visit with no appointment behind it.

> ⚠️ **SERVICE HISTORY IS WRITTEN WHEN THE JOB IS CLOSED, NEVER WHEN THE SHEET IS
> ISSUED.** This is the rule someone will "simplify" away. `createJob` writes
> **zero** `service_logs` rows; `completeJob` writes one per machine, with
> `serviceReportNumber = jobNo`, and closes the linked appointment — all in one
> transaction. A sheet that was printed and never taken is not a visit, and a
> service record claiming otherwise can never afterwards be told apart from a
> true one. Closing twice writes nothing extra (row read `FOR UPDATE`, the flip
> is `WHERE status = 'issued'` and a zero-row result stands down, and the UNIQUE
> index is the last line).

> ⚠️ **Nothing in this feature touches `customer_equipments.calibrationDate`** —
> the store never issues a write against that table at all, and two tests assert
> it. The work description is handwriting on paper; the system cannot know
> whether the visit was a calibration or a five-minute lamp check, and guessing
> would push the next calibration reminder out — silencing an alert that should
> ring (see §Recent Changes, calibration reminders).

Two more rules that look like styling and are not: **the serial number is never
typed** (it is read off the chosen `customer_equipments` row; there is no input
for it anywhere), and **the sheet's blank areas are the product** — the งานที่ทำ
column stays empty, the description block is *ruled* (unlined paper makes
handwriting drift), and the number of ruled lines grows as the machine table
shrinks so a one-machine sheet does not print a third of an A4 page as unusable
white. `scheduleId` is a plain id + index, **never an FK**: deleting the
appointment must leave the sheet whole (`getJob` LEFT JOINs it and reports
`scheduleExists: false`).

### 14. SEO — public pages, links and metadata

**Metadata: every public page uses [`pageMetadata()`](./app/lib/pageMetadata.ts).**
Next merges metadata *shallowly*: a page without its own `openGraph` shares the
root layout's — og:url and og:title of the **home page**, which is what LINE and
Facebook showed when someone shared /about — and a page *with* its own
`openGraph` loses the file-based image (`app/opengraph-image.tsx` is merged only
at the segment it lives in). `pageMetadata` sets title, description, canonical,
Open Graph (with the image) and Twitter together. Give it the bare title: the
root template appends " | Profin Lab Scale" (writing the brand too gave /catalog
and /document a doubled brand). Keep descriptions ≤ 160 characters — Google
drops the rest; the home page's is `SITE_META_DESCRIPTION` (the long
`SITE_DESCRIPTION` is for JSON-LD). There is no `keywords` meta: Google ignores it.

**Rich text in plain-text places goes through `htmlToText()`** (`lib/stripHtml.ts`),
not `stripHtml`: sanitize-html stores `&` as `&amp;`, so stripHtml alone put
"&amp;" into `<title>`, descriptions, alt text and slugs. Structured data is
rendered with `jsonLdHtml()` (`lib/jsonLd.ts`, escapes `<`).

**Product links go straight to the content page** — `productHref()` in
[`lib/productLinks.ts`](./app/lib/productLinks.ts), fed by
`getProductsData().contentIdByProduct` (public products only; built per request
from `getAllContentsMeta`, cached under the `products` tag every content write
busts). `getProductsData` catches failures **outside** its cache, like
`getCompanyInfo`: its entry has no TTL, so a cached fallback used to pin an
empty catalog until someone edited a product. `/showcase/product/[id]` is
only a gateway for products without a content page; its redirect stays
**temporary (307) on purpose** — where a product leads can change, and browsers
cache a 308 forever.

**The crawlable catalog.** The home grid shows 9 products at a time and filters
in the browser, so before these pages most product pages had no link from
anywhere but the sitemap:
- `/products` — every category and product; linked from the footer on every page.
- `/products/{id}-{slug}` — one per category with ≥ 1 public product (else 404).
  The id identifies the page; the slug (English name, `lib/catalogPaths.ts`) is
  for reading, and a stale slug **308s** to the current one. ISR with
  `generateStaticParams() → []`, so the build needs no database.
- `/services/{slug}` — one per home-page service card. The copy lives in
  `translations.ts` (`servicePages.pages`), the list in `lib/servicePages.ts`.
  Every claim in it is taken from copy the site already made (the service cards,
  `SITE_DESCRIPTION`, the Organization JSON-LD) — **add facts only from the
  owner**, never invent certifications, years or numbers.
- Each `/showcase` page links "สินค้าที่เกี่ยวข้อง" (same category first,
  `lib/showcaseSeo.ts`) and its category page — built from **public products
  only**, even for an admin. Its title adds the product's Thai/English names
  when the content title is only a model number; image alt text is that title.
- Data for these pages is converted to plain text and clipped on the server
  (`lib/catalogPages.ts`) — see "Page weight" above.

**Sitemap.** No `lastModified` on static pages (it was "now" on every fetch,
which Google learns to ignore). Content pages use **`contents.updatedAt`**
(schema v43) — stamped by `updateContent` only when a column it writes actually
changes (the same rule as its revision snapshot), backfilled from `revisions`,
NULL = fall back to `createdAt`. It is also the Article's `dateModified`.

**PDF catalogs.** `robots.ts` allows `/api/documents/proxy` (the rest of `/api/`
stays disallowed) so the catalogs' text can be indexed; `/document/[id]` links
the PDF plainly for crawlers, and the `download=1` copy sends
`X-Robots-Tag: noindex` (same file, second URL).

**Content images** render through `ResponsiveImage`: Cloudinary resizes and
re-encodes them from the URL (`lib/cloudinaryUrl.ts`, `f_auto,q_auto,c_limit,w_…`
+ srcset), the stored URL never changes, and if the resized URL fails (an
account with strict transformations) the image falls back to the original.

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
  stamped over a half-applied migration. v44's entity decode
  (`decodeStoredPlainText`, §5) is a DATA backfill and must not take the site
  down: a column that fails is logged (`[db:bootstrap] … FAILED`), the site
  carries on — and the version is left **unstamped**, so the next cold start
  runs the bootstrap again. Per-column progress in a `settings` row
  (`plaintext_decode_v44_done`) means that run decodes only the columns left.
  At most `PLAIN_TEXT_DECODE_MAX_ATTEMPTS` (5) such bootstraps, counted in
  `plaintext_decode_v44_attempts`: a column that fails every time then gets a
  "giving up" log line and the version is stamped, so cold starts stop
  re-running the whole bootstrap.
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
  `recurring_expenses`, `alert_snoozes`, plus the manual task board (v35) —
  **`task_topics`**, **`crm_tasks`**, **`task_links`** (see §8c; `task_links`
  has a composite PK and, like the rest of that group, no foreign keys), plus
  the printed service job sheet (v38) — **`service_jobs`**,
  **`service_job_equipments`** (composite PK `(jobId, equipmentId)`, no foreign
  keys; see §13).

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

**2. The schedule alert is now TWO categories, split by scope**
`getAlerts()` runs the same joined SELECT (`SCHEDULE_ALERT_SELECT`) twice; the
two feeds differ **only** in their `WHERE` clause:

| Key | Rows | Window |
| --- | ---- | ------ |
| `upcomingSchedules` | `s.equipmentId IS NOT NULL`, pending | due within `scheduleDays` (default 7, `?scheduleDays=` widens **this one only**) or already overdue — unchanged behaviour |
| `customerCallFollowUps` | `s.equipmentId IS NULL AND s.customerId IS NOT NULL`, pending | **none at all** — capped at 100 rows, with `customerCallFollowUpsTotal` carrying the true count |

- **Why they differ:** an equipment-scoped visit is service work that only
  becomes actionable near its date, so a window keeps the grid readable. A
  customer follow-up call booked six months out is a promise made to a customer
  and has to be visible the moment it is booked — under the old shared 7-day
  window, booking one looked like it had done nothing.
- The split is by **scope, not `scheduleType`**: a `phone_call` booked against a
  machine stays in the equipment feed on the 7-day window.
- ⚠️ **Both feeds still snooze under `alertType = "schedule"`** — one shared
  `LEFT JOIN alert_snoozes`. Keep it that way. Giving the customer-scoped feed
  its own alertType would silently **un-snooze** every call an admin had already
  snoozed, because those existing rows are keyed on `"schedule"`.
- Both mark `overdue = scheduledDate < today` (Bangkok date), so a future call is
  shown but is not overdue.

**3. What the bell actually counts**
`GlobalAdminBell` sums these keys from `GET /api/admin/alerts`, each read
defensively (a missing key counts as 0 — a tab left open across a deploy is still
talking to the old build):
`expiringWarranties` + `nearingCalibration` + `upcomingSchedules` +
`incompleteEquipmentsTotal` + `missingDocuments` + `customerCallFollowUpsTotal` +
`dueTaskCount`. Where a list is capped at 100 the **total** is used, never
`.length`.
- `dueTaskCount` (`countDueTasks()` in `taskStore.ts`, §8c) counts **only tasks
  whose due date has arrived** — `status = 'pending'` AND a non-empty `dueDate`
  `<=` today in Asia/Bangkok. Undated tasks and tasks due later are excluded on
  purpose: the bell means "act now", and a to-do list must not inflate it into a
  number nobody trusts. That is why the API sends a count instead of a task total.

**4. Equipment ownership + a per-machine warranty-alert switch (v35)**
`customer_equipments` gained two columns:
- `ownershipSource VARCHAR(20) NOT NULL DEFAULT 'sold_by_us'` —
  `sold_by_us` | `customer_owned` (`EQUIPMENT_OWNERSHIP_SOURCES` in `types.ts`).
  Descriptive metadata: it changes no alert.
- `warrantyAlertEnabled TINYINT(1) NOT NULL DEFAULT 1` — the per-unit off switch.

The migration is **additive only — no `UPDATE` of existing rows anywhere on that
path**. Every pre-existing machine takes the defaults (`sold_by_us`, alerts on),
which is exactly how the system behaved before the columns existed. Nothing was
reclassified automatically, on purpose: guessing the source from
`salesRecordId`/`quotationNumber` was rejected because plenty of units we really
did sell were hand-entered before sales records existed and have an empty
`salesRecordId`, so a heuristic would mislabel them as customer-owned with no way
to tell a guess from a confirmed value. Reclassifying is a per-unit admin
decision.

> 🔎 **Debugging "why does this machine never alert?" — check
> `warrantyAlertEnabled` first.** The `expiringWarranties` query ANDs
> `e.warrantyAlertEnabled = 1`, so a machine that is well inside the 30-day
> window still shows nothing when the switch is off. It silences the **warranty**
> alert only: the calibration and incomplete-record queries deliberately ignore
> it, so a silenced machine still surfaces there. The older suspects are still
> worth a look after that — `status = 'Expired'` (also excluded), a live row in
> `alert_snoozes` for `('warranty', <equipmentId>)`, or simply no
> `warrantyEndDate`.

**5. Alert date search + bulk reschedule — no schema change**
Two routes let an admin see everything dated on/around a chosen day, past or
future, and move several dates at once. `SCHEMA_VERSION` is untouched by this
feature — do not go looking for a migration.

- `GET /api/admin/alerts/search` (`app/lib/alertSearchStore.ts`,
  `searchDatedAlerts`) and `POST /api/admin/alerts/reschedule`
  (`rescheduleDatedAlerts`). The proposal that designed this
  (`openspec/changes/add-alert-date-search`) named them `date-search` and
  `bulk-reschedule`; the routes were built under these shorter names instead,
  and the code — not the proposal — is the source of truth.
- Six sources, each matched on the date that means something for it, never the
  first date column in its table (`DATED_ALERT_KINDS` in `app/lib/alertDateSearch.ts`):

  | Kind | Table | Date matched |
  | --- | --- | --- |
  | `schedule` | `service_schedules` (`equipmentId IS NOT NULL`) | `scheduledDate` |
  | `customer_call` | `service_schedules` (`equipmentId IS NULL`) | `scheduledDate` |
  | `task` | `tasks` | `dueDate` |
  | `warranty` | `customer_equipments` | `warrantyEndDate` |
  | `calibration` | `customer_equipments` | `calibrationDate + CALIBRATION_VALIDITY_MONTHS` — the due date, not the date of the last calibration |
  | `receivable` | `billing_documents` | `dueDate`, same `debtCarrier`/not-superseded rule the feed and `listOpenInvoices` use |

- **Calibration searches on 12 months, the feed alerts at 10 — this is not a
  bug.** The feed asks "has the reminder started ringing yet?" (a lead-time
  artifact, `CALIBRATION_VALIDITY_MONTHS − CALIBRATION_ALERT_LEAD_MONTHS` =
  `12 − 2`, §1 above). The search asks "what falls due on that day?" — the
  anniversary itself. Searching 12 Jun 2026 must return machines *due* that
  day, not machines calibrated that day.
- `evaluateMovability()` (`alertDateSearch.ts`) is the single place that
  decides whether a found row's date may move, and returns the Thai refusal
  reason alongside the verdict. The results table greys a checkbox with it and
  the reschedule route refuses with it **against the status it re-read from the
  database**, never against what the client claimed — so a stale screen can
  disable the wrong checkbox but can never talk the server into moving a date
  it shouldn't. `schedule` and `customer_call` are movable while `pending`;
  `task` is movable while `pending` and dated; `warranty`, `calibration` and
  `receivable` are never movable — their dates are facts, not reminders someone
  set. Debugging "why won't this date move" starts at `movable`/
  `immovableReason` on that row, not in the UI.
- The reschedule route writes at most two columns per row inside one
  transaction (the date column plus, for `schedule`/`customer_call`, nothing
  else — no side effects on `status` or `notes`).
- Four caps, all in `app/lib/alertDateSearch.ts`. The proposal had put them in
  `alertThresholds.ts` instead, but this feature owns neither that file nor
  `types.ts` (where the proposal put its result types), so both live in
  `alertDateSearch.ts` — still with no imports, same reason `alertThresholds.ts`
  has none: the in-page guide (a client component) has to read the exact
  numbers the queries run on. Rendered into the guide from those constants
  rather than typed a second time as numbers in copy: `DATE_SEARCH_ROW_CAP`
  (200 rows per category — matches the bulk-move
  cap on purpose, so a category you can see in full is one you can act on in
  full), `DATE_SEARCH_MAX_RANGE_DAYS` (366 — a year is the longest span that
  still means something operationally here; wider is a report, not a search),
  `BULK_RESCHEDULE_MAX_ITEMS` (200 — refuses the whole request over the cap,
  never truncates), `BULK_RESCHEDULE_MAX_SHIFT_DAYS` (3650, ≈10 years — catches
  a fat-fingered shift and keeps every result inside a 4-digit year, which the
  lexical `YYYY-MM-DD` comparisons these VARCHAR date columns depend on require).
- `getAlerts()` and the default feed are untouched by any of this — same
  thresholds, same snooze keys, same number on the bell. A row reschedule does
  not touch `alert_snoozes`; a snoozed item can still turn up in a search and
  moving its date does not un-snooze it.
