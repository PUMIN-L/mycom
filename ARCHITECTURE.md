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
│   ├── auth/             login (+ login/2fa) · logout · me · 2fa/  (session lifecycle, §10)
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
│   ├── inventoryStore.ts Asset register + stock (groups, pieces, timelines) — §8d.
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
├── quotation/           Admin quotation builder (client-side PDF export);
│                        saved/ is the list of saved quotations (§8).
├── product-specs/       Spec texts per product, picked in the quotation builder
│                        to fill a line's detail. Grouped by product; pure
│                        logic (group/search/copy name/checks) in specHelpers.ts.
├── settings/            Admin settings (change contact-email recipient).
├── assets/ stock/       Asset register + stock (admin, phone-friendly) — §8d.
├── login/               Admin login page.
└── showcase/            Public content browsing + admin in-place editing.

proxy.ts                 Next 16's `proxy` convention (formerly middleware.ts —
                         deprecated): admin pages in `config.matcher` redirect to
                         /login?next=<that page> without a validly SIGNED session
                         cookie (§10); after the login, /login goes back to
                         `next` when it is a page of this site
                         (`lib/loginDestination.ts` — never another site), else
                         /adminpanel. That is what makes a sticker's QR, scanned
                         on a logged-out phone, open the piece (§8d).
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
- **A positive money amount from a body goes through `parsePositiveMoney`**
  ([`app/lib/moneyAmount.ts`](./app/lib/moneyAmount.ts)), and the route
  stores the `amount` it returns. It rounds to the satang **first** and checks
  after. Checking `> 0` first let 0.004 through, and the DECIMAL(12,2) column
  then held ฿0.00 (a zero-baht payment, cost or monthly bill). It also refuses
  anything above 9,999,999,999.99 (the column's ceiling), and anything that is
  not a number or a PLAIN decimal string ("1500", "1500.00", ".5"). Number()
  alone would read "0x10" as 16, "0b101" as 5 and "1e3" as 1000.
  Used by recurring
  expenses and sale costs. `syncCostItems` applies the
  same rounding itself (`toSatang`). `toSatang`, not quotationTotals'
  `round2`, whose relative epsilon is a whole satang at the ceiling.

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
| `POST /api/auth/login/2fa` (needs the 5-min pending cookie, §10) | `GET /api/auth/2fa`, `POST /api/auth/2fa/{setup,enable,disable,backup-codes}` — the last three also re-ask the password (+ a code once on) | |
| `POST /api/auth/forgot-password` + `/otp` (emailed code to the fixed address, + a 2FA code once on, §10) | `POST /api/auth/password` + `/otp` — the current password, an emailed code (+ a 2FA code once on) | |
| — | `GET /api/auth/login-history` (every account's logins, §10) | |
| `POST /api/contact` (sends email)               | all `/api/quotations/**` (GET/POST/[id]/docnos) | `cleanup` = **cron** (`CRON_SECRET`) |
| `GET /api/health`                               | `GET`/`PUT /api/settings/contact-email` | |
| —                                               | all `/api/admin/**`, incl. `POST`/`GET /api/admin/sales` + `[id]/items` and `GET /api/admin/equipments/serial-check` (§8a), plus the task board's `/api/admin/tasks/**` + `/api/admin/task-topics/**` (§8c), and the asset register / stock's `/api/admin/inventory/[kind]/**` (§8d), and the missing-image scan's `/api/admin/missing-images` + `/check` (§7) | |
| —                                               | `GET /api/{customers,companies,salespeople}/[id]/links` — what still points at a record, for /customers' delete dialog (§5c) | |

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
- **⚠️ Limit rich text by its TEXT and refuse it when over — never cut it.**
  Product titles, category names and content titles allow 255 characters of
  text, descriptions 10,000, counted with `stripHtml` exactly as the forms
  count them ([`cleanRichText`](./app/lib/richTextLimits.ts) → a 400 that
  names the field). The stores used to save `sanitizeRichText(x).substring(0,
  255)` — a cut by length of HTML. Formatting is HTML (a bold, large title
  carries ~60 characters of tags, each coloured word ~40), so a 203-character
  title the form accepted was stored as `…</span></stro`. Server-rendered,
  that half-written tag pulled the rest of the page into the `<h1>` in bold,
  and the end of the title was lost silently. The columns hold the whole HTML
  since v46 (TEXT for titles and names, MEDIUMTEXT for descriptions; the
  bootstrap also mended the values the cut had broken). `RichTextLimit.html`
  is only a ceiling the database can always hold. For descriptions that is
  200,000 characters, because a whole product row (and its revision snapshot)
  must stay well under TiDB's 6 MB entry limit, not the 16 MB of MEDIUMTEXT.
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

### 5b. Customer list order — "บันทึกล่าสุด"
`customers.noteUpdatedAt` (VARCHAR ISO-8601 UTC, schema v42) is when the
**note** last changed — not when the row was last saved. `/customers` shows it
as "บันทึกล่าสุด" (`displayDateTimeParts`, Bangkok time, e.g.
`05 Sep 2026 20:25`) and sorts by it, newest first, empty notes last
(`app/lib/customerOrder.ts`). A row whose note changed in the last 12 hours
(`isNoteRecentlyUpdated`, `NOTE_RECENT_WINDOW_MS`) gets a pastel green
background (`bg-green-100`); the page's `now` ticks once a minute so the
highlight expires without a reload. (The column was called "อัปเดตล่าสุด",
which read as "the row was last saved" — a phone fix moves nobody.)

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
  page is clamped by derivation (no setState-in-effect). The companies tab is
  paged the same way (`COMPANIES_PER_PAGE`), and so is the equipment tab (10),
  whose page is clamped too — a refetch after a save no longer sends it to
  page 1. A page change from the pager scrolls the list's top back into view
  when it is above the screen (the pager sits under 50 rows). Skeleton rows
  show only until a list FIRST arrives: a reload after a save keeps the rows,
  the pager, the legend and the count on screen.
- **Searching and sorting the lists is [`app/customers/listHelpers.ts`](./app/customers/listHelpers.ts)**
  (pure, tested). One box per tab. A query matches when the whole phrase is in
  one field, or every word of it is somewhere among the fields — customers:
  name, company, department, e-mail; companies: name, ตำบล, อำเภอ, จังหวัด,
  รหัสไปรษณีย์ (the three boxes this tab had, in one); salespeople: name,
  e-mail. A one-letter word or a number must START a word there ("บริษัท ก" is
  not every row holding a ก, "ลูกค้า 00" is not ลูกค้า 100); longer words may
  sit inside one (Thai runs words together: "คุณสมชาย"). A phone matches by
  digits — only for a query that looks like a phone number ("ร้าน 2024" is a
  name), from three digits, each number of a "02-…, 081-…" field on its own;
  "+66" reads as "0" on both sides. A clicked header sorts by name / company
  (blank values last either way, ties keep the note order); "บันทึกล่าสุด" is
  the default note order and flips to oldest-first. Companies also sort by
  their customer count (`countCustomersByCompany`, most first), and by จังหวัด
  or by อำเภอ — two columns since 2026-11-24 (`companyProvince` shows the
  official name, so กทม. sits with กรุงเทพมหานคร; each sort breaks ties on the
  other).
  `thCompare` ([`lib/thCompare.ts`](./app/lib/thCompare.ts), shared with
  /product-specs) uses one `Intl.Collator` — `localeCompare` with a locale
  builds a new one per call, ~80,000 calls for one sort of 6,000 customers.
- **The open tab is in the URL** (`?tab=companies|salespeople|equipment`,
  none for ลูกค้า), written with `history.replaceState` by `searchWithTab`, so
  a refresh keeps it. A tab change also drops a deep link's one-shot
  parameters (`customerId`, `edit_eq`, …), or a refresh would reopen them.
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

### 5c. `/customers` — forms, deleting and loading
The page ([`app/customers/page.tsx`](./app/customers/page.tsx)) holds the three
lists and which window is open; the windows live beside it.

- **Forms** — [`EntityForms.tsx`](./app/customers/EntityForms.tsx)
  (`CompanyForm`, `CustomerForm`, `SalespersonForm`) in the shell
  [`FormModal.tsx`](./app/customers/FormModal.tsx). Each keeps its own draft
  ([`formHelpers.ts`](./app/customers/formHelpers.ts): every field as text,
  `isDraftDirty`) and saves itself: a ref + the disabled button stop a second
  submit (a double click used to create the customer twice), the route's own
  `error` is shown ([`lib/apiErrorMessage.ts`](./app/lib/apiErrorMessage.ts),
  a 401 always reads as "เซสชันหมดอายุ"), and the page only closes the form,
  toasts and reloads. Closing with typing in it — backdrop, ✕, ยกเลิก — asks
  first, and a refresh gets `beforeunload`; while saving it cannot close.
  `CustomerForm` sends every field, **the note included**: `PUT` reads a
  missing note as an empty one (§5b).
- **What is wrong is said in Thai, under the field** — the forms are
  `noValidate` (the browser's "Please fill out this field." bubble is gone);
  `companyErrors` / `customerErrors` / `salespersonErrors` in
  [`formHelpers.ts`](./app/customers/formHelpers.ts) decide (missing name, no
  company — or one no longer on the list, a malformed e-mail, a note over its
  column: 2,000 for customers and companies, 5,000 for salespeople), and only
  after a save is tried; the cursor goes to the first field that is wrong. A
  refused save stays in the form as an alert at its top, scrolled into view.
  Notes grow with their text and count characters as you type.
- **Keyboard** (`FormModal`): the cursor is put in the first field on open
  (by the shell, not `autoFocus` — React's dev-mode double effect undid that);
  Enter in a one-line field saves, Ctrl / ⌘ + Enter from a note, Esc closes
  (asking when dirty; Esc again goes back to the form); the focus returns to
  what opened the form. The title has the record's name under it.
- **Likely duplicates are pointed out, never refused** — a company or
  salesperson with the same name, a customer with the same name in the same
  company or the same phone number (`sameNameAs`, `duplicateCustomers`;
  case, spaces and punctuation ignored, phones compared as dialable numbers).
- **"+ เพิ่มบริษัทใหม่" inside the customer form** opens the company form on
  top of it (pre-filled with what was typed in the company list's search);
  saved, the company is put on the page's list at once (`onCompanyCreated`)
  and picked for the customer. The customer form keeps what was typed.
- **Provinces are picked from the 77** ([`lib/thaiProvinces.ts`](./app/lib/thaiProvinces.ts),
  `SearchableDropdown`). Stored values are never rewritten in bulk: a known
  province typed another way ("กทม.", "จ.ชลบุรี") opens in the form under its
  official name (and is saved so the next time the company is saved), is shown
  and sorted under it in the list, and is found by any of its names
  (`provinceSearchText`). A stored value that is none of the 77 stays as typed
  and is offered in the list as "(ที่พิมพ์ไว้เดิม)". An address abroad (no Thai
  in its province) is written without ตำบล / อำเภอ / จังหวัด.
- **`SearchableDropdown`** now closes on Esc, marks its open list
  `data-dropdown-panel` (so a window leaves that Esc to the list), and takes
  `id` / `describedBy` for a label and an error message.
- **Phone fields are free text** (`maxLength` 255): "02-123-4567 ต่อ 105",
  two numbers, "+66 …". They used to strip every non-digit as it was typed,
  running an extension into the number. Search still compares digits
  (`listHelpers.matchesCustomerSearch`).
- **Deleting** — [`DeleteDialog.tsx`](./app/customers/DeleteDialog.tsx) first
  asks `GET /api/{customers,companies,salespeople}/[id]/links` (admin only;
  [`lib/deleteBlockers.ts`](./app/lib/deleteBlockers.ts), one `COUNT` query
  each) what still points at the record, and lists it ("เครื่องมือ 2 เครื่อง",
  "ใบ Job 1 ใบ" — [`linkHelpers.ts`](./app/customers/linkHelpers.ts)) with only
  ตกลง, instead of a bare "เกิดข้อผิดพลาดในการลบ" after pressing ลบ. The
  DELETE routes stay the authority and are unchanged; a refusal the check did
  not foresee (400) is shown in the server's words, a failed check (or one
  slower than 8 s) just asks as before. `deleteBlockers.test.ts` reads the
  DELETE routes' SQL and fails if the counts stop checking the same tables.
  A salesperson who is เซลล์ผู้ดูแล of companies is NOT refused: the question
  names those companies (`caretakerNotice`, from the page's own list — five by
  name, the rest counted) and the delete leaves them with nobody.
- **เซลล์ผู้ดูแล (schema v57, the owner 2026-11-24)** — `companies.salespersonId`:
  the salesperson who looks after a company. Optional, one per company, no FK
  (like `sales_records`). Picked in the company form (`SearchableDropdown`,
  "— ไม่ระบุ —" first; a saved id not on the loaded list is kept, so opening the
  form is not an edit); a column on the companies tab (sortable, nobody last),
  a line in the company window, and the search box finds a company by that
  name. The API writes it only when sent (`readCompanyInput` → `undefined` =
  leave alone, `""` / null = nobody) and refuses an id not in `salespeople`
  (`assertSalespersonExists`, 400). `salesStore.deleteSalesperson` sets it back
  to NULL in the same transaction as the delete. Not used to fill in a new
  invoice's salesperson — the owner said not to (2026-11-24). Any query that
  joins `companies` must now prefix `salespersonId` (`sr.`, `d.`) — the bare
  name is ambiguous there. The customers tab shows each customer's too — their
  COMPANY's, derived on the page (`caretakersByCompany` → `customerSalespersonName`,
  by company id), never stored on the customer: a column after บริษัท
  (sortable: name, then company; nobody last), the search box, and the Excel
  export.
- **Loading** — each list has its own status (`loading | ok | error`). A list
  that has never loaded shows "โหลดรายชื่อ…ไม่สำเร็จ" + ลองใหม่ in its table —
  not "ยังไม่มีข้อมูล…", no "0" on its tab or heading, Export off; a reload
  that fails keeps the rows and toasts. Only the latest load is applied
  (`loadSeqRef`); a 401 goes to /login.
- **The customer window** (`CustomerDetailsModal`, shared with /crm/alerts and
  /crm/tasks) asks before a backdrop click, ✕, Esc or ยกเลิก drops an edit of
  the call log, and saves it once however often บันทึก is pressed. The note
  editor opens with the cursor at the END (the log is written downwards),
  counts characters against the column's 2,000 (amber from 1,800; over it,
  บันทึก is off and it says by how many), and saves on Ctrl / ⌘ + Enter.
  Department / phone / e-mail are one label:value table, phone and e-mail
  copyable; the avatar is an icon (every "คุณ…" read "ค"). Two optional props
  hosts may pass: `onEdit` ("แก้ไขข้อมูล" → the host's form) and
  `onOpenCompany` (the company name becomes a button) — /customers passes
  both, the CRM pages neither.
- **The company and salesperson windows** —
  [`ViewWindows.tsx`](./app/customers/ViewWindows.tsx) in the shell
  [`ViewModal.tsx`](./app/customers/ViewModal.tsx), which carries แก้ไข beside
  ✕. A company's address is written by
  [`companyAddress.ts`](./app/customers/companyAddress.ts): "แขวง … เขต …" in
  Bangkok, "ตำบล … อำเภอ … จังหวัด …" elsewhere, no word doubled when the admin
  typed it ("ต.บางพลี"), no empty lines — and "ไม่มีข้อมูลที่อยู่" only when
  every part is empty (it used to show beside a lone district).
  "คัดลอกที่อยู่" copies it as one line.
- **Every window here is a dialog** (`role`, `aria-modal`): Esc closes the
  one on top and only that one (`useModalEscape`, §11) — the task form or a
  call-schedule form over the customer window takes its own Esc — and the
  focus goes into a window when it opens and back to the row it came from
  when it closes. `CustomerCallScheduleSection`'s four sub-windows and
  `TaskCreatedNotice` are marked the same way so this holds for them.
- **Call schedules that fail to load** say "โหลดนัดหมายโทรติดตามไม่สำเร็จ" with
  ลองใหม่ — not "ยังไม่มีนัดหมายโทรติดตาม".
- **The อุปกรณ์ที่ขาย tab** ([`EquipmentTab.tsx`](./app/customers/EquipmentTab.tsx),
  logic in [`equipmentHelpers.ts`](./app/customers/equipmentHelpers.ts)).
  A warranty's END DATE is its last valid day: on it the row says "หมดวันนี้"
  and "อยู่ในประกัน" (it used to say "หมดแล้ว" beside "Active"); expired is
  past the end date or marked `Expired`; no end date is "ไม่ระบุวันหมด", not
  a claimed "Active". Status, filter labels ("ประกัน: …") and the export's
  สถานะ column are Thai; end dates read like the rest of the site
  (`formatDisplayDate`). Headers sort (customer, product, S/N, end date —
  blanks last). The list keeps its rows through a reload, only the latest
  load is applied, a list that never loaded says so with ลองใหม่, the pager
  takes the view back to the tab's top, and the delete dialog is `z-100`.
- **Phones are shown dashed** — `formatThaiPhone` ([`lib/phone.ts`](./app/lib/phone.ts)):
  a bare Thai number ("0812345678") reads "081-234-5678"; anything typed with
  its own formatting stays as typed. Display only, and what CopyText copies.
- **The note search-and-replace (§5a) is folded** behind "ค้นหา-แทนที่ในบันทึก"
  beside the list's search box; open, it sat above the list as a second,
  bigger search box.
- **Every window on the page is `z-100`** — over the admin bell
  (`GlobalAdminBell`, `z-90`), which used to float on top of them and lead off
  the page when clicked. The page has `pb-32` so the bell does not cover the
  pager either.

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
- **`images.remotePatterns` is an allowlist for a public endpoint.**
  `/_next/image` resizes any URL the patterns match, for anyone, on Vercel's
  image-optimization quota. It takes only `flagcdn.com/w40/*.png` (the navbar
  flags, a small fixed set) with `search: ""`.
  - **Cloudinary is deliberately NOT a pattern.** Even pinned to our own
    cloud's `/image/upload/`, anyone could mint endless "new" images: Cloudinary
    accepts any transformation in front of a real public id (`w_1/`, `w_2/`, …),
    each a distinct URL and a fresh optimization.
  - Product and content photos are resized by **Cloudinary itself** instead.
    [`SkeletonImage`](./app/components/SkeletonImage.tsx) gives next/image the
    `cloudinaryImageLoader` from
    [`lib/cloudinaryUrl.ts`](./app/lib/cloudinaryUrl.ts)
    (`f_auto,q_auto,c_limit,w_<next/image's own widths>`).
  - A Cloudinary URL that already carries a transformation renders
    `unoptimized`, as it is.
  - If the resized delivery fails, the photo falls back to the original URL.
    That happens on an account with Cloudinary's "strict transformations"
    turned on, which refuses transformations it was not told about.
  - Those transformations and their bandwidth count on Cloudinary's quota,
    not Vercel's.
  - The LINE QR image (api.qrserver.com, which draws whatever text it is
    given) renders `unoptimized` and is not a pattern either.
  - A new remote image host means a new pattern, as tight as its URLs allow
    and only if its URLs cannot be varied at will, plus an `img-src` entry.
  `__tests__/nextConfigImages.test.ts` checks the patterns with Next's own
  matcher.
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

**And the other way round:** deleting an image (the confirm dialog →
`/api/upload/delete` → `safeDeleteCloudinaryImage`, or the orphan scanner)
must never destroy one a quotation still shows. A line item picked from the
catalog carries a **copy** of the product's image URL in `quotations.data`
(`imageUrl: p.image, imageUploaded: false`), and `uploadedImages` does not
list it. So `isCloudinaryImageInUse` searches both quotation columns, and
`getAllUsedImageUrls` collects every URL inside `data`, reading a page of
quotations at a time. (The old billing documents were covered the same way
until they went, schema v55.) Anything new that stores an image URL
has to be added to both functions in `app/lib/imageUsageHelper.ts` — and to
`listImageReferences` below (`__tests__/lib/imageReferences.test.ts` fails when
the two disagree).

**Orphan scanner (/settings → "Cloudinary Orphan Scanner")** lists the files
on Cloudinary that `getAllUsedImageUrls` finds nowhere and deletes a selection
with an emailed code. One delete takes at most `ORPHAN_DELETE_MAX` (50,
[`lib/orphanDelete.ts`](./app/lib/orphanDelete.ts)). The route **refuses** a
longer list (400) before comparing or using up the code. It used to take the
first 50 and answer "deleted 50", while the screen dropped every selected file
from its list — the rest stayed on Cloudinary unseen. The answer names
`deletedIds`, `skippedIds` (in use again) and `errors`, and the screen removes
only the first two; "เลือกทั้งหมด" selects the first 50.

**Missing-image scan (/settings → "ตรวจหารูปที่หาย")** — which pages show a
picture or PDF whose file is gone from Cloudinary. ⚠️ Why it exists: until
2026-08-12 the showcase editor deleted a file the moment ✕ or "replace" was
pressed — before the page was saved and without checking anything else used
it (Aug 10–12 it checked, but excluded the page being edited). A cancelled edit
kept pointing at a file that no longer existed; Cloudinary answers such a URL
with 404 `x-cld-error: Resource not found`. Those files cannot come back from
the app; the scan finds the pages to re-upload them on.
- [`lib/imageReferences.ts`](./app/lib/imageReferences.ts) `listImageReferences()`
  — every Cloudinary URL the site SHOWS, with its page: content blocks (`imageUrl`,
  `imageUrls[]`), product pictures, catalog covers and PDFs, and what quotations
  print (`data`, a page of rows at a time; line items
  labelled by `items[i]`). Not `uploadedImages`: a file only listed there is
  printed nowhere.
- `GET /api/admin/missing-images` answers it as pages + files, each file once
  (`indexImageReferences`, [`lib/missingImages.ts`](./app/lib/missingImages.ts));
  `maxDuration` 60 and 10 a minute per admin, since it reads every quotation.
  `POST …/check { urls }` (1–20, 120 batches a minute per admin, `maxDuration`
  60) answers each file with one **HEAD** request ([`lib/imageCheck.ts`](./app/lib/imageCheck.ts)):
  2xx `ok`, 404/410 `missing`, anything else `error` ("could not tell", never
  called missing). The URLs come from the browser, so only
  `https://res.cloudinary.com` (no port, no credentials) is fetched and a
  redirect is never followed; any other address is answered
  `error / unsupported` without a request.
- The section ([`components/MissingImagesScanner.tsx`](./app/components/MissingImagesScanner.tsx))
  sends two batches at a time with a progress bar and หยุด, then lists the pages
  with a missing file (pages visitors see first; 20, then "ดูทั้งหมด", under a
  count by kind — one missing product picture can be on a hundred quotations),
  each linking — in a new tab — to where it is fixed, and offers to re-check
  only the files it could not. It reads; it never deletes or changes anything.
  - A **429 from the check route is a pause, not a failure**: the batch waits
    `Retry-After` (≤ 60 s, หยุด ends the wait) and asks again, three times,
    before its files count as "ตรวจไม่ได้". A scan of more than ~2,400 files
    meets the limit as a matter of course.
  - A lapsed session (401) stops the other batches, and the scan ends only
    once every batch already sent has come back. Ending it at the first 401
    (`Promise.all` rejecting) brought ตรวจใหม่ back while a batch was still
    out, and that batch then carried on through the old list into the new
    scan.
- ⚠️ **Limit: a file deleted less than ~30 days ago can still read "ok".**
  Cloudinary delivers with `max-age=2592000`, its CDN ignores the query string
  (a cache-busting parameter still answers `desc=hit`), and `deleteCloudinaryImage`
  does not pass `invalidate: true` — so an edge that cached the file keeps
  serving it, while other edges already answer 404. Older losses (the ones the
  scan exists for) read "missing" correctly. Asking the Admin API
  (`resources_by_ids`) would be exact, at the cost of its hourly quota.

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

**The proxy's PDF is cacheable** (it used to carry no `Cache-Control`, so
every view streamed the whole file through the function again). A versioned
Cloudinary URL (`/v123…/`) names one fixed file, so it gets `public,
max-age=3600, s-maxage=86400` (an hour in the browser, a day at the CDN). An
unversioned one gets five minutes and an hour. Deliberately not a year: these
caches cannot be purged from the app, so their lifetime is how long a document
an admin deletes stays reachable. Only a 200 carries it; refusals and upstream
errors are never stored.

### 8. Quotation builder
[`app/quotation/page.tsx`](./app/quotation/page.tsx) builds a quote and exports a
single-page PDF **client-side** (`jspdf` + `html2canvas-pro`, dynamically imported
— they're oklch-safe for Tailwind v4). Money math lives ONLY in
[`quotationTotals.ts`](./app/lib/quotationTotals.ts) (`computeQuoteTotals`) so the
builder UI and the saved-list summary can never drift. Number inputs use a
raw-text `NumberInput` so sub-1 values (e.g. `0.5%` discount) are enterable.

**Working in the builder:**
- **Saving stays on the page** (`persist` → `afterSaved`): the document turns
  clean, its number is settled, and the URL becomes `?id=<id>` so a refresh
  reopens it. While editing, "บันทึก + ดาวน์โหลด PDF" saves and downloads in
  one step; Ctrl+S / ⌘S saves (matched on `e.code === "KeyS"` too — with the
  Thai layout the key reports "ห"). The leave dialog's บันทึกแล้วออก goes on
  to where the admin was going, and only once the save landed.
- **Drafts** ([`app/quotation/quoteDraft.ts`](./app/quotation/quoteDraft.ts)):
  unsaved edits are kept in `localStorage`, one draft per document
  (`new`, `edit:<id>`, `clone:<sourceId>`), half a second after the last
  keystroke and at once on `pagehide`. Opening that document again offers
  กู้คืน / ทิ้ง, and the form is locked (`<fieldset disabled>`) until the admin
  answers — typing meanwhile could not be kept without overwriting that very
  draft. A draft goes when its document is saved or left without saving;
  drafts expire after 14 days, at most 10 are kept. They hold customers'
  details, so they are **per signed-in user** (`<userId>/…` keys — never
  offered to, or overwritten by, another admin on a shared computer; the
  page opens its document only once the user is known) and **cleared on
  logout** (`clearAllDrafts` in AuthContext). An edit's draft remembers the
  saved quotation it started from (`base`); if that has been saved again
  since, the offer warns that restoring and saving would overwrite it. A
  stored draft that is not quotation-shaped is never offered, and drafts are
  compared with documents by content (`contentFingerprint`: sorted keys,
  conditions by text — an old quotation's conditions get new ids each load).
- **"Unsaved" means the admin's edits only.** The page's own changes — the
  running number moving past a taken one, our company's lines arriving — go
  through `setQAuto`, which carries the clean snapshot along on a document
  with no edits. (An untouched new quotation used to warn on leaving only
  because its number had advanced.) Every snapshot and comparison uses
  `fingerprintOf`.
- **A new quotation starts filled in:** our company's phone / e-mail / tax id
  from `GET /api/quotations/company-defaults` (`latestCompanyDefaults` — per
  field, the latest saved quotation that has it; the phone falls back to the
  company profile), and the salesperson last saved from this browser
  (`localStorage`, never from merely viewing someone else's quotation).
- **The total in Thai words** under จำนวนเงินรวมทั้งสิ้น comes from
  [`lib/bahtText.ts`](./app/lib/bahtText.ts), which rounds through the same
  `Intl.NumberFormat` as the printed figures — `toFixed(2)` rounds the binary
  value and disagreed with the figure on about one amount in six.
- How long a save keeps is said from
  [`lib/quotationRetention.ts`](./app/lib/quotationRetention.ts), the constant
  the cleanup cron purges by (the page said "30 วัน" long after it became two
  years).

**The saved list (`/quotation/saved`)** lists the saved quotations, with a
search box and a **date range** — it was a tab of the old `/billing/saved` until
that went (schema v55, §8g). Each row shows its last save and, within 30 days
of the nightly purge, says so (`daysUntilPurge`, `lib/quotationRetention.ts`;
the old list counted down from 30 days for every row). Filtering is
[`app/lib/savedDocFilter.ts`](./app/lib/savedDocFilter.ts), not inline in the
page, because two rules there decide what a bulk delete can reach:
- **The range is a Bangkok calendar day**, via `savedOnBangkokDate`. `createdAt`
  is a UTC instant, so `createdAt.slice(0, 10)` files a document saved at 06:00
  in the office under the *previous* day and drops it out of a filter for the
  day the admin watched it being made. A row whose date cannot be read is shown
  when no range is set and hidden once one is — "delete this range" must not
  sweep up a document that could not be shown to be in it.
- **A bulk delete only ever touches rows on screen** (`visibleSelection`). The
  tick survives a filter change, so without this an admin who ticked 40 rows,
  narrowed the dates and pressed ลบที่เลือก would delete documents he was no longer
  looking at. The selection bar says how many ticked rows the filter is hiding.

`เลือกทั้งหมด` ticks the filtered rows up to `BULK_DELETE_MAX_ITEMS` (100) and
**announces the remainder** rather than trimming quietly — each delete is its
own sequential request. Deletes run one at a time because partial success is
possible (one already gone, a dropped connection), and a refusal is
reported **by document number with the server's reason** (a `role="alert"`
block that stays on screen), not folded into a count. Refused rows stay in the
table and stay ticked. Images freed across the whole sweep are pooled,
**de-duplicated** (an "แก้ไข (New Ver.)" clone reuses its original's image URL)
and handed to `ImageDeleteConfirmDialog` once.

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
(`purgeExpiredAlertSnoozes` in `crmStore.ts`, `snoozesPurged` in the log line),
plus login lockout rows whose window has ended (`purgeExpiredLoginFailures`,
`loginFailuresPurged` — §10).
That purge is one day conservative on purpose — it deletes with `<` against
today's Bangkok date, a strict subset of the `snoozeUntil <= today` the alert
queries already treat as spent, so no alert can reappear early because of it.
`service_logs` (real service history) and `used_docnos` (kept for
conversion-rate analytics) are deliberately not swept.

**No PDF of an unsaved document — on every document page.** ⬇️ ดาวน์โหลด PDF
saves first (quotation, PO, service job), and a save that does not
land — an error, no connection, or a number the ledger refused with no free one
to move to — stops there with a Thai toast; nothing is rasterised. The PDF is
the copy the customer keeps: made anyway, the customer would hold a number the
system does not have, free to be issued again to someone else. The quotation
save used to be "best-effort".

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

**Two arithmetics — `totalsVersion` (2026-10-07).** The original
`computeQuoteTotals` carries full precision from row to row and rounds only on
paper, so with a bill-level **%** discount a sheet could print rows that do not
add up: 1 × ฿100.37 less 3% printed หลังหักส่วนลด 97.36 + VAT 6.82 = 104.18 over
a ยอดรวมสุทธิ of 104.17. Version 2 settles **every** figure to the satang as it
is made (each line's gross, every sum, the bill discount, the VAT base, the VAT,
the total), so each printed row is the number the next one was computed from.
It is opt-in **per document**, by a `totalsVersion: 2` key in the document's own
`data` blob:
- The quotation and PO builders stamp `CURRENT_TOTALS_VERSION` on every
  **fresh** document (a new page, `?new=1`, `?type=…`, the reset button).
- A document that **continues** another keeps that one's arithmetic, because
  the two must agree to the satang — and with a % bill discount the two
  arithmetics differ by a satang on roughly one document in four:
  - "แก้ไข (New Ver.)" (the in-place button and `?action=clone`) and a PO's
    ออกใบใหม่แทนใบนี้ carry the source's `totalsVersion` over untouched.
- It is **deliberately not in `emptyState()`**: every reopened document is
  spread over `emptyState()`, so putting it there would silently move the
  totals of every document already sent to a customer. A blob without the key
  computes bit-for-bit as before, forever — the stored `totalAmount`, the
  ledger and every re-download included. `quotationTotals.test.ts` pins that
  against a frozen copy of the old function over 2,000 random documents.
- Everything that computes a document's money passes its blob, so it follows
  the document's version without being told: the builders, the saved lists,
  and the quotation → sale conversion
  (`buildLineDrafts({ …, totalsVersion })`).
- `computeLineTotal(item, totalsVersion?)` takes the version as a 2nd
  argument, so never pass it bare to `.map()` — the index would arrive as the
  version and line 2 would compute as version 2.

**A version suffix is read only after a digit** (`splitDocNoVersion` in
`quotationNumber.ts`): "QT050926-23v2" → base "QT050926-23", version 2. The old
`/(?:-V|v)\d+$/i` matched the "V" of the **INV** prefix, so New Ver. of a
hand-typed "INV001" became "INv2". No lookbehind in that regex: older iOS Safari
cannot parse one and the whole page would fail to load.

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
disappearing; `deals = COUNT(DISTINCT COALESCE(sr.dealId, salesRecordId))`, one
bill = one deal — and since v51 every delivery of one customer PO is still that
one deal, §8g step 5; a credit note's negative sale is never a deal, §8g step 8).

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

### 8d. Asset register + stock (schema v47)

Two admin pages: `/assets` (the company's own things) and `/stock` (bought
to sell on). Spec: `openspec/changes/add-inventory-tracking`.

- **One set of tables, told apart by `kind`** (`'asset'` | `'stock'`):
  `inventory_groups` (a model: name, brand, model, category),
  `inventory_items` (one physical piece each), `inventory_events` (each
  piece's timeline) and `inventory_counters` (the last code number per
  kind). One store (`lib/inventoryStore.ts`), one set of routes
  (`/api/admin/inventory/[kind]/**`) and one UI (`components/inventory/*`)
  serve both. Keeping them apart is the store's job: every statement filters
  on kind, and a piece only joins a group of its own kind. A kind in the URL
  other than asset/stock is a 404.
- **No foreign keys**, like the task board. A group is deleted only when
  empty. The store checks that with a LOCKING read inside its transaction, so
  an item added concurrently is seen. A piece's events are written and
  deleted in the piece's own transaction. `supplierId` is a soft link: a
  piece shows the supplier's CURRENT name (`LEFT JOIN suppliers`), and once
  the supplier is deleted it shows the `supplierName` it carries.
- **Codes** `AS-0001` / `ST-0001` come from `inventory_counters`, in the
  same transaction as the INSERT. The counter only goes up, so a deleted
  piece's code is never handed out again. It also starts past `MAX(seq)`, so
  a lost counter row cannot collide with `UNIQUE (kind, code)`.
- **Statuses** live in `lib/inventoryStatus.ts`, and the two kinds have
  different sets. A status's extra fields share two columns, `statusParty` /
  `statusDate`: borrower + return date, repair shop, reserved for, sold to +
  date, disposal date. The store **clears them whenever the status does not
  use them**. When the status changes, they come from the request alone
  (`mergeItemPatch`), so the old status's borrower can never become the new
  one's "reserved for". The old values stay on the timeline. "Gone" statuses
  (sold, disposed, broken, returned) are hidden by default and left out of
  the total value.
- **A PATCH is checked whole.** The fields sent are laid over the stored row
  and the result is validated. A sale date is checked against the purchase
  date even when only one of them changed. Prices go through
  `parseNonNegativeMoney`, which allows 0 and is otherwise
  `parsePositiveMoney`'s rules.
- **Lock order:** group rows first (ascending id), then item rows. A move
  locks the target group before the piece.
- **The page loads a whole register** (no timelines) and searches and filters
  it in the browser (`lib/inventorySearch.ts`, pure, tested). Every word must
  match, across the group and the piece. The free-text fields (place,
  category, borrower) and the supplier field ("pick from Suppliers or type")
  are built on `SearchableDropdown` (`components/SuggestField.tsx`,
  `InventoryFields.tsx`). They are never a `<datalist>`, which the OS
  paints. **These two pages are phone-friendly**, unlike the rest of the admin
  side: they are used walking round the storeroom, and from a sticker's QR.
- **Stickers are optional.** `/[assets|stock]/labels` takes the chosen ids
  from `sessionStorage` (or `?ids=` for one piece). Paper sizes are in
  `lib/inventoryLabels.ts`; add a new stock there. QR codes are made in the
  browser with `qrcode` and point at `<origin>/<assets|stock>/item/<id>`.
  The printed copy is portalled to `<body>`, and print CSS hides everything
  else.
- Tests: `__tests__/lib/inventoryStore.test.ts` runs the store against an
  in-memory database that executes its statements and rolls back failed
  transactions (`__tests__/helpers/fakeInventoryDb.ts`). Teach it any new
  statement shape. Also `inventoryPure.test.ts`,
  `api/admin-inventory.test.ts` and `components/Inventory.test.tsx`.

### 8e. Suppliers (`/suppliers`)
The page ([`app/suppliers/page.tsx`](./app/suppliers/page.tsx), logic in
[`supplierHelpers.ts`](./app/suppliers/supplierHelpers.ts)) has the same look
and parts as /customers and /product-specs. One word everywhere a supplier is
shown: **ซัพพลายเออร์**. It used to be ผู้ผลิต / รายชื่อ / Suppliers by turns, and
the product forms that link suppliers said ผู้ผลิต.
`__tests__/lib/supplierWording.test.ts` fails if the old word comes back.
- **List.** The search matches the name, the contact, the phone or tax ID by
  their digits ("081 234" finds "081-234-5678"), and the linked products'
  plain names ("ZTA" finds who sells it). It used to search the name only.
  Next to it: a count ("พบ 2 จาก 8"), and `SortableTh` on name, contact
  (empties last either way) and product count (most first). Rows use
  `RowActions` + `openOnKey`, the phone is `CopyText`, and `pb-32` keeps the
  floating admin bell off the last row.
  `missingPoFields` badges what a purchase order would print blank: the
  address always, the tax ID only for a supplier with a Thai-script name.
  One abroad has no Thai tax ID, and flagging every one of them would teach
  the admin to ignore the badge.
- **Load / save / delete.**
  - A failed FIRST load is an error with ลองใหม่, never "no suppliers"; a
    failed reload keeps the list and says so in a toast.
  - Loads are latest-only: a slow reload answering last must not bring back
    a supplier deleted meanwhile.
  - A save is guarded by a ref and the disabled button: a double click on a
    slow line used to add the supplier twice. A refusal stays inside the
    form and is scrolled into view. A 401 says `SESSION_EXPIRED_MESSAGE` in
    Thai, never requireAuth's "Unauthorized".
  - A name or tax ID that is already used gets a WARNING and is never
    refused, because a head office and its branches share one tax ID.
  - The delete question says how many linked products lose the link
    (`product_suppliers` cascades). It also says that issued POs and
    assets / stock keep the old name: the PO holds a snapshot, and an
    inventory item carries `supplierName`.
- **Form.** A `<form>`: Enter submits, and Ctrl + Enter submits from the
  address or note. Esc, the backdrop, ✕ and ยกเลิก ask first when there is
  typing to lose, and so does the browser's `beforeunload`. The focus goes
  back to whatever opened the form — the row, when it came from the
  supplier's window.
  The tax ID is checked by [`lib/thaiTaxId.ts`](./app/lib/thaiTaxId.ts)
  (13 digits; the check digit is (11 − Σ dᵢ·(13−i) mod 11) mod 10). This only
  ever WARNS, after the box is left. "-" means none, and a foreign number is
  left to the admin.
- **The supplier's window** ([`SupplierDetailsModal`](./app/suppliers/SupplierDetailsModal.tsx),
  details in the shared [`SupplierInfo`](./app/components/SupplierInfo.tsx)):
  - Thai labels, left-aligned. Each linked product opens `/edit-product/{id}`
    in a new tab; an untitled one still counts, as "(สินค้าไม่มีชื่อ)".
  - Two actions: แก้ไข, and สร้างใบสั่งซื้อ, which opens
    `/purchase-order?supplierId=…`.
  - The PO page picks that supplier once BOTH the new PO is seeded and the
    supplier list is in, whichever is last: `seedFresh` replaces the whole
    state, so a pick applied before it is wiped out. With `?id=` (an issued
    PO) the parameter is ignored.
  - The showcase's admin "ดูซัพพลายเออร์" window uses `SupplierInfo` as well.
    A failed load there is an error with ลองใหม่ — it used to say "no
    supplier linked", or keep the previous product's list.

### 8f. `/dashboard` — the sale form and the sales table
- **The บันทึกยอดขาย / แก้ไขรายการ window** is
  [`SaleFormShell.tsx`](./app/dashboard/SaleFormShell.tsx) (a dialog, `z-100`
  — over the admin bell). Closing it with typing in it (backdrop, ✕, ยกเลิก,
  Esc) asks first; "typing" is `saleFormSnapshot`
  ([`saleFormHelpers.ts`](./app/dashboard/saleFormHelpers.ts)) differing from
  the snapshot taken as the form opened — an empty cost row is not typing.
  While a save, or the serial check before it, runs it cannot close (closing
  mid-check used to let the save go on behind a closed form). Esc closes one
  layer: an open dropdown list, then the page's own questions over the form
  (`interceptEscape`), then the form. The page's confirm dialogs and the toast
  are rendered AFTER the form so they are drawn over it.
- **What stops a save stays in the form**: the checks are one pure function,
  `saleFormProblems` (saleFormHelpers.ts) — the fields to paint red and the
  same in words. The save runs it once; after a save that failed on them the
  form runs it LIVE (`liveProblems`), so the footer's `role="alert"` list
  (SaleFormShell `notice`) and the red borders lose each thing as it is filled
  — it used to be a toast gone in 3 seconds.
- **The form is in sections** — ข้อมูลการขาย, สินค้าและลูกค้า, ต้นทุน,
  เอกสารอ้างอิง, การรับประกัน (a machine sold without quotation lines),
  หมายเหตุ — and the bill's ยอดขาย / ต้นทุน / กำไร / Margin sit by the save
  button (SaleFormShell `summary`), live as they are typed, a loss in its own
  red. Its save button is the header's green (#065f46), one colour for one
  action.
- **One colour per meaning** (item 11): the brand navy→gold is the title
  block only (the heading and the period badge beside it); every interactive
  accent — links, toggles, the jump-to-now button, chips, focus rings, the
  chart's "now" marker — is indigo; green #065f46 is saving a sale; amber,
  red and emerald carry meaning (no cost yet / a warning, a loss, a profit).
  Headings carry no emoji.
- **No "smart insights" are worked out** (item 12): `GET /api/admin/dashboard`
  stopped calling `getSmartInsights` — the page has not shown them since
  2073ab9, and they cost about six queries on every load and every ◀ ▶. The
  function stays in the store, unused.
- **The table keeps to the period picked at the top** (or "ทุกช่วงเวลา"): its
  days are `periodDateRange` ([`lib/dashboardPeriod.ts`](./app/lib/dashboardPeriod.ts)),
  the same function `getPeriodDateRange` uses for the figures, so the two never
  cover different days. A Top 10 row narrows it to that row's bills by the
  API's own grouping keys ([`salesFilters.ts`](./app/dashboard/salesFilters.ts)):
  a product by `(productId, productName)` of ANY line item — `GET /api/admin/sales`
  (`listSalesRecords`, one extra `IN (…)` query) carries each bill's
  `lineItems` for this — a company by `companyId`; a row with one bill in the
  period opens it. A leaderboard row narrows it to that salesperson by
  `salespersonId` (`kind: "salesperson"`; `unspecified` = the sales with none) —
  it used to type the name into the search, which matched customers of that
  name, and "ไม่ระบุเซลล์" listed every sale. Export writes exactly the table's list, money as numbers
  (mysql2 sends DECIMAL as strings, which Excel kept as text).
- **A failed load is said, never read as "no sales"**: the figures' load
  keeps its error (`loadError`, the route's own message — a 401 reads as the
  session) in a `role="alert"` box with ลองใหม่ until a retry lands; every
  list says "โหลดไม่สำเร็จ" instead of "ยังไม่มีข้อมูล", and the permanent cost
  note under the charts stays. The sales list has its own load state
  (loading / ok / error in `SalesTable`, ลองใหม่), and Export refuses to write
  a file while the list is not loaded.
- **Bars by month or by quarter is a choice for a year only** (`chartView`):
  a month's chart is its days and a quarter's its months, so the toggle
  (named แยกตามเดือน / แยกตามไตรมาส — not like the period picker's
  รายเดือน / รายไตรมาส) shows for a year only; the choice is kept for the
  next year shown.
- **Opening a sale says it is loading**: viewing and editing both fetch the
  sale first (editing its costs too); meanwhile a `role="status"` pill says
  so over everything, the row is `aria-busy`, every แก้ไข is disabled, and a
  ref turns a second click — on any row — away until the first is open.
- **The table reads and works as it says**: a row opens the sale's view (the
  hint used to say it edits) and is reachable from the keyboard (`tabIndex`,
  Enter / Space on the row itself); dates are in พ.ศ. (`fmtThaiDate`, types.ts
  — the Excel keeps ISO dates); the search is the shared `SearchBox` (it
  wraps on a phone) and finds every document number on a sale — PO, delivery
  note, invoice, receipt — and the date as shown; a sale at a loss has its own
  badge and a red profit; the table can no longer be hidden. The view window
  (`ViewRecordModal`) is a real dialog over the admin bell (`z-[100]`) that
  Esc closes.
- **A list cut at its limit says so**: `GET /api/admin/sales` answers at most
  `SALES_LIST_LIMIT` (1,000) sales, newest first, and sends `X-Total-Count`
  (`countSalesRecords` — a COUNT only when the list was cut). When that total
  is more than was loaded AND what is on screen reaches back past the oldest
  sale loaded (an older period, or ทุกช่วงเวลา), an amber note above the table
  says how many there are, and the Excel's success toast says it is not whole.
  The current period, after the oldest loaded sale, is complete and says
  nothing. The cards count in SQL, so they are always whole.

### 8g. Accounting module (`/accounting`, schema v50–54) — sales side
The in-house accounting module that replaced the old `/billing` for issuing
documents (phase 1: 10 steps, all below; the old module was then removed —
see "The old /billing is removed" below). Files:
[`lib/accounting/`](./app/lib/accounting/), routes under
[`api/accounting/`](./app/api/accounting/), pages under
[`app/accounting/`](./app/accounting/).

- **Who may use it — checked by every route** (`requireAccountingUser`,
  [`guard.ts`](./app/lib/accounting/guard.ts)): the module switched on
  (always outside production; in production only with
  `NEXT_PUBLIC_ACCOUNTING_ENABLED=1` — [`flags.ts`](./app/lib/accounting/flags.ts),
  also read by the admin panel's menu card), a signed-in admin (401), with
  **two-factor login ON** (403, Thai message). `GET /api/accounting/status` is
  the one route that answers without 2FA, so the page
  ([`AccountingFrame.tsx`](./app/accounting/AccountingFrame.tsx)) can say
  "turn 2FA on first" (link to `/settings#two-factor`) instead of failing.
  Every answer is `Cache-Control: no-store` (`noStoreJson`). `/accounting` is
  in proxy.ts's matcher and robots.ts's disallow list.
- **Password again** before changing what every tax invoice prints
  (`PUT /api/accounting/settings` → `twoFactorReauth.requirePassword`, its own
  lockout) — [`PasswordConfirmDialog.tsx`](./app/accounting/PasswordConfirmDialog.tsx),
  reused for deleting issued documents and voiding payments.
- **Our company is kept as VERSIONS** (`acc_seller_versions`, newest =
  current; an unchanged save writes no row). A document points at the version
  it was issued under (`sellerVersionId`) instead of copying it, so a move of
  address never changes an old invoice. Before the first save the form starts
  from the website's company profile. The tax ID must be a valid Thai one
  (13 digits + check digit — [`lib/thaiTaxId.ts`](./app/lib/thaiTaxId.ts),
  shared with the supplier form); branch "00000" = สำนักงานใหญ่.
- **Running numbers** ([`numbering.ts`](./app/lib/accounting/numbering.ts)):
  `TYPE + YYYYMM + 4 digits` (INV2026110001), from 0001 each month, per series
  (INV / RE / BN / CN; a customer PO — SO — has none of ours). Handed out ONLY
  when a document is issued, inside its transaction, from `acc_counters` read
  `FOR UPDATE` (and never below the highest number on a document), so
  concurrent issues neither share nor skip one. Deleting the LATEST document of
  a series/month gives its number back (`releaseDocNoIfLatest`).
- **Audit log** (`acc_audit_log`, [`audit.ts`](./app/lib/accounting/audit.ts)):
  one short line per action, appended only — no UPDATE/DELETE path. Kept
  small: a summary of what changed, never a copy of the document.
- **Customers' tax fields** — `companies.taxId / branchCode / whtPercent`
  (nullable). The /customers company form has a "ข้อมูลภาษี" section: a tax
  ID is only WARNED about (a buyer abroad has its own kind), a branch must be
  one; the API writes the three only when the request sends them (a caller that
  knows nothing of them cannot wipe them).
- **Saving database space** (owner's request): money is whole satang in
  BIGINT; no JSON copy of a document, no stored PDF or file; reports are
  computed on demand; indexes only where a list or a lookup needs them.
- **Money** ([`money.ts`](./app/lib/accounting/money.ts)): typed text is
  parsed into satang without floats; each figure is one `Math.round` of an
  integer ratio (half up). Exclusive prices add VAT on the base; inclusive
  ones take it out. The server computes every total again on save — the
  browser's figures are never stored.
- **Invoices (step 2)** — [`documents.ts`](./app/lib/accounting/documents.ts),
  rules in [`invoiceRules.ts`](./app/lib/accounting/invoiceRules.ts), pages
  under [`app/accounting/invoices/`](./app/accounting/invoices/):
  - **Draft → issue.** A draft has no number and can be edited or deleted.
    Issuing (`issueInvoice`) gives the number, points the document at our
    company's current version, and creates its **/dashboard sale and
    machines in the SAME transaction** (`prepareSaleWithLineItems` before it,
    `insertPreparedSaleTx` inside — split out of `createSaleWithLineItems`
    for this). A draft changed since it was checked (`updatedAt`) is refused
    with no number spent. Saves over a newer save (another tab) are refused.
  - **The VAT timing rule** (owner confirmed): goods → the invoice is the
    tax invoice ("ใบส่งสินค้า / ใบแจ้งหนี้ / ใบกำกับภาษี"); services only → a
    plain ใบแจ้งหนี้, the receipt will be the tax invoice; overridable per
    document (`isTaxInvoice`).
  - **The sale it creates** is the invoice ex VAT, the bill discount (and VAT
    out of inclusive prices) shared over the lines (`allocateProportionally`)
    so they add up to the VAT base; no cost yet — the dashboard's table says
    "ยังไม่กรอกต้นทุน" for any sale with none instead of a 100% margin. A line
    ticked as a machine registers one `customer_equipments` row per unit
    (serials in order, warranty = issue date + months − 1 day), under the
    contact person (issuing needs one when there are machines).
  - **Deleting an issued invoice** (password again) takes its sale (and its
    lines and costs — deleted explicitly, not left to FK cascades) and the
    machines with no service history; machines with history are kept,
    unlinked. Refused while payments or other documents point at it. The
    dialog says all of this first (`deletionImpact`).
  - **Printing** is the browser's: the paper ([`InvoicePaper.tsx`](./app/accounting/invoices/InvoicePaper.tsx))
    hides the rest of the page in print, original or copy; "Save as PDF"
    makes the file. Nothing is stored. Every paper of the module (invoice,
    receipt, billing note, credit note) puts the website's own logo in front of
    our company's name ([`SellerLogo.tsx`](./app/accounting/SellerLogo.tsx) — a
    plain `<img>`, 11 mm wide, as on the quotation's paper). All four print with
    ONE stylesheet, [`paperPrint.ts`](./app/accounting/paperPrint.ts): the PAGE has
    no margin, so the browser has nowhere to print its date, time and page title
    (the owner, 2026-11-23); the paper keeps its 10 mm inside itself
    (`box-decoration-break: clone` repeats it on a second page where supported).
    Addresses — ours and the customer's — are spaced after each label word when
    drawn ("อำเภอเมือง" → "อำเภอ เมือง",
    [`thaiAddressSpacing.ts`](./app/lib/thaiAddressSpacing.ts)), never in the stored
    text, so documents already issued print spaced too.
  - **The dashboard's บันทึกยอดขาย** leads to a new invoice while the module
    is on (so a sale is never typed in twice); with it off (the live site
    before go-live) the old form still records sales.
  - The store's functions are `getAccDocument` / `listAccDocuments` /
    `deleteAccDocument` — not `getDocument` & co., which are the PDF
    catalog's (`documentStore.ts`; `catalogCacheInvalidation.test.ts` matches
    mutators by name).
- **Documents issued elsewhere (step 3)** — `/accounting/invoices/record-external`,
  `recordExternalInvoice`: the number as printed and where the paper is kept
  (`externalNote`, required; recent ones suggested) — **no file upload** (the
  owner's choice). Recorded as issued at once (`source = 'external'`), with
  its dashboard sale and machines in the same transaction, so it counts in
  receivables and on the dashboard like one issued here. It never takes one
  of our numbers, and a number shaped like ours (`INV2026110001`) is refused —
  the two series would collide (the unique `(docType, docNo)` index is the
  backstop). The VAT may be typed as printed, within ฿1 of the system's
  (`withVatOverride`). Its page prints nothing (the original is elsewhere)
  and fixes a typo in the number or storage note with a reason
  (`updateExternalReference`, audited; the sale's `invoiceRef` follows); a
  wrong amount is deleted and recorded again. The list tags it "ภายนอก".
- **Payments, receipts, withholding, receivables (step 4)** —
  [`payments.ts`](./app/lib/accounting/payments.ts), rules in
  [`paymentRules.ts`](./app/lib/accounting/paymentRules.ts), the two caches in
  [`paymentLedger.ts`](./app/lib/accounting/paymentLedger.ts); UI in
  [`app/accounting/payments/`](./app/accounting/payments/) (the dialog and the
  invoice's payment panel), [`receipts/`](./app/accounting/receipts/) and
  [`receivables/`](./app/accounting/receivables/):
  - **รับชำระเงิน on an issued invoice** (internal or external) records ONE
    `acc_payments` row: `amountSatang` = what it settles; `whtSatang` withheld
    by the customer; `feeSatang` kept by the bank; what arrived = amount − wht
    − fee. More than is owed is refused — checked again under the invoice's
    lock. A future date is refused; one before the invoice is only warned of.
  - **Its receipt is issued in the same transaction**: an `RE` document (our
    next RE number in the month of the payment date), `relatedDocId` = the
    invoice, the buyer copied as printed, **no lines stored** — the paper
    prints the invoice's items as the description. `isTaxInvoice` = NOT the
    invoice's: services → "ใบเสร็จรับเงิน/ใบกำกับภาษี" (VAT falls due on
    payment); goods → a plain ใบเสร็จรับเงิน (the invoice was the tax
    invoice). The receipt's VAT is its share of the invoice's, and the payment
    that settles the invoice takes what is left, so an invoice's receipts add
    up to its VAT to the satang (`receiptVatSatang`; products of satang can pass
    2^53, so these ratios are BigInt-exact). With "ออกใบเสร็จจากที่อื่นแล้ว"
    the outside number is kept (`externalReceiptNo`) and no RE is issued.
    (Step 9: only REs with `isTaxInvoice = 1` and not void go in ภาษีขาย.)
  - **Withholding (หัก ณ ที่จ่าย)** is worked out on the SERVICES before VAT
    only (`serviceBaseSatang`: the services' share of the VAT base), in
    proportion to what is paid, at the customer's usual rate
    (`companies.whtPercent`) — a suggestion the dialog lets the admin type over.
  - **50 ทวิ**: a received flag + where the paper is kept (`cert50Note`) — no
    file (owner's choice); ticked when paying or later (`PATCH
    /api/accounting/payments/[id]`, audited). /accounting/receivables lists the
    ones still to come in.
  - **`paidSatang` is a cache with one writer** (`recomputePaidSatang`): a full
    re-sum of live payments in the same transaction, never `+= amount`. The
    sale's `receiptRef` follows the live payments'
    receipt numbers (`syncSaleReceiptRef`) — it belongs to the module now.
  - **⚠️ Locks: invoice first, then its payments/receipts** — recording, voiding
    and deleting a receipt all take that order, so they cannot deadlock each
    other. And every read inside those transactions that a money decision rests
    on is a LOCKING read (`FOR UPDATE`): a plain SELECT reads the snapshot the
    transaction began with (TiDB), which misses a payment committed while it
    waited for the invoice's lock — deleting an invoice would have counted
    "no payments" and gone ahead.
  - **A payment is never edited.** A mistake is VOIDED (reason + password —
    `POST /api/accounting/payments/[id]/void`; a missing reason spends no
    password try): its receipt is voided with it, keeping its number in the
    register. Deleting the RECEIPT (password, impact dialog; latest number goes
    back) takes its payment along — for test data or a paper never handed over.
    Deleting an invoice takes the payments voided on it; a live one, or any
    receipt pointing at it, still refuses it.
  - **Receivables** (`GET /api/accounting/receivables`): open invoices by
    customer (the record when linked, else the printed name; named as on the
    latest invoice) in ageing buckets from the due date as of today in Bangkok
    (`ยังไม่ถึงกำหนด`, 1–30, 31–60, 61–90, 90+).
- **Customer POs and the dashboard's backlog (step 5, schema v51)** —
  [`salesOrders.ts`](./app/lib/accounting/salesOrders.ts), rules in
  [`orderRules.ts`](./app/lib/accounting/orderRules.ts), the delivery check and
  cache in [`orderDelivery.ts`](./app/lib/accounting/orderDelivery.ts); routes
  under [`api/accounting/sales-orders/`](./app/api/accounting/sales-orders/);
  pages under [`app/accounting/sales-orders/`](./app/accounting/sales-orders/)
  (tab "PO ลูกค้า"); the dashboard's
  [`BacklogSection.tsx`](./app/dashboard/BacklogSection.tsx).
  - **A customer PO ("PO ลูกค้า") is NOT a sale and never "ใบสั่งซื้อ"** (that is
    OUR order to a supplier — /purchase-order). It is an `acc_documents` row
    with `docType = 'SO'`: no number of ours (`docNo` NULL — the customer's is
    `customerPoNo`, required, and the same number of the same customer cannot
    be recorded twice unless cancelled), `status` `issued` (open) or `void`
    (cancelled, with a reason), never a tax invoice, nothing due;
    `expectedDeliveryDate` and where the paper is kept (`externalNote` — no file).
    It can be filled from the quotation the customer accepted
    ([`quotationSeed.ts`](./app/accounting/sales-orders/quotationSeed.ts),
    `buildLineDrafts`' arithmetic — a catalog product becomes goods/a machine,
    anything else a service, for the admin to check). Machines are only MARKED
    on it (the 50-per-document cap is the delivery invoice's, not the PO's);
    serials come at delivery.
  - **Its state is derived, not stored**: รอส่งของ → ส่งบางส่วน → ส่งครบ by
    the lines' `deliveredQty` against `qty` (by QUANTITY — a free item still to
    send keeps it open), ยกเลิก when void (`orderStatusOf`). A PO delivered in
    full cannot be cancelled. Its lines can be edited only while no invoice
    (drafts too) points at it; its date and notes any time before it is
    cancelled. Deleting it is refused while an invoice delivers from it.
  - **A delivery is an ordinary invoice** with `salesOrderId` = the PO and each
    line's `sourceLineId` = the PO line it sends (`/accounting/invoices/new?fromOrder=`
    or `record-external?fromOrder=` for one issued elsewhere). It opens with
    everything left; each line's discount follows the quantity sent and the
    delivery that empties a line takes the rest of its discount (the bill
    discount likewise, over the PO's own lines only) — until the admin types
    one. Nothing beyond what a line still holds: said under the field, checked
    on save (plain reads), and checked for real when issued — **the PO locked
    AFTER the invoice** (the lock order everywhere: invoice → PO) with locking
    reads, BEFORE the number is spent.
  - **`deliveredQty` is a cache with one writer** (`recomputeDeliveredTx`): a
    full re-sum of the ISSUED invoices' lines that point at each PO line, in the
    transaction that issued, recorded or deleted one — never `+ qty`. Deleting
    a delivery gives its quantities back (the dialog says so — `fromOrder`).
  - **One PO = one deal on the dashboard.** Each delivery is its own sale (its
    own month, machines and costs) with `sales_records.dealId` = the PO (v51);
    every deal count is `COUNT(DISTINCT COALESCE(dealId, id))` — overview,
    charts, top products/customers, leaderboard and the repeat-customer
    insight — so revenue lands month by month as delivered while a PO in three
    deliveries is still one deal. (Over `totalAmount >= 0` rows only since
    step 8: a credit note's negative sale lowers revenue but is no deal.)
  - **"ยอดรอส่งของ · ณ วันนี้"** on /dashboard (`GET /api/accounting/sales-orders/backlog`):
    every open PO still holding something, as of today in Bangkok whatever
    period the page shows, **ex VAT** (`backlogSatang` — the undelivered share
    of each line, then of the VAT base, so the bill discount and VAT out of
    inclusive prices come off too), late ones first in red. Kept OUT of the
    sales cards and charts. The route 404s while the module is off, and the
    section then hides; a bad answer shows an error in the section — it never
    takes the dashboard down (nor does any side panel of this module: they
    check the answer's shape first).
  - **"ยอดตาม PO ลูกค้า"** on /dashboard (`GET /api/accounting/sales-orders/by-date?from&to`,
    [`OrdersChartSection.tsx`](./app/dashboard/OrdersChartSection.tsx), buckets in
    [`orderChart.ts`](./app/lib/accounting/orderChart.ts)): the customer POs RECEIVED
    in the period on screen, by their own PO date (`issueDate`) — counted the
    moment one is recorded, not when delivered or paid (the owner, 2026-11-20).
    Open POs only (a cancelled one is not counted; a delivered one still is),
    ex VAT (`vatBaseSatang`). Its bars are divided "แบ่งตาม" สัปดาห์ (Monday to
    Sunday) / เดือน / ไตรมาส / ปี — and วัน for a month; a month or a quarter
    on the page opens by its own way (day / month) — offering only the ways that
    draw more than one bar (`orderChartGrains`); by year it draws the five years
    up to the period's. The buttons are never named like the period picker's
    (รายเดือน …) or the sales chart's (แยกตามเดือน …). Its own chart, apart from the sales one — sales count when each
    delivery is invoiced — so one deal is never in one chart twice. Same gate
    and same failure rules as the backlog (404 hides it; ≤ 5 years a request).
- **Deposits and the payment plan (step 6, schema v52)** —
  [`deposits.ts`](./app/lib/accounting/deposits.ts) (context, record), the
  ledger in [`depositLedger.ts`](./app/lib/accounting/depositLedger.ts) (db
  only — documents, payments and orderDelivery all use it without an import
  cycle), rules in [`depositRules.ts`](./app/lib/accounting/depositRules.ts);
  routes `sales-orders/[id]/deposits` (GET context, POST record) and
  `sales-orders/[id]/plan` (PUT); UI on the PO page (the payment dialog and
  panel reused: `PaymentDialog kind="deposit"`, `useOrderDeposits`).
  - **A deposit (มัดจำ) is money received against a customer PO before
    delivery**: one `acc_payments` row whose `documentId` is the PO, and its
    receipt — an RE with `relatedDocId` = the PO, **always a
    ใบเสร็จรับเงิน/ใบกำกับภาษี** (VAT falls due when money comes in before
    delivery), its VAT taken out of the amount paid (`vatInsideSatang`). No
    outside receipt. The PO's `paidSatang` is the deposits received (the same
    one-writer re-sum). Never more than the PO still holds before VAT, counting
    the deposits not yet deducted (`depositRoomSatang`) — checked again under
    the PO's lock. Withholding works as on an invoice (the PO's services).
  - **A delivery invoice deducts its share BEFORE VAT** (`depositSatang`,
    deducted by `computeTotals`): what is left of the deposits in proportion to
    what it sends of what the PO still holds, the delivery that empties the PO
    taking the rest (`deliveryDepositSatang`), never more than its own value —
    until the admin types one. VAT on the invoice is on the remainder only, so
    VAT is charged once. Checked on save and, for real, when issued (PO
    locked, locking reads — `depositDeductionProblem`). A delivery paid in full
    by its deposit comes to 0 and may still be issued (it is the delivery
    note). **The dashboard sale keeps the full value** (`vatBase + deposit`) —
    the deposit paid ahead for those same goods. The paper prints "หักเงินมัดจำ"
    (with its VAT on inclusive prices, so the rows add up).
  - **The ledger is sums of what is there** (`depositLedgerOf`): live deposits
    (before VAT from their receipts) less what ISSUED invoices deducted —
    nothing kept as a running figure. So a deposit the invoices lean on cannot
    be voided nor its receipt deleted (`assertDepositNotDeductedTx`); a PO with
    live deposits (or their receipts) cannot be deleted; a PO's lines cannot be
    edited below its deposits; deleting a delivery gives its deduction back by
    itself. Cancelling a PO keeps an undeducted deposit on record (the history
    says so — a refund is a credit note, step 8); a PO delivered in full with
    some left says the customer paid too much. The 50 ทวิ list includes a
    deposit's withholding (named by its PO).
  - **The payment plan (แผนเก็บเงิน)** — `acc_plan_items` (label, stage
    `deposit` | `invoice`, amount with VAT, due date), saved whole, never more
    than the PO. **Its status is not stored**: `planProgress` applies the
    deposits to the deposit items and the payments on the PO's invoices to the
    others, in order (paid / partial / open, late past its date), so a voided
    payment puts its item back. Each open item says what to do next — take the
    deposit (the dialog opens with what is left of the item), collect on the
    oldest invoice still owing, or deliver. The dashboard's backlog shows the
    deposits received and not yet deducted (ex VAT, as the backlog).
- **Billing notes (ใบวางบิล, step 7, schema v53)** —
  [`billingNotes.ts`](./app/lib/accounting/billingNotes.ts), rules in
  [`billingRules.ts`](./app/lib/accounting/billingRules.ts); routes under
  [`api/accounting/billing-notes/`](./app/api/accounting/billing-notes/); pages
  under [`app/accounting/billing-notes/`](./app/accounting/billing-notes/) (tab
  "ใบวางบิล"; "ออกใบวางบิล" per customer on the receivables page).
  - **A BN lists one customer's open invoices** (`acc_billing_items`: each
    invoice and what it owed when billed — read under its lock), numbered at
    once (BN + month + running number), pointing at our company's version, the
    customer as on the latest of them; a due date (นัดชำระ / นัดรับเช็ค). Not a
    tax document: cancelled with a reason (no password), but not once money
    came in against it. Its state is derived from its invoices as they are now
    (paid on it or directly): รอชำระ / ชำระบางส่วน / ชำระครบ / ยกเลิก. An
    invoice may be billed again (a lost note); an invoice on an OPEN note
    cannot be deleted.
  - **Money received against it** (`recordBillingPayment`, the payment dialog
    with `kind="billing"`): spread over its invoices that still owe, in its
    order (the oldest first) — `spreadBillingPayment`: the withholding by each
    share's services (by amount when nothing is a service), the bank fee by
    amount, each share's VAT its invoice's (the settling payment takes what is
    left). **One payment row per invoice** (`billingNoteId`, one `groupId`) so
    each invoice owes less — under **ONE combined receipt** (the owner's
    choice, 2026-11-19), **two when goods and services mix**: the services'
    receipt is the tax invoice, the goods' is not (their invoices were). The
    receipt's `relatedDocId` is the BN; it prints every invoice it pays.
  - **Each payment keeps its own share of VAT** (`acc_payments.vatSatang`,
    v53; also on every new single payment and deposit): a receipt covering
    several invoices cannot say which part of its VAT is whose, and the next
    payment on an invoice must know what was declared on it before
    (`vatOnLivePayments` prefers the payment's own figure; older rows fall back
    to their receipt's).
  - **It goes as it came**: voiding any share voids the whole group and its
    receipt(s); its 50 ทวิ is one certificate for all the shares (marked on
    every share withheld; one line in the 50 ทวิ list, named by the BN);
    deleting its receipt gives each invoice it paid its share back. Locks:
    the BN first, then its invoices, then payments and receipts — so these
    queue behind each other. On an invoice page such a payment says it came
    through the note, and that voiding it voids all of it.
- **Credit notes, voiding an invoice, refunds (step 8, schema v54)** —
  [`creditNotes.ts`](./app/lib/accounting/creditNotes.ts), rules in
  [`creditRules.ts`](./app/lib/accounting/creditRules.ts), the credited sum in
  [`creditLedger.ts`](./app/lib/accounting/creditLedger.ts); routes under
  [`api/accounting/credit-notes/`](./app/api/accounting/credit-notes/) and
  `documents/[id]/void` · `documents/[id]/refunds`; pages under
  [`app/accounting/credit-notes/`](./app/accounting/credit-notes/) (tab
  "ใบลดหนี้"; "ออกใบลดหนี้" on an issued invoice).
  - **A credit note (ใบลดหนี้, CN)** is issued at once (CN + month + running
    number) against an issued invoice (`relatedDocId`), in the cases §86/10
    allows (picked from `CREDIT_REASONS`, or typed). It is a tax document when
    the invoice was the tax invoice (goods); a services invoice that is not yet
    the tax invoice gets a plain one, and only what is still owed can come off
    it (what was received went out on receipts that ARE tax invoices). Its
    lines are the invoice's own, picked and cut back (a line's discount shared
    by the quantity), or one typed in for a price cut — at the invoice's price
    mode and VAT rate; never more than the invoice has left. The paper prints
    what §86/10 asks: the original invoice's number, date and value
    (`refValueSatang` — the value less earlier credit notes, kept at issue),
    the correct value, the difference and the VAT on it, and why.
  - **The invoice keeps what its issued credit notes took off it**
    (`creditedSatang` / `creditedVatSatang`, v54) — a cache with ONE writer,
    `recomputeCreditedTx`, a full re-sum like `paidSatang` (issue, void and
    delete of a CN all call it, under the invoice's lock). Everything that asks
    what an invoice owes takes it off: **owed = total − credited − paid**
    (`owedSatang`; receivables, the summary cards, the invoice list's status,
    billing notes, the PO page). Its payments see the invoice as
    `effectiveInvoice` (total and VAT less what was credited), so the receipt
    that settles it declares the VAT that is left; a billing note's invoice
    shrinks its service base in proportion, as the single-payment dialog does.
  - **The dashboard (the owner's choice, 2026-11-19)**: sales go down in the
    credit note's OWN month — the original month stays as it was — as a sale of
    NEGATIVE amounts (`insertCreditSaleTx`, ex VAT) in the invoice sale's deal
    (`dealId`). Quantity goes down only for goods taken back (the "รับคืนสินค้า"
    case; a price cut takes value only, qty 0). It is no purchase: every deal
    count is over `totalAmount >= 0` rows only, and the dormant-customer
    insight ignores it. The dashboard form refuses to edit it (409 — it would
    clamp it to ฿0); voiding or deleting the CN removes it.
  - **Money due back**: a credit note on an invoice already paid leaves the
    customer having paid too much (`refundDueSatang`). The invoice page and
    receivables say "ต้องคืนเงินลูกค้า"; **บันทึกคืนเงิน** records it as a
    payment of a NEGATIVE amount — no receipt, no VAT (the CN took that off) —
    never more than is due, checked under the invoice's lock; voided like any
    payment. The credit may also simply stay for the next invoice.
  - **Voiding** keeps the number in the register, marked ยกเลิก with the
    reason (route: the reason first, then the password — a typo spends no
    try). A **credit note**: the invoice owes its value again, its negative
    sale goes. An **invoice** (`voidInvoice`, for one already sent; a test one
    is deleted): refused while it has a live payment, an issued credit note or
    an open billing note (the page offers the button only when none hangs
    off it); its sale and history-free machines go (others kept, unlinked), a
    delivery's quantities go back to its PO; printed, it says ยกเลิก across
    it. Deleting a CN locks its invoice first and gives the value back too.
    Locks: the invoice, then its credit notes / payments.
- **The accountant's Excel (step 9, no schema change)** — page
  [`app/accounting/export/`](./app/accounting/export/page.tsx) (tab "Excel
  นักบัญชี"), `POST /api/accounting/export` { month, password }; the rows are
  built by [`exportRules.ts`](./app/lib/accounting/exportRules.ts) (pure) from
  what [`exportData.ts`](./app/lib/accounting/exportData.ts) reads; the
  browser writes the .xlsx (`downloadExcel`, its `title` lines and
  `moneyColumns` formatted #,##0.00). **Nothing is stored** — computed on
  click, as the owner asked.
  - **One workbook per month, six sheets**: ภาษีขาย (the sales-tax report:
    every tax document dated in the month — INV / RE / CN that are tax
    documents, plus a services invoice's receipt issued ELSEWHERE, one row per
    receipt; a voided one stays at 0 marked ยกเลิก so the numbers run complete;
    a credit note negative; headed with our name, tax ID, branch and the tax
    month in Thai), ทะเบียนเอกสาร (every document dated in the month, voided
    and external too), รับชำระ (a voided payment at 0 with what it was; a
    refund negative), หัก ณ ที่จ่าย (and whether each 50 ทวิ came in),
    ลูกหนี้คงค้าง and มัดจำคงเหลือ **as at the month's last day** (only what
    was dated before the next month — credit notes, live payments, deductions).
  - **Money is NUMBERS in baht**, summed in satang first so a total row is
    exact; dates as printed (`formatDisplayDate`). Every string goes through
    the formula-injection guard, headings too.
  - **The whole month's tax data in one file**: the month is checked first
    (no password try spent on a slip), then the password again, and the
    download is a line in the audit log (`data.export`).
- **วันวางบิล (schema v56, the owner 2026-11-23)** — `acc_documents.billingDate`:
  the day an invoice's bill is to be handed to the customer. Set, moved or
  cleared on the invoice's page (`setInvoiceBillingDate`, `PATCH
  /api/accounting/documents/[id]/billing-date`; any invoice not cancelled,
  never before its own date, each change in the history, its `updatedAt` left
  alone), with "* ระบบจะแจ้งเตือนก่อนถึงวันวางบิล 7 วัน". Internal — never
  printed. The CRM feed's "วางบิล" (`billingDueAlerts` in crmStore.ts,
  `CrmAlerts.billingDue` + `billingDueTotal`, counted on the bell) shows it
  from `BILLING_REMINDER_LEAD_DAYS` (7) before the day until a billing note
  carrying the invoice is issued, it is paid in full or cancelled, or it is
  snoozed (`alertType` "billing_date"); its card opens the invoice and offers
  ออกใบวางบิล for that customer. Nothing is asked of the accounting tables
  while the module is off. NB: the CRM feed is not behind two-factor login,
  so an admin without it sees these invoices' numbers, customers and amounts
  there — the owner chose this (2026-11-23).
- **The invoice list says whether the bill is out** (the owner, 2026-11-23): an
  invoice still owed (รอเก็บเงิน, เกินกำหนด, ชำระบางส่วน) carries "ออกใบวางบิลแล้ว"
  or "ยังไม่ได้ออกใบวางบิล" under its status (`billingStateOf` in invoiceRules.ts,
  from `listAccDocuments`' `onBillingNote` — an ISSUED billing note carries it,
  the rule `billingNotesOf` reads), and two tabs narrow to them.
- **The old /billing is removed (schema v55).** Step 10 first stopped it
  issuing once this module was switched on; with the module live, the old one
  went entirely (its documents were test documents — the owner's word):
  - Deleted: its three pages, the nine `/api/billing` routes, and what only
    they used (`billingStore`, `billingPayments`, `billingNumber`,
    `receivables`, `paymentMethods`, `ReceivablesGuidePanel`,
    `RecordPaymentModal`). The saved quotations got their own list,
    `/quotation/saved` (§8).
  - The CRM alert "ลูกหนี้ค้างชำระ" (its unpaid invoices) is gone from the
    feed, the bell, the date search and the guide. Debts are on
    `/accounting/receivables`.
  - /settings "เครดิตเทอมเริ่มต้น" (`billing_credit_term_days`) went too: it
    only pre-filled the old builder. This module keeps its own default credit
    days (its settings page).
  - v55 drops `billing_payments` and `billing_documents`, then the alert
    snoozes and the settings row that belonged to them. `used_docnos` keeps
    the old numbers — it is shared with quotations and POs.
  - A bookmark lands on what replaced it (`next.config.ts` redirects, 307):
    `/billing/saved` → `/quotation/saved`, `/billing/receivables` →
    `/accounting/receivables`, anything else → `/accounting`.
  - [`__tests__/billingRemoved.test.ts`](./__tests__/billingRemoved.test.ts)
    pins that no page, route or library still links to it, fetches it or
    queries its tables.
- **A menu or list drawn inside a rounded `overflow-hidden` box is cut off** —
  the lists in this module sit in such a box (for the rounded corners). So the
  invoice list's ⋯ menu (`RowMenu`) is drawn on <body> like
  `SearchableDropdown`'s list: `fixed`, placed from the button's box (below
  it, or above when there is no room; kept on screen), following the page
  while it scrolls, marked `data-dropdown-panel`. Anything new that pops out of
  a list row must do the same.

### 8h. Commission — ฟอร์ด and พี่ต่อ (ค่าคอมมิชชั่น, the owner 2026-11-25)
Part of the accounting module (same gate: admin + two-factor, no-store). The
owner's rules: the company always keeps 50% of a deal's profit; the other 50%
goes to ฟอร์ด and พี่ต่อ by the kind of deal **chosen by hand on each PO**
(ลูกค้าฟอร์ด / ลูกค้าพี่ต่อ — not the PO's salesperson, not the company's
เซลล์ผู้ดูแล). Everything runs by the PO's date; a commission may be PAID only
once the customer has paid the whole PO.

- **The calculator** ([`commission.ts`](./app/lib/accounting/commission.ts),
  pure — server and browser alike): money in satang, rates in basis points
  (2700 = 27%). `monthCommission(pos, rules)` puts one month's POs in PO-date
  order (then the one recorded first, then id) and runs ONE ladder over the
  ลูกค้าฟอร์ด POs — **unpaid ones too**: a customer paying decides when a
  commission may be paid, never how much. Each takes the slice of the running
  profit it spans, every slice at its own step's rates (`ladderSlices` —
  "100,000 แรก × 27% + 200,000 ถัดมา × 32%"). ลูกค้าพี่ต่อ POs are flat
  (`torFlat`) and do not move the ladder; a PO not chosen yet, a loss, or a
  profit not known yet takes nothing. Each share is its percentage rounded
  half up (`mulDivRound`) and the company keeps the rest, so the three add up
  to the profit exactly (`splitAmount`).
- `DEFAULT_COMMISSION_RULES` is the owner's table (27/23 up to 100,000, 32/18
  up to 300,000, 34/16 up to 500,000, 37/13 beyond; ลูกค้าพี่ต่อ 15/35).
  `rateSetForMonth` picks a month's set — **a set starts on the 1st of a
  month** (the owner's rule), so a month is one set; `rateRulesProblems` says
  in Thai what stops a table being saved. `accountingCommission.test.ts` runs
  the owner's own example table (profit 50,000 … 600,000) row by row.
- **Whose commission a PO is (schema v58)** — `acc_documents.commissionOf`
  ('ford' | 'tor', NULL until chosen), a "ค่าคอมของ" row on the PO's page with a
  window to choose (SearchableDropdown); `PUT
  /api/accounting/sales-orders/[id]/commission` → `setSalesOrderCommission`
  ([`commissionOwner.ts`](./app/lib/accounting/commissionOwner.ts)): the PO
  locked, a history line (`commission.owner`), its `updatedAt` left alone; a
  cancelled PO may still be chosen (what it delivered still counts).
- **The commission emails go to the owner's fixed inbox only**
  ([`commissionEmails.ts`](./app/lib/accounting/commissionEmails.ts) —
  `COMMISSION_EMAIL` = `PASSWORD_OTP_EMAIL`, the owner's choice): never the
  contact email, which an admin session can change. A PO **switched** from one
  person to the other is emailed (PO, customer, PO date, from → to, who, when —
  no money); the first choice is not. The email goes after the change is
  saved; a failed one never undoes it (`emailSent: false`, the page says so).
  The look is the shared designed email (§9).
- **The rate table (schema v59)** — `acc_commission_rates` (`effectiveMonth`
  "YYYY-MM" or "0000-00" = from the beginning, `rulesJson`, `removed`),
  **append-only**: every save and every removal is a row; the newest row of a
  month is that month's set, so the history is the table itself
  ([`commissionRates.ts`](./app/lib/accounting/commissionRates.ts) `loadRates`;
  nothing stored = the owner's table). Changes are pure in
  [`commissionRateChange.ts`](./app/lib/accounting/commissionRateChange.ts): a
  save of one month's set or the removal of a later one (the first never);
  the same figures as already apply to that month are refused ("ไม่มีอะไรเปลี่ยน");
  steps end on whole baht; `rateChangeTable` draws before → after for the
  emails. Page `/accounting/commission` (tab "ค่าคอมมิชชั่น"), sub-tab "ตารางอัตรา"
  ([`RatesView.tsx`](./app/accounting/commission/RatesView.tsx)): the sets as
  the owner's table writes them, an editor (the company's share follows; a new
  set picks its starting month), the code window, the history.
- **A change is saved ONLY with a 6-digit code emailed to the owner** (the
  owner's rule — no password): `POST /api/accounting/commission/rates/otp
  { change }` validates it, takes an issue (`claimOtpIssue`, one a minute, five
  an hour), stores `{ otp, expiresAt +15 min, pending, userId }` in ONE settings
  row and emails the code with the before → after table (a failed email
  withdraws the code, 502). `PUT /api/accounting/commission/rates { otp }`
  saves the change STORED with the code — never anything the request carries:
  the guess is taken before it is compared (five, the fifth wipes it), the
  change is checked again against the tables as they are now (409 when
  overtaken), and the code is spent IN the transaction that inserts the row
  (`UPDATE settings … WHERE value = <the row read>` — two tabs with one code
  save once; the company-profile route only blanks its row). Then the latest
  tables are emailed — who, when, what changed, every set in force — and
  `summaryEmailSent: false` when that email did not go (the save stands).
- **The month (no schema change)** — `GET /api/accounting/commission?month=`
  → `commissionMonth` ([`commissionData.ts`](./app/lib/accounting/commissionData.ts)):
  the customer POs dated in the month (one cancelled before anything went is
  left out; one cancelled after a delivery counts for what it delivered).
  A PO's profit = its sales by `sr.dealId` (every delivery, a credit note's
  negative) less `sr.costAmount` minus its "ค่าคอมมิชชั่น" cost rows; a sale with
  something to charge and no cost typed is not known yet and is left out
  (`costMissing`). DECIMALs are read as text (`signedDecimalToSatang`, a
  minus sign kept). The month's set (`rateSetForMonth`) and `monthCommission`
  give each its place and shares; its status, in this order: ยังไม่เลือก
  (`unassigned`) → ยังส่งของไม่ครบ → ยังไม่กรอกต้นทุน → รอลูกค้าจ่าย (every
  issued invoice owes 0 by `owedSatang`) → จ่ายได้. Totals per person split into
  payable now and waiting; invoices of the month not from a PO are counted
  and said (no commission).
- **The month's screen** — sub-tab "สรุปรายเดือน", the page's first
  ([`MonthView.tsx`](./app/accounting/commission/MonthView.tsx)): a month
  picker (by PO date), cards per person, the rows in the ladder's order with a
  link to each PO, a chooser in the row of a PO nobody chose yet, and each
  PO's costs on a click — `GET /api/accounting/commission/orders/[id]/costs`
  (`commissionCosts`), loaded the first time only: by delivery, each product's
  cost on its lines and the other costs by kind (`COST_TYPE_LABELS`, now in
  [`lib/costTypes.ts`](./app/lib/costTypes.ts), shared with the dashboard; the
  old `product_cost` rows left out as the dashboard leaves them), the
  "ค่าคอมมิชชั่น" rows shown but not deducted, a delivery with no cost flagged,
  then ยอดขาย − ต้นทุน = กำไร as the commission counts it, and "แก้ต้นทุน"
  to `/dashboard?edit=<saleId>` (the dashboard opens it when the sale is in
  its loaded list, the newest 1,000).
- **Paid-out marks (schema v60)** — `acc_commission_payouts`, one row per
  mark with the amounts **LOCKED** as they were when it was paid (kind, PO
  month, profit counted, ladder range, the three shares, rate set id, paid
  date, who); undone with a reason (`voidedAt` / `voidedBy` / `voidReason`),
  never deleted. `POST /api/accounting/commission/payouts { salesOrderId,
  paidDate }` → `recordPayout`
  ([`commissionPayouts.ts`](./app/lib/accounting/commissionPayouts.ts)): the
  date a real day and not in the future; worked out by `commissionMonth`
  exactly as the screen shows it; only a PO that is `payable`, only once
  (409 in Thai with the reason otherwise). Then under the PO's lock (the PO
  only, never an invoice — the module's order is invoice → PO) it checks the
  choice has not just been switched and re-reads the PO's live marks with a
  LOCKING read (a plain one in a TiDB transaction reads its start snapshot),
  inserts the mark and a history line (`commission.payout`). `POST
  …/payouts/[id]/void { reason }` → `voidPayout`: the PO then the mark
  locked, a reason required, `commission.payout.void`. In the month a marked
  PO is `paid` (`payout` — what was locked); a change since (a cost fixed, a
  credit note) shows as `differenceFordSatang` / `differenceTorSatang`
  (as it stands now − locked) and never rewrites what was paid, and
  `paidButNot` says when it could no longer be paid as it stands now. Per
  person: total = paid (locked) + difference + payable + waiting. A PO
  cancelled with nothing delivered is left out of its month — unless it has a
  live mark (its deliveries taken back after it was paid): it stays, at 0 on
  the ladder, `paidButNot` "not-delivered", so the mark shows and can be
  undone. While a PO
  has a live mark its choice cannot be switched (409 — undo the mark first);
  a PO with any mark, live or undone, cannot be deleted (`impactOf` — cancel
  it instead). The screen: a "จ่ายค่าคอมแล้ว" button on a payable row (a window
  with the three amounts and the paid date, today by default), "จ่ายแล้ว
  <date>" plus "ส่วนต่างหลังจ่าย" on a paid row, "ยกเลิกการบันทึกจ่าย" with a
  reason, and the cards add จ่ายแล้ว and ส่วนต่างหลังจ่าย.
- **The Excel and the PDF (no schema change).** The shapes live in
  [`commissionTypes.ts`](./app/lib/accounting/commissionTypes.ts) (pure — the
  browser draws them; `commissionData.ts` re-exports them) with
  `COMMISSION_STATUS_LABELS`, the one set of status words. **Excel** — the
  month screen's "ดาวน์โหลด Excel" reads `GET /api/accounting/commission?month=
  &withCosts=1` (`costs` by PO id from `commissionCostsFor`: every PO's sales,
  lines and cost rows in three reads, the way `commissionCosts` reads one) and
  [`commissionExport.ts`](./app/lib/accounting/commissionExport.ts) builds three
  sheets for `downloadExcel`: สรุปรายเดือน (every PO, what was paid and the
  difference, a รวม row, the totals per person above), ขั้นบันได (slice by
  slice at each step's rates; ลูกค้าพี่ต่อ flat), รายละเอียดต้นทุน (line by line).
  **PDF** — sub-tab "สรุปการจ่าย"
  ([`PayoutsView.tsx`](./app/accounting/commission/PayoutsView.tsx)): a range of
  PAID dates (this month first; เดือนนี้ / เดือนที่แล้ว), what was paid in it,
  and "ส่งออก PDF" with a "แสดงรายละเอียดต้นทุน" switch, off by default (the paper
  may be handed to the two). `GET /api/accounting/commission/payouts?from&to
  [&withCosts=1]` → `payoutReport`
  ([`commissionReport.ts`](./app/lib/accounting/commissionReport.ts)): the live
  marks paid in the range with their PO (the LOCKED amounts), `changedSince`
  per mark (against its PO's month as it stands now, by the PO's date now), the
  rate sets used (`rateSetId` null = the owner's table; a saved set by its id —
  append-only, so still there), the seller, who exported it and when; at most
  a year and 2,000 marks. The paper
  ([`CommissionPayoutPaper.tsx`](./app/accounting/commission/CommissionPayoutPaper.tsx),
  the logic pure in
  [`commissionPayoutPaper.ts`](./app/lib/accounting/commissionPayoutPaper.ts)) is
  made in the browser the quotation's way (html2canvas-pro + jsPDF, nothing
  stored): every part drawn once off-screen in `<body>` and measured after the
  fonts and the logo are ready, `paginatePaper` places them (a part never
  splits; a PO's row goes over with its cost detail only when the two fit the
  next page together — a page is never overfilled, as `overflow: hidden` would
  cut rows off the PDF; the totals + rates + notes + signatures stay together
  on the last page; heights are measured, so a gap under a measured block is
  padding, never margin; `accountingCommissionProperties.test.ts` checks the
  breaks and the calculator against a separate reference on random months),
  then each A4 page is painted —
  the company and the range, three cards (ฟอร์ดได้รับ / พี่ต่อได้รับ from which
  deals, รวมจ่าย), the table (navy head on every page, zebra rows, the ladder
  range under the customer), รวม, อัตราที่ใช้คิด, the notes, three signatures,
  and "หน้า x/y · ส่งออกโดย … · when" on every page. File
  `commission-payout_<from>_<to>.pdf`.

### 9. Email (contact form) + lead persistence
[`app/lib/mailer.ts`](./app/lib/mailer.ts) sends via SMTP (`nodemailer`, Gmail by
default). Addresses go to nodemailer as structured `{ name, address }` objects,
never hand-built `"name" <addr>` strings, so a visitor's name cannot add a
second From/Reply-To address. `__tests__/lib/mailerHeaders.test.ts` checks
this with the REAL nodemailer, so an upgrade that changes it fails the suite.
The public `POST /api/contact` **persists the lead to `contact_messages`
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

**Designed system emails** ([`emailHtml.ts`](./app/lib/emailHtml.ts),
`renderEmail` → `sendSystemHtmlEmail`): one look for the alerts the owner is
sent — the contact email's navy header bar, a white card, at most 600px, inline
CSS only, no picture fetched from the web — built from blocks (facts, from → to,
a big code, tables with right-aligned numbers and highlighted changes, a warning
box). Every value is escaped (`escapeHtml` lives here now; mailer.ts imports
it), and the same facts go as plain text for a mail app that shows no HTML. The
OTP notifications are still plain text.

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

**A restore checks what the snapshot names still exists** (2026-10-07).
- A product snapshot whose **best-seller rank** another product holds now is
  answered **409** with the reason (`BestSellerRankConflictError`), as the edit
  page answers it — it used to be a bare 500.
- A product snapshot whose **picture was deleted from Cloudinary** since is
  restored **without** `image`: the product keeps its current picture and the
  answer carries a Thai `warning` saying so. A **content** snapshot with deleted
  pictures is **refused** (409, naming how many) — its pictures are inside
  blocks, and publishing them would put broken images on the public page.
- "Deleted" is asked of the **Admin API** (`isCloudinaryImageMissing` in
  `cloudinaryHelper.ts`), never the CDN, which serves a deleted image from
  cache for a while. Only a definite 404 counts; a foreign URL, missing
  credentials, a rate limit or a network error all read as "not missing", so an
  outage can never block a restore.

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
- ⚠️ **The attempt is TAKEN before the answer is checked** (`takeLoginAttempt`
  in `lib/loginThrottle.ts`: one locked read-modify-write that refuses when the
  bucket is full). The earlier shape was "locked yet? → check → count if
  wrong", and every request of a burst sent at once passed the first step
  before any reached the third: 20 wrong codes fired together were all checked
  (`__tests__/api/lockout-burst.test.ts`). A right answer then resets its
  bucket; an outcome that was not a guess (2FA setup not started) hands its
  attempt back (`refundLoginAttempt`). Any new "N wrong answers" limit must
  take before it checks; there is deliberately no "is it locked?" read to
  build the old shape from.
- ⚠️ **The username's bucket is `login_fail_u_<username>` — the "u_" is a
  namespace, keep it.** The username is the one bucket name a stranger
  chooses. Unprefixed, the username "2fa_admin-001" was the admin's 2FA bucket
  (his id is the fixed `admin-001`): five wrong passwords for that made-up name
  locked his code step without knowing anything. No other bucket starts "u_".
- **Per-IP brake, in front of the lockout** (`app/lib/loginThrottle.ts`):
  10 attempts / minute per `clientKey` (in memory, per instance), checked
  after the body's type check and before the lockout row is read or bcrypt
  runs. It exists because the lockout alone never stops a caller who makes up a
  new username for every attempt: each name is its own bucket, and every
  attempt still costs ~0.25 s of bcrypt (cost 12) and one `settings` row. Not a
  replacement for the lockout (an IP is not an identity, and the counter is per
  instance). Failures for unknown usernames are still recorded, so the
  lockout does not reveal which usernames exist.
- **Lockout rows are purged nightly.** Rows are `login_fail_u_<username>` /
  `login_fail_dev_<deviceId>` (and the 2FA ones below) = `"count|expiresAt"`. The cleanup cron's
  `purgeExpiredLoginFailures` deletes those whose window has ended (an ended
  window already counts as no failures, so no login's outcome changes). It
  reads them in keyset pages, with the prefix escaped in LIKE (`_` is a
  wildcard), and deletes a row only if its value is unchanged since the read.
  A failure recorded mid-purge has opened a new window and stays.
- **Revocation ("ออกจากระบบอุปกรณ์อื่นทั้งหมด", /settings):** every session
  and device token carries the **session epoch** it was issued under
  (`settingsStore`: `session_epoch` row, cached, tag `session_epoch`).
  `getSession()` rejects an older one; `POST /api/auth/logout-others` bumps it
  atomically, busts the tag, and re-issues the caller's own session and device
  token under the new epoch (passed explicitly, not read back through the
  cache). Tokens from before epochs existed read as 0. The epoch is read only
  when a valid session cookie is present, and a read error fails open (0) so a
  DB blip does not log everyone out. `proxy.ts` (no DB, by choice) checks only
  the signature, so a revoked browser may still load a page shell — every
  protected API goes through `getSession()` and rejects it (the one admin page
  that reads server-side, `/documents`, reads the list `GET /api/documents`
  already serves publicly). On the client, `AuthContext` reads `/api/auth/me`
  once per page load, **only in a browser carrying the `has_session` hint**
  ([`lib/sessionHint.ts`](./app/lib/sessionHint.ts)). It is a script-readable
  cookie that only says a session cookie was issued: no secret, grants
  nothing. Without it there is no session to find, and asking was one function
  run per page view of every visitor. `createSession` sets it with the session's
  expiry and `deleteSession` removes it. `/api/auth/me` clears it when the
  session behind it is gone, and `proxy.ts` gives one to a valid session that
  lacks it (sessions from before the hint). Even so, a tab open during a revocation still says logged in:
  `/login` calls `refresh()` before redirecting a "logged-in" visitor to
  /adminpanel, or a revoked tab sent there by a 401 would bounce straight back
  (`__tests__/pages/loginRevokedSession.test.tsx`).
- **A logged-in browser is in Next's Draft Mode** — that is how an admin gets
  fresh renders of pages cached for visitors (`/showcase/[id]` is ISR, §14).
  `createSession` calls `enableDraftMode(expiresAt)` and `deleteSession` calls
  `draftMode().disable()` (every caller is a Route Handler, the only place they
  are allowed). The `__prerender_bypass` cookie is a per-build secret that
  grants nothing: a page still decides from `getSession()` what an admin may
  see. Next sets it as a browser-session cookie with SameSite=None. That
  outlives the session in a browser that restores its tabs, leaving every page
  uncached with nothing to turn it off. `enableDraftMode` re-issues it with the
  **session's expiry and SameSite=Lax**, so it lives exactly as long as the
  session and the hint. A live session can still lack it: sessions from before
  this, or a cookie from an earlier build. `/api/auth/me` turns Draft Mode back
  on for such a session (until its expiry) and answers `draftStarted: true`.
  `AuthContext` then calls `router.refresh()` once, because the page it landed
  on was the visitor's copy (a hidden product's page is a 404 there).
  `/api/auth/me` also turns Draft Mode off when the session behind it is gone. **Cost, by design:** Draft Mode
  skips `unstable_cache` and ISR for that browser, in pages and Route Handlers
  alike. Every request from a logged-in admin reads the DB directly. That is
  one admin against every visitor; the bell polls every 5 minutes. The PDF
  proxy's own `Cache-Control` is untouched (dynamic Route Handlers return
  before Next's Draft Mode header).
- ⚠️ The device key is `"login-device:" + SESSION_SECRET`, deliberately NOT the
  session key: `getSession()` and `proxy.ts` check only the signature, so a
  token signed with the session key would be accepted as a session. Tests pin
  both directions (`__tests__/lib/loginDevice.test.ts`).

**Two-factor login (TOTP, schema v45)** — opt-in per account, from /settings →
"ยืนยันตัวตน 2 ขั้น". A 6-digit code from an authenticator app (Google
Authenticator, Authy, Microsoft Authenticator…) on top of the password.
Self-hosted, free: RFC 6238 in [`lib/totp.ts`](./app/lib/totp.ts) over
`node:crypto` (pinned to the RFC test vectors), the QR drawn by the `qrcode`
package. Storage and checks in [`lib/twoFactor.ts`](./app/lib/twoFactor.ts).
- **The login is two requests.** `POST /api/auth/login` with a right password
  on a 2FA account answers `{ twoFactorRequired: true }` and sets only a
  **pending** cookie (`login_2fa`, 5 min, httpOnly, SameSite=Strict,
  `Path=/api/auth/login`, [`lib/twoFactorPending.ts`](./app/lib/twoFactorPending.ts)).
  `POST /api/auth/login/2fa { code }` checks the code and only then issues
  the session and device cookies. Because the session cookie exists only after
  both factors, **`proxy.ts` and `requireAuth()` are unchanged and no request
  pays anything extra.**
- ⚠️ The pending token's key is `"login-2fa:" + SESSION_SECRET` with its own
  audience — same reason as the device key: signed with the session key it
  WOULD be a session, and the code step would be decoration. It carries the
  session epoch, so "log out other devices" voids a half-finished login too.
- **A code works once.** `users.totpLastStep` records the 30-second step of the
  last accepted code; the accepting `UPDATE … WHERE totpLastStep < ?` refuses
  the same (or an older) step, so a code shoulder-surfed or replayed within its
  ±30 s window is rejected, and two racing requests cannot both win. The code
  that confirms setup is recorded the same way.
- **Backup codes:** 10 × `ABCD-EFGH` (31 symbols, no 0/O/1/I/L), shown once at
  setup or on "สร้างรหัสสำรองชุดใหม่", stored as HMAC-SHA256 in
  `user_backup_codes`, each spent by an `UPDATE … WHERE usedAt IS NULL` (once
  only). The same field takes either: six digits are TOTP, anything else is
  tried as a backup code. Logging in with one sends the admin to
  `/settings#two-factor`, where the remaining count is.
- **Lockout:** wrong codes count in `login_fail_2fa_<userId>` — or
  `login_fail_2fa_dev_<deviceId>` for a browser with a device cookie, so someone
  who has the password cannot keep the admin's own browser locked out of the
  code step. Same 5 / 15 min and the same per-IP brake as the password step;
  the nightly purge cleans these rows by the shared `login_fail_` prefix.
- **Turning it on/off needs more than a session** ([`lib/twoFactorReauth.ts`](./app/lib/twoFactorReauth.ts)):
  `enable` needs the password + a code from the new secret (proof the phone
  holds it); `disable` and `backup-codes` need the password + a code. Otherwise
  a stolen session could switch 2FA on with an attacker's phone (locking the
  admin out) or switch it off. Wrong answers count in **the settings' own
  per-user buckets**, `login_fail_reauth_pw_<userId>` and
  `login_fail_reauth_2fa_<userId>` (5 / 15 min), which only a logged-in session
  reaches. They used to share the login page's buckets, and anyone who sent
  five wrong logins as "admin" kept the admin, logged in on his own browser,
  out of these settings. The trade: a stolen session gets these five guesses
  besides the login page's. `setup` refuses while 2FA is on — a
  live secret is replaced only by turning it off first. **Enabling bumps the
  session epoch**: every session issued on the password alone is voided.
- **Secrets at rest:** `users.totpSecret` / `totpPendingSecret` are AES-256-GCM
  ("v1:" + base64(iv‖tag‖ciphertext)); the AES key and the backup-code HMAC key
  are HKDF-derived from SESSION_SECRET. A database copy alone yields neither.
  ⚠️ **Rotating SESSION_SECRET makes every stored secret and backup code
  unreadable** — the code step then answers "ยืนยันรหัสไม่ได้" and the server
  log says to reset 2FA. Reset it and set it up again.
- **Recovery (phone AND backup codes lost), deliberately not a button** — a
  bypass in the app is a new way in. Whoever has TiDB console access runs:
  ```sql
  UPDATE users SET totpEnabled = 0, totpSecret = NULL, totpPendingSecret = NULL,
         totpLastStep = NULL WHERE username = 'admin';
  DELETE FROM user_backup_codes WHERE userId = (SELECT id FROM users WHERE username = 'admin');
  ```
  then logs in with the password and sets 2FA up again.
- Only one admin account exists today (`admin-001`, seeded from env). If several
  people share it, they all scan the same QR — it is per ACCOUNT, not per
  person. Per-person codes need per-person accounts first.

**Login history and the new-device email (schema v49, table `login_events`)**
— [`lib/loginEvents.ts`](./app/lib/loginEvents.ts), lines built by
[`lib/loginHistory.ts`](./app/lib/loginHistory.ts), shown on /settings →
"ประวัติการเข้าสู่ระบบ" (`GET /api/auth/login-history`):
- **Every step that got past the password is stored:** a session on the
  password alone (`signed_in` / `password`), a right password on a 2FA account
  (`password_ok`), and its code step (`signed_in` / `totp` | `backup`). The
  routes call `noteLoginEvent` only after the step succeeded; the write and the
  email run in `after()`, so the login waits for neither and neither can fail
  it. **Wrong passwords are not stored** — the lockout counts those, and rows
  anyone could add by typing made-up usernames would be a way to fill the
  database. Pruned to 365 days on each write.
- **The email** goes when the PASSWORD step succeeds in a browser with no valid
  device cookie for that account — never logged in there, cookies cleared, a
  private window, or trust voided by "ออกจากระบบอุปกรณ์อื่นทั้งหมด" / a password
  change. It goes to `PASSWORD_OTP_EMAIL`, never the editable contact email
  (same reason as the codes). **On a 2FA account it goes at the password step
  too**: a right password that no code follows means the password has leaked,
  and that login never reaches a session. The code step never emails again.
- **At most 5 emails an hour and 20 a day** (counted from rows with
  `alert = 'sent'`). Someone with the password could otherwise log in over and
  over and spend Gmail's daily sending limit — the mailbox the password-reset
  codes come from. Past the cap the step is stored as `capped`. A failed count
  sends anyway; a step that cannot be stored still gets its email.
- **The history pairs the two steps of a 2FA login into one line**
  (`mergeLoginSteps`) by their **`attemptId`**: the password step makes a UUID,
  the pending token carries it as its jti (`readTwoFactorPendingToken` refuses
  a token without one), and the code step stores the same id. ⚠️ Never pair by
  time: one account can have several attempts open at once (a shared account,
  or a stranger typing the password while the owner logs in), and "the latest
  password step before the code" joined the owner's code to the stranger's
  step — leaving the warning line with the OWNER's device and address. A
  password step nothing joined is shown as "ใส่รหัสผ่านถูก แต่ไม่ได้ใส่รหัสยืนยัน
  2 ขั้นต่อ", highlighted.
- Address, place and browser are for reading only: `clientKey`, Vercel's
  `x-vercel-ip-city` / `-country`, and Next's `userAgent()` for "Chrome บน
  Windows". Nothing decides anything from them.

**Emailed one-time codes (OTP)** gate the actions a stolen session should
not be able to take alone: changing the contact email, the company profile,
maintenance mode, deleting equipment with service history, and deleting
unused Cloudinary images. Five `…/otp` routes issue codes, and the matching
route verifies them. All go through
[`app/lib/otpAttempts.ts`](./app/lib/otpAttempts.ts):
- Codes are **6 digits** (`crypto.randomInt(100000, 1000000)`) everywhere.
  The orphan-image code was 5 digits until September 2026; its screen, route
  and email say 6 now.
- **Guesses:** 5 per code. Each guess is TAKEN before the code is compared
  (`takeOtpAttempt`, one locked read-modify-write; it refuses once five are
  taken), and the fifth wrong one wipes the code. Taking after comparing — the
  earlier `recordOtpFailure` — let a burst of parallel guesses all compare
  before any failure was counted. Each new code starts from 0
  (`resetOtpAttempts`).
- **Issuing:** because of that reset, `claimOtpIssue(otpKey)` must come
  before any new code: at most one a minute and 5 an hour per `otpKey`
  (settings row `<otpKey>_issued`, under a row lock). Refused →
  `otpIssueRefused` = 429 + `Retry-After` + a Thai "wait N" message, and no
  code stored, no email sent. It is called after the request validates, so a
  bad request uses nothing up. A new OTP route must call it.

**Changing the password, and "ลืมรหัสผ่าน"** ([`lib/passwordReset.ts`](./app/lib/passwordReset.ts),
rules in [`lib/passwordRules.ts`](./app/lib/passwordRules.ts)):
- **The 6-digit code goes to ONE fixed address, `PASSWORD_OTP_EMAIL`
  (ampumin@gmail.com), never to the contact email.** The contact email can be
  edited from /settings; a stolen session that pointed it at its own inbox
  could then mint its own password. The fixed address changes only with a
  deploy. Codes for the two pages are separate (`password_change_otp` /
  `password_reset_otp`); each follows the OTP rules above (issue throttle,
  5 guesses taken before compared, 10 minutes).
- **Change** (/settings → เปลี่ยนรหัสผ่าน, `POST /api/auth/password/otp` then
  `POST /api/auth/password`) needs the session, the current password
  (`requirePassword`, the settings' own re-auth bucket), the emailed code and,
  while 2FA is on, an app or backup code. The current password is checked
  when the code is ASKED FOR too, so a wrong one is reported before an email
  goes out. It is checked again at the end, because the field stays editable.
  The refusal says "รหัสผ่านปัจจุบันไม่ถูกต้อง". A bare "รหัสผ่านไม่ถูกต้อง"
  next to an OTP and a 2FA code was read as "the code is wrong". **Forgot** (/forgot-password, public,
  `POST /api/auth/forgot-password/otp` then `POST /api/auth/forgot-password`)
  needs the emailed code and, while 2FA is on, an app or backup code (its own
  bucket, `login_fail_reset_2fa_<id>`). Inbox access alone cannot take over a
  2FA account.
- **The public page has a daily budget of wrong codes:** 10 per account per
  24 hours, across every code issued (`RESET_OTP_DAILY_LIMIT`,
  `login_fail_reset_otp_<id>`; a right code hands its attempt back). Five
  guesses a code is no limit there on its own: each new code resets the count,
  and anyone may ask for five codes an hour. That was 25 guesses an hour,
  indefinitely, at a 6-digit code (roughly one chance in five of a hit within a
  year on an account without 2FA). The price is that a stranger can use the ten
  up and close the page for that account for a day. Every code he asks for
  emails the admin, and the logged-in change is unaffected.
- **Nothing is spent until every check passes**, and the emailed code is then
  consumed atomically (`UPDATE … WHERE value = <the code read>`). Two requests
  with the same right code set ONE password, and a mistyped 2FA code does not
  cost a new email.
- **The forgot page tells a stranger nothing.** "Send a code" answers the same,
  and in the same time, for a real and a made-up username, for a throttled
  request and for a failed send (logged). Issuing the code and sending the
  email run in `after()` (Next's post-response hook, `waitUntil` on Vercel).
  Done before the reply, the SMTP round trip made a real username answer a
  second or two later. The password rules are judged before the lookup, and
  **every refusal of the emailed code is one message**
  (`PASSWORD_RESET_OTP_REFUSED`): unknown username, no code asked for,
  expired, wrong, five wrong, daily budget spent. Separate messages were an
  oracle. Ask for a code for "admin", send a wrong one, and "wrong code"
  (where a made-up name got "no code asked for") said the account was real.
  A made-up username still has the code row read. The one difference left is
  that a real account with a live code also spends a guess (two short
  transactions, milliseconds). "This account needs a 2FA code" is said only to
  whoever holds the emailed code. There is no "same as the old password?" check there:
  without the old password it would be a free password oracle.
- **New password:** at least 5 characters (the owner's choice; online guessing
  stays capped by the lockout and 2FA) and at most 72 BYTES (bcrypt
  silently ignores the rest; 24 Thai characters), no leading or trailing
  space, not the username. Hashed with bcrypt cost 12.
- **Afterwards every earlier session and trusted device is void** (session
  epoch). Change re-issues this browser's session and device token. Forgot
  issues none (log in again) and clears the username's login lockout. A notice
  email ("รหัสผ่านถูกเปลี่ยนแล้ว") goes to the same address.
- The seeded admin is inserted only when `admin-001` does not exist, so a
  password changed here is not overwritten by `ADMIN_PASSWORD` on a deploy, and
  that env var no longer says what the password is.

### 11. Shared UI components — don't re-implement inline
[`app/components/`](./app/components/): `ConfirmDialog`, `Toast`, `Spinner`,
`ColorPickerDropdown`, `BlockRangeControl` (image-size / block-spacing slider with
−/+ steps + live readout), `RichTextEditor`, `PasswordInput` (a password field
with an eye button that shows what was typed), `Pagination` (a table pager:
"แสดง a ถึง b จาก n", first / previous / next / last and a page-number box),
`SortableTh` (a header that sorts its column, with `aria-sort`), `CopyText` (a
phone or e-mail that copies itself on click, without opening the row around
it), `SupplierInfo` (a supplier's contact / address / tax ID as Thai label:value
rows, each copyable — /suppliers' window and the showcase's §8e), `RowActions` (a clickable row's copy / edit / delete icons, delete only on
hover or focus; its `openOnKey` opens the row on Enter / Space),
`NavButton` (any "go back to …" link drawn as a bordered button with an orange
home / dashboard / back icon, e.g. "กลับไป Dashboard"; pass `onNavigate` for a
page's leave guard. `NavButton.test.tsx` fails if the old faint grey "← กลับไป …"
text-link style comes back), `AdminHomeButton` (the way back to /adminpanel on
every admin page — `NavButton` with the home icon, "กลับหน้าระบบจัดการ".
`AdminHomeButton.test.tsx` fails if a page links to /adminpanel by hand),
`SearchBox` (a list's search field with a magnifier and ✕ to clear),
`useModalEscape` (Esc closes a window — only the one on top: the last
`aria-modal="true"` in the document, with no dropdown list open; see
[`lib/dialogLayer.ts`](./app/lib/dialogLayer.ts)). Import the shared version
instead of defining a local one. A client reading a failed response's message
uses [`lib/apiErrorMessage.ts`](./app/lib/apiErrorMessage.ts)'s `errorMessageOf`.

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

**Product and content photos show a loading skeleton** until they have
loaded — never an empty box the photo pops into. Use
[`SkeletonImage`](./app/components/SkeletonImage.tsx) (next/image with the
shimmer from [`lib/imageSkeleton.ts`](./app/lib/imageSkeleton.ts) as its
`placeholder`) for every product / content photo;
[`ResponsiveImage`](./app/components/ResponsiveImage.tsx) (the showcase's
content-block photos, no stored dimensions) paints the same shimmer in an
`aspect-ratio: auto 4 / 3` box. Both paint it as the `<img>`'s own
background: it is in the first HTML, needs no JavaScript, and never hides the
photo (hiding it until a fade-in would delay LCP); the background is dropped
on load, on error, and for a photo that loaded before hydration. It needs
`data:` in the CSP's `img-src`. Not for the site's fixed images (hero,
about, logo, the LINE QR), nor for images on documents printed to PDF
(quotation, PO, service job), where a half-loaded image would print
the shimmer. `__tests__/components/SkeletonImage.test.tsx` fails if a display
page goes back to a plain next/image.

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
- `/showcase/[id]` is **ISR (`revalidate = 60`), not force-dynamic.** It is
  the page search results send visitors to, and force-dynamic made every view
  a server render no CDN could hold. Every content, product, category and
  revision-restore write calls `revalidateTag("products")`. The page reads
  tagged data (`getAllProducts` / `getAllCategories` / `getAllContentsMeta`),
  so an edit shows at once and 60 s is only the backstop. ⚠️ **Keep a
  `products`-tagged read in this page:** `getContent` itself is uncached, so
  without one a content edit would wait out the 60 s. What only an admin may see
  is rendered **only in Draft Mode** (§10). `adminSession()` does not even read
  the session outside it, so the cached copy never depends on who asked: a
  hidden product's page is a 404 in it, and the edit picker lists public
  products only. `ShowcaseClient` is keyed on the copy it was given
  (`adminView`), since it seeds its state from props once. When it has a
  copy made for the other kind of viewer, it calls `router.refresh()` once
  per mount, after the login check settles. That covers a copy prefetched
  before logging in, an admin's copy kept in the tab after logging out, and a
  session that lacked Draft Mode until `/api/auth/me` restored it. `__tests__/pages/showcasePayload.test.tsx` and
  `__tests__/components/ShowcaseClientViewerCheck.test.tsx` pin this.

**The site is Thai until a visitor picks another language** (`LanguageContext`).
The language is client-side state on one URL per page — the server always
renders Thai — and it used to be guessed from `navigator.language` after
hydration. Googlebot renders as an en-US browser, so every page it indexed
turned English under a Thai `<html lang>`, title and description. Only a
language the visitor chose (saved in `localStorage` `idkt-lang`) is applied
now; never re-add a guess. Indexing English/Chinese separately would need
per-language URLs and hreflang — not built.

**The maintenance overlay is part of the HTML** of the pages it covers
(`MAINTENANCE_BLOCKED_PATHS`: `/`, `/contact`, `/catalog`) — `app/layout.tsx`
passes the flag down, so a visitor never reads the page first. ⚠️ Vercel's
cached copy of the home page (ISR) is rendered with the path **`/index`**:
`usePathname()` says `/index` on the server and `/` in the browser (the live
page's flight data reads `"c":["","index"]`). Match a page with
`isMaintenanceBlockedPath()` (`lib/maintenanceConfig.ts`), never the list alone.
Matching the list left the overlay out of the home page's HTML, and the
browser's first render, overlay shown, no longer matched it: React threw the
whole server-rendered page away and drew it again on every visit (hydration
error #418, found 2026-11-07 by a headless-browser pass over the live site).
`__tests__/components/MaintenanceOverlay.test.tsx` renders it as `/index` and
hydrates it as `/`.

**A service-area business.** Customers never come to the premises: the
equipment is delivered and serviced at theirs, anywhere in Thailand. Its
Google Business Profile hides the address, and the site must say the same:
the Organization JSON-LD (`ProductsJsonLd`) is `["Organization",
"LocalBusiness"]` — never "Store", a shop people walk into — with
`areaServed: "TH"` and no `hasMap`; the contact page shows the address as
text with no map. The address itself stays (it is on every quotation and
invoice). No `geo` either. With the map gone nothing frames Google, so the
CSP `frame-src` allows YouTube (video blocks) only.

**Image sitemap.** Each sitemap URL lists the pictures that page shows
(`images`, through `lib/sitemapImages.ts`), so product photos reach Google
Images: `/products` every public product photo, a category page its own,
`/showcase/{id}` its blocks' pictures (`getContentImageIndex` — JSON_EXTRACT
of `imageUrl` / `imageUrls`, never the bodies; cached under `products`),
`/catalog` the covers of shown catalogs. ⚠️ Next writes `<image:loc>` WITHOUT
escaping it, so a URL with `& < > " '` is left out — one would make the whole
sitemap unreadable. A failed image read costs a page its pictures, never its
place in the sitemap.

**Sitemap.** No `lastModified` on static pages (it was "now" on every fetch,
which Google learns to ignore). Content pages use **`contents.updatedAt`**
(schema v43) — stamped by `updateContent` only when a column it writes actually
changes (the same rule as its revision snapshot), backfilled from `revisions`,
NULL = fall back to `createdAt`. It is also the Article's `dateModified`.

**PDF catalogs.** `robots.ts` allows `/api/documents/proxy` (the rest of `/api/`
stays disallowed) so the catalogs' text can be indexed; `/document/[id]` links
the PDF plainly for crawlers, and the `download=1` copy sends
`X-Robots-Tag: noindex` (same file, second URL).

**Hiding a catalog** (schema v48, `documents.isPublished`, default TRUE). A
hidden catalog does not exist for a visitor: not on `/catalog`, not at
`/document/[id]` (404, title included), not in the sitemap, not in the public
`GET /api/documents`. The one rule is `isDocumentPublic` in
`documentStore.ts`. An admin sees every catalog, the hidden ones marked, and
switches one with `PATCH /api/documents/[id] { isPublished }` — from the card
on `/catalog` or on `/documents`. `/catalog` is ISR like `/showcase/[id]`
and follows the same rule: the admin's copy is rendered **only in Draft Mode**,
the session is read only there, and `CatalogClient` is keyed on the copy and
refreshes once when it holds the other viewer's. **The PDF proxy follows it
too**: `/document/[id]` links its PDF through `/api/documents/proxy` for
crawlers, so a PDF belonging only to hidden catalogs is a 404 there for a
visitor — matched on the FILE (the URL's last segment, the upload's random
id), because Cloudinary serves one file with or without its /v123/ version,
with transformations and with any query string — and is served to an admin with
`Cache-Control: private, no-store` so no shared cache keeps it. A copy the CDN
already holds from before the hiding lives out its `s-maxage` (a day at most —
the same window as a deleted document). It is a visibility rule, not a privacy
boundary: the file stays public on Cloudinary, and when the catalog list cannot
be read the proxy serves the PDF rather than failing every catalog. Not a
revision, and a revision restore never changes it (`updateDocument` does not
write the column).

**Content images** render through `ResponsiveImage`: Cloudinary resizes and
re-encodes them from the URL (`lib/cloudinaryUrl.ts`, `f_auto,q_auto,c_limit,w_…`
+ srcset), the stored URL never changes, and if the resized URL fails (an
account with strict transformations) the image falls back to the original.

**The /showcase/[id] column widens with the screen** (`ShowcaseClient.tsx`):
max-w-4xl, then lg max-w-5xl, xl max-w-6xl, 2xl max-w-7xl (the 1280px of
`.section-wrapper`). That gives 960, 1088 and 1216px of content. It was one
864px column on every screen, which left a large monitor mostly empty. Header
and blocks share the container. Every image `sizes` there comes from
`COLUMN_PX` through `columnSizes()`, so a photo is fetched as wide as it is
shown. Change the container and you must change `COLUMN_PX` with it. The product badge under
the title is a box (`rounded-xl`), not a pill: product titles are often
several lines (brand / type / model).

**Public pages on a phone** (admin pages are desktop-only by design). Rules
the public pages follow; `__tests__/components/MobileLayout.test.tsx` pins them:
- **Screen heights use `svh` / `dvh`, never `h-screen` / `100vh`.** On a
  phone 100vh is the height WITHOUT the browser's bars. The home Hero (laid
  out from the bottom) put its buttons under the toolbar, and the PDF viewer
  and the phone menu had their bottoms out of reach. The Hero is `min-h-svh`
  with no max height, so a short screen grows it rather than cutting the top.
  **Always keep the 100vh value as a fallback** and apply svh/dvh through
  `supports-[height:100dvh]:`. Chrome < 108, Safari < 15.4 and older in-app
  browsers drop a bare `h-dvh`. Without the fallback the `/document` column
  had no height at all, and its PDF viewer collapsed.
- **Every section the menu links to (`/#services`, `/#products`) carries
  `scroll-mt-20 md:scroll-mt-24`**, the fixed bar's height. The phone padding
  is smaller than the bar, so an anchor jump otherwise lands with the heading
  under it.
- **The full menu shows from `lg` (1024px)**, the menu button below that. It
  needs about 1,000px (6 links + language), and from `md` it crowded an iPad
  held upright. While the phone menu is open the page behind it does not
  scroll, and widening to desktop closes it.
- **Phone numbers are `tel:` links** (`PhoneText` → `lib/phone.ts`
  `phoneParts`): each number in the company phone field, extension kept on
  screen but not dialled. Only a number of a real Thai shape is linked
  (landline 0[2-7]+7 digits, mobile 0[689]+8). "02-123-4567-8" (4567 or 4568)
  would otherwise dial a wrong number. `toThaiE164` moved to `lib/phone.ts`, because client
  components need it, and is re-exported from `settingsStore`.
- **The PDF viewer draws each page as wide as it is shown, and only pages
  near the screen** (`lib/pdfViewerSizing.ts`, `PdfViewerClient` → `LazyPage`).
  A page not drawn yet is a box sized by page 1. Once a page has loaded, its
  box keeps that page's own proportions, also after the canvas is dropped, so
  a landscape page in a portrait catalog does not leave a gap or jerk the view.
  The device pixel ratio is capped at 2, and lower when zoomed far, to keep
  one canvas under iOS Safari's limit. It used to draw every page at scale
  1.5 and shrink it with CSS: on a phone, canvases several times the screen,
  for every page of a catalog at once. 100% means fit to width.
- **Section spacing is smaller on a phone** (`py-16` and `mb-12` where the
  desktop has `py-28`/`py-48` and `mb-20`/`mb-24`). Desktop values start
  at `md`.

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
- **⚠️ A cached total recomputed in a transaction must lock its parent row
  FIRST and then sum with a locking read (`FOR UPDATE`).** A plain SELECT reads
  the transaction's snapshot (on TiDB, the one taken when it began), which
  misses rows another transaction committed meanwhile. The old billing
  module's `recomputePaidAmount` summed that way: two payments recorded on one
  invoice at once each counted only their own, and the cached `paidAmount`
  lost one of them. The fix — lock the invoice row, then sum `FOR UPDATE` — is
  the rule the accounting module's `recomputePaidSatang` follows
  ([`paymentLedger.ts`](./app/lib/accounting/paymentLedger.ts)). `FOR UPDATE`
  alone is not enough, because it does not wait for another transaction's
  uncommitted INSERT; the parent lock does.
- **`withTransaction` replays a transaction the database rolled back to break
  a DEADLOCK** (`ER_LOCK_DEADLOCK`), as it does after a dropped connection.
  The sum above locks an invoice and then its payments, while a void locks a
  payment and then its invoice, so two changes to one invoice at once can
  deadlock. The loser used to surface as a 500; now it waits for the winner and
  works on what it committed. A lock-WAIT timeout is not retried: the row is
  still held. Only the transaction level retries; `query()` does not.
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
- **v46 widens the rich-text columns** (`RICH_TEXT_COLUMNS`: product
  titles/descriptions, category names, content title — VARCHAR(255) → TEXT,
  descriptions → MEDIUMTEXT) and mends the values the old cut left broken:
  only a value EXACTLY at the old cap (255 / 10,000 — what `.substring` left)
  and only if `repairTruncatedRichText` finds it broken, written with a guard
  on the value it read. A column that cannot be widened is logged and skipped,
  like the task-board charset widening: the site stays up, and a save too long
  for the old column is refused by the database instead of cut.
- **Preview deploys never mutate the DB.** Bootstrap (CREATE/ALTER/seed) is
  skipped when `VERCEL_ENV === "preview"`, because previews share the production
  database — a branch bumping `SCHEMA_VERSION` must not alter prod before merge.
  Set `ALLOW_DB_BOOTSTRAP=1` for an environment with its own throwaway DB.
- Tables (`db.ts` is the authoritative list): `users`, `product_categories`,
  `products`, `product_specs`, `contents`, `documents`, `settings`, `quotations`,
  `used_docnos`, `contact_messages`, `revisions`, plus the CRM/sales family —
  `customers`, `companies`, `salespeople`, `suppliers`, `product_suppliers`,
  `customer_equipments`, `service_schedules`,
  `service_logs`, `sales_records`, **`sales_record_items`** (v33 — one row per
  product line under a sale, see §8a), `sale_cost_items`, `expenses`,
  `recurring_expenses`, `alert_snoozes`, plus the manual task board (v35) —
  **`task_topics`**, **`crm_tasks`**, **`task_links`** (see §8c; `task_links`
  has a composite PK and, like the rest of that group, no foreign keys), plus
  the printed service job sheet (v38) — **`service_jobs`**,
  **`service_job_equipments`** (composite PK `(jobId, equipmentId)`, no foreign
  keys; see §13), plus **`login_events`** (v49 — the login history, §10), plus
  the accounting module's `acc_*` tables (§8g). `billing_documents` and
  `billing_payments` (the old /billing) were dropped in v55.

> ⚠️ The seed inserts an `admin` user (id `admin-001`) from `ADMIN_USERNAME` /
> `ADMIN_PASSWORD` (env, **not** source) — but only if the row doesn't already
> exist, and it **skips seeding entirely when `ADMIN_PASSWORD` is unset** (no weak
> default). Changing `ADMIN_PASSWORD` does **not** rotate an already-seeded
> password — change it from /settings → เปลี่ยนรหัสผ่าน, or /forgot-password (§10).

---

## Environment variables

```
# Database (TiDB Cloud / MySQL)
DB_HOST=          DB_PORT=4000     DB_USER=
DB_PASSWORD=      DB_NAME=

# Auth — REQUIRED (session.ts throws without it). Also the root of the keys that
# encrypt 2FA secrets and hash backup codes (§10): changing it logs everyone out
# AND makes every account's 2FA unusable until reset.
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
  `expenseStore.ts`, `supplierStore.ts`, the
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
5. **A single content is read fresh; the page around it is cached.**
   `getContent` is not in `unstable_cache`, but `/showcase/[id]` is ISR and its
   cache entry carries the `products` tag through the lists it also reads. Every
   content write calls `revalidateTag("products")` (it also busts
   `getAllContentsMeta`). Any new content writer must do the same (§14).
6. **Pre-existing lint debt** (`<a>` instead of `<Link>`, `<img>` instead of
   `next/image`) remains in some components — fix opportunistically. The site
   navigation is `next/link` already (menu, hero button, footer links): a plain
   `<a>` reloaded the whole page on every click. Because the page now changes in
   place, the Navbar closes the phone menu on every page change. It also forces
   scroll-to-top only on the document's first load, so Next can restore the
   back button's position.

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
- Five sources (six until the old billing receivables went, v55), each matched
  on the date that means something for it, never the
  first date column in its table (`DATED_ALERT_KINDS` in `app/lib/alertDateSearch.ts`):

  | Kind | Table | Date matched |
  | --- | --- | --- |
  | `schedule` | `service_schedules` (`equipmentId IS NOT NULL`) | `scheduledDate` |
  | `customer_call` | `service_schedules` (`equipmentId IS NULL`) | `scheduledDate` |
  | `task` | `tasks` | `dueDate` |
  | `warranty` | `customer_equipments` | `warrantyEndDate` |
  | `calibration` | `customer_equipments` | `calibrationDate + CALIBRATION_VALIDITY_MONTHS` — the due date, not the date of the last calibration |

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
  `task` is movable while `pending` and dated; `warranty` and `calibration`
  are never movable — their dates are facts, not reminders someone set — and a
  kind it does not know (an old tab's `receivable` row) is refused like them. Debugging "why won't this date move" starts at `movable`/
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

## Recent Architectural Changes (October 2026)

From the whole-project adversarial review. Each is pinned by tests that fail
when the fix is removed.

**1. Hard-deleting a product keeps the customers' machine names.**
`deleteProduct` (`productStore.ts`) runs in one transaction: it copies the
product's plain-text name (`htmlToText`, first non-empty of th/en/zh) into
`customer_equipments.productName` for every machine linked to it that has no
name of its own, **then** deletes. `customer_equipments.productId` has no
foreign key and the CRM reads a linked machine's name from the product, so the
delete used to leave those machines nameless. `updateEquipment` (`crmStore.ts`)
treats a `productId` whose product no longer exists as unlinked
(`productExists`), so editing such a machine keeps the stored name instead of
blanking it.

**2. A customer or company with a ใบ Job cannot be deleted.** `service_jobs`
reads both names live (§13) and has no foreign key, so the DELETE routes in
`app/api/customers/[id]` and `app/api/companies/[id]` check it alongside the
equipment / sales / schedule guards and refuse with 400 in Thai.

**3. Every amount and date is checked, never quietly fixed.**
- **Expenses** (`app/api/admin/expenses`): `parsePositiveMoney` and
  `isValidDateString` on POST, and on PUT for whichever is sent. The store's
  own fallbacks had turned "abc" into ฿0, "1e3" into ฿1,000 and a date that
  does not exist into today, all with a 201. The text fields go through
  `expenseTextError` (`lib/expenseInput.ts`) in all four expense routes,
  recurring included: the title is required text on create and cannot be
  blanked on edit; category and note are text or absent.
- **Salespeople**: `salespersonInputError` (`salesStore.ts`) — every field must
  be text; a number reached `.trim()` and came back a 500.
- **Documents** (`POST /api/documents`): the id must be a plain URL segment
  (`/^[A-Za-z0-9_-]{1,100}$/`, it is the page's address), both files must be in
  **our** Cloudinary cloud (the only thing the PDF proxy will fetch; fails
  closed without `CLOUDINARY_CLOUD_NAME`), `sortOrder` must be an integer, and
  a duplicate id is 409 instead of a 500.

**4. A saved billing document keeps its type.** `saveBillingDocumentAtomic`
reads the row's `docType` under `FOR UPDATE` (after the docNo reservation, so
the lock order stays used_docnos → billing_documents) and throws
`BillingDocTypeChangeError` if a re-save names another one; the route answers
409. /billing never changes a type, but the API took the upsert's word for it,
so an invoice with payments could be turned into a "receipt".

**5. A missing customer is a 404, not a saved edit.** `PUT /api/customers/[id]`
used to answer 200 for a customer deleted in another tab — the UPDATE matched
nothing and the admin was told the edit was kept.

**6. A sale's cost item is reached only through its own sale.**
`updateCostItem(salesRecordId, id, …)` / `deleteCostItem(salesRecordId, id)`
scope every SELECT / UPDATE / DELETE to `salesRecordId`, and a synthetic
`product-cost:<saleId>` id must name the same sale. The route only checked that
the sale in the URL existed, so /sales/A/costs/<an item of B> edited B's costs.

**7. Totals add up on paper for new documents** — `totalsVersion`, §8.

**8. Revision restore checks what it brings back** — §9a.

**9. PDF editor: text is styled in its own dialog** (`app/tools/pdf-editor`).
Size, bold, italic, colour, alignment and angle are one component,
`TextStyleControls`, used by BOTH the toolbar (how the next text looks) and
the text dialog (`TextDraftDialog`, how this text looks). A new text starts
from the toolbar, at a snapped line's size and angle, and placing it makes the
toolbar remember its look (`textDraft.ts`). **An edit starts from the text's
own style** (`styleOfText`): saving used to take colour, bold and alignment
from the toolbar, restyling text the admin only meant to retype. Italic
(`TextAnnotation.italic`, optional, missing = upright) is the upright Sarabun
face slanted `ITALIC_SLANT_DEG` (12°), since only Regular and Bold ship. The
slant is a `cm` shear along each line's own baseline, about its start, built
in the rotated frame. pdf-lib's `xSkew`/`ySkew` adds to the rotation matrix,
which is a slant only at 0°. A slant keeps advance widths, so wrapping is the
same as upright; the preview uses CSS `font-style: italic`. The angle field
is labelled "มุม", because "เอียง" now means italic (ตัวเอียง).
A page wider than the view (zoomed in, a landscape spread) scrolls left and
right: the page column is `w-max min-w-full` inside the `overflow-auto` view.
A view-wide `items-center` column overflowed both sides, and the left half
could never be reached, because scrollLeft does not go negative.

**10. A stored instant is shown on Bangkok's calendar** (`lib/dateFormat.ts`).
`formatDisplayDate` converts a full ISO instant (`…Z` / `…+07:00` —
createdAt, completedAt) to the Bangkok day; its first ten characters are the
UTC day, still yesterday here until 07:00 (a job closed at 03:00 read as the
day before). A plain date, a zone-less date-time and a DATE column arriving as
midnight UTC keep their own day. `bangkokDayOf(value)` is the same rule as a
`YYYY-MM-DD` string, for code that needs the day itself (the task picker,
a receipt's fallback payment date). Never `createdAt.slice(0, 10)`.

**11. A sale edit checks its numbers like a new sale.** `saleNumbersError`
(`lib/saleInput.ts`) is shared by POST /api/admin/sales (every line) and PUT
/api/admin/sales/[id] (whatever the edit sends): a quantity of at least 1, and
money that is a non-negative number or absent. The store turns anything it
cannot read into ฿0 (or a quantity of 1) and saves it without a word.
