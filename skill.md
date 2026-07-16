# Project Skills & Tech Stack

This document outlines the technologies, frameworks, and libraries used in this project.

## Core Stack
- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **UI Library**: [React 19](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

## Styling
- **CSS Framework**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons/Fonts**: Geist font family via `next/font`

## Database & Data Fetching
- **Database**: MySQL (optimized for TiDB Cloud)
- **Database Driver**: `mysql2` (with pooled connections and query retries)
- **Data Fetching**: Server Components, Route Handlers (`fetch` API), React `use()`, `React.cache`

## Authentication & Security
- **Authentication**: Custom JWT session cookies
- **JWT Signing**: `jose`
- **Password Hashing**: `bcryptjs`

## Media & Storage
- **Media Hosting**: [Cloudinary](https://cloudinary.com/) (Images and PDF documents)
- **PDF Viewer**: `react-pdf` (v10.x, using modern `import.meta.url` worker initialization)

## State Management & Features
- **State Management**: React Context (`AuthContext`, `NavContext`)
- **i18n (Internationalization)**: Custom React Context (Supports TH, EN, ZH)

## Deployment
- **Platform**: [Vercel](https://vercel.com)

## Important Caveats & Quirks

### 1. Next.js `fetch` Proxying (Stream Corruption)
When proxying an external file via a Next.js App Router Route Handler (`NextResponse(response.body)`), Next.js `fetch` automatically decompresses gzipped bodies but retains the original headers if you blindly copy them.
- **Skill/Fix**: Always run `headers.delete("content-encoding")` and `headers.delete("content-length")` before returning the proxied stream to prevent the browser from attempting to decode an already uncompressed stream, which results in corrupted binaries (e.g., failed PDF renders).

### 2. Cloudinary PDF Strict Delivery
Cloudinary enforces strict delivery for `raw` PDF files by default to mitigate XSS risks, returning a `401 deny or ACL failure`.
- **Skill/Fix**: Instead of attempting to sign URLs (which still fail for raw deliveries under this policy), the global setting **"Delivery of PDF and ZIP files"** in the Cloudinary Security settings must be unchecked to allow public PDF delivery to `react-pdf`.
