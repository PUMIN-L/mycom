import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./__tests__/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Path A: measure the logic surface (pure helpers, DB stores, API route
      // handlers) — NOT the large React UI components/pages, which are covered by
      // the targeted component tests instead. Setting `include` makes v8 report
      // EVERY matching file, even ones with zero tests (Vitest 4's replacement
      // for the old `all` flag), so untested logic can't hide behind the
      // touched-files average and still trips the thresholds below.
      include: ['app/lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: [
        'node_modules/',
        '.next/',
        'vitest.config.ts',
        '**/*.d.ts',
        '__tests__/**',
        'app/lib/types.ts' // type-only declarations, no runtime code
      ],
      // Locked just below the achieved numbers (as of 2026-09-01: ~63.6 stmts /
      // 54.9 branch / 68.0 funcs / 64.9 lines — see ARCHITECTURE.md#testing for
      // why this is far from 100%) so a regression fails the pre-push gate,
      // with a little headroom for trivial refactors. This was previously set
      // to 95/90/97/96 without anything ever running `--coverage` to check it
      // — pure aspiration, not a real gate. Raise these numbers only by adding
      // real tests first; lowering them to dodge a failing push defeats the
      // point of having a floor at all.
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 63,
        lines: 61
      }
    },
    alias: {
      '@': path.resolve(__dirname, './')
    }
  }
})
