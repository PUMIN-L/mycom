<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

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

## How every piece of work is done — one step at a time

The owner's rule (2026-11-20): every task is split into steps, and **each step
goes round this loop** before the next one starts.

```
1. สรุปงานขั้นนี้ให้ดูก่อน ──▶ 2. อ่านโค้ด/เอกสารที่เกี่ยวข้อง ──▶ 3. เขียนเทสต์ก่อน
                                                                      │
8. รายงานผล รอคำสั่ง ◀── 7. ลองใช้จริงบน DB ทดสอบ ◀── 6. ตรวจหาบั๊ก ◀── 5. ตรวจอัตโนมัติ ◀── 4. เขียนโค้ด
                                                         └─ เจอบั๊ก → แก้ → กลับไปข้อ 5 จนสะอาด
```

1. **Summarise the step first** — what it will change, in the owner's terms
   (in Thai), before anything is touched.
2. **Read the code and the docs it touches** — [`ARCHITECTURE.md`](./ARCHITECTURE.md),
   the files themselves, and the Next docs (above).
3. **Write the tests first**, and see them fail against the old code.
4. **Write the code.**
5. **Automatic checks** — `npx tsc --noEmit`; lint the touched files (no file
   may end up with more problems than it had); `npm run test:run`.
6. **Look for bugs** — read the whole diff. A bug found → fix it → back to 5,
   until it is clean.
7. **Try it for real on a TEST database**, never the live one (Vercel
   previews share the live database). There is none yet; until there is, the
   report says plainly that this step was skipped — the owner agreed to that.
8. **Report, then wait** — what was done, what the checks said, what was
   skipped — and stop for the owner's go before the next step. When the owner
   has asked for the whole job to run to the end, report each step and carry
   on, with every check still made.

A push is never part of a step: `main` is the live site (Vercel deploys it),
so pushing waits until the owner says to push.
