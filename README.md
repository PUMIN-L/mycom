# Profin Lab Scale — CMS & Catalog

A trilingual (TH / EN / ZH) marketing + product-catalog site with a lightweight
admin CMS: manage products & rich "showcase" content, host PDF documents, receive
contact-form email, and build/export PDF quotations.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
MySQL/TiDB Cloud (`mysql2`) · Cloudinary · JWT sessions (`jose`) · Vercel.

> **New here? Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first** — it's the guide
> to how everything fits together. And note [`AGENTS.md`](./AGENTS.md): this is
> **Next.js 16**, which has breaking changes vs. older versions.

## Getting Started

```bash
npm install        # also wires up the pre-push test hook (via the "prepare" script)
npm run dev        # http://localhost:3000
```

You'll need a `.env.local` with the variables below before data-backed pages work.

## Environment Variables

```env
# Database (TiDB Cloud / MySQL)
DB_HOST=          DB_PORT=4000     DB_USER=
DB_PASSWORD=      DB_NAME=

# Auth — REQUIRED (the app throws at import without it)
SESSION_SECRET=

# Admin seed — set ADMIN_PASSWORD to create the admin user on first DB init.
# Leave it unset and NO admin is seeded (no weak default).
ADMIN_USERNAME=admin     ADMIN_PASSWORD=

# Cloudinary (images + PDF documents)
CLOUDINARY_CLOUD_NAME=   CLOUDINARY_API_KEY=   CLOUDINARY_API_SECRET=

# Email — contact form (Gmail App Password by default; host/port optional)
SMTP_USER=        SMTP_PASS=       SMTP_HOST=smtp.gmail.com   SMTP_PORT=465

# Cron secret — protects the quotation-cleanup cron
CRON_SECRET=

# Canonical site URL (optional; falls back to Vercel vars, then localhost:3000)
NEXT_PUBLIC_SITE_URL=
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#environment-variables) for what each one does.

## Scripts

```bash
npm run dev            # local dev server
npm run build          # production build
npm run start          # serve the build
npm run lint           # eslint
npm test               # vitest (watch mode)
npm run test:run       # vitest one-shot (also what the pre-push hook runs)
npm run test:coverage  # one-shot + coverage report + thresholds
npx tsc --noEmit       # typecheck
```

### Tests run before every push

A committed pre-push hook ([`.githooks/pre-push`](./.githooks/pre-push)) runs the
test suite and **blocks the push if anything fails**. It's activated automatically
by `npm install` (no husky/dependency). Emergency bypass: `git push --no-verify`.

## ⚠️ Cloudinary PDF Configuration

By default Cloudinary restricts delivery of PDF/ZIP files (Strict Delivery), so
the `react-pdf` viewer gets a `401 Unauthorized` (`deny or ACL failure`). To allow
PDFs to load:

1. Cloudinary Dashboard → **Settings** (⚙️) → **Security** tab.
2. Under **Restricted media types**, **uncheck** **"Delivery of PDF and ZIP files"**.
3. **Save**.

Without this, uploaded quotations/documents won't render.
