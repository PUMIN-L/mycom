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
      // Locked just below the achieved numbers (97.7 / 93.2 / 100 / 98.5) so a
      // regression fails CI, with a little headroom for trivial refactors.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 97,
        lines: 96
      }
    },
    alias: {
      '@': path.resolve(__dirname, './')
    }
  }
})
