# Project Skills & Tech Stack

This document outlines the technologies, frameworks, and libraries used in this project.
For how they fit together, read [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Core Stack
- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **UI Library**: [React 19](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

## Styling
- **CSS Framework**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons/Fonts**: Geist font family via `next/font`

## Database & Data Fetching
- **Database**: MySQL (optimized for TiDB Cloud)
- **Database Driver**: `mysql2` — pooled connections (`connectionLimit == maxIdle == 3`) with transient-error query retries and a `SCHEMA_VERSION`-gated bootstrap/seed
- **Data Fetching**: Server Components, Route Handlers (`fetch` API), React `use()`, `React.cache`

## Authentication & Security
- **Authentication**: Custom JWT session cookies (httpOnly, 3-day HS256)
- **JWT Signing**: `jose`
- **Password Hashing**: `bcryptjs`
- **CSRF**: same-origin guard in `withRoute` for all state-changing routes
- **Headers**: CSP (Report-Only), `X-Frame-Options: DENY`, HSTS via `next.config.ts`
- **HTML Sanitization**: `sanitize-html` (pure JS) on write — see Caveat #3

## Media & Storage
- **Media Hosting**: [Cloudinary](https://cloudinary.com/) (Images and PDF documents)
- **PDF Viewer**: `react-pdf` (v10.x, modern `import.meta.url` worker init)
- **PDF Generation**: `jspdf` + `html2canvas-pro` (client-side quotation export; oklch-safe for Tailwind v4)

## Email
- **Transport**: `nodemailer` over SMTP (Gmail App Password by default; `SMTP_HOST`/`SMTP_PORT` overridable)
- **Use**: public contact form → configurable recipient (`settings.contact_email`); notifies old + new address on change

## State Management & Features
- **State Management**: React Context (`AuthContext`, `NavContext`)
- **i18n (Internationalization)**: Custom React Context (Supports TH, EN, ZH)
- **Quotation builder**: date-prefixed running numbers (`QT<YYYYMMDD>-NN`, starts at 22) with a persistent `used_docnos` ledger; 30-day auto-purge via Vercel Cron

## Testing
- **Runner**: [Vitest](https://vitest.dev/) 4 + `@testing-library/react`, v8 coverage
- **Scope**: unit tests for the logic surface (`app/lib/**` + `app/api/**`); coverage `include`-scoped with thresholds (~95/90/97/96)
- **Gate**: `.githooks/pre-push` runs the suite before every push (wired via `core.hooksPath`, auto-set on `npm install` — no husky)

## Deployment
- **Platform**: [Vercel](https://vercel.com) (region `sin1`) + Vercel Cron

## Important Caveats & Quirks

### 1. Next.js `fetch` Proxying (Stream Corruption)
When proxying an external file via a Next.js App Router Route Handler (`NextResponse(response.body)`), Next.js `fetch` automatically decompresses gzipped bodies but retains the original headers if you blindly copy them.
- **Skill/Fix**: Always run `headers.delete("content-encoding")` and `headers.delete("content-length")` before returning the proxied stream to prevent the browser from attempting to decode an already uncompressed stream, which results in corrupted binaries (e.g., failed PDF renders).

### 2. Cloudinary PDF Strict Delivery
Cloudinary enforces strict delivery for `raw` PDF files by default to mitigate XSS risks, returning a `401 deny or ACL failure`.
- **Skill/Fix**: Instead of attempting to sign URLs (which still fail for raw deliveries under this policy), the global setting **"Delivery of PDF and ZIP files"** in the Cloudinary Security settings must be unchecked to allow public PDF delivery to `react-pdf`.

### 3. Server-side HTML sanitization must be pure JS
`jsdom` / `isomorphic-dompurify` fail to load on Vercel's serverless runtime (`ERR_REQUIRE_ESM`) and 500 the whole site; DOMPurify+linkedom silently returns **unsanitized** HTML when the fake DOM lacks features.
- **Skill/Fix**: Use `sanitize-html` (pure JS, no native/DOM deps), sanitizing on write. Apply the same "pure JS on the server" rule to any new server dependency with native or ESM-loader quirks.

### 4. `maxIdle` must equal `connectionLimit` (mysql2 pool)
With `maxIdle < connectionLimit`, mysql2's eviction timer destroys surplus connections after every request, so a page issuing several parallel queries pays a full ~1s+ TiDB TLS reconnect on the next view.
- **Skill/Fix**: Keep `connectionLimit` and `maxIdle` equal (both `3`) in `db.ts`.

### 5. Image-deletion safety invariant
Deleting a quotation must never destroy a Cloudinary image still referenced by a product or content block.
- **Skill/Fix**: The upload route only accepts URLs on our cloud, and `quotationStore` cross-checks every candidate URL against product images + content blocks (`imageUrl` **and** gallery `imageUrls[]`) before calling `cloudinary.destroy`.
