<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project specifics

- **Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing anything** — it's the
  map of the codebase (routes, stores, auth model, DB bootstrap, gotchas).
- **Tests must pass before you push.** A pre-push hook runs `vitest run` and blocks
  the push on failure. Run `npm run test:run` (one-shot) as you go — `npm test` is
  watch mode. New logic in `app/lib/**` or `app/api/**` should come with tests
  (patterns in [`ARCHITECTURE.md#testing`](./ARCHITECTURE.md#testing)).
- **Bump `SCHEMA_VERSION` in `app/lib/db.ts` whenever you change the DB schema**, or
  existing databases skip the migration.
- **Never use `jsdom`/`isomorphic-dompurify` server-side** — they break on Vercel.
  Sanitize with `sanitize-html` (see `app/lib/sanitizeHtml.ts`).
- **Every dropdown is `app/components/SearchableDropdown.tsx` — never a native
  `<select>`.** A native one is painted by the operating system, so on a
  dark-mode machine it opens as a dark grey popup in the middle of a white form.
  The shared component is white and styled like the rest of the admin UI, and it
  portals its panel to `<body>` so a scrolling modal cannot clip it. Pass
  `searchable={false}` when a handful of fixed options make the search box dead
  weight, and wrap it in a `<fieldset disabled>` for the disabled state (it has
  no `disabled` prop). This holds everywhere in the project, no exceptions.
